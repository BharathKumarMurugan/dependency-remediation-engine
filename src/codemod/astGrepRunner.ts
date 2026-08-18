import { js, ts, SgNode } from "@ast-grep/napi";
import * as fs from "fs/promises";
import * as path from "path";

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

function transformCodeSnippet(
  code: string,
  isTypeScript: boolean,
  rules: CodemodRule[]
): string {
  let currentCode = code;

  for (const rule of rules) {
    try {
      const parseFn = isTypeScript ? ts.parse : js.parse;
      const sgRoot = parseFn(currentCode);
      const rootNode = sgRoot.root();

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
    } catch {
      // Ignore syntax errors in snippet parsing, preserve original code
    }
  }

  return currentCode;
}

/**
 * Iterates through files in a directory and applies structural replacements across all JS/TS module types & framework templates
 */
export async function applyStructuralCodemod(
  targetDir: string,
  rules: CodemodRule[],
  extensions: string[] = SUPPORTED_EXTENSIONS
): Promise<number> {
  let filesModified = 0;

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
        const content = await fs.readFile(fullPath, "utf-8");
        const lowerName = entry.name.toLowerCase();
        const ext = path.extname(entry.name).toLowerCase();

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
      }
    }
  }

  await walk(targetDir);
  return filesModified;
}
