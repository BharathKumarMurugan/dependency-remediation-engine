import fs from "fs/promises";
import path from "path";
import * as intro from "@clack/prompts";
import { parsePackageLock } from "./parser";
import { fetchBatchVulnerabilities } from "./osvClient";
import { evaluateRemediation } from "./evaulator";
import { getRulesForPackage } from "./codemod/registry";
import { applyStructuralCodemod } from "./codemod/astGrepRunner";
import { GitGuard } from "./vcs/gitGuard";
import { installUpgrade, verifyTestSuite } from "./runner/packageManager";

async function main() {
  intro.intro("🛡️  Developer Tooling MVP: Vuln Scanner & Remediation Engine");

  const targetPath = process.argv[2] || path.join(process.cwd(), "package-lock.json");
  let resolvedPath = targetPath;
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      resolvedPath = path.join(targetPath, "package-lock.json");
    }
  } catch (err) {
    // If path does not exist, let parsePackageLock handle the error
    console.error("Scan failed:", err);
    process.exit(1);
  }
  
  const projectRootDir = path.dirname(resolvedPath);
  const gitGuard = new GitGuard(projectRootDir);
  const spinner = intro.spinner();
  console.log("targetPath: ", targetPath);
  console.log("resolvedPath: ", resolvedPath);
  console.log("projectRootDir: ", projectRootDir);

  // Safety Gate Check
  const isClean = await gitGuard.isWorkingTreeClean();
  if (!isClean) {
    intro.log.error("🚨 Git working directory has uncommitted modifications. Please commit or stash changes before running upgrades.");
    process.exit(1);
  }

  spinner.start("Scanning lockfile and querying OSV.dev Hydration API...");
  const queries = await parsePackageLock(resolvedPath);
  const vulnMap = await fetchBatchVulnerabilities(queries);

  const reports = queries.map((q) => {
    const key = `${q.package.name}@${q.version}`;
    const vulns = vulnMap[key] || [];
    return evaluateRemediation(q.package.name, q.version, vulns);
  });

  const vulnerableItems = reports.filter((r) => r.vulnerabilities.length > 0);
  spinner.stop(`Scan completed. Found ${vulnerableItems.length} vulnerable packages.`);

  if (vulnerableItems.length === 0) {
    intro.outro("🎉 Your dependencies are secure. No actions needed!");
    return;
  }
  // Create safety rollback snapshot baseline
  await gitGuard.createSnapshot();

  // Human-in-loop interactive loop
  for (const pkg of vulnerableItems) {
    const { packageName, currentVersion, remediation } = pkg;

    intro.note(
      `Package: ${packageName}\n` +
        `Current Installed Version: ${currentVersion}\n` +
        `Target Safe Version: ${remediation.targetVersion || "N/A"}\n` +
        `Upgrade Path Severity: ${remediation.upgradeType} (Breaking Change: ${remediation.hasBreakingChanges})`,
      `⚠️ Vulnerability Found: ${pkg.vulnerabilities[0].id}`,
    );

    const shouldUpgrade = await intro.confirm({
      message: `Do you want to prepare the upgrade remediation for ${packageName}?`,
    });

    if (intro.isCancel(shouldUpgrade) || !shouldUpgrade) {
      continue;
    }

    try {
      // 1. Checking if codemods are needed for breaking upgrades
      if (remediation.hasBreakingChanges) {
        const rules = getRulesForPackage(packageName);
        if (rules) {
          const confirmCodemod = await intro.confirm({
            message: `🚨 This is a MAJOR upgrade containing breaking structural shifts. Run automated AST Refactoring Engine?`,
          });

          if (confirmCodemod && !intro.isCancel(confirmCodemod)) {
            spinner.start(`Running ast-grep refactoring on source files...`);
            const count = await applyStructuralCodemod(projectRootDir, rules);
            spinner.stop(`AST refactoring complete. Modified structural elements in ${count} files.`);
          }
        } else {
          intro.log.warn(`No pre-configured AST refactoring rules found for ${packageName}. Manual code changes might be required.`);
        }
      }

      // 2. Physical package upgrade execution
      spinner.start(`Installing upgraded dependency: ${packageName}@${remediation.targetVersion}...`);
      await installUpgrade(projectRootDir, {
        packageName,
        targetVersion: remediation.targetVersion,
      });
      spinner.stop(`Package installed successfully.`);

      // 3. Automated Test Verification Gate
      spinner.start(`Executing verification test suites ('npm test')...`);
      const testsPassed = await verifyTestSuite(projectRootDir);

      if (testsPassed) {
        spinner.stop(`Verification testing passed! Remediations successfully integrated.`);
        intro.log.success(`✨ Package ${packageName} successfully updated and verified.`);
      } else {
        spinner.stop(`Verification test suite FAILED.`);
        intro.log.error(`🚨 Post-upgrade test verification suite encountered errors. Triggering automated rollback transaction...`);

        await gitGuard.rollback();
        intro.log.warn(`↩️ Rollback complete. Filesystem reverted back to safe initialization state.`);
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
