export interface TomlPackage {
  name: string;
  version: string;
}

/**
 * Lightweight, zero-dependency TOML parser for poetry.lock and uv.lock files
 */
export function parseTomlPackages(tomlContent: string): TomlPackage[] {
  const packages: TomlPackage[] = [];
  const blocks = tomlContent.split(/\[\[package\]\]/gi);

  for (const block of blocks) {
    const nameMatch = block.match(/^\s*name\s*=\s*"([^"]+)"/m) || block.match(/^\s*name\s*=\s*'([^']+)'/m);
    const verMatch = block.match(/^\s*version\s*=\s*"([^"]+)"/m) || block.match(/^\s*version\s*=\s*'([^']+)'/m);

    if (nameMatch && verMatch) {
      packages.push({
        name: nameMatch[1].trim(),
        version: verMatch[1].trim(),
      });
    }
  }

  return packages;
}
