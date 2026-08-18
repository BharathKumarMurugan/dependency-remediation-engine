import { checkPackageDeprecation, evaluateRemediation } from "../evaulator";
import { OSVVulnerability } from "../types";

describe("evaluateRemediation", () => {
  it("should return NONE upgrade type when no vulnerabilities exist", () => {
    const result = evaluateRemediation("lodash", "4.17.20", []);
    expect(result.remediation.upgradeType).toBe("NONE");
    expect(result.remediation.targetVersion).toBeNull();
    expect(result.remediation.hasBreakingChanges).toBe(false);
  });

  it("should detect a PATCH upgrade for a non-breaking fix", () => {
    const mockVulns: OSVVulnerability[] = [
      {
        id: "GHSA-test-1234",
        summary: "Mock vulnerability",
        affected: [
          {
            package: { name: "express", ecosystem: "npm" },
            ranges: [
              {
                type: "SEMVER",
                events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }],
              },
            ],
          },
        ],
      },
    ];

    const result = evaluateRemediation("express", "4.17.20", mockVulns);
    expect(result.remediation.upgradeType).toBe("PATCH");
    expect(result.remediation.targetVersion).toBe("4.17.21");
    expect(result.remediation.hasBreakingChanges).toBe(false);
  });

  it("should flag MAJOR upgrade and breaking changes correctly", () => {
    const mockVulns: OSVVulnerability[] = [
      {
        id: "GHSA-break-9999",
        summary: "Major Breaking Fix Required",
        affected: [
          {
            package: { name: "some-pkg", ecosystem: "npm" },
            ranges: [
              {
                type: "SEMVER",
                events: [{ introduced: "1.0.0" }, { fixed: "2.0.0" }],
              },
            ],
          },
        ],
      },
    ];

    const result = evaluateRemediation("some-pkg", "1.5.0", mockVulns);
    expect(result.remediation.upgradeType).toBe("MAJOR");
    expect(result.remediation.targetVersion).toBe("2.0.0");
    expect(result.remediation.hasBreakingChanges).toBe(true);
  });

  it("should extract severity from database_specific if present", () => {
    const mockVulns: OSVVulnerability[] = [
      {
        id: "GHSA-6w62-83g6-rfhj",
        summary: "Node Connect Reflected Cross-Site Scripting",
        database_specific: {
          severity: "MODERATE",
        },
        affected: [],
      },
    ];

    const result = evaluateRemediation("connect", "2.8.0", mockVulns);
    expect(result.vulnerabilities[0].severity).toBe("MODERATE");
  });

  it("should parse CVSS v3 vector into severity rating when database_specific is missing", () => {
    const mockVulns: OSVVulnerability[] = [
      {
        id: "GHSA-6w62-83g6-rfhj",
        summary: "Node Connect Reflected Cross-Site Scripting",
        severity: [
          {
            type: "CVSS_V3",
            score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
          },
        ],
        affected: [],
      },
    ];

    const result = evaluateRemediation("connect", "2.8.0", mockVulns);
    expect(result.vulnerabilities[0].severity).toBe("MODERATE");
  });

  it("should detect deprecation from vulnerability details or deprecationInfo", async () => {
    const mockVulns: OSVVulnerability[] = [
      {
        id: "GHSA-depr-1234",
        summary: "This package is deprecated",
        affected: [],
      },
    ];

    const depInfo = await checkPackageDeprecation("some-deprecated-pkg", "1.0.0", mockVulns);
    expect(depInfo.isDeprecated).toBe(true);

    const result = evaluateRemediation("some-deprecated-pkg", "1.0.0", mockVulns, depInfo);
    expect(result.isDeprecated).toBe(true);
  });
});