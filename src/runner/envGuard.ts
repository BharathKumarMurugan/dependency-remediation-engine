export interface EnvGuardResult {
  isProduction: boolean;
  hasForceFlag: boolean;
  shouldProceed: boolean;
  warningMessage?: string;
}

/**
 * Inspects environment variables and CLI flags to prevent unintended dependency upgrades, file edits, or AST refactoring on production servers.
 */
export function checkProductionGuard(
  env: Record<string, string | undefined> = process.env,
  args: string[] = process.argv
): EnvGuardResult {
  const nodeEnv = (env.NODE_ENV || "").toLowerCase().trim();
  const envVar = (env.ENV || "").toLowerCase().trim();

  const isProduction =
    nodeEnv === "production" ||
    envVar === "production" ||
    args.includes("--production");

  const hasForceFlag = args.includes("--force") || args.includes("-f");

  if (isProduction && !hasForceFlag) {
    return {
      isProduction: true,
      hasForceFlag: false,
      shouldProceed: false,
      warningMessage:
        "🚨 PRODUCTION ENVIRONMENT DETECTED (NODE_ENV=production or --production flag).\n" +
        "Running dependency upgrades, file modifications, or AST refactoring on a live production server can cause downtime.\n" +
        "To bypass this guard and force execution on production, re-run with the --force flag (e.g. npm start -- --force).",
    };
  }

  if (isProduction && hasForceFlag) {
    return {
      isProduction: true,
      hasForceFlag: true,
      shouldProceed: true,
      warningMessage:
        "⚠️ Production environment detected (NODE_ENV=production), but --force flag was provided. Proceeding with caution...",
    };
  }

  return {
    isProduction: false,
    hasForceFlag,
    shouldProceed: true,
  };
}
