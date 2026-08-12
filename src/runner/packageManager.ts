import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface UpgradeTarget {
  packageName: string | null;
  targetVersion: string | null;
}

/**
 * Natively triggers npm install to upgrade the vulnerable package target
 */
export async function installUpgrade(projectDir: string, target: UpgradeTarget): Promise<void> {
  const command = `npm install ${target.packageName}@${target.targetVersion} --no-audit`;
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