import axios from "axios";
import { OSVQuery, OSVVulnerability } from "./types";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
// const OSV_BATCH_URL = "https://api.osv.dev/v1/query";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";

/**
 * Fetches full details for a single vulnerability ID
 */
async function fetchVulnerabilityDetails(id: string): Promise<OSVVulnerability | null> {
  try {
    const response = await axios.get(`${OSV_VULN_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error(`[-] Failed to hydrate vulnerability ${id}:`, error);
    return null;
  }
}

export async function fetchBatchVulnerabilities(queries: OSVQuery[]): Promise<Record<string, OSVVulnerability[]>> {
  if (queries.length === 0) return {};

  // Step 1: Query the batch endpoint to extract all vulnerable package maps and matching IDs
  const response = await axios.post(OSV_BATCH_URL, { queries });
  const results = response.data.results || [];

  // Track unique vulnerability IDs across the entire scan to avoid redundant API hits
  const uniqueIdsToFetch = new Set<string>();
  const initialBatchMap: Record<string, string[]> = {};

  results.forEach((res: { vulns?: Array<{ id: string }> }, index: number) => {
    const query = queries[index];
    const key = `${query.package.name}@${query.version}`;

    const ids = (res.vulns || []).map((v) => v.id);
    initialBatchMap[key] = ids;

    ids.forEach((id) => uniqueIdsToFetch.add(id));
  });

  if (uniqueIdsToFetch.size === 0) return {};

  // Step 2: Hydrate all unique vulnerability details concurrently
  const hydrationRecords: Record<string, OSVVulnerability> = {};
  const hydrationPromises = Array.from(uniqueIdsToFetch).map(async (id) => {
    const details = await fetchVulnerabilityDetails(id);
    if (details) {
      hydrationRecords[id] = details;
    }
  });

  await Promise.all(hydrationPromises);

  // Step 3: Remap full hydrated objects back to their package ecosystem entries
  const finalizedVulnMap: Record<string, OSVVulnerability[]> = {};

  for (const [packageKey, vulnIds] of Object.entries(initialBatchMap)) {
    finalizedVulnMap[packageKey] = vulnIds.map((id) => hydrationRecords[id]).filter((v): v is OSVVulnerability => !!v);
  }

  return finalizedVulnMap;
}
