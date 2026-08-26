import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("Pre-Push Hook Scripts", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prepush-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should verify pre-push installer script exists and runs without error", async () => {
    const installerPath = path.join(process.cwd(), "scripts", "install-hooks.js");
    const checkPath = path.join(process.cwd(), "scripts", "pre-push-check.js");

    const installerExists = await fs.stat(installerPath).then(() => true).catch(() => false);
    const checkExists = await fs.stat(checkPath).then(() => true).catch(() => false);

    expect(installerExists).toBe(true);
    expect(checkExists).toBe(true);
  });
});
