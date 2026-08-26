import * as fs from "node:fs/promises";
import type { EcosystemAdapter, EcosystemType } from "./types.ts";
import { NodeEcosystemAdapter } from "./node/NodeEcosystemAdapter.ts";
import { PythonEcosystemAdapter } from "./python/PythonEcosystemAdapter.ts";

/**
 * Auto-detects whether the target project is a Python project or Node.js project based on manifest/lockfiles
 */
export async function detectEcosystem(projectDir: string): Promise<EcosystemType> {
  try {
    const files = await fs.readdir(projectDir);

    // Check Python manifest & lockfile indicators
    if (
      files.includes("requirements.txt") ||
      files.includes("poetry.lock") ||
      files.includes("pyproject.toml") ||
      files.includes("Pipfile.lock") ||
      files.includes("Pipfile") ||
      files.includes("uv.lock")
    ) {
      // If no Node lockfile exists, default to python
      if (
        !files.includes("package-lock.json") &&
        !files.includes("yarn.lock") &&
        !files.includes("pnpm-lock.yaml") &&
        !files.includes("bun.lock") &&
        !files.includes("bun.lockb")
      ) {
        return "python";
      }
    }

    // Default to Node.js ecosystem
    return "node";
  } catch {
    return "node";
  }
}

/**
 * Returns the EcosystemAdapter instance for the specified ecosystem
 */
export function getEcosystemAdapter(type: EcosystemType): EcosystemAdapter {
  if (type === "python") {
    return new PythonEcosystemAdapter();
  }
  return new NodeEcosystemAdapter();
}
