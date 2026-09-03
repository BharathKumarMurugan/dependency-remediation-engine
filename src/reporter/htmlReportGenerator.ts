export interface HtmlReportData {
  projectName?: string;
  scanTimestamp?: string;
  totalDependenciesScanned?: number;
  vulnerablePackagesCount?: number;
  vulnerableItems?: Array<{
    packageName: string;
    currentVersion: string;
    vulnerabilities: Array<{
      id: string;
      summary: string;
      severity: string;
      fixedInVersion?: string;
    }>;
    isDeprecated?: boolean;
    deprecationReason?: string;
    isPrivate?: boolean;
    remediation: {
      targetVersion: string | null;
      upgradeType: string;
      hasBreakingChanges: boolean;
    };
  }>;
}

export function generateHtmlReport(data: HtmlReportData): string {
  const projectName = data.projectName || "Target Project";
  const timestamp = data.scanTimestamp ? new Date(data.scanTimestamp).toLocaleString() : new Date().toLocaleString();
  const totalScanned = data.totalDependenciesScanned || 0;
  const vulnerableItems = data.vulnerableItems || [];
  const totalVulnerable = data.vulnerablePackagesCount !== undefined ? data.vulnerablePackagesCount : vulnerableItems.length;

  let criticalCount = 0;
  let highCount = 0;
  let moderateCount = 0;
  let lowCount = 0;
  let deprecatedCount = 0;
  let privateCount = 0;

  vulnerableItems.forEach((item) => {
    if (item.isDeprecated) deprecatedCount++;
    if (item.isPrivate) privateCount++;
    item.vulnerabilities.forEach((v) => {
      const sev = (v.severity || "").toUpperCase();
      if (sev === "CRITICAL") criticalCount++;
      else if (sev === "HIGH") highCount++;
      else if (sev === "MODERATE") moderateCount++;
      else if (sev === "LOW") lowCount++;
    });
  });

  const packagesJson = JSON.stringify(vulnerableItems).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vulnerability & Remediation Report - ${escapeHtml(projectName)}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-card: #1e293b;
      --bg-card-hover: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #334155;
      --accent-blue: #38bdf8;
      --accent-green: #4ade80;
      --sev-critical: #ef4444;
      --sev-high: #f97316;
      --sev-moderate: #eab308;
      --sev-low: #3b82f6;
      --sev-info: #64748b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-main);
      padding: 2rem;
      min-height: 100vh;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .header-title h1 {
      font-size: 1.8rem;
      font-weight: 700;
      background: linear-gradient(to right, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .header-title p {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.3);
    }

    .metric-label {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .controls-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .search-box {
      position: relative;
      flex: 1;
      min-width: 250px;
    }

    .search-box input {
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      outline: none;
      font-size: 0.95rem;
      transition: border-color 0.2s ease;
    }

    .search-box input:focus {
      border-color: var(--accent-blue);
    }

    .filter-pills {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .filter-pill {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.5rem 0.9rem;
      border-radius: 20px;
      font-size: 0.85rem;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }

    .filter-pill.active, .filter-pill:hover {
      background: var(--accent-blue);
      color: #0f172a;
      font-weight: 600;
      border-color: var(--accent-blue);
    }

    .package-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      margin-bottom: 1rem;
      overflow: hidden;
      transition: border-color 0.2s ease;
    }

    .package-card:hover {
      border-color: #475569;
    }

    .package-header {
      padding: 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .package-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .package-name {
      font-size: 1.1rem;
      font-weight: 600;
    }

    .badge {
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-critical { background: rgba(239, 68, 68, 0.2); color: var(--sev-critical); border: 1px solid var(--sev-critical); }
    .badge-high { background: rgba(249, 115, 22, 0.2); color: var(--sev-high); border: 1px solid var(--sev-high); }
    .badge-moderate { background: rgba(234, 179, 8, 0.2); color: var(--sev-moderate); border: 1px solid var(--sev-moderate); }
    .badge-low { background: rgba(59, 130, 246, 0.2); color: var(--sev-low); border: 1px solid var(--sev-low); }
    .badge-deprecated { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid #94a3b8; }
    .badge-private { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid #a855f7; }

    .version-flow {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }

    .version-current { color: var(--text-muted); }
    .version-target { color: var(--accent-green); font-weight: 600; }

    .package-details {
      padding: 1.25rem;
      border-top: 1px solid var(--border-color);
      background: rgba(15, 23, 42, 0.4);
      display: none;
    }

    .package-card.expanded .package-details {
      display: block;
    }

    .vuln-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .vuln-item {
      background: var(--bg-card);
      border-left: 4px solid var(--sev-high);
      padding: 0.9rem 1rem;
      border-radius: 0 8px 8px 0;
    }

    .vuln-item.sev-CRITICAL { border-left-color: var(--sev-critical); }
    .vuln-item.sev-HIGH { border-left-color: var(--sev-high); }
    .vuln-item.sev-MODERATE { border-left-color: var(--sev-moderate); }
    .vuln-item.sev-LOW { border-left-color: var(--sev-low); }

    .vuln-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.4rem;
    }

    .vuln-id {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .vuln-summary {
      font-size: 0.9rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .no-results {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px dashed var(--border-color);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>🛡️ Dependency Vulnerability & Remediation Report</h1>
        <p>Project: <strong>${escapeHtml(projectName)}</strong> | Generated on: ${escapeHtml(timestamp)}</p>
      </div>
    </header>

    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Dependencies Scanned</span>
        <span class="metric-value" style="color: var(--accent-blue);">${totalScanned}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Vulnerable / Deprecated</span>
        <span class="metric-value" style="color: ${totalVulnerable > 0 ? 'var(--sev-high)' : 'var(--accent-green)'};">${totalVulnerable}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Critical Vulnerabilities</span>
        <span class="metric-value" style="color: var(--sev-critical);">${criticalCount}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">High Vulnerabilities</span>
        <span class="metric-value" style="color: var(--sev-high);">${highCount}</span>
      </div>
    </div>

    <div class="controls-bar">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search package name or vulnerability ID..." oninput="filterPackages()">
      </div>
      <div class="filter-pills">
        <button class="filter-pill active" onclick="setFilter('all', this)">All (${vulnerableItems.length})</button>
        <button class="filter-pill" onclick="setFilter('critical', this)">Critical (${criticalCount})</button>
        <button class="filter-pill" onclick="setFilter('high', this)">High (${highCount})</button>
        <button class="filter-pill" onclick="setFilter('deprecated', this)">Deprecated (${deprecatedCount})</button>
        <button class="filter-pill" onclick="setFilter('private', this)">Private (${privateCount})</button>
      </div>
    </div>

    <div id="packagesList"></div>
  </div>

  <script>
    const packages = ${packagesJson};
    let currentFilter = 'all';

    function renderPackages() {
      const container = document.getElementById('packagesList');
      const search = document.getElementById('searchInput').value.toLowerCase().trim();

      const filtered = packages.filter(pkg => {
        const matchesSearch = pkg.packageName.toLowerCase().includes(search) ||
          pkg.vulnerabilities.some(v => v.id.toLowerCase().includes(search) || v.summary.toLowerCase().includes(search));

        if (!matchesSearch) return false;

        if (currentFilter === 'all') return true;
        if (currentFilter === 'deprecated') return pkg.isDeprecated;
        if (currentFilter === 'private') return pkg.isPrivate;
        if (currentFilter === 'critical') return pkg.vulnerabilities.some(v => (v.severity || '').toUpperCase() === 'CRITICAL');
        if (currentFilter === 'high') return pkg.vulnerabilities.some(v => (v.severity || '').toUpperCase() === 'HIGH');
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="no-results">🎉 No matching vulnerable packages found.</div>';
        return;
      }

      container.innerHTML = filtered.map((pkg, idx) => {
        const maxSev = getMaxSeverity(pkg.vulnerabilities);
        const badgesHtml = getBadgesHtml(pkg, maxSev);

        const vulnsHtml = pkg.vulnerabilities.map(v => \`
          <div class="vuln-item sev-\${(v.severity || 'UNKNOWN').toUpperCase()}">
            <div class="vuln-header">
              <span class="vuln-id">\${escapeHtml(v.id)}</span>
              <span class="badge badge-\${(v.severity || 'low').toLowerCase()}">\${escapeHtml(v.severity || 'UNKNOWN')}</span>
            </div>
            <div class="vuln-summary">\${escapeHtml(v.summary)}</div>
            \${v.fixedInVersion ? \`<div style="font-size:0.8rem; color:var(--accent-green); margin-top:0.4rem;">Fixed in version: \${escapeHtml(v.fixedInVersion)}</div>\` : ''}
          </div>
        \`).join('');

        return \`
          <div class="package-card" id="pkg-\${idx}">
            <div class="package-header" onclick="togglePackage(\${idx})">
              <div class="package-title">
                <span class="package-name">\${escapeHtml(pkg.packageName)}</span>
                \${badgesHtml}
              </div>
              <div class="version-flow">
                <span class="version-current">v\${escapeHtml(pkg.currentVersion)}</span>
                <span>➔</span>
                <span class="version-target">\${pkg.remediation.targetVersion ? 'v' + escapeHtml(pkg.remediation.targetVersion) : 'N/A'}</span>
              </div>
            </div>
            <div class="package-details">
              \${pkg.isDeprecated ? \`<div style="color:#cbd5e1; margin-bottom:0.75rem; font-size:0.9rem;">⚠️ Deprecation Reason: \${escapeHtml(pkg.deprecationReason || 'No longer supported')}</div>\` : ''}
              \${pkg.isPrivate ? \`<div style="color:#c084fc; margin-bottom:0.75rem; font-size:0.9rem;">🔒 Internal / Private Package (Not published on registry)</div>\` : ''}
              <div class="vuln-list">
                \${vulnsHtml || '<div style="color:var(--text-muted); font-size:0.9rem;">No vulnerability advisories directly linked.</div>'}
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function getMaxSeverity(vulns) {
      if (vulns.some(v => (v.severity || '').toUpperCase() === 'CRITICAL')) return 'CRITICAL';
      if (vulns.some(v => (v.severity || '').toUpperCase() === 'HIGH')) return 'HIGH';
      if (vulns.some(v => (v.severity || '').toUpperCase() === 'MODERATE')) return 'MODERATE';
      if (vulns.some(v => (v.severity || '').toUpperCase() === 'LOW')) return 'LOW';
      return 'INFO';
    }

    function getBadgesHtml(pkg, maxSev) {
      let html = '';
      if (pkg.isPrivate) html += '<span class="badge badge-private">Private</span> ';
      if (pkg.isDeprecated) html += '<span class="badge badge-deprecated">Deprecated</span> ';
      if (maxSev !== 'INFO') html += \`<span class="badge badge-\${maxSev.toLowerCase()}">\${maxSev}</span> \`;
      if (pkg.remediation.hasBreakingChanges) html += '<span class="badge badge-high">Breaking Changes</span> ';
      return html;
    }

    function togglePackage(idx) {
      const card = document.getElementById(\`pkg-\${idx}\`);
      if (card) card.classList.toggle('expanded');
    }

    function setFilter(filter, el) {
      currentFilter = filter;
      document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
      el.classList.add('active');
      renderPackages();
    }

    function filterPackages() {
      renderPackages();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    renderPackages();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
