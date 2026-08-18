import fs from "fs/promises";
import path from "path";
import * as intro from "@clack/prompts";
import { parsePackageLock } from "./parser";
import { fetchBatchVulnerabilities } from "./osvClient";
import { checkPackageDeprecation, evaluateRemediation } from "./evaulator";
import { getRulesForPackage } from "./codemod/registry";
import { applyStructuralCodemod } from "./codemod/astGrepRunner";
import { GitGuard } from "./vcs/gitGuard";
import {
  detectPackageManager,
  hasTestSuite,
  installUpgrade,
  PackageManagerType,
  verifyTestSuite,
} from "./runner/packageManager";

async function main() {
  intro.intro("🛡️  Developer Tooling MVP: Vuln Scanner & Remediation Engine");

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

  // 1. Detect Package Manager and ask user at the first step
  const detectedPm = await detectPackageManager(projectRootDir);

  const chosenPm = await intro.select<PackageManagerType>({
    message: `Select the Node package manager to use (auto-detected: ${detectedPm}):`,
    options: [
      { value: "npm", label: "npm", hint: detectedPm === "npm" ? "auto-detected" : undefined },
      { value: "pnpm", label: "pnpm", hint: detectedPm === "pnpm" ? "auto-detected" : undefined },
      { value: "yarn", label: "yarn", hint: detectedPm === "yarn" ? "auto-detected" : undefined },
      { value: "bun", label: "bun", hint: detectedPm === "bun" ? "auto-detected" : undefined },
    ],
    initialValue: detectedPm,
  });

  if (intro.isCancel(chosenPm)) {
    intro.outro("Operation cancelled.");
    process.exit(0);
  }

  intro.log.info(`Active package manager selected: ${chosenPm}`);

  const gitGuard = new GitGuard(projectRootDir);
  const spinner = intro.spinner();

  // Safety Gate Check
  const isClean = await gitGuard.isWorkingTreeClean();
  if (!isClean) {
    intro.log.error("🚨 Git working directory has uncommitted modifications. Please commit or stash changes before running upgrades.");
    process.exit(1);
  }

  spinner.start(`Scanning dependencies using ${chosenPm} lockfile parser and querying OSV.dev API...`);
  const queries = await parsePackageLock(projectRootDir, chosenPm);
  const vulnMap = await fetchBatchVulnerabilities(queries);

  const reports = await Promise.all(
    queries.map(async (q) => {
      const key = `${q.package.name}@${q.version}`;
      const vulns = vulnMap[key] || [];
      const deprecationInfo = await checkPackageDeprecation(q.package.name, q.version, vulns);
      return evaluateRemediation(q.package.name, q.version, vulns, deprecationInfo);
    })
  );

  const vulnerableItems = reports.filter((r) => r.vulnerabilities.length > 0 || r.isDeprecated);
  spinner.stop(`Scan completed. Found ${vulnerableItems.length} vulnerable/deprecated packages.`);

  if (vulnerableItems.length === 0) {
    intro.outro("🎉 Your dependencies are secure. No actions needed!");
    return;
  }

  // Display summary table of all vulnerable or deprecated packages found
  const summaryTable = vulnerableItems.map((item) => ({
    "Package Name": item.packageName,
    "Current Version": item.currentVersion,
    "Target Safe Version": item.remediation.targetVersion || "N/A",
    "Upgrade Severity": item.remediation.upgradeType,
    "Breaking Changes": item.remediation.hasBreakingChanges ? "Yes" : "No",
    "Status / Deprecated": item.isDeprecated
      ? `DEPRECATED (${item.deprecationReason || "No longer supported"})`
      : "Active",
  }));

  console.log("\n📋 Summary of Vulnerable & Deprecated Packages Identified:");
  console.table(summaryTable);
  console.log("");

  // Create safety rollback snapshot baseline
  await gitGuard.createSnapshot();

  let autoApproveAll = false;
  let autoApproveCodemod = false;

  // Human-in-loop interactive loop
  for (let i = 0; i < vulnerableItems.length; i++) {
    const pkg = vulnerableItems[i];
    const { packageName, currentVersion, remediation, isDeprecated, deprecationReason } = pkg;

    // Handle deprecated package logic: skip ONLY if no target safe version exists
    if (isDeprecated) {
      if (!remediation.targetVersion) {
        intro.log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}) and has no safe target version available. Skipping installation.`
        );
        continue;
      } else {
        intro.log.warn(
          `⚠️ Package "${packageName}" is DEPRECATED (${deprecationReason || "No longer supported"}), but safe target version ${remediation.targetVersion} is available. Proceeding with upgrade...`
        );
      }
    }

    let shouldUpgrade = false;

    if (autoApproveAll) {
      shouldUpgrade = true;
      intro.log.info(`[${i + 1}/${vulnerableItems.length}] Auto-preparing upgrade for ${packageName}...`);
    } else {
      intro.note(
        `Package: ${packageName}\n` +
          `Current Installed Version: ${currentVersion}\n` +
          `Target Safe Version: ${remediation.targetVersion || "N/A"}\n` +
          `Upgrade Path Severity: ${remediation.upgradeType} (Breaking Change: ${remediation.hasBreakingChanges})`,
        `⚠️ Vulnerability Found [${i + 1}/${vulnerableItems.length}]: ${pkg.vulnerabilities[0]?.id || packageName}`,
      );

      const choice = await intro.select({
        message: `Do you want to prepare the upgrade remediation for ${packageName}? (${i + 1}/${vulnerableItems.length})`,
        options: [
          { value: "yes", label: "Yes", hint: "Upgrade this package" },
          { value: "yes-all", label: "Yes to All", hint: "Automatically upgrade all remaining packages" },
          { value: "no", label: "No", hint: "Skip this package" },
        ],
      });

      if (intro.isCancel(choice)) {
        intro.outro("Operation cancelled.");
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

    try {
      // 1. Checking if codemods are needed for breaking upgrades
      if (remediation.hasBreakingChanges) {
        const rules = getRulesForPackage(packageName);
        if (rules) {
          let runCodemod = autoApproveCodemod || autoApproveAll;
          if (!runCodemod) {
            const confirmCodemod = await intro.select({
              message: `🚨 ${packageName} has MAJOR breaking structural shifts. Run automated AST Refactoring Engine?`,
              options: [
                { value: "yes", label: "Yes", hint: "Run AST refactoring for this package" },
                { value: "yes-all", label: "Yes to All", hint: "Run AST refactoring for all breaking packages" },
                { value: "no", label: "No", hint: "Skip AST refactoring" },
              ],
            });

            if (intro.isCancel(confirmCodemod)) {
              intro.outro("Operation cancelled.");
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
            spinner.start(`Running ast-grep refactoring on source files...`);
            const count = await applyStructuralCodemod(projectRootDir, rules);
            spinner.stop(`AST refactoring complete. Modified structural elements in ${count} files.`);
          }
        } else {
          intro.log.warn(`No pre-configured AST refactoring rules found for ${packageName}. Manual code changes might be required.`);
        }
      }

      // 2. Physical package upgrade execution using selected package manager
      spinner.start(`Installing upgraded dependency via ${chosenPm}: ${packageName}@${remediation.targetVersion}...`);
      await installUpgrade(
        projectRootDir,
        {
          packageName,
          targetVersion: remediation.targetVersion,
        },
        chosenPm
      );
      spinner.stop(`Package installed successfully via ${chosenPm}.`);

      // 3. Automated Test Verification Gate using selected package manager
      const testSuiteConfigured = await hasTestSuite(projectRootDir);

      if (!testSuiteConfigured) {
        intro.log.warn(`⚠️ No test suite configured in target repository. Skipping test verification for ${packageName}.`);
        intro.log.success(`✨ Package ${packageName} successfully updated.`);
      } else {
        spinner.start(`Executing verification test suite ('${chosenPm} test')...`);
        const testsPassed = await verifyTestSuite(projectRootDir, chosenPm);

        if (testsPassed) {
          spinner.stop(`Verification testing passed! Remediations successfully integrated.`);
          intro.log.success(`✨ Package ${packageName} successfully updated and verified.`);
        } else {
          spinner.stop(`Verification test suite FAILED.`);
          intro.log.error(`🚨 Post-upgrade test verification suite encountered errors. Triggering automated rollback transaction...`);

          await gitGuard.rollback();
          intro.log.warn(`↩️ Rollback complete. Filesystem reverted back to safe initialization state.`);
        }
      }
    } catch (pipelineError: any) {
      spinner.stop(`Pipeline execution broken.`);
      intro.log.error(`Execution Error: ${pipelineError.message}. Triggering absolute rollback reset...`);
      await gitGuard.rollback();
    }
  }

  intro.outro("🏁 Pipeline transaction engine loop complete.");
}

main().catch((err) => {
  console.error("An unhandled crash occurred inside the pipeline framework:", err);
  process.exit(1);
});
