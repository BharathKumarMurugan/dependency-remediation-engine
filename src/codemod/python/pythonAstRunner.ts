import * as fs from "fs/promises";
import * as path from "path";
import os from "os";
import type { CodemodRule } from "../astGrepRunner.ts";
import { filePathMutex } from "../../vcs/filePathMutex.ts";

export const PYTHON_SUPPORTED_EXTENSIONS: string[] = [".py", ".pyi", ".pyx"];

export function transformPythonSnippet(code: string, rules: CodemodRule[]): string {
  let currentCode = code;

  for (const rule of rules) {
    try {
      // Escape special regex characters in selector except metavariables starting with $
      const metaVars: string[] = [];
      const regexPattern = rule.selector
        .replace(/[-\/\\^$*+?.()|[\]{}]/g, (match) => {
          if (match === "$") return "$";
          return "\\" + match;
        })
        .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_full, varName) => {
          metaVars.push(varName);
          return "([a-zA-Z0-9_.-]+)";
        });

      const regex = new RegExp(regexPattern, "g");
      currentCode = currentCode.replace(regex, (_fullMatch, ...capturedArgs) => {
        let replacementText = rule.replacement;
        metaVars.forEach((varName, idx) => {
          const val = capturedArgs[idx];
          if (val !== undefined) {
            replacementText = replacementText.replace(new RegExp(`\\$${varName}`, "g"), val);
          }
        });
        return replacementText;
      });
    } catch {
      // Preserve code if rule pattern fails
    }
  }

  return currentCode;
}

export async function processPythonFileChunk(files: string[], rules: CodemodRule[]): Promise<number> {
  let filesModified = 0;

  for (const fullPath of files) {
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const updatedContent = transformPythonSnippet(content, rules);

      if (updatedContent !== content) {
        await filePathMutex.runExclusive(fullPath, () => fs.writeFile(fullPath, updatedContent, "utf-8"));
        filesModified++;
      }
    } catch {
      // Ignore reading/writing errors
    }
  }

  return filesModified;
}

/**
 * Traverses Python files (.py, .pyi, .pyx) in target directory and applies AST structural code refactoring concurrently
 */
export async function applyPythonStructuralCodemod(
  targetDir: string,
  rules: CodemodRule[]
): Promise<number> {
  const candidateFiles: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === ".venv" ||
          entry.name === "venv" ||
          entry.name === "env" ||
          entry.name === "__pycache__" ||
          entry.name === ".pytest_cache" ||
          entry.name === ".git" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (PYTHON_SUPPORTED_EXTENSIONS.includes(ext)) {
          candidateFiles.push(fullPath);
        }
      }
    }
  }

  await walk(targetDir);

  if (candidateFiles.length === 0) return 0;

  const availableCpus = os.cpus()?.length || 1;
  const numThreads = Math.max(1, availableCpus - 1);

  // Split into balanced chunks for CPU worker execution
  const chunkSize = Math.max(1, Math.ceil(candidateFiles.length / numThreads));
  const chunks: string[][] = [];
  for (let i = 0; i < candidateFiles.length; i += chunkSize) {
    chunks.push(candidateFiles.slice(i, i + chunkSize));
  }

  const results = await Promise.all(chunks.map((chunk) => processPythonFileChunk(chunk, rules)));
  return results.reduce((sum, count) => sum + count, 0);
}
