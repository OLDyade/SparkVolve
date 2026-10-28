import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { specification } from './fixtures.ts';
import {
  acceptanceContracts,
  authoringEvidence,
  implementationShape,
  integrationChecks,
  taskObservations,
  cancelOwnedRuns,
} from '../scripts/verify-native-authoring.mjs';

function contract() {
  const s = specification();
  s.tasks = ['one', 'two', 'three', 'four'].map((id) => ({ ...s.tasks[0], id }));
  s.candidate.build.timeoutSeconds = 300;
  s.evaluator.timeoutSeconds = 120;
  return s;
}
test('native acceptance fixes 12 search + 8 independent validation tasks before inference', () => {
  const c = acceptanceContracts(contract(), contract());
  assert.deepEqual(c.search.budget, { candidates: 3, optimizerSeconds: 7140 });
  assert.equal(c.search.probes.limit, 3);
  assert.equal(c.search.timeoutSeconds, 600);
  assert.equal(c.assessment.timeoutSeconds, 600);
  assert.equal(c.search.probes.timeoutSeconds, 600);
  assert.equal(c.allocation.optimizerBudget.authoringSeconds, 1200);
  assert.equal(c.allocation.optimizerBudget.candidateWaitSeconds, 3240);
  assert.equal(c.allocation.optimizerBudget.probeWaitSeconds, 2700);
  assert.equal(c.assessment.purpose, 'validation');
  assert.equal(c.assessment.budget.candidates, 1);
  assert.equal(c.allocation.totalTaskExecutions, 20);
  const invalid = contract();
  invalid.tasks.pop();
  assert.throws(() => acceptanceContracts(invalid, contract()));
});

test('custom task deadlines propagate to task, native QA, probe and derived optimizer allocation', () => {
  const c = acceptanceContracts(contract(), contract(), { taskTimeoutSeconds: 900 });
  assert.equal(c.search.timeoutSeconds, 900);
  assert.equal(c.assessment.timeoutSeconds, 900);
  assert.equal(c.search.probes.timeoutSeconds, 900);
  assert.equal(c.allocation.modelRequestTimeoutSeconds, 900);
  assert.equal(c.allocation.optimizerBudget.nativeQaSeconds, 900);
  assert.equal(c.search.budget.optimizerSeconds, 9240);
  assert.equal(c.allocation.totalTaskExecutions, 20);
  const changedBuild = contract();
  changedBuild.candidate.build.timeoutSeconds = 450;
  assert.equal(
    acceptanceContracts(changedBuild, structuredClone(changedBuild)).search.budget.optimizerSeconds,
    7890,
  );
});

test('invalid deadlines and shorter model route deadlines are rejected before inference', () => {
  for (const taskTimeoutSeconds of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => acceptanceContracts(contract(), contract(), { taskTimeoutSeconds }));
  const development = contract();
  development.egress.optimizer = [
    {
      id: 'model',
      path: '/v1/chat/completions',
      method: 'POST',
      upstream: 'https://provider.invalid/v1/chat/completions',
      addresses: { kind: 'public' },
      credential: null,
      body: { kind: 'empty' },
      maxRequestBytes: 1024,
      timeoutSeconds: 300,
    },
  ];
  assert.throws(() => acceptanceContracts(development, contract()), /route deadline/);
  development.egress.optimizer[0].timeoutSeconds = 900;
  assert.equal(
    acceptanceContracts(development, contract(), { taskTimeoutSeconds: 900 }).search.budget.optimizerSeconds,
    9240,
  );
});

