import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuroLink } from '@juspay/neurolink';
import type { GenerateApiResult } from '@juspay/neurolink';
import { LumosOrchestrator } from '../src/orchestrator.js';
import type { ReviewPrOptions } from '../src/parsers/types.js';

// ---------------------------------------------------------------------------
// Sample Lumos Review comment (mirrors what the agent posts)
// ---------------------------------------------------------------------------
const LUMOS_REVIEW_COMMENT = `## Lumos Review — PR #4916

**Verdict: ✅ Approved**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ✅ | Tests present for changed files |
| Playwright Convention | ✅ | Conventions followed |
| Automation Coverage | ✅ | Both mocking modes handled |
| How to Test (Dev-Authored) | ✅ | Developer-authored steps present |
| Video Proof — Mocking | ✅ | Mocking-mode recording attached |
| Video Proof — Non-Mocking | ✅ | Non-mocking recording attached |
| Dev Code-Change Proof | ✅ | Screenshots of manual verification present |

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

const LUMOS_REVIEW_COMMENT_FAIL = `## Lumos Review — PR #4916

**Verdict: ❌ Changes Required**

| Check | Status | Notes |
|---|---|---|
| PR Description | ❌ | Missing "Steps for Testing" section |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ➖ | Build status unavailable — not present in PR metadata |
| Test Coverage | ❌ | Testable files changed but no tests added |
| Playwright Convention | ➖ | N/A |
| Automation Coverage | ➖ | N/A |
| How to Test (Dev-Authored) | ❌ | Steps appear auto-generated — no feature-specific detail |
| Video Proof — Mocking | ❌ | No mocking-mode recording found |
| Video Proof — Non-Mocking | ❌ | No non-mocking recording found |
| Dev Code-Change Proof | ❌ | No developer proof of manual testing attached |

### ❌ Issues Found

#### PR Description
- Missing "Steps for Testing" section

**Suggested Action:** Add a "Steps for Testing" section describing how to verify the change.

#### How to Test (Dev-Authored)
- Steps appear auto-generated with no feature-specific detail

**Suggested Action:** Replace with your own step-by-step testing instructions that reference the specific UI, route, or API changed.

#### Video Proof — Mocking
- No screen recording demonstrating the feature under mocking mode was found

**Suggested Action:** Attach a video or GIF of the feature working with mocked backend responses.

#### Video Proof — Non-Mocking
- No screen recording demonstrating the feature against a real backend was found

**Suggested Action:** Attach a separate video or GIF of the feature working against staging/live.

#### Dev Code-Change Proof
- No screenshots or recordings showing manual verification by the developer

**Suggested Action:** Attach before/after screenshots or a recording showing you tested the change locally.

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lumos-pr-review-'));
}

function createOrchestrator(
  projectRoot: string,
  generateResult: GenerateApiResult
): LumosOrchestrator {
  const orchestrator = new LumosOrchestrator(projectRoot);
  orchestrator['initialized'] = true;
  orchestrator['config'] = {
    version: 1,
    ai: {
      provider: 'litellm',
      model: 'glm-latest',
      temperature: 0.1,
      maxTokens: 30_000,
      timeout: '5m',
      maxTokenBudget: 1_000_000,
      maxCostPerRun: 5.0,
    },
    mcpServers: { jira: { enabled: false } },
    report: { jsonPath: 'result.json' },
    memoryBank: [],
    posting: { strategy: 'single' },
    testGeneration: { patternsFile: 'memory-bank/test-generation-patterns.md' },
    observability: { langfuse: { enabled: false } },
  };
  const neurolink = new NeuroLink();
  vi.spyOn(neurolink, 'generate').mockResolvedValue(generateResult);
  orchestrator['neurolink'] = neurolink;
  return orchestrator;
}

const BASE_OPTIONS: ReviewPrOptions = {
  workspace: 'BZ',
  repository: 'lighthouse',
  pullRequestId: '4916',
};

const envBackup = {
  BITBUCKET_BASE_URL: process.env.BITBUCKET_BASE_URL,
  BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME,
  BITBUCKET_TOKEN: process.env.BITBUCKET_TOKEN,
};

