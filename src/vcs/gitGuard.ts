import { exec } from "child_process";
import { promisify } from "util";
import { Mutex } from "async-mutex";

const execAsync = promisify(exec);

export class GitGuard {
  private projectDir: string;
  private currentStashCreated: boolean = false;
  private mutex: Mutex = new Mutex();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /**
   * Validates that the working tree is clean before running scanner operations under an exclusive Git Mutex lock
   */
  async isWorkingTreeClean(): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      try {
        const { stdout } = await execAsync("git status --porcelain", { cwd: this.projectDir });
        return stdout.trim().length === 0;
      } catch {
        return false; // Not a git repo or git not found
      }
    });
  }

  /**
   * Creates an atomic rollback snapshot before upgrading a single package under an exclusive Git Mutex lock.
   */
  async createSnapshot(packageName?: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      try {
        const tag = packageName ? `vuln-snapshot-${packageName}` : "vuln-snapshot-baseline";
        const { stdout: stashOut } = await execAsync(`git stash push --include-untracked -m "${tag}"`, {
          cwd: this.projectDir,
        });

        if (!stashOut.includes("No local changes to save")) {
          this.currentStashCreated = true;
          // Re-apply the stash so the working directory retains all current edits
          await execAsync("git stash apply stash@{0}", { cwd: this.projectDir });
        } else {
          this.currentStashCreated = false;
        }
      } catch (error: any) {
        this.currentStashCreated = false;
      }
    });
  }

  /**
   * Confirms a successful package upgrade by discarding the temporary rollback snapshot stash under an exclusive Git Mutex lock.
   */
  async commitSnapshot(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      if (!this.currentStashCreated) return;
      try {
        await execAsync("git stash drop stash@{0}", { cwd: this.projectDir });
      } catch {
        // Ignore stash drop errors
      } finally {
        this.currentStashCreated = false;
      }
    });
  }

  /**
   * Rolls back ONLY the current package's modifications, restoring the repository to the state prior to this package's upgrade attempt under an exclusive Git Mutex lock.
   */
  async rollback(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      try {
        // Hard reset working copy files and clean untracked entries from current failed step
        await execAsync("git reset --hard HEAD", { cwd: this.projectDir });
        await execAsync("git clean -fd", { cwd: this.projectDir });

        // If a snapshot stash exists from before this step, restore it
        if (this.currentStashCreated) {
          await execAsync("git stash apply stash@{0}", { cwd: this.projectDir });
          await execAsync("git stash drop stash@{0}", { cwd: this.projectDir });
        }
      } catch (error: any) {
        // Graceful fallback
      } finally {
        this.currentStashCreated = false;
      }
    });
  }
}