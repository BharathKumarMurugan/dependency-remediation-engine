import { js, ts } from "@ast-grep/napi";
import * as fs from "fs/promises";
import * as path from "path";

export interface CodemodRule {
  selector: string; // Structural search pattern (e.g., $$$A.oldMethod($$$B))
  replacement: string; // Structural replacement template
}

/**
 * Iterates through files in a directory and applies structural replacements
 */
export async function applyStructuralCodemod(
  targetDir: string,
  rules: CodemodRule[],
  extensions: string[] = [".js", ".ts", ".jsx", ".tsx"],
): Promise<number> {
  let filesModified = 0;

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
        await walk(fullPath);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        let content = await fs.readFile(fullPath, "utf-8");
        let isModified = false;

        for (const rule of rules) {
          // Parse using ast-grep binding based on extension
          const isTypeScript = entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
          const root = isTypeScript ? ts.parse(content) : js.parse(content);

          // Perform structural search matching
          const root = isTypeScript ? napi.ts.parse(content) : napi.js.parse(content);
          const edit = root.root().toString().replace(rule.selector, rule.replacement);

          if (edit) {
            content = edit;
            isModified = true;
          }
        }

        if (isModified) {
          await fs.writeFile(fullPath, content, "utf-8");
          filesModified++;
        }
      }
    }
  }

  await walk(targetDir);
  return filesModified;
}
