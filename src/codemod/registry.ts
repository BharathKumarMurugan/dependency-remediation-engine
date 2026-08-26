import type { CodemodRule } from "./astGrepRunner.ts";

export const CODEMOD_REGISTRY: Record<string, CodemodRule[]> = {
  // 1. Express Framework Breaking Changes (v4 -> v5)
  express: [
    // res.send(status, body) -> res.status(status).send(body)
    {
      selector: "$RES.send($STATUS, $BODY)",
      replacement: "$RES.status($STATUS).send($BODY)",
    },
    // Legacy express.bodyParser() -> express.json()
    {
      selector: "$APP.use(express.bodyParser())",
      replacement: "$APP.use(express.json())\n$APP.use(express.urlencoded({ extended: true }))",
    },
  ],

  // 2. Request Library Deprecation Refactoring (CJS, ESM, Destructured, and Dynamic Imports)
  request: [
    // CJS Default Require: const request = require('request')
    {
      selector: "const $VAR = require('request')",
      replacement: "const $VAR = require('axios')",
    },
    // CJS Destructured Require: const { get } = require('request')
    {
      selector: "const { $FN } = require('request')",
      replacement: "const { $FN } = require('axios')",
    },
    // ESM Default Import: import request from 'request'
    {
      selector: "import $VAR from 'request'",
      replacement: "import $VAR from 'axios'",
    },
    // ESM Named Import: import { get } from 'request'
    {
      selector: "import { $FN } from 'request'",
      replacement: "import { $FN } from 'axios'",
    },
    // ESM Namespace Import: import * as request from 'request'
    {
      selector: "import * as $VAR from 'request'",
      replacement: "import * as $VAR from 'axios'",
    },
    // Dynamic Import Call: await import('request')
    {
      selector: "await import('request')",
      replacement: "await import('axios')",
    },
  ],

  // 3. Example Vulnerable Package API Migrations
  "example-vulnerable-package": [
    // Destructured CJS: const { fetchData } = require('example-vulnerable-package')
    {
      selector: "const { fetchData } = require('example-vulnerable-package')",
      replacement: "const { query } = require('example-vulnerable-package')",
    },
    // Destructured ESM: import { fetchData } from 'example-vulnerable-package'
    {
      selector: "import { fetchData } from 'example-vulnerable-package'",
      replacement: "import { query } from 'example-vulnerable-package'",
    },
    // Method Call Refactoring: $CLIENT.fetchData($ID) -> $CLIENT.query({ id: $ID })
    {
      selector: "$CLIENT.fetchData($ID)",
      replacement: "$CLIENT.query({ id: $ID })",
    },
  ],
};

export function getRulesForPackage(packageName: string): CodemodRule[] | null {
  return CODEMOD_REGISTRY[packageName] || null;
}
