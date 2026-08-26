import type { UserFacingError } from "../../ecosystems/types.ts";

export function classifyPythonError(errorMessage: string): UserFacingError | null {
  const msg = errorMessage.toLowerCase();

  // 1. Python 3.12+ distutils removal & metadata generation build error
  if (
    msg.includes("no module named 'distutils'") ||
    msg.includes("modulenotfounderror: no module named 'distutils") ||
    msg.includes("metadata-generation-failed") ||
    msg.includes("preparing metadata (pyproject.toml) did not run successfully")
  ) {
    return {
      userTitle: "🐍 Python 3.12+ Version Incompatibility (Removed 'distutils' Module)",
      userMessage:
        "The target package version relies on legacy setup scripts using 'distutils', which was removed in Python 3.12. PyPI has no pre-compiled binary wheel for this exact legacy release on Python 3.12.",
      recommendation:
        "Upgrade to a newer version supporting Python 3.12 (e.g. pip install package>=target_version) or use a Python 3.10/3.11 virtual environment.",
    };
  }

  // 2. Package Not Found / Version Resolution Failed / No Compatible Wheel
  if (
    msg.includes("no matching distribution found") ||
    msg.includes("could not find a version that satisfies the requirement") ||
    msg.includes("resolutionfailed") ||
    msg.includes("solverproblemerror") ||
    msg.includes("could not find a version")
  ) {
    return {
      userTitle: "❌ Package Version Resolution Failed / No Compatible Wheel",
      userMessage:
        "The target package version has no compatible pre-compiled binary wheel on PyPI for your Python runtime environment.",
      recommendation:
        "Verify package name spelling, check available releases on https://pypi.org/, or install using a minimum safe version constraint (e.g. >= target_version).",
    };
  }

  // 3. Permission Denied / System Python Write Attempt
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

  // 4. C Extension / Native Binary Build Failure
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

  // 5. SSL / Certificate / Network Error
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
