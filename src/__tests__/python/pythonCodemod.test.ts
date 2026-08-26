import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { applyPythonStructuralCodemod, transformPythonSnippet } from "../../codemod/python/pythonAstRunner.ts";
import { PYTHON_CODEMOD_REGISTRY } from "../../codemod/python/pythonRegistry.ts";

describe("Python AST Structural Refactoring", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "py-codemod-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should refactor Python import statements while preserving comments, docstrings, and formatting", async () => {
    const originalCode = `"""Module docstring for sample app."""
# Legacy import
import urllib2

def fetch(url):
    """Fetch URL contents."""
    return urllib2.urlopen(url) # inline comment
`;

    const pyPath = path.join(tmpDir, "app.py");
    await fs.writeFile(pyPath, originalCode, "utf-8");

    const rules = PYTHON_CODEMOD_REGISTRY["requests"];
    expect(rules).toBeDefined();

    const count = await applyPythonStructuralCodemod(tmpDir, rules);
    expect(count).toBe(1);

    const updatedContent = await fs.readFile(pyPath, "utf-8");
    expect(updatedContent).toContain("import requests");
    expect(updatedContent).toContain('"""Module docstring for sample app."""');
    expect(updatedContent).toContain("# Legacy import");
  });

  it("should transform Jinja2 deprecated import statements correctly", async () => {
    const originalCode = `from jinja2 import escape\n\nsafe_html = escape("<div>Hello</div>")\n`;
    const pyPath = path.join(tmpDir, "template.py");
    await fs.writeFile(pyPath, originalCode, "utf-8");

    const rules = PYTHON_CODEMOD_REGISTRY["jinja2"];
    const count = await applyPythonStructuralCodemod(tmpDir, rules);
    expect(count).toBe(1);

    const updated = await fs.readFile(pyPath, "utf-8");
    expect(updated).toContain("from markupsafe import escape");
  });
});
