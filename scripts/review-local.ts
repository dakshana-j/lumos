#!/usr/bin/env npx tsx
/**
 * Local smoke-test for reviewPr().
 *
 * Usage:
 *   pnpm tsx scripts/review-local.ts --pr 1234              # dry-run (default)
 *   pnpm tsx scripts/review-local.ts --pr 1234 --live       # live (calls AI, posts comment)
 *   pnpm tsx scripts/review-local.ts --branch BZ-1234-feat  # resolve PR from branch
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createLumos } from '../src/index.js';

// ---------------------------------------------------------------------------
// Load .env from project root (Node >= 20.12 built-in)
// ---------------------------------------------------------------------------
const projectRoot = resolve(import.meta.dirname, '..');
const envPath = resolve(projectRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else {
  console.error(
    'No .env file found. Copy .env.example to .env and fill in your credentials.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------
const required = [
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY',
  'BITBUCKET_TOKEN',
  'BITBUCKET_USERNAME',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars in .env: ${missing.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1]
    ? process.argv[idx + 1]
    : undefined;
}

const isLive = process.argv.includes('--live');
const dryRun = !isLive;
const pullRequestId = getArgValue('--pr');
const branch = getArgValue('--branch');

if (!pullRequestId && !branch) {
  console.error(
    'Usage: pnpm tsx scripts/review-local.ts --pr <id> [--live]\n' +
      '       pnpm tsx scripts/review-local.ts --branch <name> [--live]'
  );
  process.exit(1);
}

// Workspace and repository are fixed for this project; override via env if needed.
const workspace = process.env.BITBUCKET_WORKSPACE ?? 'BZ';
const repository = process.env.BITBUCKET_REPOSITORY ?? 'lighthouse';

console.log('=== Lumos reviewPr local test ===');
console.log(
  `PR: ${pullRequestId ? `#${pullRequestId}` : '(resolve from branch)'}`
);
if (branch) console.log(`Branch: ${branch}`);
console.log(
  `Mode: ${dryRun ? 'DRY RUN (no AI call)' : 'LIVE (will call AI and post comment)'}`
);
console.log(
  `Bitbucket: ${process.env.BITBUCKET_BASE_URL} as ${process.env.BITBUCKET_USERNAME}`
);
console.log('');

const lumos = await createLumos(projectRoot);

const result = await lumos.reviewPr({
  workspace,
  repository,
  pullRequestId: pullRequestId ?? '0',
  branch,
  dryRun,
  triggeredBy: 'local-test',
});

console.log('\nResult:', JSON.stringify(result, null, 2));
