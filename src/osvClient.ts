import axios from "axios";
import { OSVQuery, OSVVulnerability } from "./types";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
const MAX_BATCH_SIZE = 500;
const HYDRATION_CHUNK_SIZE = 50;

/**
 * Utility to split an array into chunks of a specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Fetches full details for a single vulnerability ID
 */
async function fetchVulnerabilityDetails(id: string): Promise<OSVVulnerability | null> {
  try {
    const response = await axios.get(`${OSV_VULN_URL}/${id}`, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error(`[-] Failed to hydrate vulnerability ${id}:`, error);
    return null;
  }
}

export async function fetchBatchVulnerabilities(queries: OSVQuery[]): Promise<Record<string, OSVVulnerability[]>> {
  if (queries.length === 0) return {};

  // Step 1: Split queries into batches to stay strictly within OSV.dev query limits (max 500 per batch)
  const queryChunks = chunkArray(queries, MAX_BATCH_SIZE);
  const initialBatchMap: Record<string, string[]> = {};
  const uniqueIdsToFetch = new Set<string>();

  const batchPromises = queryChunks.map(async (chunk) => {
    try {
      const response = await axios.post(OSV_BATCH_URL, { queries: chunk }, { timeout: 30000 });
      const results = response.data.results || [];

      results.forEach((res: { vulns?: Array<{ id: string }> }, index: number) => {
        const query = chunk[index];
        if (!query) return;

        const key = `${query.package.name}@${query.version}`;
        const ids = (res.vulns || []).map((v) => v.id);
        initialBatchMap[key] = ids;

        ids.forEach((id) => uniqueIdsToFetch.add(id));
      });
    } catch (error: any) {
      console.error(`[-] OSV Batch Query chunk failed:`, error.response?.data?.message || error.message);
    }
  });

  await Promise.all(batchPromises);

  if (uniqueIdsToFetch.size === 0) return {};

  // Step 2: Hydrate all unique vulnerability details in controlled concurrent chunks
  const hydrationRecords: Record<string, OSVVulnerability> = {};
  const idList = Array.from(uniqueIdsToFetch);
  const idChunks = chunkArray(idList, HYDRATION_CHUNK_SIZE);

  for (const chunk of idChunks) {
    const promises = chunk.map(async (id) => {
      const details = await fetchVulnerabilityDetails(id);
      if (details) {
        hydrationRecords[id] = details;
      }
    });
    await Promise.all(promises);
  }

  // Step 3: Remap full hydrated objects back to their package ecosystem entries
  const finalizedVulnMap: Record<string, OSVVulnerability[]> = {};

  for (const [packageKey, vulnIds] of Object.entries(initialBatchMap)) {
    finalizedVulnMap[packageKey] = vulnIds
      .map((id) => hydrationRecords[id])
      .filter((v): v is OSVVulnerability => !!v);
  }

  return finalizedVulnMap;
}
