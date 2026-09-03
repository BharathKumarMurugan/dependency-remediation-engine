import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { stripVTControlCharacters } from "util";
import { filePathMutex } from "../vcs/filePathMutex.ts";
import { generateHtmlReport } from "./htmlReportGenerator.ts";

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

/**
 * Utility to write arrays of string log chunks to disk using a WritableStream under an exclusive file path lock
 */
function writeChunksToStream(filePath: string, chunks: string[]): Promise<void> {
  return filePathMutex.runExclusive(filePath, () => {
    return new Promise((resolve, reject) => {
      const stream = createWriteStream(filePath, { encoding: "utf-8", highWaterMark: 64 * 1024 });
      stream.on("finish", resolve);
      stream.on("error", reject);

      for (const chunk of chunks) {
        stream.write(stripVTControlCharacters(chunk));
      }
      stream.end();
    });
  });
}

export class ReportManager {
  private targetRootDir: string;
  private projectReportDir: string = "";
  private logFilePath: string = "";
  private htmlFilePath: string = "";
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
      this.htmlFilePath = path.join(this.projectReportDir, `scan_report.html`);
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
   * Streams captured console logs, JSON summary, and interactive HTML report to disk after scanning completes,
   * then clears memory buffer immediately.
   */
  async saveReport(scanSummaryData?: any): Promise<any | null> {
    try {
      if (this.isCapturing) {
        if (this.originalStdoutWrite) process.stdout.write = this.originalStdoutWrite;
        if (this.originalConsoleLog) console.log = this.originalConsoleLog;
        this.isCapturing = false;
      }

      await fs.mkdir(this.projectReportDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      if (!this.logFilePath) {
        this.logFilePath = path.join(this.projectReportDir, `scan_report_${timestamp}.log`);
      }

      // Stream log buffer directly to file via WritableStream under file path mutex
      await writeChunksToStream(this.logFilePath, this.logBuffer);
      this.logBuffer = []; // Clear buffer memory immediately for Garbage Collection

      if (scanSummaryData) {
        // 1. Write scan_summary.json
        const jsonPath = path.join(this.projectReportDir, "scan_summary.json");
        const jsonContent = JSON.stringify(scanSummaryData, null, 2);
        await writeChunksToStream(jsonPath, [jsonContent]);

        // 2. Generate and write interactive HTML reports (timestamped and scan_report.html)
        const htmlContent = generateHtmlReport(scanSummaryData);
        const timestampedHtmlPath = path.join(this.projectReportDir, `scan_report_${timestamp}.html`);
        this.htmlFilePath = path.join(this.projectReportDir, "scan_report.html");

        await writeChunksToStream(timestampedHtmlPath, [htmlContent]);
        await writeChunksToStream(this.htmlFilePath, [htmlContent]);
      }

      return {
        logFilePath: this.logFilePath,
        htmlFilePath: this.htmlFilePath,
      };
    } catch {
      return null;
    }
  }
}
