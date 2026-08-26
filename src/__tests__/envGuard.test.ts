import { checkProductionGuard } from "../runner/envGuard";

describe("Production Environment Guard & Safety Check", () => {
  it("should allow execution in default development mode", () => {
    const res = checkProductionGuard({}, []);
    expect(res.shouldProceed).toBe(true);
    expect(res.isProduction).toBe(false);
  });

  it("should block execution when NODE_ENV=production without --force flag", () => {
    const res = checkProductionGuard({ NODE_ENV: "production" }, []);
    expect(res.shouldProceed).toBe(false);
    expect(res.isProduction).toBe(true);
    expect(res.hasForceFlag).toBe(false);
    expect(res.warningMessage).toContain("PRODUCTION ENVIRONMENT DETECTED");
  });

  it("should block execution when --production flag is present without --force flag", () => {
    const res = checkProductionGuard({}, ["node", "index.js", "--production"]);
    expect(res.shouldProceed).toBe(false);
    expect(res.isProduction).toBe(true);
    expect(res.hasForceFlag).toBe(false);
  });

  it("should allow execution when NODE_ENV=production AND --force flag is provided", () => {
    const res = checkProductionGuard({ NODE_ENV: "production" }, ["node", "index.js", "--force"]);
    expect(res.shouldProceed).toBe(true);
    expect(res.isProduction).toBe(true);
    expect(res.hasForceFlag).toBe(true);
    expect(res.warningMessage).toContain("Proceeding with caution");
  });

  it("should allow execution when ENV=production AND -f flag is provided", () => {
    const res = checkProductionGuard({ ENV: "production" }, ["node", "index.js", "-f"]);
    expect(res.shouldProceed).toBe(true);
    expect(res.isProduction).toBe(true);
    expect(res.hasForceFlag).toBe(true);
  });
});
