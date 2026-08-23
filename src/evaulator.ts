import axios from "axios";
import semver from "semver";
import https from "node:https";
import http from "node:http";
import type { OSVVulnerability, RemediationReport, VulnerabilitySummary } from "./types.ts";

const CONCURRENCY_LIMIT = 20;

// Optimized HTTP/HTTPS Agents with TCP Keep-Alive connection pooling for npm registry queries
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY_LIMIT,
  keepAliveMsecs: 10000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY_LIMIT,
  keepAliveMsecs: 10000,
});

const registryClient = axios.create({
  httpAgent,
  httpsAgent,
});

/**
 * Executes registry calls with exponential backoff retries for transient network faults
 */
async function fetchRegistryWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const status = error.response?.status;
      // Do not retry 404/401/403 private package responses
      if (status === 404 || status === 401 || status === 403) {
        throw error;
      }
      const isRetryable =
        !error.response ||
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "EAI_AGAIN" ||
        error.code === "ENOTFOUND" ||
        error.code === "ECONNREFUSED" ||
        (status && status >= 500 && status <= 599) ||
        status === 429;

      if (attempt >= retries || !isRetryable) {
        throw error;
      }

      const backoff = delayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

export interface DeprecationInfo {
  isDeprecated: boolean;
  reason?: string;
  isPrivate?: boolean;
}

export async function checkPackageDeprecation(
  packageName: string,
  currentVersion?: string,
  vulnerabilities: OSVVulnerability[] = [],
): Promise<DeprecationInfo> {
  for (const v of vulnerabilities) {
    if (v.database_specific?.deprecated) {
      return {
        isDeprecated: true,
        reason: String(v.database_specific.deprecated),
        isPrivate: false,
      };
    }
    const summary = (v.summary || "").toLowerCase();
    const details = (v.details || "").toLowerCase();

    if (
      summary.includes("deprecated") ||
      details.includes("package is deprecated") ||
      details.includes("package has been deprecated") ||
      details.includes("is no longer maintained")
    ) {
      return {
        isDeprecated: true,
        reason: v.summary || "Package marked as deprecated in vulnerability advisories",
        isPrivate: false,
      };
    }
  }

  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const response = await fetchRegistryWithRetry(() => registryClient.get(url, { timeout: 3000 }));
    const data = response.data;

    if (data.deprecated) {
      return {
        isDeprecated: true,
        reason: typeof data.deprecated === "string" ? data.deprecated : "Package is deprecated on npm registry",
        isPrivate: false,
      };
    }

    const latestVer = data["dist-tags"]?.latest;
    if (latestVer && data.versions?.[latestVer]?.deprecated) {
      return {
        isDeprecated: true,
        reason: String(data.versions[latestVer].deprecated),
        isPrivate: false,
      };
    }

    if (currentVersion && data.versions?.[currentVersion]?.deprecated) {
      return {
        isDeprecated: true,
        reason: String(data.versions[currentVersion].deprecated),
        isPrivate: false,
      };
    }
  } catch (err: any) {
    if (err.response && (err.response.status === 404 || err.response.status === 401 || err.response.status === 403)) {
      return {
        isDeprecated: false,
        isPrivate: true,
        reason: `Private package (HTTP ${err.response.status}: Not found in public npm registry)`,
      };
    }
  }

  return { isDeprecated: false, isPrivate: false };
}

export function parseCvssVectorToRating(vector: string): string | null {
  if (!vector.startsWith("CVSS:3.")) return null;

  const parts = vector.split("/");
  const metrics: Record<string, string> = {};
  for (const part of parts) {
    const [key, val] = part.split(":");
    if (key && val) metrics[key] = val;
  }

  const avMap: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const acMap: Record<string, number> = { L: 0.77, H: 0.44 };
  const uiMap: Record<string, number> = { N: 0.85, R: 0.62 };
  const ciaMap: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };

  const av = avMap[metrics["AV"]] ?? 0.85;
  const ac = acMap[metrics["AC"]] ?? 0.77;
  const ui = uiMap[metrics["UI"]] ?? 0.85;
  const scope = metrics["S"] || "U";

  let pr = 0.85;
  if (scope === "U") {
    const prMap: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
    pr = prMap[metrics["PR"]] ?? 0.85;
  } else {
    const prMap: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
    pr = prMap[metrics["PR"]] ?? 0.85;
  }

  const c = ciaMap[metrics["C"]] ?? 0;
  const i = ciaMap[metrics["I"]] ?? 0;
  const a = ciaMap[metrics["A"]] ?? 0;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  if (iss <= 0) return "NONE";

  let impact = 0;
  if (scope === "U") {
    impact = 6.42 * iss;
  } else {
    impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.029, 15);
  }

  const exploitability = 8.22 * av * ac * pr * ui;

  let baseScore = 0;
  if (impact > 0) {
    if (scope === "U") {
      baseScore = Math.min(impact + exploitability, 10);
    } else {
      baseScore = Math.min(1.08 * (impact + exploitability), 10);
    }
  }

  baseScore = Math.ceil(baseScore * 10) / 10;

  if (baseScore >= 9.0) return "CRITICAL";
  if (baseScore >= 7.0) return "HIGH";
  if (baseScore >= 4.0) return "MODERATE";
  if (baseScore > 0) return "LOW";
  return "NONE";
}

