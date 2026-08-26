import * as fs from "node:fs/promises";
import path from "node:path";
import type { EnvGuardResult } from "../envGuard.ts";

export interface VirtualEnvStatus {
  isActive: boolean;
  venvPath?: string;
  isSystemPython: boolean;
  warningMessage?: string;
}

/**
 * Auto-detects active or local Python virtual environment (.venv, venv, env, VIRTUAL_ENV)
 */
export async function detectVirtualEnvironment(
  projectDir: string,
  env: Record<string, string | undefined> = process.env
): Promise<VirtualEnvStatus> {
  // Check shell environment variables
  if (env.VIRTUAL_ENV || env.POETRY_ACTIVE) {
    return {
      isActive: true,
      venvPath: env.VIRTUAL_ENV || "poetry-venv",
      isSystemPython: false,
    };
  }

  // Check local project directories
  const candidateDirs = [".venv", "venv", "env"];
  for (const dirName of candidateDirs) {
    const fullPath = path.join(projectDir, dirName);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        return {
          isActive: true,
          venvPath: fullPath,
          isSystemPython: false,
        };
      }
    } catch {}
  }

  return {
    isActive: false,
    isSystemPython: true,
    warningMessage:
      "🚨 Virtual Environment Warning: No active Python virtual environment (.venv, venv, VIRTUAL_ENV) detected.\n" +
      "Upgrading packages globally in system Python can cause system instability or permission failures.\n" +
      "Please activate a virtual environment (e.g. source .venv/bin/activate or venv\\Scripts\\activate) before running remediations.",
  };
}

/**
 * Environmental guard check for Python environment
 */
export function checkPythonEnvGuard(
  env: Record<string, string | undefined> = process.env,
  args: string[] = process.argv
): EnvGuardResult {
  const nodeEnv = (env.NODE_ENV || "").toLowerCase().trim();
  const envVar = (env.ENV || "").toLowerCase().trim();

  const isProduction =
    nodeEnv === "production" ||
    envVar === "production" ||
    args.includes("--production");

  const hasForceFlag = args.includes("--force") || args.includes("-f");

  if (isProduction && !hasForceFlag) {
    return {
      isProduction: true,
      hasForceFlag: false,
      shouldProceed: false,
      warningMessage:
        "🚨 PRODUCTION ENVIRONMENT DETECTED (NODE_ENV=production or --production flag).\n" +
        "Running dependency upgrades or code refactoring on a live production server can cause downtime.\n" +
        "To bypass this guard and force execution, re-run with the --force flag (e.g. npm start -- --force).",
    };
  }

  return {
    isProduction,
    hasForceFlag,
    shouldProceed: true,
  };
}