afterEach(() => {
  process.env.BITBUCKET_BASE_URL = envBackup.BITBUCKET_BASE_URL;
  process.env.BITBUCKET_USERNAME = envBackup.BITBUCKET_USERNAME;
  process.env.BITBUCKET_TOKEN = envBackup.BITBUCKET_TOKEN;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------
describe('reviewPr — dry-run', () => {
  it('returns zeroed result without calling the AI', async () => {
    const projectRoot = makeTempRoot();
    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 0, output: 0, total: 0 },
    });

    try {
      const result = await orchestrator.reviewPr({
        ...BASE_OPTIONS,
        dryRun: true,
      });

      expect(result.allPassed).toBe(false);
      expect(result.checksRun).toBe(0);
      expect(result.commentsPosted).toBe(0);
      expect(orchestrator['neurolink'].generate).not.toHaveBeenCalled();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// live — agent posts comment via add_comment
// ---------------------------------------------------------------------------
describe('reviewPr — live, comment posted by agent', () => {
  it('detects add_comment in toolsUsed and returns commentsPosted=1', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_REVIEW_COMMENT,
      toolsUsed: [
        'bitbucket.get_pull_request',
        'bitbucket.get_pull_request_diff',
        'bitbucket.add_comment',
      ],
      toolResults: [
        {
          toolName: 'bitbucket.add_comment',
          args: { comment_text: LUMOS_REVIEW_COMMENT },
        },
      ],
      finishReason: 'stop',
      usage: { input: 500, output: 200, total: 700 },
    });

    // GET comments (dedup cleanup) → no existing Lumos comments
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(true);
      expect(result.checksRun).toBe(10);
      expect(result.tokenUsage).toEqual({
        input: 500,
        output: 200,
        total: 700,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.toolsUsed).toContain('bitbucket.add_comment');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('sets allPassed=false when verdict is ❌ Changes Required', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_REVIEW_COMMENT_FAIL,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 400, output: 150, total: 550 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns commentsPosted=0 when agent does not call add_comment', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: 'I reviewed the PR but did not post.',
      toolsUsed: ['bitbucket.get_pull_request'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 100, output: 50, total: 150 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(result.commentsPosted).toBe(0);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// orchestrator-level deduplication
// ---------------------------------------------------------------------------
describe('reviewPr — orchestrator-level comment deduplication', () => {
  it('deletes existing Lumos Review comment before calling the agent', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_REVIEW_COMMENT,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 100, output: 50, total: 150 },
    });

    // Spy directly on the private dedup method — verifies it's called and returns deleted=1
    const dedupSpy = vi
      .spyOn(
        orchestrator as unknown as {
          deletePreviousLumosComments: (
            w: string,
            r: string,
            id: string
          ) => Promise<{ deleted: number }>;
        },
        'deletePreviousLumosComments'
      )
      .mockResolvedValue({ deleted: 1 });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(dedupSpy).toHaveBeenCalledTimes(1);
      expect(dedupSpy).toHaveBeenCalledWith(
        BASE_OPTIONS.workspace,
        BASE_OPTIONS.repository,
        BASE_OPTIONS.pullRequestId
      );
      // Agent still ran and posted
      expect(result.commentsPosted).toBe(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not attempt dedup when PR ID is "find-by-branch"', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 0, output: 0, total: 0 },
    });

    // Branch that resolves to nothing → pullRequestId stays 'find-by-branch'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const fetchSpy = vi.mocked(globalThis.fetch);

    try {
      await orchestrator.reviewPr({
        ...BASE_OPTIONS,
        pullRequestId: '0',
        branch: 'feat/no-pr-found',
      });

      // fetch was called for branch lookup; no DELETE calls (no dedup)
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([, init]) =>
          init && (init as Record<string, unknown>).method === 'DELETE'
      );
      expect(deleteCalls).toHaveLength(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// branch → PR ID resolution
// ---------------------------------------------------------------------------
describe('reviewPr — branch resolution', () => {
  it('resolves PR ID from branch and runs the review', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_REVIEW_COMMENT,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 100, output: 50, total: 150 },
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string, init?: Record<string, unknown>) => {
          // Branch → PR lookup
          if (typeof url === 'string' && url.includes('/pull-requests?')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  values: [
                    {
                      id: 4916,
                      title: 'BZ-1234: feat(scope): my feature',
                      fromRef: { displayId: 'BZ-1234-my-feature' },
                      toRef: { displayId: 'main' },
                      links: {
                        self: [
                          { href: 'https://bitbucket.example.com/pr/4916' },
                        ],
                      },
                    },
                  ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
          }
          // Dedup GET
          if (!init?.method || init?.method === 'GET') {
            return Promise.resolve(
              new Response(JSON.stringify({ values: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
          return Promise.resolve(new Response('', { status: 404 }));
        })
    );

    try {
      const result = await orchestrator.reviewPr({
        ...BASE_OPTIONS,
        pullRequestId: '0',
        branch: 'BZ-1234-my-feature',
      });

      // AI was called — branch was resolved to a numeric PR ID
      expect(orchestrator['neurolink'].generate).toHaveBeenCalledTimes(1);
      expect(result.commentsPosted).toBe(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// token usage & cost propagation
// ---------------------------------------------------------------------------
describe('reviewPr — token usage and cost', () => {
  it('propagates token usage and estimated cost in result', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: LUMOS_REVIEW_COMMENT,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 1000, output: 400, total: 1400 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(result.tokenUsage).toEqual({
        input: 1000,
        output: 400,
        total: 1400,
      });
      expect(typeof result.estimatedCost).toBe('number');
      expect(result.estimatedCost).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns undefined tokenUsage when usage is absent from AI result', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const orchestrator = createOrchestrator(projectRoot, {
      content: '',
      toolsUsed: [],
      toolResults: [],
      finishReason: 'stop',
      // no usage field
    } as GenerateApiResult);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);

      expect(result.tokenUsage).toBeUndefined();
      expect(result.estimatedCost).toBeUndefined();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ReviewPrOptions type surface
// ---------------------------------------------------------------------------
describe('ReviewPrOptions', () => {
  it('allows callers to omit branch', () => {
    const options: ReviewPrOptions = {
      workspace: 'BZ',
      repository: 'lighthouse',
      pullRequestId: '4916',
    };
    expect(options.branch).toBeUndefined();
  });

  it('allows callers to omit dryRun (defaults to live)', () => {
    const options: ReviewPrOptions = {
      workspace: 'BZ',
      repository: 'lighthouse',
      pullRequestId: '4916',
    };
    expect(options.dryRun).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// New checks: How to Test, Video Proofs, Dev Proof
// ---------------------------------------------------------------------------
describe('reviewPr — new checks (checks 7–10)', () => {
  it('fails when "How to Test" section appears auto-generated (no feature-specific detail)', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const autoGeneratedComment = `## Lumos Review — PR #4916

**Verdict: ❌ Changes Required**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ✅ | Tests present |
| Playwright Convention | ✅ | Conventions followed |
| Automation Coverage | ✅ | Both modes handled |
| How to Test (Dev-Authored) | ❌ | Steps appear auto-generated — no feature-specific detail |
| Video Proof — Mocking | ✅ | Recording attached |
| Video Proof — Non-Mocking | ✅ | Recording attached |
| Dev Code-Change Proof | ✅ | Screenshots present |

### ❌ Issues Found

#### How to Test (Dev-Authored)
- "How to test" reads as generic boilerplate with no mention of the specific feature changed

**Suggested Action:** Replace with your own step-by-step testing instructions.

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

    const orchestrator = createOrchestrator(projectRoot, {
      content: autoGeneratedComment,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 400, output: 150, total: 550 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);
      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails when mocking-mode video proof is missing', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const missingMockVideoComment = `## Lumos Review — PR #4916

**Verdict: ❌ Changes Required**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ✅ | Tests present |
| Playwright Convention | ✅ | Conventions followed |
| Automation Coverage | ✅ | Both modes handled |
| How to Test (Dev-Authored) | ✅ | Developer-authored steps present |
| Video Proof — Mocking | ❌ | No mocking-mode recording found |
| Video Proof — Non-Mocking | ✅ | Non-mocking recording attached |
| Dev Code-Change Proof | ✅ | Screenshots present |

### ❌ Issues Found

#### Video Proof — Mocking
- No screen recording demonstrating the feature under mocking mode was found

**Suggested Action:** Attach a video or GIF of the feature working with mocked backend responses.

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

    const orchestrator = createOrchestrator(projectRoot, {
      content: missingMockVideoComment,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 400, output: 150, total: 550 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);
      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails when non-mocking video proof is missing', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const missingNonMockVideoComment = `## Lumos Review — PR #4916

**Verdict: ❌ Changes Required**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ✅ | Tests present |
| Playwright Convention | ✅ | Conventions followed |
| Automation Coverage | ✅ | Both modes handled |
| How to Test (Dev-Authored) | ✅ | Developer-authored steps present |
| Video Proof — Mocking | ✅ | Mocking-mode recording attached |
| Video Proof — Non-Mocking | ❌ | No non-mocking recording found |
| Dev Code-Change Proof | ✅ | Screenshots present |

### ❌ Issues Found

#### Video Proof — Non-Mocking
- No screen recording against a real backend was found

**Suggested Action:** Attach a separate video of the feature working against staging/live.

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

    const orchestrator = createOrchestrator(projectRoot, {
      content: missingNonMockVideoComment,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 400, output: 150, total: 550 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);
      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails when developer code-change proof is missing', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const missingDevProofComment = `## Lumos Review — PR #4916

**Verdict: ❌ Changes Required**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ✅ | Tests present |
| Playwright Convention | ✅ | Conventions followed |
| Automation Coverage | ✅ | Both modes handled |
| How to Test (Dev-Authored) | ✅ | Developer-authored steps present |
| Video Proof — Mocking | ✅ | Mocking-mode recording attached |
| Video Proof — Non-Mocking | ✅ | Non-mocking recording attached |
| Dev Code-Change Proof | ❌ | No developer proof of manual testing attached |

### ❌ Issues Found

#### Dev Code-Change Proof
- No screenshots or recordings of developer manually testing the change

**Suggested Action:** Attach before/after screenshots or a recording showing you tested the change locally.

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

    const orchestrator = createOrchestrator(projectRoot, {
      content: missingDevProofComment,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 400, output: 150, total: 550 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);
      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('skips video proof and dev proof checks for non-UI changes (config-only)', async () => {
    const projectRoot = makeTempRoot();
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_USERNAME = 'user';
    process.env.BITBUCKET_TOKEN = 'token';

    const nonUiComment = `## Lumos Review — PR #4916

**Verdict: ✅ Approved**

| Check | Status | Notes |
|---|---|---|
| PR Description | ✅ | All sections present |
| Title Convention | ✅ | Matches expected ticket-type-description format |
| Build Status | ✅ | SUCCESSFUL |
| Test Coverage | ➖ | N/A — only config files changed |
| Playwright Convention | ➖ | N/A |
| Automation Coverage | ➖ | N/A |
| How to Test (Dev-Authored) | ✅ | Developer-authored steps present |
| Video Proof — Mocking | ➖ | N/A — no UI changes |
| Video Proof — Non-Mocking | ➖ | N/A — no UI changes |
| Dev Code-Change Proof | ➖ | N/A — pure config change with no observable runtime behaviour |

---
*Reviewed by Lumos | PR #4916 | 2026-04-24T00:00:00.000Z*`;

    const orchestrator = createOrchestrator(projectRoot, {
      content: nonUiComment,
      toolsUsed: ['bitbucket.add_comment'],
      toolResults: [],
      finishReason: 'stop',
      usage: { input: 300, output: 100, total: 400 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
      const result = await orchestrator.reviewPr(BASE_OPTIONS);
      expect(result.commentsPosted).toBe(1);
      expect(result.allPassed).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Guard: not-initialized
// ---------------------------------------------------------------------------
describe('reviewPr — initialization guard', () => {
  it('throws ConfigError when orchestrator is not initialized', async () => {
    const orchestrator = new LumosOrchestrator();
    // deliberately skip initialize()

    await expect(orchestrator.reviewPr(BASE_OPTIONS)).rejects.toThrow(
      'LumosOrchestrator.initialize() must be called first.'
    );
  });
});
