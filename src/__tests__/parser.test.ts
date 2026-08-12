import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parsePackageLock } from "../parser";

describe("parsePackageLock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vuln-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should parse lockfile when directory path is provided", async () => {
    const lockfileContent = JSON.stringify({
      packages: {
        "node_modules/axios": { version: "0.21.1" },
      },
    });
    await fs.writeFile(path.join(tmpDir, "package-lock.json"), lockfileContent, "utf-8");

    const result = await parsePackageLock(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      package: { name: "axios", ecosystem: "npm" },
      version: "0.21.1",
    });
  });

  it("should parse lockfile when direct lockfile path is provided", async () => {
    const lockfilePath = path.join(tmpDir, "package-lock.json");
    const lockfileContent = JSON.stringify({
      packages: {
        "node_modules/lodash": { version: "4.17.21" },
      },
    });
    await fs.writeFile(lockfilePath, lockfileContent, "utf-8");

    const result = await parsePackageLock(lockfilePath);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      package: { name: "lodash", ecosystem: "npm" },
      version: "4.17.21",
    });
  });

  it("should support v1 dependencies format", async () => {
    const lockfileContent = JSON.stringify({
      dependencies: {
        express: { version: "4.17.1" },
      },
    });
    await fs.writeFile(path.join(tmpDir, "package-lock.json"), lockfileContent, "utf-8");

    const result = await parsePackageLock(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      package: { name: "express", ecosystem: "npm" },
      version: "4.17.1",
    });
  });
});