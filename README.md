## 📦 Automated Local Dependency Remediation Engine

An automated, local-first dependency vulnerability scanner, auto-updater, and structural refactoring (AST) companion tool designed to safely remediate security advisories within the local development environment.

---

## 🎯 Purpose & Vision

### What We Are Trying to Achieve

Managing open-source vulnerabilities is a multi-step, friction-filled process for developers. When a vulnerability scanner flags a critical security issue, the developer must manually research secure versions, analyze semantic versioning impacts, execute upgrades, handle broken APIs caused by breaking major version jumps, and verify that the test suites still pass.

This engine transforms that manual lifecycle into a **deterministic, local transaction**. It aims to automate the end-to-end remediation process safely on the developer's workstation—handling discovery, upgrades, code structural updates via Abstract Syntax Trees (AST), and test suite verification—while guaranteeing an immediate filesystem rollback if anything breaks.

### Is This New to the Market?

No, dependency update tools are highly prevalent in the modern software engineering ecosystem.

Existing industry tools include:

- **Dependabot / Renovate Bot:** Automate version bumps but run primarily as cloud-native GitHub/GitLab applications or headless background tasks that lack localized options.
- **npm audit fix:** Handles dependency tree upgrades directly from the CLI but only remediates simple, non-breaking minor/patch updates. It does not look at your source code to resolve breaking changes.

### How This Tool is Different

1. **AST-Aware Structural Refactoring:** Unlike standard tools that stop at the lockfile level, this engine embeds Rust-powered `ast-grep` engines to scan your project code and rewrite expressions to match updated library signatures when making major version jumps.
2. **Local Transaction Isolation:** It operates locally under an atomic transaction boundary using Git snapshots. If an upgrade breaks your local unit tests (`npm test`), the engine rolls back both the dependency configurations and the source code shifts instantly, keeping your working directory completely clean.
3. **Platform Agnostic & Local First:** Rather than tying execution to a specific cloud platform or SaaS layer (e.g., GitHub, GitLab, Bitbucket), it operates completely in the local workspace. The engineer retains full ownership to review the `git diff` before deciding how and where to commit their changes.

---

## 🏗️ High-Level System Architecture

The runtime engine acts as an interactive terminal execution wizard operating over the host codebase.

```
                  ┌────────────────────────┐
                  │   Target Repository    │
                  │  (Lockfiles & Source)  │
                  └───────────┬────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                  LOCAL REMEDIATION ENGINE                  │
│                                                            │
│  ┌─────────────────┐       ┌────────────────────────────┐  │
│  │  Lockfile       │ ────► │  OSV.dev Batch Hydrator    │  │
│  │  Extractor      │       │  (Vulnerability Queries)   │  │
│  └─────────────────┘       └─────────────┬──────────────┘  │
│                                          │                 │
│                                          ▼                 │
│  ┌─────────────────┐       ┌────────────────────────────┐  │
│  │  Git Snapshot   │ ◄──── │  SemVer Complexity Router  │  │
│  │  Guard (Tx)     │       │  (Patch/Minor/Major)       │  │
│  └────────┬────────┘       └────────────────────────────┘  │
│           │                                                │
│           ▼                                                │
│  ┌─────────────────┐       ┌────────────────────────────┐  │
│  │  ast-grep       │ ────► │  Package Manager Invoker   │  │
│  │  Refactor Block │       │  (Physical Installation)   │  │
│  └─────────────────┘       └─────────────┬──────────────┘  │
│                                          │                 │
│                                          ▼                 │
│                            ┌────────────────────────────┐  │
│                            │  Verification Gate         │  │
│                            │  (npm test / Rollback Tx)  │  │
│                            └────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘

```

---

## 🗺️ Product Roadmap & Ecosystem Milestones

The architectural boundaries of the application core are completely pluggable. While the foundational engine is optimized for JavaScript runtimes, the parsing layer can be systematically scaled to support alternative tech stack lockfiles:

- [x] **Phase 1: Node.js / npm Ecosystem Core Support (`package-lock.json`)**
- [ ] **Phase 2: Python / PyPI Ecosystem Support (`poetry.lock` / `requirements.txt`)**
- [ ] **Phase 3: Go / Go Modules Support (`go.sum`)**
- [ ] **Phase 4: Java / Maven Ecosystem Support (`pom.xml`)**

---

## ⚡ Quick Start & Usage

### Prerequisites

- Node.js runtime environment (v20+ recommended).
- Git binary binary commands configured in the local shell.

### Installation

Clone the repository and compile the TypeScript dependencies locally:

```bash
npm install
npm run build

```

### Running the Remediation Engine

Execute the engine by targeting a project directory containing a `package-lock.json` file:

```bash
# Scan and remediate the current working directory
npm start

# Target an alternative local software repository path
npm start /path/to/target/project/package-lock.json

```

### Testing the Engine

Verify the local snapshot operations and SemVer evaluation logic across the core codebase:

```bash
npm test

```
