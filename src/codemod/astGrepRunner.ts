import * as fs from "fs/promises";
import fsSync from "fs";
import * as path from "path";
import os from "os";
import Piscina from "piscina";
import { processFileChunk } from "./astGrepWorkerTask.ts";

export interface CodemodRule {
  selector: string; // Structural search pattern (e.g., $$$A.oldMethod($$$B))
  replacement: string; // Structural replacement template
}

export const SUPPORTED_EXTENSIONS: string[] = [
  // Standard JS/TS
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  // Explicit Module Specs
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Declaration Files
  ".d.ts",
  ".d.mts",
  ".d.cts",
  // Frontend Framework Templates
  ".vue",
  ".astro",
  ".svelte",
];

function isSupportedFile(fileName: string, customExtensions?: string[]): boolean {
  const allowed = customExtensions || SUPPORTED_EXTENSIONS;
  const nameLower = fileName.toLowerCase();

  for (const ext of allowed) {
    if (nameLower.endsWith(ext.toLowerCase())) {
      return true;
    }
  }

  const extName = path.extname(fileName).toLowerCase();
  return allowed.includes(extName);
}

/**
 * Utility to split candidate files into balanced chunks across worker threads
 */
function chunkArrayBalanced<T>(array: T[], numChunks: number): T[][] {
  const chunks: T[][] = Array.from({ length: numChunks }, () => []);
  array.forEach((item, index) => {
    chunks[index % numChunks].push(item);
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Iterates through files in a directory, balances them across CPU worker threads (os.cpus().length - 1),
 * and applies structural AST code refactoring concurrently without blocking the main V8 thread.
 */
export async function applyStructuralCodemod(
  targetDir: string,
  rules: CodemodRule[],
  extensions: string[] = SUPPORTED_EXTENSIONS
): Promise<number> {
  const candidateFiles: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === ".git" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile() && isSupportedFile(entry.name, extensions)) {
        candidateFiles.push(fullPath);
      }
    }
  }

  await walk(targetDir);

  if (candidateFiles.length === 0) return 0;

  // Calculate worker threads equal to os.cpus().length - 1 (minimum 1 thread)
  const availableCpus = os.cpus()?.length || 1;
  const numThreads = Math.max(1, availableCpus - 1);

  // Split files into balanced chunks for CPU worker threads
  const chunks = chunkArrayBalanced(candidateFiles, Math.min(numThreads, candidateFiles.length));

  // Check compiled JS worker task location
  const compiledJsWorker = path.resolve(__dirname, "./astGrepWorkerTask.js");
  const isCompiled = fsSync.existsSync(compiledJsWorker);

  if (isCompiled) {
    try {
      const pool = new Piscina({
        filename: compiledJsWorker,
        maxThreads: numThreads,
      });

      const tasks = chunks.map((chunk) => pool.run({ files: chunk, rules }));
      const results = await Promise.all(tasks);
      return results.reduce((sum, count) => sum + count, 0);
    } catch {
      // Fallback
    }
  }

  // Fallback for ts-node / Jest development environments: process file chunks asynchronously
  const results = await Promise.all(chunks.map((chunk) => processFileChunk(chunk, rules)));
  return results.reduce((sum, count) => sum + count, 0);
}
