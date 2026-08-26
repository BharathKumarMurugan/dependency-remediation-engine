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

/**
 * Identifies internal workspace protocol references or non-registry URIs (e.g. workspace:*, file:, link:)
 */
export function isInternalOrNonRegistrySpec(version: string): boolean {
  if (!version) return true;
  const v = version.trim().toLowerCase();
  return (
    v.startsWith("workspace:") ||
    v.startsWith("file:") ||
    v.startsWith("link:") ||
    v.startsWith("portal:") ||
    v.startsWith("git+") ||
    v.startsWith("http:") ||
    v.startsWith("https:") ||
    v.startsWith("ssh:") ||
    v === "*" ||
    v === "latest"
  );
}

/**
 * Recursively resolves workspace package directories based on glob pattern strings (e.g. "packages/*", "apps/*")
 */
async function expandWorkspaceGlobs(rootDir: string, patterns: string[]): Promise<string[]> {
  const packageDirs: string[] = [];

  for (const pattern of patterns) {
    if (!pattern || pattern.startsWith("!")) continue;
    const cleanPattern = pattern.replace(/\/+\*+$/, "");
    const targetParent = path.join(rootDir, cleanPattern);

    try {
      const entries = await fs.readdir(targetParent, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPkgDir = path.join(targetParent, entry.name);
          const pkgJsonPath = path.join(subPkgDir, "package.json");
          try {
            await fs.access(pkgJsonPath);
            packageDirs.push(subPkgDir);
          } catch {}
        }
      }
    } catch {
      try {
        const pkgJsonPath = path.join(rootDir, pattern, "package.json");
        await fs.access(pkgJsonPath);
        packageDirs.push(path.join(rootDir, pattern));
      } catch {}
    }
  }

  return packageDirs;
}

/**
 * Discovers sub-package manifest directories for monorepo setups (pnpm, yarn, npm, bun, lerna)
 */
export async function discoverWorkspacePackages(rootDir: string): Promise<string[]> {
  const workspacePatterns: string[] = [];

  // 1. Check pnpm-workspace.yaml
  try {
    const pnpmWorkspacePath = path.join(rootDir, "pnpm-workspace.yaml");
    const content = await readFileAsStream(pnpmWorkspacePath);
    const matches = content.match(/-\s*['"]?([^'"]+)['"]?/g);
    if (matches) {
      for (const m of matches) {
        const pat = m.replace(/^-\s*['"]?/, "").replace(/['"]?$/, "").trim();
        if (pat && !pat.startsWith("!")) workspacePatterns.push(pat);
      }
    }
  } catch {}

  // 2. Check lerna.json
  try {
    const lernaPath = path.join(rootDir, "lerna.json");
    const content = await readFileAsStream(lernaPath);
    const lernaJson = JSON.parse(content);
    if (Array.isArray(lernaJson.packages)) {
      workspacePatterns.push(...lernaJson.packages);
    }
  } catch {}

  // 3. Check root package.json "workspaces" field
  try {
    const pkgJsonPath = path.join(rootDir, "package.json");
    const content = await readFileAsStream(pkgJsonPath);
    const pkgJson = JSON.parse(content);
    if (Array.isArray(pkgJson.workspaces)) {
      workspacePatterns.push(...pkgJson.workspaces);
    } else if (pkgJson.workspaces && Array.isArray(pkgJson.workspaces.packages)) {
      workspacePatterns.push(...pkgJson.workspaces.packages);
    }
  } catch {}

  if (workspacePatterns.length === 0) return [];
  return expandWorkspaceGlobs(rootDir, workspacePatterns);
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
    if (!name || !version || isInternalOrNonRegistrySpec(version)) return;
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

  /**
   * Recursively traverses legacy lockfileVersion: 1 dependencies objects to extract all direct and nested sub-dependencies offline
   */
  function parseLegacyDependencies(depsObj: Record<string, any>) {
    if (!depsObj || typeof depsObj !== "object") return;
    for (const [pkgName, pkgData] of Object.entries(depsObj)) {
      if (pkgData && typeof pkgData === "object") {
        const version = (pkgData as { version?: string }).version;
        if (pkgName && version && typeof version === "string") {
          addQuery(pkgName, version);
        }
        if ((pkgData as { dependencies?: Record<string, any> }).dependencies) {
          parseLegacyDependencies((pkgData as { dependencies: Record<string, any> }).dependencies);
        }
      }
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
      parseLegacyDependencies(lockfile.dependencies);
    }
  } catch {}

  // 5. Monorepo Workspace Sub-package Manifest Parsing
  try {
    const subPackageDirs = await discoverWorkspacePackages(projectDir);
    for (const subDir of subPackageDirs) {
      try {
        const subPkgJsonPath = path.join(subDir, "package.json");
        const content = await readFileAsStream(subPkgJsonPath);
        const pkg = JSON.parse(content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
          ...pkg.optionalDependencies,
        };
        for (const [name, verSpec] of Object.entries(allDeps)) {
          if (typeof verSpec === "string" && !isInternalOrNonRegistrySpec(verSpec)) {
            const cleanVer = verSpec.replace(/[\^~>=<]/g, "");
            if (name && cleanVer) addQuery(name, cleanVer);
          }
        }
      } catch {}
    }
  } catch {}

  // 6. Fallback to direct dependencies in root package.json
  try {
    const pkgJsonPath = path.join(projectDir, "package.json");
    const content = await readFileAsStream(pkgJsonPath);
    const pkg = JSON.parse(content);

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, verSpec] of Object.entries(allDeps)) {
      if (typeof verSpec === "string" && !isInternalOrNonRegistrySpec(verSpec)) {
        const cleanVer = verSpec.replace(/[\^~>=<]/g, "");
        if (name && cleanVer) addQuery(name, cleanVer);
      }
    }
  } catch {}

  return queries;
}
