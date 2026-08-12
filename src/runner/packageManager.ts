import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface UpgradeTarget {
  packageName: string | null;
  targetVersion: string | null;
}

/**
 * Checks if a package is explicitly listed in package.json dependencies / devDependencies
 */
export async function isDirectDependency(projectDir: string, packageName: string): Promise<boolean> {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
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

/**
 * Natively triggers npm install to upgrade the vulnerable package target.
 * Updates package.json ONLY for direct dependencies, and package-lock.json ONLY for transitive dependencies.
 */
export async function installUpgrade(projectDir: string, target: UpgradeTarget): Promise<void> {
  if (!target.packageName || !target.targetVersion) return;

  const direct = await isDirectDependency(projectDir, target.packageName);
  const saveFlag = direct ? '--save' : '--no-save';
  const command = `npm install ${target.packageName}@${target.targetVersion} ${saveFlag} --no-audit`;

  try {
    await execAsync(command, { cwd: projectDir });
  } catch (error: any) {
    throw new Error(`Installation failed for ${target.packageName}: ${error.message}`);
  }
}

/**
 * Runs the project's verification test runner suite.
 * Returns true if passes successfully, false if suite breaks or fails.
 */
export async function verifyTestSuite(projectDir: string): Promise<boolean> {
  try {
    // Executes standard test suite hook
    await execAsync('npm test', { cwd: projectDir });
    return true;
  } catch (error) {
    // If exit code is non-zero, the test suite broke
    return false;
  }
}