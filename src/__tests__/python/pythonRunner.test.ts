import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { detectVirtualEnvironment, checkPythonEnvGuard } from "../../runner/python/pythonEnvDetector.ts";
import { detectPythonPackageManager } from "../../runner/python/pythonManager.ts";
import { classifyPythonError } from "../../runner/python/pythonErrorClassifier.ts";

describe("Python Environment & Package Manager Runner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "py-runner-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should detect active virtual environment from shell environment variables", async () => {
    const res = await detectVirtualEnvironment(tmpDir, { VIRTUAL_ENV: "/path/to/.venv" });
    expect(res.isActive).toBe(true);
    expect(res.isSystemPython).toBe(false);
  });

  it("should detect local .venv directory in project root", async () => {
    await fs.mkdir(path.join(tmpDir, ".venv"));
    const res = await detectVirtualEnvironment(tmpDir, {});
    expect(res.isActive).toBe(true);
    expect(res.isSystemPython).toBe(false);
  });

  it("should warn when no virtual environment is present (system Python)", async () => {
    const res = await detectVirtualEnvironment(tmpDir, {});
    expect(res.isActive).toBe(false);
    expect(res.isSystemPython).toBe(true);
    expect(res.warningMessage).toContain("No active Python virtual environment");
  });

  it("should detect package manager correctly based on lockfile presence", async () => {
    await fs.writeFile(path.join(tmpDir, "poetry.lock"), "");
    expect(await detectPythonPackageManager(tmpDir)).toBe("poetry");

    await fs.rm(path.join(tmpDir, "poetry.lock"));
    await fs.writeFile(path.join(tmpDir, "uv.lock"), "");
    expect(await detectPythonPackageManager(tmpDir)).toBe("uv");

    await fs.rm(path.join(tmpDir, "uv.lock"));
    await fs.writeFile(path.join(tmpDir, "Pipfile.lock"), "");
    expect(await detectPythonPackageManager(tmpDir)).toBe("pipenv");

    await fs.rm(path.join(tmpDir, "Pipfile.lock"));
    await fs.writeFile(path.join(tmpDir, "requirements.txt"), "");
    expect(await detectPythonPackageManager(tmpDir)).toBe("pip");
  });

  it("should classify Python package manager errors correctly", () => {
    const res1 = classifyPythonError("ERROR: No matching distribution found for requests==9.9.9");
    expect(res1?.userTitle).toContain("Version Resolution Failed");

    const res2 = classifyPythonError("PermissionError: [Errno 13] Permission denied: '/usr/local/lib/python3.10'");
    expect(res2?.userTitle).toContain("Permission Denied");

    const res3 = classifyPythonError("Failed building wheel for cryptography: error: command 'gcc' failed");
    expect(res3?.userTitle).toContain("Native C/C++ Binary Build Error");

    const res4 = classifyPythonError("SSLError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed");
    expect(res4?.userTitle).toContain("SSL Certificate / Network Error");

    expect(classifyPythonError("Unknown error")).toBeNull();
  });
});
