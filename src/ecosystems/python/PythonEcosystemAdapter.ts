import type { CodemodRule } from "../../codemod/astGrepRunner.ts";
import type { EcosystemAdapter, EcosystemType, UpgradeTarget, UserFacingError } from "../types.ts";
import { parsePythonLockfile } from "../../parser/python/pythonParser.ts";
import {
  detectPythonPackageManager,
  hasPythonTestSuite,
  installPythonUpgrade,
  PYTHON_PACKAGE_MANAGERS,
  verifyPythonTestSuite,
} from "../../runner/python/pythonManager.ts";
import { classifyPythonError } from "../../runner/python/pythonErrorClassifier.ts";
import { checkPythonEnvGuard } from "../../runner/python/pythonEnvDetector.ts";
import { getPythonRulesForPackage } from "../../codemod/python/pythonRegistry.ts";
import { applyPythonStructuralCodemod } from "../../codemod/python/pythonAstRunner.ts";
import type { OSVQuery } from "../../types.ts";
import type { EnvGuardResult } from "../../runner/envGuard.ts";

export class PythonEcosystemAdapter implements EcosystemAdapter {
  name = "Python (PyPI)";
  ecosystemType: EcosystemType = "python";

  async detectPackageManager(projectDir: string): Promise<string> {
    return detectPythonPackageManager(projectDir);
  }

  getSupportedPackageManagers(autoDetected: string): Array<{ value: string; label: string; hint?: string }> {
    return [
      { value: "pip", label: "pip", hint: autoDetected === "pip" ? "auto-detected" : undefined },
      { value: "poetry", label: "poetry", hint: autoDetected === "poetry" ? "auto-detected" : undefined },
      { value: "uv", label: "uv", hint: autoDetected === "uv" ? "auto-detected" : undefined },
      { value: "pipenv", label: "pipenv", hint: autoDetected === "pipenv" ? "auto-detected" : undefined },
    ];
  }

  async parseLockfile(projectDir: string, pm: string): Promise<OSVQuery[]> {
    return parsePythonLockfile(projectDir, pm);
  }

  async installUpgrade(projectDir: string, target: UpgradeTarget, pm: string): Promise<void> {
    return installPythonUpgrade(projectDir, target, pm);
  }

  async hasTestSuite(projectDir: string): Promise<boolean> {
    return hasPythonTestSuite(projectDir);
  }

  async verifyTestSuite(projectDir: string, pm: string): Promise<boolean> {
    return verifyPythonTestSuite(projectDir, pm);
  }

  getRulesForPackage(packageName: string): CodemodRule[] | null {
    return getPythonRulesForPackage(packageName);
  }

  async runCodemod(projectDir: string, rules: CodemodRule[]): Promise<number> {
    return applyPythonStructuralCodemod(projectDir, rules);
  }

  classifyError(errorMessage: string): UserFacingError | null {
    return classifyPythonError(errorMessage);
  }

  checkEnvGuard(): EnvGuardResult {
    return checkPythonEnvGuard();
  }
}
