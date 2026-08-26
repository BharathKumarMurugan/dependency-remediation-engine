#!/usr/bin/env node
import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const gitHooksDir = path.join(rootDir, ".git", "hooks");
const prePushHookPath = path.join(gitHooksDir, "pre-push");

if (!fs.existsSync(gitHooksDir)) {
  console.log("ℹ️ .git/hooks directory not found. Skipping git hook installation.");
  process.exit(0);
}

const hookContent = `#!/bin/sh
# Cross-Platform Git Pre-Push Hook for Node, Python, Go, and Maven ecosystems
node scripts/pre-push-check.js
`;

try {
  fs.writeFileSync(prePushHookPath, hookContent, { encoding: "utf-8", mode: 0o755 });
  // Set executable permissions on Unix/macOS/Linux
  try {
    fs.chmodSync(prePushHookPath, "755");
  } catch {}

  console.log("✅ Git pre-push hook installed successfully at .git/hooks/pre-push");
} catch (error) {
  console.error("❌ Failed to install git pre-push hook:", error.message);
}
