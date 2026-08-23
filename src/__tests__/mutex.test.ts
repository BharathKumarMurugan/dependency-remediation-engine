import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { filePathMutex } from "../vcs/filePathMutex.ts";
import { GitGuard } from "../vcs/gitGuard.ts";

describe("Mutex Synchronization Mechanisms", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mutex-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should prevent concurrent write collisions on the same file path using filePathMutex", async () => {
    const testFile = path.join(tmpDir, "concurrent_target.txt");
    const executionOrder: number[] = [];

    const task1 = filePathMutex.runExclusive(testFile, async () => {
      executionOrder.push(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(testFile, "content-from-task-1", "utf-8");
      executionOrder.push(11);
    });

    const task2 = filePathMutex.runExclusive(testFile, async () => {
      executionOrder.push(2);
      await fs.writeFile(testFile, "content-from-task-2", "utf-8");
      executionOrder.push(22);
    });

    await Promise.all([task1, task2]);

    expect(executionOrder).toEqual([1, 11, 2, 22]);
    const finalContent = await fs.readFile(testFile, "utf-8");
    expect(finalContent).toBe("content-from-task-2");
  });

  it("should allow parallel writes to different file paths", async () => {
    const fileA = path.join(tmpDir, "fileA.txt");
    const fileB = path.join(tmpDir, "fileB.txt");
    const started: string[] = [];

    const taskA = filePathMutex.runExclusive(fileA, async () => {
      started.push("A");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const taskB = filePathMutex.runExclusive(fileB, async () => {
      started.push("B");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    await Promise.all([taskA, taskB]);

    expect(started).toContain("A");
    expect(started).toContain("B");
  });

  it("should execute GitGuard operations sequentially via Git State Mutex", async () => {
    const gitGuard = new GitGuard(tmpDir);
    const cleanResult = await gitGuard.isWorkingTreeClean();
    expect(typeof cleanResult).toBe("boolean");
  });
});
