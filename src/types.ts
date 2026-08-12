export interface OSVQuery {
  package: {
    name: string;
    ecosystem: "npm" | "PyPI" | "Go" | "Maven";
  };
  version: string;
}

export interface DatabaseSpecific {
  github_reviewed_at?: string;
  github_reviewed?: boolean;
  nvd_published_at?: string;
  severity?: 'LOW' | 'MODERATE' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  cwe_ids?: string[];
  source?: string;
  [key: string]: unknown;
}

export interface OSVVulnerability {
  id: string;
  summary?: string;
  details?: string;
  modified?: string;
  published?: string;
  database_specific?: DatabaseSpecific;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package: { name: string; ecosystem: string; purl?: string };
    ranges?: Array<{
      type: "SEMVER" | "ECOSYSTEM";
      events: Array<{ introduced?: string; fixed?: string }>;
    }>;
    versions?: string[];
    database_specific?: DatabaseSpecific;
  }>;
}

export interface VulnerabilitySummary {
  id: string;
  summary: string;
  severity: string;
  fixedInVersion?: string;
}

export interface RemediationReport {
  packageName: string;
  currentVersion: string;
  vulnerabilities: VulnerabilitySummary[];
  remediation: {
    targetVersion: string | null;
    upgradeType: "PATCH" | "MINOR" | "MAJOR" | "NONE";
    hasBreakingChanges: boolean;
  };
}