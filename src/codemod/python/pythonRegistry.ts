import type { CodemodRule } from "../astGrepRunner.ts";

export const PYTHON_CODEMOD_REGISTRY: Record<string, CodemodRule[]> = {
  // Example refactoring rules for Python packages
  requests: [
    {
      selector: "import urllib2",
      replacement: "import requests",
    },
    {
      selector: "from urllib2 import $NAME",
      replacement: "from requests import $NAME",
    },
  ],
  urllib3: [
    {
      selector: "import urllib3.contrib.pyopenssl",
      replacement: "import urllib3",
    },
  ],
  jinja2: [
    {
      selector: "from jinja2 import escape",
      replacement: "from markupsafe import escape",
    },
  ],
};

export function getPythonRulesForPackage(packageName: string): CodemodRule[] | null {
  const key = packageName.toLowerCase();
  return PYTHON_CODEMOD_REGISTRY[key] || null;
}
