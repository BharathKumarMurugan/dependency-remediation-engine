import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectPackageManager,
  hasTestSuite,
  isDirectDependency,
  isNoTargetVersionError,
  isPeerDependencyError,
} from "../runner/packageManager";

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

  it("should correctly detect presence or absence of a valid test suite", async () => {
    const noTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "notest-"));
    await fs.writeFile(
      path.join(noTestDir, "package.json"),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      "utf-8"
    );
    expect(await hasTestSuite(noTestDir)).toBe(false);
    await fs.rm(noTestDir, { recursive: true, force: true });

    const validTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "validtest-"));
    await fs.writeFile(
      path.join(validTestDir, "package.json"),
      JSON.stringify({ scripts: { test: "jest" } }),
      "utf-8"
    );
    expect(await hasTestSuite(validTestDir)).toBe(true);
    await fs.rm(validTestDir, { recursive: true, force: true });
  });

  it("should identify no matching target version errors correctly", () => {
    expect(isNoTargetVersionError("npm error code ETARGET")).toBe(true);
    expect(isNoTargetVersionError("npm error notarget No matching version found for foo@9.9.9")).toBe(true);
    expect(isNoTargetVersionError("ERR_PNPM_NO_MATCHING_VERSION No matching version found for bar")).toBe(true);
    expect(isNoTargetVersionError("SyntaxError: unexpected token")).toBe(false);
  });

  it("should identify peer dependency & ERESOLVE errors correctly", () => {
    expect(isPeerDependencyError("npm error code ERESOLVE")).toBe(true);
    expect(isPeerDependencyError("npm error ERESOLVE could not resolve dependency")).toBe(true);
    expect(isPeerDependencyError("Conflicting peer dependency: typescript@7.0.2")).toBe(true);
    expect(isPeerDependencyError("ERR_PNPM_PEER_DEP_ISSUES")).toBe(true);
    expect(isPeerDependencyError("Command failed: node index.js")).toBe(false);
  });
});
