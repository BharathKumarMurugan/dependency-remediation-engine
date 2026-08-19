import fs from "fs/promises";
import path from "path";
import { stripVTControlCharacters } from "util";

export async function getProjectName(projectRootDir: string): Promise<string> {
  try {
    const pkgPath = path.join(projectRootDir, "package.json");
    const content = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    if (pkg.name && typeof pkg.name === "string") {
      // Handle scoped package names like @myorg/myapp -> myorg__myapp
      return pkg.name.replace(/^@/, "").replace(/[/\\?%*:|"<>]/g, "__");
    }
  } catch {}
  return path.basename(projectRootDir) || "target_project";
}

export class ReportManager {
  private targetRootDir: string;
  private projectReportDir: string = "";
  private logFilePath: string = "";
  private originalStdoutWrite?: typeof process.stdout.write;
  private originalConsoleLog?: typeof console.log;
  private logBuffer: string[] = [];
  private isCapturing: boolean = false;

  constructor(targetRootDir: string) {
    this.targetRootDir = targetRootDir;
    this.projectReportDir = path.join(this.targetRootDir, "reports");
  }

  /**
   * Initializes the reports folder structure asynchronously
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.projectReportDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.logFilePath = path.join(this.projectReportDir, `scan_report_${timestamp}.log`);
    } catch {
      // Graceful fallback
    }
  }

  /**
   * Starts capturing console stdout and console.log streams without disturbing terminal stdout
   */
  startCapturing(): void {
    if (this.isCapturing) return;
    this.isCapturing = true;

    const self = this;
    this.originalStdoutWrite = process.stdout.write;
    this.originalConsoleLog = console.log;

    process.stdout.write = function (chunk: any, encoding?: any, callback?: any): boolean {
      if (chunk) {
        self.logBuffer.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
      }
      return self.originalStdoutWrite!.call(process.stdout, chunk, encoding, callback);
    };

    console.log = function (...args: any[]) {
      const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      self.logBuffer.push(line + "\n");
      return self.originalConsoleLog!.apply(console, args);
    };
  }

  /**
   * Concurrently writes captured console.log and JSON summary to disk after scanning completes
   */
  async saveReport(scanSummaryData?: any): Promise<string | null> {
    try {
      if (this.isCapturing) {
        if (this.originalStdoutWrite) process.stdout.write = this.originalStdoutWrite;
        if (this.originalConsoleLog) console.log = this.originalConsoleLog;
        this.isCapturing = false;
      }

      await fs.mkdir(this.projectReportDir, { recursive: true });

      if (!this.logFilePath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        this.logFilePath = path.join(this.projectReportDir, `scan_report_${timestamp}.log`);
      }

      const content = this.logBuffer.join("");

      // Perform non-blocking async file write
      await fs.writeFile(this.logFilePath, stripVTControlCharacters(content), "utf-8");

      if (scanSummaryData) {
        const jsonPath = path.join(this.projectReportDir, "scan_summary.json");
        await fs.writeFile(jsonPath, JSON.stringify(scanSummaryData, null, 2), "utf-8");
      }

      return this.logFilePath;
    } catch {
      return null;
    }
  }
}
