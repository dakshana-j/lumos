# Project Brief

<!-- Purpose: High-level project identity. The "elevator pitch" document.
An agent reads this FIRST to understand what Lumos is before diving into
technical details. Changes only when the project's fundamental scope shifts. -->

## Identity

- **Name**: Lumos
- **Package**: `@juspay/lumos`
- **Version**: 1.4.3 (latest published) / 1.5.0 (pending — PR review)
- **Repo**: `github.com/juspay/lumos`
- **Branch**: `feat/review-pr-mode`
- **Language**: TypeScript (strict, ESM, Node >= 20.12)

## What It Does

Lumos is an AI-powered CI agent that operates on Bitbucket pull requests.
It uses an autonomous AI agent (NeuroLink + Bitbucket MCP tools) to provide
three capabilities:

1. **Test failure analysis** — parses Playwright JSON reports, correlates
   failures with PR diffs, posts targeted fix suggestions as PR comments
2. **E2E test generation** — reads PR diffs, generates Playwright test files
   matching the project's patterns, posts them as a comment or creates a test PR
3. **PR review** — validates a PR against 10 universal engineering checks and
   posts a structured verdict comment (repo-agnostic; works on any project)

## Goals

1. Correlate test failures with the specific PR diff that caused them
2. Post actionable fix suggestions (file, line, code snippet) on the PR
3. Reduce developer triage time from "read 17 failures manually" to "read one
   AI-curated comment"
4. Classify failures as PR-caused / flaky / infrastructure
5. Generate Playwright E2E tests from PR context so developers ship test coverage
6. Enforce PR quality standards universally: description completeness, build status,
   test coverage, video proofs, developer-authored testing steps, and manual
   verification proof — before code merges

## Non-Goals

- Does NOT replace `playwright-failure-analyzer.js` or
  `enhanced-test-summary-generator.js` — runs alongside them
- Does NOT auto-fix code or push commits (analyze/review are suggest-only)
- Does NOT block the build — always wrapped in try/catch in Jenkins
- Does NOT require new Jenkins credentials — reuses existing env vars

## Scope

- **V1 + V1.1** (complete): `test:mock` failures on Lighthouse PRs.
  V1.1 adds: comment dedup, retry loop, fallback posting, token/cost tracking,
  Langfuse observability, comment format v2, typed errors, Zod config validation.
- **V2** (complete): AI-powered E2E test generation from PR diffs, with optional
  PR creation mode (commit + push generated files + open Bitbucket PR).
- **V3** (complete, pending publish): Repo-agnostic PR review with 10 structured
  checks including video proof requirements, Yama-generated description detection,
  and developer manual testing verification.
- **Future** (planned): Two-pass analysis for 30+ failure scaling, structured
  output for programmatic consumption (Zod schemas exist, not yet wired).

## Consumers

- **Primary**: Lighthouse CI pipeline (Jenkinsfile mock tests catch block)
- **Pattern**: Published to npm as `@juspay/lumos`. Lighthouse installs via
  `npm install @juspay/lumos`. Consumed via `scripts/run-lumos.js` wrapper
  (identical to how Lighthouse consumes `@juspay/yama` via `run-yama.js`).
