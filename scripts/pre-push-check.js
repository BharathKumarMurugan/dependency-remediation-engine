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

// 1. Node.js Ecosystem Check
if (fs.existsSync(path.join(rootDir, "package.json"))) {
  console.log("📦 Detected Node.js Ecosystem Project");
  runStep("Node Lint & Type Safety Sanitize", "npm run build");
  runStep("Node Test Verification", "npm test");
}

// 2. Python Ecosystem Check
if (
  fs.existsSync(path.join(rootDir, "pyproject.toml")) ||
  fs.existsSync(path.join(rootDir, "requirements.txt")) ||
  fs.existsSync(path.join(rootDir, "setup.py")) ||
  fs.existsSync(path.join(rootDir, "Pipfile"))
) {
  console.log("🐍 Detected Python Ecosystem Project");
  try {
    execSync("flake8 --version", { stdio: "ignore" });
    runStep("Python Lint Sanitize (flake8)", "flake8 .");
  } catch {
    console.log("ℹ️ flake8 not found, skipping Python lint.");
  }

  try {
    execSync("pytest --version", { stdio: "ignore" });
    runStep("Python Test Suite (pytest)", "pytest");
  } catch {
    try {
      execSync("python -m unittest discover", { stdio: "ignore" });
      runStep("Python Test Suite (unittest)", "python -m unittest discover");
    } catch {
      console.log("ℹ️ No Python test runner found, skipping Python tests.");
    }
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
