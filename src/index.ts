#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { intro, outro, log, note, spinner, select, isCancel } from "@clack/prompts";
import { fetchBatchVulnerabilities } from "./osvClient.ts";
import { checkPackageDeprecation, evaluateRemediation } from "./evaulator.ts";
import { GitGuard } from "./vcs/gitGuard.ts";
import { isNoTargetVersionError, NoTargetVersionError } from "./runner/packageManager.ts";
import { getProjectName, ReportManager } from "./reporter/reportManager.ts";
import pLimit from "p-limit";
import { detectEcosystem, getEcosystemAdapter } from "./ecosystems/factory.ts";
import type { EcosystemType } from "./ecosystems/types.ts";

async function main() {
  intro("🛡️  Developer Tooling: Vuln Scanner & Local Dependency Remediation Engine");

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

  // Initialize ReportManager & start log capturing
  const projectName = await getProjectName(projectRootDir);
  const reportManager = new ReportManager(projectRootDir);
  await reportManager.init();
  reportManager.startCapturing();

  // 1. Detect or Select Ecosystem (Node.js vs Python)
  const detectedEco = await detectEcosystem(projectRootDir);

  const chosenEco = await select<EcosystemType>({
    message: `Select the target software ecosystem (auto-detected: ${detectedEco === "python" ? "Python" : "Node.js"}):`,
    options: [
      { value: "node", label: "Node.js", hint: detectedEco === "node" ? "auto-detected" : "npm, pnpm, yarn, bun" },
      { value: "python", label: "Python", hint: detectedEco === "python" ? "auto-detected" : "pip, poetry, uv, pipenv" },
    ],
    initialValue: detectedEco,
  });

  if (isCancel(chosenEco)) {
    outro("Operation cancelled.");
    process.exit(0);
  }

  const adapter = getEcosystemAdapter(chosenEco);
  log.info(`Active ecosystem selected: ${adapter.name}`);

  // 2. Production Environment Guard & Safety Check for selected ecosystem
  const envGuard = adapter.checkEnvGuard();
  if (!envGuard.shouldProceed) {
    log.error(envGuard.warningMessage!);
    process.exit(1);
  }

  if (envGuard.isProduction && envGuard.hasForceFlag) {
    log.warn(envGuard.warningMessage!);
  } else if (envGuard.warningMessage) {
    log.warn(envGuard.warningMessage);
  } else {
    log.info("ℹ️ Verified development environment mode.");
  }

  // 3. Detect & Select Package Manager
  const detectedPm = await adapter.detectPackageManager(projectRootDir);
  const pmOptions = adapter.getSupportedPackageManagers(detectedPm);

  const chosenPm = await select({
    message: `Select the package manager to use (auto-detected: ${detectedPm}):`,
    options: pmOptions,
    initialValue: detectedPm,
  });

  if (isCancel(chosenPm)) {
    outro("Operation cancelled.");
    process.exit(0);
  }

  log.info(`Active package manager selected: ${chosenPm}`);

  const gitGuard = new GitGuard(projectRootDir);
  const spin = spinner();

  // Safety Gate Check: Clean Git Working Tree
  const isClean = await gitGuard.isWorkingTreeClean();
  if (!isClean) {
    log.error("🚨 Git working directory has uncommitted modifications. Please commit or stash changes before running upgrades.");
    process.exit(1);
  }

  spin.start(`Scanning dependencies using ${chosenPm} lockfile parser and querying OSV.dev API...`);
  const queries = await adapter.parseLockfile(projectRootDir, chosenPm);
  const vulnMap = await fetchBatchVulnerabilities(queries);

  const limit = pLimit(20);

  const reports = await Promise.all(
    queries.map((q) =>
      limit(async () => {
        const key = `${q.package.name}@${q.version}`;
        const vulns = vulnMap[key] || [];
        const deprecationInfo = await checkPackageDeprecation(
          q.package.name,
          q.version,
          vulns,
          q.package.ecosystem === "PyPI" ? "PyPI" : "npm"
        );
        return evaluateRemediation(q.package.name, q.version, vulns, deprecationInfo);
      })
    )
  );

  const vulnerableItems = reports.filter((r) => r.vulnerabilities.length > 0 || r.isDeprecated || r.isPrivate);
  spin.stop(`Scan completed. Found ${vulnerableItems.length} vulnerable/deprecated/private packages.`);

  if (vulnerableItems.length === 0) {
    outro("🎉 Your dependencies are secure. No actions needed!");
    await reportManager.saveReport({
      projectName,
      scanTimestamp: new Date().toISOString(),
      totalDependenciesScanned: queries.length,
      vulnerablePackagesCount: 0,
      vulnerableItems: [],
    });
    return;
  }

  // Display summary table
  const summaryTable = vulnerableItems.map((item) => ({
    "Package Name": item.packageName,
    "Current Version": item.currentVersion,
    "Target Safe Version": item.remediation.targetVersion || "N/A",
    "Upgrade Severity": item.remediation.upgradeType,
    "Breaking Changes": item.remediation.hasBreakingChanges ? "Yes" : "No",
    "Status / Deprecated": item.isPrivate
      ? `PRIVATE (Not in ${chosenEco === "python" ? "PyPI" : "npm"} registry)`
      : item.isDeprecated
        ? `DEPRECATED (${item.deprecationReason || "No longer supported"})`
        : "Active",
  }));

  console.log("\n📋 Summary of Vulnerable & Deprecated Packages Identified:");
  console.table(summaryTable);
  console.log("");

  let autoApproveAll = false;
  let autoApproveCodemod = false;

  // Human-in-loop interactive remediation loop
  for (let i = 0; i < vulnerableItems.length; i++) {
    const pkg = vulnerableItems[i];
    const { packageName, currentVersion, remediation, isDeprecated, deprecationReason, isPrivate } = pkg;

    if (isPrivate) {
      log.warn(`⚠️ Package "${packageName}" is private/internal (not found in registry). Skipping installation.`);
      continue;
    }

    if (isDeprecated) {
      if (!remediation.targetVersion) {
        log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}) and has no safe target version. Skipping installation.`
        );
        continue;
      } else {
        log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}), but safe target version ${remediation.targetVersion} is available. Proceeding with upgrade...`
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
        `⚠️ Vulnerability Found [${i + 1}/${vulnerableItems.length}]: ${pkg.vulnerabilities[0]?.id || packageName}`
      );

      const choice = await select({
        message: `Do you want to prepare the upgrade remediation for ${packageName}? (${i + 1}/${vulnerableItems.length})`,
        options: [
          { value: "yes", label: "Yes", hint: "Upgrade this package" },
          { value: "yes-all", label: "Yes to All", hint: "Automatically upgrade all remaining packages" },
          { value: "no", label: "No", hint: "Skip this package" },
          { value: "no-all", label: "No to All", hint: "Cancel remaining upgrades and exit process smoothly" },
        ],
      });

      if (isCancel(choice) || choice === "no-all") {
        outro("Remediation process cancelled smoothly by user.");
        await reportManager.saveReport({
          projectName,
          scanTimestamp: new Date().toISOString(),
          totalDependenciesScanned: queries.length,
          vulnerablePackagesCount: vulnerableItems.length,
          vulnerableItems,
        });
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

    // Atomic snapshot before modifying filesystem
    await gitGuard.createSnapshot(packageName);

    try {
      // 1. AST Structural Refactoring for breaking upgrades
      if (remediation.hasBreakingChanges) {
        const rules = adapter.getRulesForPackage(packageName);
        if (rules) {
          let runCodemod = autoApproveCodemod || autoApproveAll;
          if (!runCodemod) {
            const confirmCodemod = await select({
              message: `🚨 ${packageName} has MAJOR breaking structural shifts. Run automated AST Refactoring Engine?`,
              options: [
                { value: "yes", label: "Yes", hint: "Run AST refactoring for this package" },
                { value: "yes-all", label: "Yes to All", hint: "Run AST refactoring for all breaking packages" },
                { value: "no", label: "No", hint: "Skip AST refactoring" },
                { value: "no-all", label: "No to All", hint: "Skip AST refactoring for all remaining breaking packages" },
              ],
            });

            if (isCancel(confirmCodemod) || confirmCodemod === "no-all") {
              runCodemod = false;
            } else if (confirmCodemod === "yes-all") {
              autoApproveCodemod = true;
              runCodemod = true;
            } else if (confirmCodemod === "yes") {
              runCodemod = true;
            }
          }

          if (runCodemod) {
            spin.start(`Running AST structural refactoring on source files...`);
            const count = await adapter.runCodemod(projectRootDir, rules);
            spin.stop(`AST refactoring complete. Modified structural elements in ${count} files.`);
          }
        } else {
          log.warn(`No pre-configured AST refactoring rules found for ${packageName}. Manual code changes might be required.`);
        }
      }

      // 2. Physical package upgrade execution
      spin.start(`Installing upgraded dependency via ${chosenPm}: ${packageName}@${remediation.targetVersion}...`);
      await adapter.installUpgrade(
        projectRootDir,
        {
          packageName,
          targetVersion: remediation.targetVersion,
        },
        chosenPm
      );
      spin.stop(`Package installed successfully via ${chosenPm}.`);

      // 3. Automated Test Verification Gate
      const testSuiteConfigured = await adapter.hasTestSuite(projectRootDir);

      if (!testSuiteConfigured) {
        log.warn(`⚠️ No test suite configured in target repository. Skipping test verification for ${packageName}.`);
        log.success(`✨ Package ${packageName} successfully updated.`);
        await gitGuard.commitSnapshot();
      } else {
        spin.start(`Executing verification test suite...`);
        const testsPassed = await adapter.verifyTestSuite(projectRootDir, chosenPm);

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
      const knownError = adapter.classifyError(pipelineError.message || "");

      if (knownError) {
        log.warn(`${knownError.userTitle}\n${knownError.userMessage}`);
        log.info(`👉 Recommendation: ${knownError.recommendation}`);
        await gitGuard.rollback();
      } else if (pipelineError instanceof NoTargetVersionError || isNoTargetVersionError(pipelineError.message || "")) {
        log.warn(
          `⚠️ Skipped upgrade for "${packageName}": Target version ${remediation.targetVersion} was not found on the registry.`
        );
        await gitGuard.rollback();
      } else {
        log.error(`Execution Error for ${packageName}: ${pipelineError.message}. Reverting package changes...`);
        await gitGuard.rollback();
      }
    }
  }

  outro("🏁 Pipeline transaction engine loop complete.");

  // Save report asynchronously right after scanning & upgrades complete
  const reportPath = await reportManager.saveReport({
    projectName,
    scanTimestamp: new Date().toISOString(),
    totalDependenciesScanned: queries.length,
    vulnerablePackagesCount: vulnerableItems.length,
    vulnerableItems,
  });

  // if (reportPath) {
  //   log.info(`📄 Scan report saved to: ${reportPath}`);
  // }
}

main().catch((err) => {
  console.error("An unhandled crash occurred inside the pipeline framework:", err);
  process.exit(1);
});
