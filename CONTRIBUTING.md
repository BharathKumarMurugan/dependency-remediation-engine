# Contributing to Automatic Local Dependency Remediation Engine

First off, thank you for taking the time to contribute! 🎉

This project aims to provide developers with a fast, platform-agnostic, local-first dependency vulnerability scanner and AST refactoring tool. To maintain focus and code quality, please review the following guidelines before submitting a Pull Request.

---

## 🧭 Project Architecture Boundaries

We explicitly design this tool to operate as a **purely local utility**.

- **Scope Control:** The engine executes entirely inside the local environment—running scans, applying AST codemods via `ast-grep`, installing packages, and validating via local test suites.
- **Out of Scope:** Pull Requests implementing remote version control hosting integrations (e.g., auto-submitting pull requests to GitHub, GitLab, Bitbucket, or AWS CodeCommit) **will not be accepted**. We leave delivery decisions entirely in the hands of the engineer running the CLI tool.

---

## 🛠️ Local Development Setup

### Prerequisites

- **Node.js**: v20.x or higher
- **Git**: Installed and accessible globally via your terminal shell

### Step-by-Step Installation

1. **Fork the Repository** on GitHub and clone your fork locally:
   ```bash
   git clone [https://github.com/YOUR-USERNAME/dependency-remediation-engine.git](https://github.com/YOUR-USERNAME/dependency-remediation-engine.git)
   cd dependency-remediation-engine
   ```
2. **Install Project Dependencies**:

   ```bash
   npm install
   ```

3. **Verify the Existing Build Stack**:
   Ensure that TypeScript successfully compiles the system files into clean JavaScript bindings inside the distribution folder:
   `bash
    npm run build
    `

4. **Execute Core Verification Suites**:
   Confirm that all native regression and integration unit tests pass cleanly on your machine before making any modifications:
   `bash
    npm test
    `

---

## 🚀 How to Add Support for New Ecosystems (Roadmap Goals)

If you are looking to expand this tool to support **Python (PyPI)**, **Go (Go Modules)**, or **Java (Maven)**, your contribution must implement three main layers:

1. **Parser Implementation (`src/parser/`)**: Write an isolated extractor module that parses the ecosystem's lockfile format (e.g., `poetry.lock`, `go.sum`, `pom.xml`) into our universal internal `OSVQuery` format.
2. **Package Manager Invoker (`src/runner/`)**: Introduce shell interaction commands targeting the ecosystem's package binary executable (e.g., `pip`, `poetry`, `go get`, `mvn`) to handle physical installations and trigger validation test gates.
3. **AST Rule Mapping (`src/codemod/`)**: Formulate structural patterns compatible with `ast-grep` engines to smoothly safely adapt breaking changes unique to that language runtime.

---

## 📬 Our Pull Request Lifecycle

1. **Check for Existing Issues:** Before writing code, search our issue tracker to ensure no one else is working on the same feature or bug fix.
2. **Branch Naming Standard:** Create an isolated feature branch using descriptive prefixes:

- `feat/add-pypi-lockfile-parser`
- `fix/resolve-git-status-check`

3. **Commit Messages:** Write clear, conversational commit summaries (e.g., `feat: integrate ast-grep rule parsing matching major breaking changes`).
4. **Keep Commits Clean:** Ensure the application builds successfully, and formatting tools do not throw errors before staging code changes.
5. **Open the PR:** Clearly summarize your modifications, note the issues it resolves, and state the exact verification steps you performed locally. Utilize the templates for [bug_report](./.github/ISSUE_TEMPLATE/bug_report.md) & [feature_request](./.github/ISSUE_TEMPLATE/feature_request.md).

---

## 🚀 GitHub Repository Settings to Enable

Once you create the files above, push them to your repository, and switch the visibility to **Public**, navigate to the **Settings** tab of your repository on GitHub and adjust these toggles:

1. **General ➔ Pull Requests:**

- Check **Allow squash merging**. This combines all commits from a contributor's feature branch into a single clean commit when merging, keeping your `main` branch history pristine.
- Check **Automatically delete head branches**. This auto-cleans feature branches after a Pull Request closes, keeping the repository tidy.

2. **Features:** Uncheck **Wikis** and **Projects** unless you actively use them. Keeping the focus exclusively on **Issues** and **Pull Requests** reduces initial noise for your open-source community.
