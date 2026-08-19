import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

export type PackageManagerType = "npm" | "pnpm" | "yarn" | "bun";

export interface UpgradeTarget {
  packageName: string | null;
  targetVersion: string | null;
}

export interface PackageManagerConfig {
  name: PackageManagerType;
  lockfile: string;
  installDirectCmd: (pkg: string, version: string) => string;
  installTransitiveCmd: (pkg: string, version: string) => string;
  installLegacyDirectCmd: (pkg: string, version: string) => string;
  installLegacyTransitiveCmd: (pkg: string, version: string) => string;
  cacheCleanCmd: string;
  testCmd: string;
}

export const PACKAGE_MANAGERS: Record<PackageManagerType, PackageManagerConfig> = {
  npm: {
    name: "npm",
    lockfile: "package-lock.json",
    installDirectCmd: (pkg, ver) => `npm install ${pkg}@${ver} --save --no-audit`,
    installTransitiveCmd: (pkg, ver) => `npm install ${pkg}@${ver} --no-save --no-audit`,
    installLegacyDirectCmd: (pkg, ver) => `npm install ${pkg}@${ver} --legacy-peer-deps --save --no-audit`,
    installLegacyTransitiveCmd: (pkg, ver) => `npm install ${pkg}@${ver} --legacy-peer-deps --no-save --no-audit`,
    cacheCleanCmd: "npm cache clean --force",
    testCmd: "npm test",
  },
  pnpm: {
    name: "pnpm",
    lockfile: "pnpm-lock.yaml",
    installDirectCmd: (pkg, ver) => `pnpm add ${pkg}@${ver}`,
    installTransitiveCmd: (pkg, ver) => `pnpm update ${pkg}@${ver}`,
    installLegacyDirectCmd: (pkg, ver) => `pnpm add ${pkg}@${ver} --no-strict-peer-dependencies`,
    installLegacyTransitiveCmd: (pkg, ver) => `pnpm update ${pkg}@${ver} --no-strict-peer-dependencies`,
    cacheCleanCmd: "pnpm store prune",
    testCmd: "pnpm test",
  },
  yarn: {
    name: "yarn",
    lockfile: "yarn.lock",
    installDirectCmd: (pkg, ver) => `yarn add ${pkg}@${ver}`,
    installTransitiveCmd: (pkg, ver) => `yarn upgrade ${pkg}@${ver}`,
    installLegacyDirectCmd: (pkg, ver) => `yarn add ${pkg}@${ver} --ignore-engines`,
    installLegacyTransitiveCmd: (pkg, ver) => `yarn upgrade ${pkg}@${ver} --ignore-engines`,
    cacheCleanCmd: "yarn cache clean",
    testCmd: "yarn test",
  },
  bun: {
    name: "bun",
    lockfile: "bun.lock",
    installDirectCmd: (pkg, ver) => `bun add ${pkg}@${ver}`,
    installTransitiveCmd: (pkg, ver) => `bun add ${pkg}@${ver} --no-save`,
    installLegacyDirectCmd: (pkg, ver) => `bun add ${pkg}@${ver} --force`,
    installLegacyTransitiveCmd: (pkg, ver) => `bun add ${pkg}@${ver} --no-save --force`,
    cacheCleanCmd: "bun pm cache rm",
    testCmd: "bun test",
  },
};

/**
 * Detects package manager based on lockfiles present in project directory
 */
export async function detectPackageManager(projectDir: string): Promise<PackageManagerType> {
  try {
    const files = await fs.readdir(projectDir);
    if (files.includes("pnpm-lock.yaml")) return "pnpm";
    if (files.includes("yarn.lock")) return "yarn";
    if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun";
    if (files.includes("package-lock.json")) return "npm";
  } catch {}
  return "npm";
}

/**
 * Checks if a package is explicitly listed in package.json dependencies / devDependencies
 */
