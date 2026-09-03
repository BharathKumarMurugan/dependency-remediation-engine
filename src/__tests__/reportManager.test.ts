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

  it("should create reports directory and store logs, json summary, and interactive html report", async () => {
    const manager = new ReportManager(tmpDir);
    await manager.init();

    manager.startCapturing();
    console.log("Test log entry line 1");
    console.log("Test log entry line 2");

    const summaryData = {
      projectName: "my-test-app",
      scanTimestamp: new Date().toISOString(),
      totalDependenciesScanned: 10,
      vulnerablePackagesCount: 1,
      vulnerableItems: [
        {
          packageName: "express",
          currentVersion: "4.16.0",
          vulnerabilities: [{ id: "GHSA-1234", summary: "Test vulnerability", severity: "HIGH" }],
          remediation: { targetVersion: "4.19.2", upgradeType: "MINOR", hasBreakingChanges: false },
        },
      ],
    };

    const savedLogPath = await manager.saveReport(summaryData);

    expect(savedLogPath).not.toBeNull();
    expect(savedLogPath.logFilePath).toContain("reports");
    expect(savedLogPath.htmlFilePath).toContain("reports");

    const logContent = await fs.readFile(savedLogPath.logFilePath!, "utf-8");
    expect(logContent).toContain("Test log entry line 1");

    const jsonPath = path.join(tmpDir, "reports", "scan_summary.json");
    const jsonExists = await fs
      .stat(jsonPath)
      .then(() => true)
      .catch(() => false);
    expect(jsonExists).toBe(true);

    const htmlPath = path.join(tmpDir, "reports", "scan_report.html");
    const htmlExists = await fs
      .stat(htmlPath)
      .then(() => true)
      .catch(() => false);
    expect(htmlExists).toBe(true);

    const htmlContent = await fs.readFile(htmlPath, "utf-8");
    expect(htmlContent).toContain("my-test-app");
    expect(htmlContent).toContain("express");
    expect(htmlContent).toContain("GHSA-1234");
  });
});
