import { js, ts, SgNode } from "@ast-grep/napi";
import * as fs from "fs/promises";
import * as path from "path";

export interface CodemodRule {
  selector: string;
  replacement: string;
}

/**
 * Iterates through files in a directory and applies structural replacements using ast-grep
 */
export async function applyStructuralCodemod(
  targetDir: string,
  rules: CodemodRule[],
  extensions: string[] = [".js", ".ts", ".jsx", ".tsx"]
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
          entry.name.startsWith(".")
        ) {
          continue;
        }
        await walk(fullPath);
      } else if (
        entry.isFile() &&
        extensions.includes(path.extname(entry.name))
      ) {
        let content = await fs.readFile(fullPath, "utf-8");
        let currentContent = content;

        for (const rule of rules) {
          const isTypeScript =
            entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
          const sgRoot = isTypeScript ? ts.parse(currentContent) : js.parse(currentContent);
          const rootNode = sgRoot.root();

          // Find all nodes matching the rule selector pattern
          const matches = rootNode.findAll(rule.selector);

          if (matches.length > 0) {
            // Build edits for each matched node
            const edits = matches.map((node: SgNode) => {
              // Substitute metavariables (e.g. $RES, $STATUS, $BODY) in replacement
              let replacementText = rule.replacement;
              const metaVarRegex = /\$([A-Z_][A-Z0-9_]*)/g;
              replacementText = replacementText.replace(metaVarRegex, (fullMatch, varName) => {
                const matchedNode = node.getMatch(varName);
                return matchedNode ? matchedNode.text() : fullMatch;
              });

              return node.replace(replacementText);
            });

            currentContent = rootNode.commitEdits(edits);
          }
        }

        if (currentContent !== content) {
          await fs.writeFile(fullPath, currentContent, "utf-8");
          filesModified++;
        }
      }
    }
  }

  await walk(targetDir);
  return filesModified;
}
