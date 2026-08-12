import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { detectPackageManager, isDirectDependency } from "../runner/packageManager";

describe("packageManager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkgmgr-test-"));
    const pkgContent = JSON.stringify({
      name: "test-app",
      dependencies: {
        express: "^3.3.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
    });
    await fs.writeFile(path.join(tmpDir, "package.json"), pkgContent, "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should return true for direct dependencies in dependencies or devDependencies", async () => {
    expect(await isDirectDependency(tmpDir, "express")).toBe(true);
    expect(await isDirectDependency(tmpDir, "typescript")).toBe(true);
  });

  it("should return false for transitive dependencies not in package.json", async () => {
    expect(await isDirectDependency(tmpDir, "qs")).toBe(false);
    expect(await isDirectDependency(tmpDir, "send")).toBe(false);
    expect(await isDirectDependency(tmpDir, "cookie")).toBe(false);
  });

  it("should detect package managers correctly based on lockfile presence", async () => {
    const pnpmDir = await fs.mkdtemp(path.join(os.tmpdir(), "pnpm-test-"));
    await fs.writeFile(path.join(pnpmDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
    expect(await detectPackageManager(pnpmDir)).toBe("pnpm");
    await fs.rm(pnpmDir, { recursive: true, force: true });

    const yarnDir = await fs.mkdtemp(path.join(os.tmpdir(), "yarn-test-"));
    await fs.writeFile(path.join(yarnDir, "yarn.lock"), "# yarn lockfile v1");
    expect(await detectPackageManager(yarnDir)).toBe("yarn");
    await fs.rm(yarnDir, { recursive: true, force: true });

    const bunDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-test-"));
    await fs.writeFile(path.join(bunDir, "bun.lock"), "");
    expect(await detectPackageManager(bunDir)).toBe("bun");
    await fs.rm(bunDir, { recursive: true, force: true });

    const npmDir = await fs.mkdtemp(path.join(os.tmpdir(), "npm-test-"));
    await fs.writeFile(path.join(npmDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(npmDir)).toBe("npm");
    await fs.rm(npmDir, { recursive: true, force: true });
  });
});
