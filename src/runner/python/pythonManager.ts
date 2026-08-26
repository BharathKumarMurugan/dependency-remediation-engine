import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import type { UpgradeTarget } from "../../ecosystems/types.ts";
import { detectVirtualEnvironment } from "./pythonEnvDetector.ts";

const execAsync = promisify(exec);

export type PythonPackageManagerType = "pip" | "poetry" | "uv" | "pipenv";

export interface PythonPMConfig {
  name: PythonPackageManagerType;
  lockfile: string;
  installCmd: (pkg: string, ver: string) => string;
  testCmd: string;
}

export const PYTHON_PACKAGE_MANAGERS: Record<PythonPackageManagerType, PythonPMConfig> = {
  pip: {
    name: "pip",
    lockfile: "requirements.txt",
    installCmd: (pkg, ver) => `pip install "${pkg}==${ver}"`,
    testCmd: "pytest",
  },
  poetry: {
    name: "poetry",
    lockfile: "poetry.lock",
    installCmd: (pkg, ver) => `poetry add "${pkg}==${ver}"`,
    testCmd: "poetry run pytest",
  },
  uv: {
    name: "uv",
    lockfile: "uv.lock",
    installCmd: (pkg, ver) => `uv add "${pkg}==${ver}"`,
    testCmd: "uv run pytest",
  },
  pipenv: {
    name: "pipenv",
    lockfile: "Pipfile.lock",
    installCmd: (pkg, ver) => `pipenv install "${pkg}==${ver}"`,
    testCmd: "pipenv run pytest",
  },
};

/**
 * Auto-detects Python package manager based on lockfiles/manifests present in project
 */
export async function detectPythonPackageManager(projectDir: string): Promise<PythonPackageManagerType> {
  try {
    const files = await fs.readdir(projectDir);
    if (files.includes("poetry.lock") || files.includes("pyproject.toml")) return "poetry";
    if (files.includes("uv.lock")) return "uv";
    if (files.includes("Pipfile.lock") || files.includes("Pipfile")) return "pipenv";
    if (files.includes("requirements.txt") || files.includes("constraints.txt")) return "pip";
  } catch {}
  return "pip";
}

/**
 * Injects transitive constraint rule into constraints.txt or requirements.txt for pip
 */
export async function applyPythonTransitiveConstraint(
  projectDir: string,
  packageName: string,
  targetVersion: string
): Promise<void> {
  const reqFiles = ["constraints.txt", "requirements.txt"];
  for (const file of reqFiles) {
    const filePath = path.join(projectDir, file);
    try {
      let content = "";
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {}

      const constraintLine = `${packageName}==${targetVersion}`;
      if (!content.includes(packageName)) {
        const updated = content ? `${content.trim()}\n${constraintLine}\n` : `${constraintLine}\n`;
        await fs.writeFile(filePath, updated, "utf-8");
      } else {
        const regex = new RegExp(`^${packageName}\\s*(?:==|===|>=|~=|>|=|<=|<)?.*$`, "m");
        const updated = content.replace(regex, constraintLine);
        await fs.writeFile(filePath, updated, "utf-8");
      }
      break;
    } catch {}
  }
}

/**
 * Executes installation upgrade for a Python package using detected package manager.
 * Warns if no virtual environment is active.
 */
export async function installPythonUpgrade(
  projectDir: string,
  target: UpgradeTarget,
  pm: string = "pip"
): Promise<void> {
  if (!target.packageName || !target.targetVersion) return;

  const venvStatus = await detectVirtualEnvironment(projectDir);
  if (!venvStatus.isActive) {
    console.warn(`\n${venvStatus.warningMessage}\n`);
  }

  const pmType = (PYTHON_PACKAGE_MANAGERS[pm as PythonPackageManagerType] ? pm : "pip") as PythonPackageManagerType;
  const config = PYTHON_PACKAGE_MANAGERS[pmType];

  // Apply constraints.txt / requirements.txt transitive override if pip is used
  if (pmType === "pip") {
    await applyPythonTransitiveConstraint(projectDir, target.packageName, target.targetVersion);
  }

  const command = config.installCmd(target.packageName, target.targetVersion);

  try {
    await execAsync(command, { cwd: projectDir });
  } catch (error: any) {
    throw new Error(`Python installation failed for ${target.packageName} using ${pmType}: ${error.message}`);
  }
}

/**
 * Checks if a Python test suite (pytest or unittest) is available
 */
export async function hasPythonTestSuite(projectDir: string): Promise<boolean> {
  try {
    const files = await fs.readdir(projectDir);
    if (files.includes("pytest.ini") || files.includes("conftest.py") || files.includes("pyproject.toml")) return true;

    // Check for tests directory or test_*.py files
    if (files.includes("tests") || files.includes("test")) return true;

    for (const f of files) {
      if (f.startsWith("test_") && f.endsWith(".py")) return true;
    }
  } catch {}
  return false;
}

/**
 * Runs Python test verification suite (pytest or python -m unittest)
 */
export async function verifyPythonTestSuite(projectDir: string, pm: string = "pip"): Promise<boolean> {
  const hasTests = await hasPythonTestSuite(projectDir);
  if (!hasTests) {
    return true;
  }

  const pmType = (PYTHON_PACKAGE_MANAGERS[pm as PythonPackageManagerType] ? pm : "pip") as PythonPackageManagerType;

  // Try pytest first, then fallback to python -m unittest
  try {
    const cmd = pmType === "poetry" ? "poetry run pytest" : pmType === "uv" ? "uv run pytest" : pmType === "pipenv" ? "pipenv run pytest" : "pytest";
    await execAsync(cmd, { cwd: projectDir });
    return true;
  } catch {
    try {
      await execAsync("python -m unittest discover", { cwd: projectDir });
      return true;
    } catch {
      return false;
    }
  }
}
