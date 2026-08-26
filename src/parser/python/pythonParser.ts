import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { OSVQuery } from "../../types.ts";
import { parseTomlPackages } from "./tomlParser.ts";

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
 * Parses requirements.txt or constraints.txt for PEP 508 package specifiers
 */
export function parseRequirementsTxt(content: string): OSVQuery[] {
  const queries: OSVQuery[] = [];
  const seen = new Set<string>();

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    const commentIndex = line.indexOf("#");
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex);
    }
    line = line.trim();
    if (!line) continue;

    // Skip flags, options, VCS links, local file paths, editable specs
    if (
      line.startsWith("-") ||
      line.startsWith("--") ||
      line.startsWith("git+") ||
      line.startsWith("http://") ||
      line.startsWith("https://") ||
      line.startsWith("file://") ||
      line.startsWith("./") ||
      line.startsWith("../")
    ) {
      continue;
    }

    const semiIndex = line.indexOf(";");
    if (semiIndex !== -1) {
      line = line.substring(0, semiIndex).trim();
    }

    const match = line.match(/^([a-zA-Z0-9_.-]+)\s*(?:==|===|>=|~=|>|=|<=|<)?\s*([0-9]+\.[0-9]+[^\s,]*)/);
    if (match) {
      const name = match[1].trim();
      const rawVer = match[2].trim();
      const cleanVer = rawVer.replace(/^[^\d]*/, "");

      if (name && cleanVer) {
        const key = `${name.toLowerCase()}@${cleanVer}`;
        if (!seen.has(key)) {
          seen.add(key);
          queries.push({
            package: { name, ecosystem: "PyPI" },
            version: cleanVer,
          });
        }
      }
    }
  }

  return queries;
}

/**
 * Parses Pipfile.lock JSON format
 */
export function parsePipfileLock(content: string): OSVQuery[] {
  const queries: OSVQuery[] = [];
  const seen = new Set<string>();

  try {
    const json = JSON.parse(content);
    const sections = [json.default, json.develop];

    for (const section of sections) {
      if (!section || typeof section !== "object") continue;
      for (const [pkgName, pkgData] of Object.entries(section)) {
        if (!pkgData || typeof pkgData !== "object") continue;
        const versionSpec = (pkgData as { version?: string }).version;
        if (versionSpec && typeof versionSpec === "string") {
          const cleanVer = versionSpec.replace(/^[^\d]*/, "");
          if (pkgName && cleanVer) {
            const key = `${pkgName.toLowerCase()}@${cleanVer}`;
            if (!seen.has(key)) {
              seen.add(key);
              queries.push({
                package: { name: pkgName, ecosystem: "PyPI" },
                version: cleanVer,
              });
            }
          }
        }
      }
    }
  } catch {}

  return queries;
}

/**
 * Parses Python lockfiles (requirements.txt, poetry.lock, Pipfile.lock, uv.lock) and outputs PyPI queries
 */
export async function parsePythonLockfile(targetPath: string, pm = "pip"): Promise<OSVQuery[]> {
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
    const cleanVer = version.replace(/^[^\d]*/, "");
    if (!cleanVer) return;

    const key = `${name.toLowerCase()}@${cleanVer}`;
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({
        package: { name, ecosystem: "PyPI" },
        version: cleanVer,
      });
    }
  }

  // 1. poetry.lock parsing
  if (pm === "poetry") {
    try {
      const poetryLockPath = path.join(projectDir, "poetry.lock");
      const content = await readFileAsStream(poetryLockPath);
      const pkgs = parseTomlPackages(content);
      for (const p of pkgs) addQuery(p.name, p.version);
      if (queries.length > 0) return queries;
    } catch {}
  }

  // 2. uv.lock parsing
  if (pm === "uv") {
    try {
      const uvLockPath = path.join(projectDir, "uv.lock");
      const content = await readFileAsStream(uvLockPath);
      const pkgs = parseTomlPackages(content);
      for (const p of pkgs) addQuery(p.name, p.version);
      if (queries.length > 0) return queries;
    } catch {}
  }

  // 3. Pipfile.lock parsing
  if (pm === "pipenv") {
    try {
      const pipfileLockPath = path.join(projectDir, "Pipfile.lock");
      const content = await readFileAsStream(pipfileLockPath);
      const res = parsePipfileLock(content);
      if (res.length > 0) return res;
    } catch {}
  }

  // 4. requirements.txt / constraints.txt parsing (fallback for pip or general)
  const reqFiles = ["requirements.txt", "constraints.txt", "requirements-dev.txt"];
  for (const reqFile of reqFiles) {
    try {
      const reqPath = path.join(projectDir, reqFile);
      const content = await readFileAsStream(reqPath);
      const res = parseRequirementsTxt(content);
      for (const q of res) addQuery(q.package.name, q.version);
    } catch {}
  }

  // 5. Fallback: try poetry.lock / uv.lock / Pipfile.lock if present regardless of pm flag
  if (queries.length === 0) {
    const fallbackLocks = ["poetry.lock", "uv.lock"];
    for (const lock of fallbackLocks) {
      try {
        const lockPath = path.join(projectDir, lock);
        const content = await readFileAsStream(lockPath);
        const pkgs = parseTomlPackages(content);
        for (const p of pkgs) addQuery(p.name, p.version);
        if (queries.length > 0) return queries;
      } catch {}
    }

    try {
      const pipfileLockPath = path.join(projectDir, "Pipfile.lock");
      const content = await readFileAsStream(pipfileLockPath);
      const res = parsePipfileLock(content);
      for (const q of res) addQuery(q.package.name, q.version);
    } catch {}
  }

  return queries;
}
