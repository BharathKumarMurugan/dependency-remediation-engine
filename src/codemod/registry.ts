import type { CodemodRule } from "./astGrepRunner.ts";

export const CODEMOD_REGISTRY: Record<string, CodemodRule[]> = {
  // Example rule mapping for when a target breaking package is identified
  'express': [
    {
      selector: '$RES.send($STATUS, $BODY)',
      // Enforce status conversion only when the first argument matches a 3-digit number syntax
      // ast-grep lets us catch structural shapes natively
      replacement: '$RES.status($STATUS).send($BODY)'
    }
  ],
  "example-vulnerable-package": [
    {
      selector: "$CLIENT.fetchData($ID)",
      replacement: "$CLIENT.query({ id: $ID })",
    },
  ],
};

export function getRulesForPackage(packageName: string): CodemodRule[] | null {
  return CODEMOD_REGISTRY[packageName] || null;
}
