import * as fs from "node:fs/promises";
import path from "node:path";
import { OSVQuery } from "./types";

export async function parsePackageLock(lockfilePath: string): Promise<OSVQuery[]> {
  let resolvedPath = lockfilePath;
  try {
    const stat = await fs.stat(lockfilePath);
    if (stat.isDirectory()) {
      resolvedPath = path.join(lockfilePath, "package-lock.json");
    }
  } catch (err) {
    throw new Error(`File or directory not found: ${lockfilePath}`);
  }

  const content = await fs.readFile(resolvedPath, "utf-8");
  const lockfile = JSON.parse(content);
  const queries: OSVQuery[] = [];

  if (lockfile.packages) {
    for (const [pkgPath, pkgData] of Object.entries(lockfile.packages)) {
      if (pkgPath === "" || (pkgData as { link?: boolean }).link) continue;

      const packageName = pkgPath.replace(/^.*node_modules\//, "");
      const version = (pkgData as { version?: string }).version;

      if (packageName && version) {
        queries.push({
          package: { name: packageName, ecosystem: "npm" },
          version,
        });
      }
    }
  } else if (lockfile.dependencies) {
    for (const [pkgName, pkgData] of Object.entries(lockfile.dependencies)) {
      const version = (pkgData as { version?: string }).version;
      if (pkgName && version) {
        queries.push({
          package: { name: pkgName, ecosystem: "npm" },
          version,
        });
      }
    }
  }
  return queries;
}
