import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isDirectDependency } from "../runner/packageManager";

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
});
