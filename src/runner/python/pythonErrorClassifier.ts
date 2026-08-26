import type { UserFacingError } from "../../ecosystems/types.ts";

export function classifyPythonError(errorMessage: string): UserFacingError | null {
  const msg = errorMessage.toLowerCase();

  // 1. Package Not Found / Version Resolution Failed
  if (
    msg.includes("no matching distribution found") ||
    msg.includes("could not find a version that satisfies the requirement") ||
    msg.includes("resolutionfailed") ||
    msg.includes("solverproblemerror") ||
    msg.includes("could not find a version")
  ) {
    return {
      userTitle: "❌ Package Version Resolution Failed",
      userMessage: "The target package version was not found on PyPI or index repositories.",
      recommendation: "Verify package name spelling or check available releases on https://pypi.org/.",
    };
  }

  // 2. Permission Denied / System Python Write Attempt
  if (
    msg.includes("permissionerror") ||
    msg.includes("permission denied") ||
    msg.includes("consider using the `--user` option") ||
    msg.includes("could not install packages due to an oserror")
  ) {
    return {
      userTitle: "🚫 Permission Denied / Global Environment Write Blocked",
      userMessage: "Attempted to modify global system Python without administrative or virtual environment permissions.",
      recommendation: "Activate a local virtual environment (e.g. source .venv/bin/activate) or run with --user flag.",
    };
  }

  // 3. C Extension / Native Binary Build Failure
  if (
    msg.includes("failed building wheel for") ||
    msg.includes("gcc failed") ||
    msg.includes("clang failed") ||
    msg.includes("microsoft visual c++ 14.0 or greater is required") ||
    msg.includes("command errored out with exit status 1") ||
    msg.includes("error: command 'gcc' failed")
  ) {
    return {
      userTitle: "🛠️ Native C/C++ Binary Build Error",
      userMessage: "Building native C extensions failed due to missing compilers or system headers.",
      recommendation: "Install binary wheels (pip install wheel) or install C/C++ build tools (GCC/MSVC/Clang).",
    };
  }

  // 4. SSL / Certificate / Network Error
  if (
    msg.includes("sslerror") ||
    msg.includes("certificate_verify_failed") ||
    msg.includes("connection error") ||
    msg.includes("connection reset") ||
    msg.includes("max retries exceeded")
  ) {
    return {
      userTitle: "🌐 PyPI SSL Certificate / Network Error",
      userMessage: "Network or SSL certificate verification failure while connecting to PyPI index.",
      recommendation: "Check internet connectivity, corporate proxy SSL settings, or pass --trusted-host pypi.org.",
    };
  }

  return null;
}
