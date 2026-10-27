import type { Candidate, ExperimentSpec, TaskRun } from '../src/contracts.js';
export const hash = 'a'.repeat(64);
export function specification(): ExperimentSpec {
  const model = {
    provider: 'test',
    model: 'test',
    reasoningEffort: 'off',
    maxTokens: 1024,
    credentialEnv: [],
  };
  return {
    name: 'invariants',
    objective: 'Verify experiment invariants',
    purpose: 'search',
    runtime: { image: `sha256:${hash}`, dshVersion: '0.2.1-rc.4', profile: 'sdk', environment: null },
    executor: model,
    optimizer: model,
    optimizerHarness: { directory: 'optimizer-bundle', digest: hash, composition: 'plugins.yml' },
    researchLibrary: null,
    evaluator: { image: `sha256:${hash}`, command: ['node', '/grader.js'], timeoutSeconds: 10 },
    candidate: {
      patch: 'cordis.patch.yml',
      build: { image: `sha256:${hash}`, network: 'none', timeoutSeconds: 10 },
      qa: ['node', '/candidate/qa.js'],
    },
    tasks: ['one', 'two'].map((id) => ({
      id,
      prompt: id,
      input: `inputs/${id}`,
      inputDigest: hash,
      evaluation: `private/${id}`,
      evaluationDigest: hash,
    })),
    repetitions: 1,
    concurrency: 2,
    timeoutSeconds: 10,
    failureLimit: 1,
    budget: { candidates: 4, optimizerSeconds: 60 },
    metric: { name: 'accuracy', direction: 'maximize', minimum: 0, maximum: 1, failure: 0 },
  };
}
export function candidate(id = hash, ordinal = 0): Candidate {
  return {
    digest: id,
    ordinal,
    phase: 'frozen',
    proposal: {
      draft: 'draft',
      parents: [],
      actions: ['author'],
      evidence: ['test'],
      hypothesis: 'Test candidate',
      expectedChange: 'Test trace',
    },
  };
}
export function runs(id = hash): TaskRun[] {
  return ['one', 'two'].map((task, i) => ({
    id: `${id}-${i}`,
    candidate: id,
    task,
    repetition: 0,
    attempt: 0,
    gradeAttempt: 0,
    phase: 'queued',
    container: `run-${i}`,
    gradeContainer: `grade-${i}`,
  }));
}
