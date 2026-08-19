export type NpmKnownErrorCategory =
  | "BROKEN_NPM_INSTALL"
  | "NO_COMPATIBLE_VERSION"
  | "PERMISSION_ERROR"
  | "NO_SPACE_ENOSPC"
  | "NO_GIT_ENOGIT"
  | "SSL_ERROR"
  | "REGISTRY_SERVER_ERROR"
  | "INVALID_JSON"
  | "ENOENT_ENOEMPTY"
  | "UNKNOWN";

export interface NpmKnownErrorDetails {
  category: NpmKnownErrorCategory;
  userTitle: string;
  userMessage: string;
  recommendation: string;
}

/**
 * Inspects error messages thrown during dependency scanning & installation operations
 * and maps them to known npm / package manager errors with user-friendly guidance.
 */
export function classifyNpmError(errorMsg: string): NpmKnownErrorDetails | null {
  if (!errorMsg || typeof errorMsg !== "string") return null;
  const msg = errorMsg.toLowerCase();

  // 1. Broken npm / package manager installation
  if (
    msg.includes("command not found") ||
    msg.includes("is not recognized as an internal") ||
    msg.includes("cannot find module") ||
    msg.includes("module_not_found") ||
    msg.includes("spawn npm enoent")
  ) {
    return {
      category: "BROKEN_NPM_INSTALL",
      userTitle: "❌ Broken / Missing Package Manager Installation",
      userMessage: "The package manager CLI executable is broken, corrupted, or missing from environment PATH.",
      recommendation: "Reinstall Node.js / your chosen package manager CLI and verify it is on system PATH.",
    };
  }

  // 2. No compatible version found
  if (
    msg.includes("no compatible version found") ||
    msg.includes("no matching version") ||
    msg.includes("etarget") ||
    msg.includes("notarget") ||
    msg.includes("couldn't find any versions") ||
    msg.includes("could not find any versions")
  ) {
    return {
      category: "NO_COMPATIBLE_VERSION",
      userTitle: "⚠️ No Compatible Version Found",
      userMessage: "No version matching the target release was found in the package registry.",
      recommendation: "Check the requested version number or inspect public registry release tags.",
    };
  }

  // 3. Permission errors (EACCES / EPERM)
  if (
    msg.includes("eacces") ||
    msg.includes("eperm") ||
    msg.includes("permission denied") ||
    msg.includes("operation not permitted")
  ) {
    return {
      category: "PERMISSION_ERROR",
      userTitle: "🔒 Permission Denied (EACCES / EPERM)",
      userMessage: "Insufficient filesystem read/write permissions to modify project directory files.",
      recommendation: "Run terminal as Administrator / root or grant write access to project directory files.",
    };
  }

  // 4. No space (ENOSPC)
  if (msg.includes("enospc") || msg.includes("no space left on device")) {
    return {
      category: "NO_SPACE_ENOSPC",
      userTitle: "💾 Disk Space Exhausted (ENOSPC)",
      userMessage: "No disk space remaining to write package files or extract tarballs.",
      recommendation: "Free up disk space on your drive and clean temp directories before retrying.",
    };
  }

  // 5. No git (ENOGIT)
  if (
    msg.includes("enogit") ||
    msg.includes("not found: git") ||
    msg.includes("git is not installed") ||
    msg.includes("git: command not found")
  ) {
    return {
      category: "NO_GIT_ENOGIT",
      userTitle: "⚙️ Git Not Found (ENOGIT)",
      userMessage: "Git CLI is required for safety rollback snapshots but was not found on PATH.",
      recommendation: "Install Git (https://git-scm.com/) and ensure `git` is accessible in your system terminal.",
    };
  }

  // 6. SSL Error
  if (
    msg.includes("cert_untrusted") ||
    msg.includes("unable_to_verify_leaf_signature") ||
    msg.includes("self_signed_cert") ||
    msg.includes("ssl error") ||
    msg.includes("depth_zero_self_signed_cert")
  ) {
    return {
      category: "SSL_ERROR",
      userTitle: "🔐 SSL Certificate Error",
      userMessage: "HTTPS request failed due to untrusted SSL certificates or self-signed cert chain.",
      recommendation: "Configure npm SSL certificate settings (`npm config set cafile`) or check your network proxy.",
    };
  }

  // 7. Not found / Server error (404 / 500 / fetch failed)
  if (
    msg.includes("fetch failed") ||
    msg.includes("404 not found") ||
    msg.includes("404") ||
    msg.includes("500 internal server error") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again")
  ) {
    return {
      category: "REGISTRY_SERVER_ERROR",
      userTitle: "🌐 Registry Network / Server Error",
      userMessage: "Failed to connect to package registry endpoint (404 / 500 / Network Error).",
      recommendation: "Check your internet connection or verify registry endpoint accessibility.",
    };
  }

  // 8. Invalid JSON
  if (msg.includes("invalid json") || msg.includes("unexpected token") || msg.includes("json.parse")) {
    return {
      category: "INVALID_JSON",
      userTitle: "📄 Invalid JSON Syntax",
      userMessage: "Encountered malformed or unparseable JSON in package.json or lockfile.",
      recommendation: "Fix syntax errors (missing commas, trailing commas, quotes) in package.json or lockfile.",
    };
  }

  // 9. ENOENT / ENOEMPTY / ENOTEMPTY errors
  if (msg.includes("enoent") || msg.includes("enoempty") || msg.includes("enotempty")) {
    return {
      category: "ENOENT_ENOEMPTY",
      userTitle: "📁 Missing File or Path Error (ENOENT / ENOEMPTY)",
      userMessage: "Required target file or directory path was not found or is unreadable.",
      recommendation: "Verify target file paths exist and clean stale lockfiles or node_modules cache.",
    };
  }

  return null;
}
