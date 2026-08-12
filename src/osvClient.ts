import axios from "axios";
import { OSVQuery, OSVVulnerability } from "./types";

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";

export async function fetchBatchVulnerabilities(queries: OSVQuery[]): Promise<Record<string, OSVVulnerability[]>> {
  if (queries.length === 0) return {};

  const response = await axios.post(OSV_BATCH_URL, { queries });
  const results = response.data.results || [];
  const vulnMap: Record<string, OSVVulnerability[]> = {};

  results.forEach((res: { vulns?: OSVVulnerability[] }, index: number) => {
    const query = queries[index];
    const key = `${query.package.name}@${query.version}`;
    vulnMap[key] = res.vulns || [];
  });

  return vulnMap;
}