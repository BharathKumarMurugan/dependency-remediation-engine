import { js, ts, SgNode } from "@ast-grep/napi";
import * as fs from "fs/promises";
import * as path from "path";
import type { CodemodRule } from "./astGrepRunner.ts";

function transformCodeSnippet(
  code: string,
  isTypeScript: boolean,
  rules: CodemodRule[]
): string {
  let currentCode = code;

  for (const rule of rules) {
    try {
      const parseFn = isTypeScript ? ts.parse : js.parse;
      let sgRoot: any = parseFn(currentCode);
      let rootNode: any = sgRoot.root();

      const matches = rootNode.findAll(rule.selector);

      if (matches.length > 0) {
        const edits = matches.map((node: SgNode) => {
          let replacementText = rule.replacement;
          const metaVarRegex = /\$([A-Z_][A-Z0-9_]*)/g;
          replacementText = replacementText.replace(metaVarRegex, (fullMatch, varName) => {
            const matchedNode = node.getMatch(varName);
            return matchedNode ? matchedNode.text() : fullMatch;
          });

          return node.replace(replacementText);
        });

        currentCode = rootNode.commitEdits(edits);
      }

      // Explicitly release AST node references for V8 Garbage Collection
      sgRoot = null;
      rootNode = null;
    } catch {
      // Ignore syntax errors in snippet parsing, preserve original code
    }
  }

  return currentCode;
}

/**
 * Worker thread entry point to process a chunk of candidate files concurrently
 */
export async function processFileChunk(files: string[], rules: CodemodRule[]): Promise<number> {
  let filesModified = 0;

  for (const fullPath of files) {
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const lowerName = path.basename(fullPath).toLowerCase();
      const ext = path.extname(fullPath).toLowerCase();

      const isTypeScript =
        lowerName.endsWith(".ts") ||
        lowerName.endsWith(".tsx") ||
        lowerName.endsWith(".mts") ||
        lowerName.endsWith(".cts") ||
        lowerName.endsWith(".d.ts") ||
        lowerName.endsWith(".d.mts") ||
        lowerName.endsWith(".d.cts") ||
        content.includes('lang="ts"') ||
        content.includes("lang='ts'");

      let updatedContent = content;

      if (ext === ".vue" || ext === ".svelte" || ext === ".astro") {
        // Transform script blocks inside Frontend Framework Single File Components
        updatedContent = updatedContent.replace(
          /(<script[\s\S]*?>)([\s\S]*?)(<\/script>)/gi,
          (_full, openTag, scriptCode, closeTag) => {
            const isScriptTS =
              isTypeScript || openTag.toLowerCase().includes('lang="ts"') || openTag.toLowerCase().includes("lang='ts'");
            return openTag + transformCodeSnippet(scriptCode, isScriptTS, rules) + closeTag;
          }
        );

        if (ext === ".astro") {
          // Transform Astro frontmatter fence blocks (--- code ---)
          updatedContent = updatedContent.replace(
            /^(---[\r\n]+)([\s\S]*?)([\r\n]+---)/m,
            (_full, openFence, fenceCode, closeFence) => {
              return openFence + transformCodeSnippet(fenceCode, isTypeScript, rules) + closeFence;
            }
          );
        }
      } else {
        updatedContent = transformCodeSnippet(content, isTypeScript, rules);
      }

      if (updatedContent !== content) {
        await fs.writeFile(fullPath, updatedContent, "utf-8");
        filesModified++;
      }
    } catch {
      // Ignore file reading/writing errors
    }
  }

  return filesModified;
}

export default async function workerTask({ files, rules }: { files: string[]; rules: CodemodRule[] }): Promise<number> {
  return processFileChunk(files, rules);
}
