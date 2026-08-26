import type { OSVQuery } from "../types.ts";
import type { CodemodRule } from "../codemod/astGrepRunner.ts";
import type { EnvGuardResult } from "../runner/envGuard.ts";

export type EcosystemType = "node" | "python";

export interface UpgradeTarget {
  packageName: string | null;
  targetVersion: string | null;
}

export interface UserFacingError {
  userTitle: string;
  userMessage: string;
  recommendation: string;
}

export interface EcosystemAdapter {
  name: string;
  ecosystemType: EcosystemType;
  detectPackageManager(projectDir: string): Promise<string>;
  getSupportedPackageManagers(autoDetected: string): Array<{ value: string; label: string; hint?: string }>;
  parseLockfile(projectDir: string, pm: string): Promise<OSVQuery[]>;
  installUpgrade(projectDir: string, target: UpgradeTarget, pm: string): Promise<void>;
  hasTestSuite(projectDir: string): Promise<boolean>;
  verifyTestSuite(projectDir: string, pm: string): Promise<boolean>;
  getRulesForPackage(packageName: string): CodemodRule[] | null;
  runCodemod(projectDir: string, rules: CodemodRule[]): Promise<number>;
  classifyError(errorMessage: string): UserFacingError | null;
  checkEnvGuard(): EnvGuardResult;
}
