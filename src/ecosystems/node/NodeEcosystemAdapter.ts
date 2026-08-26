import type { CodemodRule } from "../../codemod/astGrepRunner.ts";
import type { EcosystemAdapter, EcosystemType, UpgradeTarget, UserFacingError } from "../types.ts";
import { parsePackageLock } from "../../parser.ts";
import {
  detectPackageManager,
  hasTestSuite,
  installUpgrade,
  PACKAGE_MANAGERS,
  verifyTestSuite,
} from "../../runner/packageManager.ts";
import type { PackageManagerType } from "../../runner/packageManager.ts";
import { classifyNpmError } from "../../runner/npmErrorClassifier.ts";
import { checkProductionGuard } from "../../runner/envGuard.ts";
import { getRulesForPackage } from "../../codemod/registry.ts";
import { applyStructuralCodemod } from "../../codemod/astGrepRunner.ts";
import type { OSVQuery } from "../../types.ts";
import type { EnvGuardResult } from "../../runner/envGuard.ts";

export class NodeEcosystemAdapter implements EcosystemAdapter {
  name = "Node.js (npm)";
  ecosystemType: EcosystemType = "node";

  async detectPackageManager(projectDir: string): Promise<string> {
    return detectPackageManager(projectDir);
  }

  getSupportedPackageManagers(autoDetected: string): Array<{ value: string; label: string; hint?: string }> {
    return [
      { value: "npm", label: "npm", hint: autoDetected === "npm" ? "auto-detected" : undefined },
      { value: "pnpm", label: "pnpm", hint: autoDetected === "pnpm" ? "auto-detected" : undefined },
      { value: "yarn", label: "yarn", hint: autoDetected === "yarn" ? "auto-detected" : undefined },
      { value: "bun", label: "bun", hint: autoDetected === "bun" ? "auto-detected" : undefined },
    ];
  }

  async parseLockfile(projectDir: string, pm: string): Promise<OSVQuery[]> {
    return parsePackageLock(projectDir, pm as PackageManagerType);
  }

  async installUpgrade(projectDir: string, target: UpgradeTarget, pm: string): Promise<void> {
    return installUpgrade(projectDir, target, pm as PackageManagerType);
  }

  async hasTestSuite(projectDir: string): Promise<boolean> {
    return hasTestSuite(projectDir);
  }

  async verifyTestSuite(projectDir: string, pm: string): Promise<boolean> {
    return verifyTestSuite(projectDir, pm as PackageManagerType);
  }

  getRulesForPackage(packageName: string): CodemodRule[] | null {
    return getRulesForPackage(packageName);
  }

  async runCodemod(projectDir: string, rules: CodemodRule[]): Promise<number> {
    return applyStructuralCodemod(projectDir, rules);
  }

  classifyError(errorMessage: string): UserFacingError | null {
    return classifyNpmError(errorMessage);
  }

  checkEnvGuard(): EnvGuardResult {
    return checkProductionGuard();
  }
}