export async function isDirectDependency(projectDir: string, packageName: string): Promise<boolean> {
  try {
    const pkgPath = path.join(projectDir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    const isDep = Boolean(pkg.dependencies && pkg.dependencies[packageName]);
    const isDevDep = Boolean(pkg.devDependencies && pkg.devDependencies[packageName]);
    const isPeerDep = Boolean(pkg.peerDependencies && pkg.peerDependencies[packageName]);
    const isOptDep = Boolean(pkg.optionalDependencies && pkg.optionalDependencies[packageName]);

    return isDep || isDevDep || isPeerDep || isOptDep;
  } catch {
    return false;
  }
}

export class NoTargetVersionError extends Error {
  constructor(packageName: string, targetVersion: string, originalMessage: string) {
    super(`No matching version "${targetVersion}" found for package "${packageName}": ${originalMessage}`);
    this.name = "NoTargetVersionError";
  }
}

export function isNoTargetVersionError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("notarget") ||
    msg.includes("etarget") ||
    msg.includes("no matching version") ||
    msg.includes("couldn't find any versions") ||
    msg.includes("could not find any versions") ||
    msg.includes("versionnotfound") ||
    msg.includes("packagenotfound") ||
    msg.includes("no versions available")
  );
}

export function isPeerDependencyError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("eresolve") ||
    msg.includes("could not resolve dependency") ||
    msg.includes("peer dependency") ||
    msg.includes("peerdependencies") ||
    msg.includes("conflicting peer") ||
    msg.includes("unable to resolve dependency tree") ||
    msg.includes("peer_dep_issues")
  );
}

/**
 * Executes installation upgrade for a package using the chosen package manager.
 * Updates package.json ONLY for direct dependencies, and lockfile ONLY for transitive dependencies.
 * Automatically cleans cache and retries with legacy peer deps / force flags if peer dependency conflicts occur.
 */
export async function installUpgrade(
  projectDir: string,
  target: UpgradeTarget,
  pm: PackageManagerType = "npm"
): Promise<void> {
  if (!target.packageName || !target.targetVersion) return;

  const config = PACKAGE_MANAGERS[pm] || PACKAGE_MANAGERS.npm;
  const direct = await isDirectDependency(projectDir, target.packageName);
  const command = direct
    ? config.installDirectCmd(target.packageName, target.targetVersion)
    : config.installTransitiveCmd(target.packageName, target.targetVersion);

  try {
    await execAsync(command, { cwd: projectDir });
  } catch (error: any) {
    const errorMsg = error.message || "";

    if (isNoTargetVersionError(errorMsg)) {
      throw new NoTargetVersionError(target.packageName, target.targetVersion, errorMsg);
    }

    if (isPeerDependencyError(errorMsg)) {
      // 1. Clean cache for clean resolution
      try {
        await execAsync(config.cacheCleanCmd, { cwd: projectDir });
      } catch {}

      // 2. Retry with legacy peer deps / force flags
      const fallbackCommand = direct
        ? config.installLegacyDirectCmd(target.packageName, target.targetVersion)
        : config.installLegacyTransitiveCmd(target.packageName, target.targetVersion);

      try {
        await execAsync(fallbackCommand, { cwd: projectDir });
        return;
      } catch (fallbackError: any) {
        throw new Error(
          `Installation failed for ${target.packageName} using ${pm} (even with legacy peer deps flag): ${fallbackError.message}`
        );
      }
    }

    throw new Error(`Installation failed for ${target.packageName} using ${pm}: ${errorMsg}`);
  }
}

/**
 * Checks if the target repository has a valid, configured test suite script in package.json
 */
export async function hasTestSuite(projectDir: string): Promise<boolean> {
  try {
    const pkgPath = path.join(projectDir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    const testScript = pkg.scripts?.test;
    if (!testScript || typeof testScript !== "string") return false;

    const normalized = testScript.trim().toLowerCase();

    // Check for standard unconfigured default npm test script
    if (
      normalized.includes("no test specified") ||
      normalized === "exit 0" ||
      normalized === "exit 1" ||
      normalized.startsWith('echo "error:') ||
      normalized.startsWith("echo 'error:")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the project's verification test runner suite using the chosen package manager.
 * Returns true if passes successfully, false if suite breaks or fails.
 * If no test suite is configured in the repository, skips execution and returns true.
 */
export async function verifyTestSuite(
  projectDir: string,
  pm: PackageManagerType = "npm"
): Promise<boolean> {
  const hasTests = await hasTestSuite(projectDir);
  if (!hasTests) {
    return true;
  }

  const config = PACKAGE_MANAGERS[pm] || PACKAGE_MANAGERS.npm;
  try {
    await execAsync(config.testCmd, { cwd: projectDir });
    return true;
  } catch (error) {
    return false;
  }
}