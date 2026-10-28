import { DEFAULT_TASK_TIMEOUT_SECONDS } from '../dist/contracts.js';

/** Explicit launcher settings; invalid or deliberately short values are never silently repaired. */
export function timeoutSeconds(value, defaultSeconds = DEFAULT_TASK_TIMEOUT_SECONDS) {
  const seconds = value === undefined ? defaultSeconds : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    throw new Error('Timeout must be a positive integer number of seconds');
  return seconds;
}

/** Seed scoring precedes G. Reserve time for every remaining candidate and declared probe. */
export function optimizerSecondsForPlan(spec, authoringSeconds) {
  const probesSeconds =
    spec.probes === null
      ? 0
      : spec.probes.limit * (spec.candidate.build.timeoutSeconds + spec.probes.timeoutSeconds);
  return authoringSeconds + (spec.budget.candidates - 1) * candidateSecondsForPlan(spec) + probesSeconds;
}

export function candidateSecondsForPlan(spec) {
  const waves = Math.ceil((spec.tasks.length * spec.repetitions) / spec.concurrency);
  return (
    spec.candidate.build.timeoutSeconds +
    spec.timeoutSeconds +
    waves * (spec.timeoutSeconds + spec.evaluator.timeoutSeconds)
  );
}
