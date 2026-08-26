#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const rootDir = process.cwd();

console.log("🔍 Running Cross-Platform Pre-Push Lint, Sanitize & Test Checks...\n");

let failures = 0;

function runStep(name, command) {
  console.log(`⏳ Executing [${name}]: ${command}`);
  try {
    execSync(command, { cwd: rootDir, stdio: "inherit" });
    console.log(`✅ [${name}] Passed successfully.\n`);
  } catch (error) {
    console.error(`❌ [${name}] Failed!\n`);
    failures++;
  }
}

// Helper to check if tests directory or test files exist
function hasPythonTestFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    if (files.includes("tests") || files.includes("test")) return true;
    return files.some((f) => f.startsWith("test_") && f.endsWith(".py"));
  } catch {
    return false;
  }
}

// 1. Node.js Ecosystem Check
if (fs.existsSync(path.join(rootDir, "package.json"))) {
  console.log("📦 Detected Node.js Ecosystem Project");
  runStep("Node Lint & Type Safety Sanitize", "npm run build");
  runStep("Node Test Verification", "npm test");
}

// 2. Python Ecosystem Check
const hasPyManifest =
  fs.existsSync(path.join(rootDir, "pyproject.toml")) ||
  fs.existsSync(path.join(rootDir, "requirements.txt")) ||
  fs.existsSync(path.join(rootDir, "setup.py")) ||
  fs.existsSync(path.join(rootDir, "Pipfile"));

const hasPyFiles = fs.readdirSync(rootDir).some((f) => f.endsWith(".py"));

if (hasPyManifest || hasPyFiles) {
  console.log("🐍 Detected Python Ecosystem Project");

  // Python Lint & Code Sanitize Check
  let linterRan = false;

  try {
    execSync("ruff --version", { stdio: "ignore" });
    runStep("Python Code Linter (ruff)", "ruff check .");
    linterRan = true;
  } catch {}

  if (!linterRan) {
    try {
      execSync("flake8 --version", { stdio: "ignore" });
      runStep("Python Code Linter (flake8)", "flake8 .");
      linterRan = true;
    } catch {}
  }

  if (!linterRan) {
    try {
      execSync("python --version", { stdio: "ignore" });
      runStep("Python Code Syntax & Sanitize Check", 'python -c "import compileall; compileall.compile_dir(\'.\', quiet=1)"');
      linterRan = true;
    } catch {
      console.log("ℹ️ Python binary not found, skipping Python lint.");
    }
  }

  // Python Test Suite Verification
  if (hasPythonTestFiles(rootDir)) {
    try {
      execSync("pytest --version", { stdio: "ignore" });
      runStep("Python Test Suite (pytest)", "pytest");
    } catch {
      try {
        execSync("python --version", { stdio: "ignore" });
        runStep("Python Test Suite (unittest)", "python -m unittest discover");
      } catch {
        console.log("ℹ️ Skipping Python tests.");
      }
    }
  } else {
    console.log("ℹ️ No Python test files (tests/ or test_*.py) detected, skipping Python tests.\n");
  }
}

// 3. Go Ecosystem Check
if (fs.existsSync(path.join(rootDir, "go.mod"))) {
  console.log("🐹 Detected Go Ecosystem Project");
  runStep("Go Vet Sanitize", "go vet ./...");
  runStep("Go Test Verification", "go test ./...");
}

// 4. Java / Maven Ecosystem Check
if (fs.existsSync(path.join(rootDir, "pom.xml"))) {
  console.log("☕ Detected Java/Maven Ecosystem Project");
  runStep("Maven Sanitize Compile", "mvn test-compile");
  runStep("Maven Test Verification", "mvn test");
}

if (failures > 0) {
  console.error(`⛔ Pre-push hook failed with ${failures} error(s). Push aborted.`);
  process.exit(1);
} else {
  console.log("🎉 All Pre-Push Lint, Sanitize & Test Checks Passed! Proceeding with push.");
  process.exit(0);
}