const event = (type, data, seq) => ({
  method: 'session.event',
  params: { sessionId: 'g', event: { type, data, seq } },
});
const pair = (name, id, content, isError = false) => [
  event('tool/call', { name, callId: id, arguments: '{}' }, 1),
  event(
    'tool/result',
    { message: { toolCallId: id, isError, content: [{ type: 'text', text: content }] } },
    2,
  ),
];
const skill = {
  file: 'cordis-plugin-development/SKILL.md',
  directory: '/installed/official/cordis-plugin-development',
  sha256: 'a'.repeat(64),
  body: 'Official complete body\nRead exact contracts.',
  bodySha256: 'b'.repeat(64),
};
const text = `Base directory for this skill: ${skill.directory}\n<skill_instructions>\n${skill.body}\n</skill_instructions>`;
test('accepts actual successful native query and exact official Skill body/source', () => {
  const evidence = authoringEvidence(
    [...pair('cordis_inspect_query', 'q', '{"data":{"methods":[]}}'), ...pair('skill', 's', text)],
    [skill],
  );
  assert.equal(evidence.inspectQueried, true);
  assert.equal(evidence.officialSkillLoaded, true);
  assert.equal(evidence.completed[1].skills[0].sha256, skill.sha256);
});
test('names in prose, tool failures, partial or differently sourced Skill bodies never pass', () => {
  for (const events of [
    pair('bash', 'b', 'cordis_inspect_query skill'),
    pair('skill', 's', text, true),
    pair('skill', 's', text.replace(skill.directory, '/untrusted')),
    pair('skill', 's', text.replace('Read exact contracts.', '')),
    [],
  ]) {
    assert.equal(authoringEvidence(events, [skill]).officialSkillLoaded, false);
  }
  assert.equal(
    authoringEvidence(pair('cordis_inspect_query', 'q', 'failure', true), [skill]).inspectQueried,
    false,
  );
});
test('native call/result correlation respects session identity and unfinished calls', () => {
  const p = pair('skill', 's', text);
  p[1].params.sessionId = 'another-session';
  const result = authoringEvidence(p, [skill]);
  assert.equal(result.officialSkillLoaded, false);
  assert.equal(result.unfinished.length, 1);
});
test('AST evidence excludes prose and formatting while recognizing executable syntax changes', () => {
  const source = `export function apply(ctx) { ctx.prompt('old'); return 1; }`;
  assert.equal(
    implementationShape(source),
    implementationShape(
      `// comment\nexport function apply(ctx){ ctx.prompt('new long instructions'); return 1; }`,
    ),
  );
  assert.notEqual(
    implementationShape(source),
    implementationShape(`export function apply(ctx) { ctx.prompt('old'); return ctx.tools.list(); }`),
  );
  assert.throws(() => implementationShape('export function {'));
});
function evidence() {
  return {
    calls: [{ inspectQueried: true, officialSkillLoaded: true }],
    mutations: [{ candidate: 'h1', executableSyntaxChanged: true }],
    search: {
      pendingSubmissions: [],
      candidates: [{ digest: 'h1', phase: 'rejected', build: {}, qaError: null, scoredRuns: 4 }],
    },
    validationReports: [0, 1].map(() => ({ candidates: [{ scoredRuns: 4, complete: true, mean: 0 }] })),
    installed: { installed: true, nativeComposition: true, inferenceRequested: false },
    usage: { complete: true, reportedTotals: { started: 8, unfinished: 0 } },
  };
}
test('quality rejection or zero gain does not rewrite integration criteria', () => {
  assert.ok(Object.values(integrationChecks(evidence())).every(Boolean));
});
test('mutation without native QA/scoring and missing validation/accounting remain explicit failures', () => {
  const e = evidence();
  e.search.candidates[0].phase = 'qa_failed';
  e.search.candidates[0].scoredRuns = 0;
  assert.equal(integrationChecks(e).implementationMutationNativelyTested, false);
  e.validationReports[0].candidates[0].scoredRuns = 3;
  assert.equal(integrationChecks(e).independentValidationComplete, false);
  e.usage.complete = false;
  assert.equal(integrationChecks(e).modelAccountingComplete, false);
});

test('allocation separates reserved/cancelled slots from tasks that actually started', () => {
  const report = {
    candidates: [
      {
        samples: [
          { startedAt: '2026-10-28T00:00:00Z', phase: 'scored' },
          { startedAt: '2026-10-28T00:00:00Z', phase: 'execution_failed' },
          { startedAt: null, phase: 'cancelled' },
        ],
      },
    ],
  };
  assert.deepEqual(taskObservations([report]), {
    reservedTaskSlots: 3,
    actualTaskExecutions: 2,
    scoredTaskSlots: 1,
    terminalFailedTaskSlots: 2,
  });
});

test('owner cancellation only targets initialized ledgers and frozen validation registration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-owner-'));
  const calls = [];
  const empty = await cancelOwnedRuns(root, async (...args) => {
    calls.push(args);
    return '{}';
  });
  assert.equal(empty.complete, true);
  assert.equal(calls.length, 0);
  await mkdir(path.join(root, 'search'));
  await writeFile(path.join(root, 'search/experiment.sqlite'), 'ledger-marker');
  await mkdir(path.join(root, 'validation/registration-intent'), { recursive: true });
  await writeFile(path.join(root, 'validation/registration-intent/contract.json'), '{}');
  const result = await cancelOwnedRuns(root, async (label, args) => {
    calls.push([label, args]);
    return JSON.stringify({ outcome: 'cancelled' });
  });
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [
    ['cancel-search', ['cancel', '--root', path.join(root, 'search')]],
    ['cancel-validation', ['cancel-validation', '--root', path.join(root, 'validation')]],
  ]);
});

test('failed owner cleanup is retained while remaining original registrations still get cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-owner-failed-'));
  await mkdir(path.join(root, 'search'));
  await writeFile(path.join(root, 'search/experiment.sqlite'), 'marker');
  await mkdir(path.join(root, 'installation/execution'), { recursive: true });
  await writeFile(path.join(root, 'installation/execution/execution-intent.json'), '{}');
  const registrations = [];
  const result = await cancelOwnedRuns(
    root,
    async () => {
      throw Error('original identity mismatch');
    },
    async (target, entries) => {
      registrations.push({ target, entries });
      return { outcome: 'cancelled' };
    },
  );
  assert.equal(result.complete, false);
  assert.equal(result.results[0].status, 'failed');
  assert.match(result.results[0].error, /identity mismatch/);
  assert.deepEqual(registrations, [
    { target: root, entries: [{ directory: 'installation/execution', role: 'qa' }] },
  ]);
});
