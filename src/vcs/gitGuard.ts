import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GitGuard {
  private projectDir: string;
  private backupStashSHA: string | null = null;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /**
   * Validates that the working tree is clean before running risky operations
   */
  async isWorkingTreeClean(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.projectDir });
      return stdout.trim().length === 0;
    } catch {
      return false; // Not a git repo or git not found
    }
  }

  /**
   * Creates a backup point by committing or stashing current progress
   */
  async createSnapshot(): Promise<void> {
    try {
      // Stash everything including untracked files to create an atomic rollback point
      await execAsync('git stash push --include-untracked -m "vuln-scanner-snapshot"', { cwd: this.projectDir });
      
      // Get the stash ref hash we just created
      const { stdout } = await execAsync('git stash list --max-count=1', { cwd: this.projectDir });
      if (stdout.includes('vuln-scanner-snapshot')) {
        // Pop it right back so the developer keeps their changes, but we have a baseline reference point to hard reset to
        await execAsync('git stash apply stash@{0}', { cwd: this.projectDir });
      }
    } catch (error: any) {
      throw new Error(`Failed to create repository safety snapshot: ${error.message}`);
    }
  }

  /**
   * Rolls back all filesystem shifts instantly if a test execution or build fails
   */
  async rollback(): Promise<void> {
    try {
      // Hard reset working copy files and clean untracked entries
      await execAsync('git reset --hard HEAD', { cwd: this.projectDir });
      await execAsync('git clean -fd', { cwd: this.projectDir });
    } catch (error: any) {
      throw new Error(`Critical: Failed to perform clean rollback: ${error.message}`);
    }
  }
}