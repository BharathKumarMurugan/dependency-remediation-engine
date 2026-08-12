import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { applyStructuralCodemod, CodemodRule } from "../codemod/astGrepRunner";

describe("applyStructuralCodemod", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codemod-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should perform AST structural code refactoring correctly", async () => {
    const originalCode = `
const express = require('express');
const app = express();

app.get('/error', (req, res) => {
  res.send(404, 'Page not found');
});
`;

    const filePath = path.join(tmpDir, "index.js");
    await fs.writeFile(filePath, originalCode, "utf-8");

    const rules: CodemodRule[] = [
      {
        selector: "$RES.send($STATUS, $BODY)",
        replacement: "$RES.status($STATUS).send($BODY)",
      },
    ];

    const modifiedCount = await applyStructuralCodemod(tmpDir, rules);
    expect(modifiedCount).toBe(1);

    const updatedContent = await fs.readFile(filePath, "utf-8");
    expect(updatedContent).not.toContain("[object Object]");
    expect(updatedContent).toContain("res.status(404).send('Page not found')");
  });

  it("should not modify files if selector does not match", async () => {
    const originalCode = `console.log("Hello world");`;
    const filePath = path.join(tmpDir, "app.js");
    await fs.writeFile(filePath, originalCode, "utf-8");

    const rules: CodemodRule[] = [
      {
        selector: "$RES.send($STATUS, $BODY)",
        replacement: "$RES.status($STATUS).send($BODY)",
      },
    ];

    const modifiedCount = await applyStructuralCodemod(tmpDir, rules);
    expect(modifiedCount).toBe(0);

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(originalCode);
  });
});