export function extractSeverity(v: OSVVulnerability): string {
  if (v.database_specific?.severity && typeof v.database_specific.severity === "string") {
    return v.database_specific.severity.toUpperCase();
  }

  if (v.affected) {
    for (const aff of v.affected) {
      if (aff.database_specific?.severity && typeof aff.database_specific.severity === "string") {
        return aff.database_specific.severity.toUpperCase();
      }
    }
  }

  if (v.severity && Array.isArray(v.severity)) {
    for (const s of v.severity) {
      if (!s.score) continue;
      const scoreStr = s.score.trim();

      const numScore = parseFloat(scoreStr);
      if (!isNaN(numScore) && scoreStr.match(/^\d+(\.\d+)?$/)) {
        if (numScore >= 9.0) return "CRITICAL";
        if (numScore >= 7.0) return "HIGH";
        if (numScore >= 4.0) return "MODERATE";
        if (numScore > 0) return "LOW";
        return "NONE";
      }

      if (scoreStr.startsWith("CVSS:3.")) {
        const rating = parseCvssVectorToRating(scoreStr);
        if (rating) return rating;
      }
    }
  }

  return "UNKNOWN";
}

export function evaluateRemediation(
  packageName: string,
  currentVersion: string,
  vulnerabilities: OSVVulnerability[],
  deprecationInfo?: DeprecationInfo,
): RemediationReport {
  const isDeprecated = deprecationInfo?.isDeprecated || false;
  const deprecationReason = deprecationInfo?.reason;
  const isPrivate = deprecationInfo?.isPrivate || false;

  if (!vulnerabilities || vulnerabilities.length === 0) {
    return {
      packageName,
      currentVersion,
      vulnerabilities: [],
      isDeprecated,
      deprecationReason,
      isPrivate,
      remediation: { targetVersion: null, upgradeType: "NONE", hasBreakingChanges: false },
    };
  }

  let highestFixedVersion: string | null = null;

  const vulnSummaries: VulnerabilitySummary[] = vulnerabilities.map((v) => {
    let vulnFixedVersion: string | undefined = undefined;

    v.affected?.forEach((aff) => {
      aff.ranges?.forEach((range) => {
        range.events?.forEach((evt) => {
          if (evt.fixed) {
            vulnFixedVersion = evt.fixed;
            if (!highestFixedVersion || (semver.valid(evt.fixed) && semver.valid(highestFixedVersion) && semver.gt(evt.fixed, highestFixedVersion))) {
              highestFixedVersion = evt.fixed;
            }
          }
        });
      });
    });

    return {
      id: v.id,
      summary: v.summary || "No summary provided",
      severity: extractSeverity(v),
      fixedInVersion: vulnFixedVersion,
    };
  });

  let upgradeType: "PATCH" | "MINOR" | "MAJOR" | "NONE" = "NONE";
  let hasBreakingChanges = false;

  if (highestFixedVersion && semver.valid(highestFixedVersion) && semver.valid(currentVersion)) {
    const diff = semver.diff(currentVersion, highestFixedVersion);
    if (diff === "major" || diff === "premajor") {
      upgradeType = "MAJOR";
      hasBreakingChanges = true;
    } else if (diff === "minor" || diff === "preminor") {
      upgradeType = "MINOR";
    } else if (diff === "patch" || diff === "prepatch") {
      upgradeType = "PATCH";
    }
  }

  return {
    packageName,
    currentVersion,
    vulnerabilities: vulnSummaries,
    isDeprecated,
    deprecationReason,
    isPrivate,
    remediation: {
      targetVersion: highestFixedVersion,
      upgradeType,
      hasBreakingChanges,
    },
  };
}
