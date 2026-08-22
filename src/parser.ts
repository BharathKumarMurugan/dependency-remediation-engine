import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { OSVQuery } from "./types.ts";
import type { PackageManagerType } from "./runner/packageManager.ts";

/**
 * Reads file content using Node.js ReadableStream to reduce I/O load on large lockfiles
 */
function readFileAsStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf-8", highWaterMark: 64 * 1024 });
    const chunks: string[] = [];
    stream.on("data", (chunk) => chunks.push(chunk as string));
    stream.on("end", () => resolve(chunks.join("")));
    stream.on("error", (err) => reject(err));
  });
}

export async function parsePackageLock(targetPath: string, pm: PackageManagerType = "npm"): Promise<OSVQuery[]> {
  let projectDir = targetPath;
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      projectDir = path.dirname(targetPath);
    }
  } catch (err) {
    throw new Error(`File or directory not found: ${targetPath}`);
  }

  const queries: OSVQuery[] = [];
  const seen = new Set<string>();

  function addQuery(name: string, version: string) {
    if (!name || !version) return;
    const cleanName = name.replace(/^.*node_modules\//, "");
    const cleanVer = version.replace(/^[^\d]*/, "");
    if (!cleanName || !cleanVer) return;

    const key = `${cleanName}@${cleanVer}`;
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({
        package: { name: cleanName, ecosystem: "npm" },
        version: cleanVer,
      });
    }
  }

  // 1. pnpm lockfile parser (pnpm-lock.yaml)
  if (pm === "pnpm") {
    const pnpmLockPath = path.join(projectDir, "pnpm-lock.yaml");
    try {
      const content = await readFileAsStream(pnpmLockPath);
      const regex = /(?:^|\s)['"]?(?:\/)?(@?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)@([0-9]+\.[0-9]+\.[0-9]+[^\s'":]*)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        addQuery(match[1], match[2]);
      }
      if (queries.length > 0) return queries;
    } catch {}
  }

  // 2. yarn lockfile parser (yarn.lock)
  if (pm === "yarn") {
    const yarnLockPath = path.join(projectDir, "yarn.lock");
    try {
      const content = await readFileAsStream(yarnLockPath);
      const blocks = content.split(/\n\n+/);
      for (const block of blocks) {
        const lines = block.split("\n");
        const header = lines[0]?.trim();
        const versionLine = lines.find((l) => l.trim().startsWith("version"));

        if (header && versionLine) {
          const nameMatch = header.match(/^"?(@?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)@/);
          const verMatch = versionLine.match(/version:?\s*"?([0-9]+\.[0-9]+\.[0-9]+[^\s"]*)"?/);
          if (nameMatch && verMatch) {
            addQuery(nameMatch[1], verMatch[1]);
          }
        }
      }
      if (queries.length > 0) return queries;
    } catch {}
  }

  // 3. bun lockfile parser (bun.lock / bun.lockb)
  if (pm === "bun") {
    const bunLockPath = path.join(projectDir, "bun.lock");
    try {
      const content = await readFileAsStream(bunLockPath);
      try {
        const parsed = JSON.parse(content);
        if (parsed.packages) {
          for (const [pkgPath, pkgData] of Object.entries(parsed.packages)) {
            const version = (pkgData as { version?: string })?.version;
            const name = pkgPath.replace(/^.*node_modules\//, "");
            if (name && version) addQuery(name, version);
          }
        }
      } catch {
        const regex = /"(@?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)@([0-9]+\.[0-9]+\.[0-9]+[^\s"]*)"/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          addQuery(match[1], match[2]);
        }
      }
      if (queries.length > 0) return queries;
    } catch {}
  }

  // 4. npm lockfile parser (package-lock.json)
  const npmLockPath = path.join(projectDir, "package-lock.json");
  try {
    const content = await readFileAsStream(npmLockPath);
    const lockfile = JSON.parse(content);

    if (lockfile.packages) {
      for (const [pkgPath, pkgData] of Object.entries(lockfile.packages)) {
        if (pkgPath === "" || (pkgData as { link?: boolean }).link) continue;
        const packageName = pkgPath.replace(/^.*node_modules\//, "");
        const version = (pkgData as { version?: string }).version;
        if (packageName && version) addQuery(packageName, version);
      }
    } else if (lockfile.dependencies) {
      for (const [pkgName, pkgData] of Object.entries(lockfile.dependencies)) {
        const version = (pkgData as { version?: string }).version;
        if (pkgName && version) addQuery(pkgName, version);
      }
    }
    if (queries.length > 0) return queries;
  } catch {}

  // 5. Fallback to direct dependencies in package.json
  try {
    const pkgJsonPath = path.join(projectDir, "package.json");
    const content = await readFileAsStream(pkgJsonPath);
    const pkg = JSON.parse(content);

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, verSpec] of Object.entries(allDeps)) {
      const cleanVer = (verSpec as string).replace(/[\^~>=<]/g, "");
      if (name && cleanVer) addQuery(name, cleanVer);
    }
  } catch {}

  return queries;
}
