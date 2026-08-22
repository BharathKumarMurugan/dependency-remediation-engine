#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { intro, outro, log, note, spinner, select, isCancel } from "@clack/prompts";
import { parsePackageLock } from "./parser.ts";
import { fetchBatchVulnerabilities } from "./osvClient.ts";
import { checkPackageDeprecation, evaluateRemediation } from "./evaulator.ts";
import { getRulesForPackage } from "./codemod/registry.ts";
import { applyStructuralCodemod } from "./codemod/astGrepRunner.ts";
import { GitGuard } from "./vcs/gitGuard.ts";
import { getProjectName, ReportManager } from "./reporter/reportManager.ts";
import { classifyNpmError } from "./runner/npmErrorClassifier.ts";
import pLimit from "p-limit";
import {
  detectPackageManager,
  hasTestSuite,
  installUpgrade,
  isNoTargetVersionError,
  NoTargetVersionError,
  verifyTestSuite,
} from "./runner/packageManager.ts";
import type { PackageManagerType } from "./runner/packageManager.ts";

async function main() {
  intro("🛡️  Developer Tooling MVP: Vuln Scanner & Remediation Engine");

  const targetPath = process.argv[2] || process.cwd();
  let projectRootDir = targetPath;
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      projectRootDir = path.dirname(targetPath);
    }
  } catch (err) {
    console.error("Scan failed: Target path not found:", targetPath);
    process.exit(1);
  }

  // const projectName = await getProjectName(projectRootDir);
  // const reportManager = new ReportManager(projectRootDir);
  // await reportManager.init();
  // reportManager.startCapturing();

  // 1. Detect Package Manager and ask user at the first step
  const detectedPm = await detectPackageManager(projectRootDir);

  const chosenPm = await select<PackageManagerType>({
    message: `Select the Node package manager to use (auto-detected: ${detectedPm}):`,
    options: [
      { value: "npm", label: "npm", hint: detectedPm === "npm" ? "auto-detected" : undefined },
      { value: "pnpm", label: "pnpm", hint: detectedPm === "pnpm" ? "auto-detected" : undefined },
      { value: "yarn", label: "yarn", hint: detectedPm === "yarn" ? "auto-detected" : undefined },
      { value: "bun", label: "bun", hint: detectedPm === "bun" ? "auto-detected" : undefined },
    ],
    initialValue: detectedPm,
  });

  if (isCancel(chosenPm)) {
    outro("Operation cancelled.");
    process.exit(0);
  }

  log.info(`Active package manager selected: ${chosenPm}`);

  const gitGuard = new GitGuard(projectRootDir);
  const spin = spinner();

  // Safety Gate Check
  const isClean = await gitGuard.isWorkingTreeClean();
  if (!isClean) {
    log.error("🚨 Git working directory has uncommitted modifications. Please commit or stash changes before running upgrades.");
    process.exit(1);
  }

  spin.start(`Scanning dependencies using ${chosenPm} lockfile parser and querying OSV.dev API...`);
  const queries = await parsePackageLock(projectRootDir, chosenPm);
  const vulnMap = await fetchBatchVulnerabilities(queries);

  const limit = pLimit(20);

  const reports = await Promise.all(
    queries.map((q) =>
      limit(async () => {
        const key = `${q.package.name}@${q.version}`;
        const vulns = vulnMap[key] || [];
        const deprecationInfo = await checkPackageDeprecation(q.package.name, q.version, vulns);
        return evaluateRemediation(q.package.name, q.version, vulns, deprecationInfo);
      })
    )
  );

  const vulnerableItems = reports.filter((r) => r.vulnerabilities.length > 0 || r.isDeprecated || r.isPrivate);
  spin.stop(`Scan completed. Found ${vulnerableItems.length} vulnerable/deprecated/private packages.`);

  if (vulnerableItems.length === 0) {
    outro("🎉 Your dependencies are secure. No actions needed!");
    return;
  }

  // Display summary table of all vulnerable, deprecated, or private packages found
  const summaryTable = vulnerableItems.map((item) => ({
    "Package Name": item.packageName,
    "Current Version": item.currentVersion,
    "Target Safe Version": item.remediation.targetVersion || "N/A",
    "Upgrade Severity": item.remediation.upgradeType,
    "Breaking Changes": item.remediation.hasBreakingChanges ? "Yes" : "No",
    "Status / Deprecated": item.isPrivate
      ? "PRIVATE (Not in npm registry)"
      : item.isDeprecated
        ? `DEPRECATED (${item.deprecationReason || "No longer supported"})`
        : "Active",
  }));

  console.log("\n📋 Summary of Vulnerable & Deprecated Packages Identified:");
  console.table(summaryTable);
  console.log("");

  let autoApproveAll = false;
  let autoApproveCodemod = false;

  // Human-in-loop interactive loop
  for (let i = 0; i < vulnerableItems.length; i++) {
    const pkg = vulnerableItems[i];
    const { packageName, currentVersion, remediation, isDeprecated, deprecationReason, isPrivate } = pkg;

    // Skip installation if package is private / internal (not found in public npm registry)
    if (isPrivate) {
      log.warn(`⚠️ Package "${packageName}" is a private/internal package (not found in public npm registry). Skipping installation.`);
      continue;
    }

    // Handle deprecated package logic: skip ONLY if no target safe version exists
    if (isDeprecated) {
      if (!remediation.targetVersion) {
        log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}) and has no safe target version available. Skipping installation.`,
        );
        continue;
      } else {
        log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}), but safe target version ${remediation.targetVersion} is available. Proceeding with upgrade...`,
        );
      }
    }

    let shouldUpgrade = false;

    if (autoApproveAll) {
      shouldUpgrade = true;
      log.info(`[${i + 1}/${vulnerableItems.length}] Auto-preparing upgrade for ${packageName}...`);
    } else {
      note(
        `Package: ${packageName}\n` +
          `Current Installed Version: ${currentVersion}\n` +
          `Target Safe Version: ${remediation.targetVersion || "N/A"}\n` +
          `Upgrade Path Severity: ${remediation.upgradeType} (Breaking Change: ${remediation.hasBreakingChanges})`,
        `⚠️ Vulnerability Found [${i + 1}/${vulnerableItems.length}]: ${pkg.vulnerabilities[0]?.id || packageName}`,
      );

      const choice = await select({
        message: `Do you want to prepare the upgrade remediation for ${packageName}? (${i + 1}/${vulnerableItems.length})`,
        options: [
          { value: "yes", label: "Yes", hint: "Upgrade this package" },
          { value: "yes-all", label: "Yes to All", hint: "Automatically upgrade all remaining packages" },
          { value: "no", label: "No", hint: "Skip this package" },
        ],
      });

      if (isCancel(choice)) {
        outro("Operation cancelled.");
        process.exit(0);
      }

      if (choice === "yes-all") {
        autoApproveAll = true;
        shouldUpgrade = true;
      } else if (choice === "yes") {
        shouldUpgrade = true;
      } else {
        shouldUpgrade = false;
      }
    }

    if (!shouldUpgrade) {
      continue;
    }

    // Create per-package snapshot before modifying filesystem for this package
    await gitGuard.createSnapshot(packageName);

    try {
      // 1. Checking if codemods are needed for breaking upgrades
      if (remediation.hasBreakingChanges) {
        const rules = getRulesForPackage(packageName);
        if (rules) {
          let runCodemod = autoApproveCodemod || autoApproveAll;
          if (!runCodemod) {
            const confirmCodemod = await select({
              message: `🚨 ${packageName} has MAJOR breaking structural shifts. Run automated AST Refactoring Engine?`,
              options: [
                { value: "yes", label: "Yes", hint: "Run AST refactoring for this package" },
                { value: "yes-all", label: "Yes to All", hint: "Run AST refactoring for all breaking packages" },
                { value: "no", label: "No", hint: "Skip AST refactoring" },
              ],
            });

            if (isCancel(confirmCodemod)) {
              outro("Operation cancelled.");
              process.exit(0);
            }

            if (confirmCodemod === "yes-all") {
              autoApproveCodemod = true;
              runCodemod = true;
            } else if (confirmCodemod === "yes") {
              runCodemod = true;
            }
          }

          if (runCodemod) {
            spin.start(`Running ast-grep refactoring on source files...`);
            const count = await applyStructuralCodemod(projectRootDir, rules);
            spin.stop(`AST refactoring complete. Modified structural elements in ${count} files.`);
          }
        } else {
          log.warn(`No pre-configured AST refactoring rules found for ${packageName}. Manual code changes might be required.`);
        }
      }

      // 2. Physical package upgrade execution using selected package manager
      spin.start(`Installing upgraded dependency via ${chosenPm}: ${packageName}@${remediation.targetVersion}...`);
      await installUpgrade(
        projectRootDir,
        {
          packageName,
          targetVersion: remediation.targetVersion,
        },
        chosenPm,
      );
      spin.stop(`Package installed successfully via ${chosenPm}.`);

      // 3. Automated Test Verification Gate using selected package manager
      const testSuiteConfigured = await hasTestSuite(projectRootDir);

      if (!testSuiteConfigured) {
        log.warn(`⚠️ No test suite configured in target repository. Skipping test verification for ${packageName}.`);
        log.success(`✨ Package ${packageName} successfully updated.`);
        await gitGuard.commitSnapshot();
      } else {
        spin.start(`Executing verification test suite ('${chosenPm} test')...`);
        const testsPassed = await verifyTestSuite(projectRootDir, chosenPm);

        if (testsPassed) {
          spin.stop(`Verification testing passed! Remediations successfully integrated.`);
          log.success(`✨ Package ${packageName} successfully updated and verified.`);
          await gitGuard.commitSnapshot();
        } else {
          spin.stop(`Verification test suite FAILED.`);
          log.error(`🚨 Post-upgrade test verification suite encountered errors. Triggering automated rollback transaction...`);

          await gitGuard.rollback();
          log.warn(`↩️ Rollback complete for ${packageName}. Filesystem reverted back to pre-upgrade state.`);
        }
      }
    } catch (pipelineError: any) {
      spin.stop(`Step skipped for ${packageName}.`);
      const knownError = classifyNpmError(pipelineError.message || "");

      if (knownError) {
        log.warn(`${knownError.userTitle}\n${knownError.userMessage}`);
        log.info(`👉 Recommendation: ${knownError.recommendation}`);
        await gitGuard.rollback();
      } else if (pipelineError instanceof NoTargetVersionError || isNoTargetVersionError(pipelineError.message || "")) {
        log.warn(
          `⚠️ Skipped upgrade for "${packageName}": Target version ${remediation.targetVersion} was not found on the ${chosenPm} registry (no matching version found).`,
        );
        await gitGuard.rollback();
      } else {
        log.error(`Execution Error for ${packageName}: ${pipelineError.message}. Reverting package changes...`);
        await gitGuard.rollback();
      }
    }
  }

  outro("🏁 Pipeline transaction engine loop complete.");

  // // Save report asynchronously right after scanning is done without disturbing terminal stdout
  // const reportPath = await reportManager.saveReport({
  //   projectName,
  //   scanTimestamp: new Date().toISOString(),
  //   totalDependenciesScanned: queries.length,
  //   vulnerablePackagesCount: vulnerableItems.length,
  //   vulnerableItems,
  // });

  // if (reportPath) {
  //   log.info(`📄 Scan report saved to: ${reportPath}`);
  // }
}

main().catch((err) => {
  console.error("An unhandled crash occurred inside the pipeline framework:", err);
  process.exit(1);
});
