import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getProjectName, ReportManager } from "../reporter/reportManager";

describe("ReportManager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "report-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should extract project name from package.json or fallback to folder basename", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    await fs.writeFile(pkgPath, JSON.stringify({ name: "@myorg/my-app" }), "utf-8");

    const name = await getProjectName(tmpDir);
    expect(name).toBe("myorg__my-app");
  });

  it("should create reports directory and subfolder named after the project", async () => {
    const manager = new ReportManager(tmpDir, "my-test-project");
    await manager.init();

    manager.startCapturing();
    console.log("Test log entry line 1");
    console.log("Test log entry line 2");

    const savedLogPath = await manager.saveReport({ status: "OK", total: 5 });

    expect(savedLogPath).not.toBeNull();
    expect(savedLogPath).toContain(path.join("reports", "my-test-project"));

    const logContent = await fs.readFile(savedLogPath!, "utf-8");
    expect(logContent).toContain("Test log entry line 1");

    const jsonPath = path.join(tmpDir, "reports", "my-test-project", "scan_summary.json");
    const jsonExists = await fs
      .stat(jsonPath)
      .then(() => true)
      .catch(() => false);
    expect(jsonExists).toBe(true);
  });
});
