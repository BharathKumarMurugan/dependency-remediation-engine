import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { applyStructuralCodemod, CodemodRule } from "../codemod/astGrepRunner";
import { CODEMOD_REGISTRY } from "../codemod/registry";

describe("applyStructuralCodemod", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codemod-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should perform AST structural code refactoring correctly on standard JS", async () => {
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

  it("should support variant import styles including CJS require, destructured, ESM default/named/namespace, and dynamic imports", async () => {
    const rules = CODEMOD_REGISTRY["request"];
    expect(rules).toBeDefined();

    const cjsFile = path.join(tmpDir, "cjs.js");
    const esmFile = path.join(tmpDir, "esm.js");
    const dynamicFile = path.join(tmpDir, "dynamic.js");

    await fs.writeFile(cjsFile, "const request = require('request');\nconst { get } = require('request');", "utf-8");
    await fs.writeFile(esmFile, "import request from 'request';\nimport { get } from 'request';\nimport * as request from 'request';", "utf-8");
    await fs.writeFile(dynamicFile, "async function run() { await import('request'); }", "utf-8");

    const modifiedCount = await applyStructuralCodemod(tmpDir, rules);
    expect(modifiedCount).toBe(3);

    const cjsUpdated = await fs.readFile(cjsFile, "utf-8");
    expect(cjsUpdated).toContain("require('axios')");

    const esmUpdated = await fs.readFile(esmFile, "utf-8");
    expect(esmUpdated).toContain("from 'axios'");

    const dynamicUpdated = await fs.readFile(dynamicFile, "utf-8");
    expect(dynamicUpdated).toContain("import('axios')");
  });

  it("should support explicit module specs (.mjs, .cjs, .mts, .cts)", async () => {
    const rules: CodemodRule[] = [
      {
        selector: "$RES.send($STATUS, $BODY)",
        replacement: "$RES.status($STATUS).send($BODY)",
      },
    ];

    const mjsPath = path.join(tmpDir, "server.mjs");
    const cjsPath = path.join(tmpDir, "server.cjs");
    const mtsPath = path.join(tmpDir, "server.mts");
    const ctsPath = path.join(tmpDir, "server.cts");

    const sampleCode = `res.send(400, 'Bad Request');`;

    await fs.writeFile(mjsPath, sampleCode, "utf-8");
    await fs.writeFile(cjsPath, sampleCode, "utf-8");
    await fs.writeFile(mtsPath, sampleCode, "utf-8");
    await fs.writeFile(ctsPath, sampleCode, "utf-8");

    const count = await applyStructuralCodemod(tmpDir, rules);
    expect(count).toBe(4);

    expect(await fs.readFile(mjsPath, "utf-8")).toContain("res.status(400).send('Bad Request')");
    expect(await fs.readFile(cjsPath, "utf-8")).toContain("res.status(400).send('Bad Request')");
    expect(await fs.readFile(mtsPath, "utf-8")).toContain("res.status(400).send('Bad Request')");
    expect(await fs.readFile(ctsPath, "utf-8")).toContain("res.status(400).send('Bad Request')");
  });

  it("should support declaration files (.d.ts, .d.mts, .d.cts)", async () => {
    const rules: CodemodRule[] = [
      {
        selector: "$RES.send($STATUS, $BODY)",
        replacement: "$RES.status($STATUS).send($BODY)",
      },
    ];

    const dtsPath = path.join(tmpDir, "index.d.ts");
    const dmtsPath = path.join(tmpDir, "index.d.mts");
    const dctsPath = path.join(tmpDir, "index.d.cts");

    const sampleCode = `res.send(500, 'Server Error');`;

    await fs.writeFile(dtsPath, sampleCode, "utf-8");
    await fs.writeFile(dmtsPath, sampleCode, "utf-8");
    await fs.writeFile(dctsPath, sampleCode, "utf-8");

    const count = await applyStructuralCodemod(tmpDir, rules);
    expect(count).toBe(3);

    expect(await fs.readFile(dtsPath, "utf-8")).toContain("res.status(500).send('Server Error')");
  });

  it("should support frontend framework single file components (.vue, .astro, .svelte)", async () => {
    const rules: CodemodRule[] = [
      {
        selector: "$RES.send($STATUS, $BODY)",
        replacement: "$RES.status($STATUS).send($BODY)",
      },
    ];

    const vuePath = path.join(tmpDir, "Component.vue");
    const vueCode = `<template><h1>Page</h1></template>\n<script>\nres.send(403, 'Forbidden');\n</script>`;

    const sveltePath = path.join(tmpDir, "Widget.svelte");
    const svelteCode = `<script lang="ts">\nres.send(401, 'Unauthorized');\n</script>\n<main>Widget</main>`;

    const astroPath = path.join(tmpDir, "Page.astro");
    const astroCode = `---\nres.send(502, 'Bad Gateway');\n---\n<html></html>`;

    await fs.writeFile(vuePath, vueCode, "utf-8");
    await fs.writeFile(sveltePath, svelteCode, "utf-8");
    await fs.writeFile(astroPath, astroCode, "utf-8");

    const count = await applyStructuralCodemod(tmpDir, rules);
    expect(count).toBe(3);

    expect(await fs.readFile(vuePath, "utf-8")).toContain("res.status(403).send('Forbidden')");
    expect(await fs.readFile(sveltePath, "utf-8")).toContain("res.status(401).send('Unauthorized')");
    expect(await fs.readFile(astroPath, "utf-8")).toContain("res.status(502).send('Bad Gateway')");
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
