import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parsePythonLockfile } from "../../parser/python/pythonParser.ts";
import { detectEcosystem } from "../../ecosystems/factory.ts";

describe("Python Manifest & Lockfile Parser", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "py-parse-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should auto-detect Python ecosystem when requirements.txt exists without Node lockfile", async () => {
    await fs.writeFile(path.join(tmpDir, "requirements.txt"), "requests==2.28.1\n", "utf-8");
    const eco = await detectEcosystem(tmpDir);
    expect(eco).toBe("python");
  });

  it("should parse requirements.txt standard PEP 508 specifiers and ignore flags, comments, and VCS links", async () => {
    const reqContent = `
# This is a comment
requests==2.28.1 # inline comment
jinja2 >= 2.10.1, < 3.0.0
django~=4.0.0
-r base.txt
-i https://pypi.org/simple
git+https://github.com/psf/requests.git@v2.28.1#egg=requests
-e .
urllib3 == 1.26.12 ; python_version >= '3.8'
`;
    await fs.writeFile(path.join(tmpDir, "requirements.txt"), reqContent, "utf-8");

    const result = await parsePythonLockfile(tmpDir, "pip");
    expect(result).toEqual(
      expect.arrayContaining([
        { package: { name: "requests", ecosystem: "PyPI" }, version: "2.28.1" },
        { package: { name: "jinja2", ecosystem: "PyPI" }, version: "2.10.1" },
        { package: { name: "django", ecosystem: "PyPI" }, version: "4.0.0" },
        { package: { name: "urllib3", ecosystem: "PyPI" }, version: "1.26.12" },
      ])
    );
  });

  it("should parse poetry.lock TOML package structures correctly", async () => {
    const poetryContent = `
[[package]]
name = "requests"
version = "2.28.1"
description = "Python HTTP for Humans."

[[package]]
name = "urllib3"
version = "1.26.12"
`;
    await fs.writeFile(path.join(tmpDir, "poetry.lock"), poetryContent, "utf-8");

    const result = await parsePythonLockfile(tmpDir, "poetry");
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { package: { name: "requests", ecosystem: "PyPI" }, version: "2.28.1" },
      { package: { name: "urllib3", ecosystem: "PyPI" }, version: "1.26.12" },
    ]);
  });

  it("should parse Pipfile.lock JSON format correctly", async () => {
    const pipfileContent = JSON.stringify({
      default: {
        requests: { version: "==2.28.1" },
        flask: { version: "==2.2.2" },
      },
      develop: {
        pytest: { version: "==7.1.3" },
      },
    });
    await fs.writeFile(path.join(tmpDir, "Pipfile.lock"), pipfileContent, "utf-8");

    const result = await parsePythonLockfile(tmpDir, "pipenv");
    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        { package: { name: "requests", ecosystem: "PyPI" }, version: "2.28.1" },
        { package: { name: "flask", ecosystem: "PyPI" }, version: "2.2.2" },
        { package: { name: "pytest", ecosystem: "PyPI" }, version: "7.1.3" },
      ])
    );
  });

  it("should parse uv.lock TOML format correctly", async () => {
    const uvContent = `
[[package]]
name = "httpx"
version = "0.23.0"

[[package]]
name = "certifi"
version = "2022.9.24"
`;
    await fs.writeFile(path.join(tmpDir, "uv.lock"), uvContent, "utf-8");

    const result = await parsePythonLockfile(tmpDir, "uv");
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { package: { name: "httpx", ecosystem: "PyPI" }, version: "0.23.0" },
      { package: { name: "certifi", ecosystem: "PyPI" }, version: "2022.9.24" },
    ]);
  });
});
