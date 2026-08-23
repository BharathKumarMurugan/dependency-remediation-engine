import axios from "axios";
import pLimit from "p-limit";
import https from "node:https";
import http from "node:http";
import type { OSVQuery, OSVVulnerability } from "./types.ts";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
const MAX_BATCH_SIZE = 500;
const CONCURRENCY_LIMIT = 20;

// Optimized HTTP/HTTPS Agents with TCP Keep-Alive connection pooling
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

const axiosClient = axios.create({
  httpAgent,
  httpsAgent,
});

/**
 * Executes a network call with exponential backoff retries for transient network faults
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const status = error.response?.status;
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
    return await withNetworkRetry(async () => {
      const response = await axiosClient.get(`${OSV_VULN_URL}/${id}`, { timeout: 10000 });
      return response.data;
    });
  } catch (error) {
    console.error(`[-] Failed to hydrate vulnerability ${id}:`, error);
    return null;
  }
}

export async function fetchBatchVulnerabilities(queries: OSVQuery[]): Promise<Record<string, OSVVulnerability[]>> {
  if (queries.length === 0) return {};

  const limit = pLimit(CONCURRENCY_LIMIT);

  // Step 1: Split queries into batches to stay strictly within OSV.dev query limits (max 500 per batch)
  const queryChunks = chunkArray(queries, MAX_BATCH_SIZE);
  const initialBatchMap: Record<string, string[]> = {};
  const uniqueIdsToFetch = new Set<string>();

  const batchPromises = queryChunks.map((chunk) =>
    limit(async () => {
      try {
        const response = await withNetworkRetry(async () => {
          return await axiosClient.post(OSV_BATCH_URL, { queries: chunk }, { timeout: 30000 });
        });
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
    })
  );

  await Promise.all(batchPromises);

  if (uniqueIdsToFetch.size === 0) return {};

  // Step 2: Hydrate all unique vulnerability details with concurrency limit 20 to prevent socket pool saturation
  const hydrationRecords: Record<string, OSVVulnerability> = {};
  const idList = Array.from(uniqueIdsToFetch);

  const hydrationPromises = idList.map((id) =>
    limit(async () => {
      const details = await fetchVulnerabilityDetails(id);
      if (details) {
        hydrationRecords[id] = details;
      }
    })
  );

  await Promise.all(hydrationPromises);

  // Step 3: Remap full hydrated objects back to their package ecosystem entries
  const finalizedVulnMap: Record<string, OSVVulnerability[]> = {};

  for (const [packageKey, vulnIds] of Object.entries(initialBatchMap)) {
    finalizedVulnMap[packageKey] = vulnIds.map((id) => hydrationRecords[id]).filter((v): v is OSVVulnerability => !!v);
  }

  return finalizedVulnMap;
}
