import type { ExperimentSpec } from './contracts.js';

export function evaluatorIsolation(spec: ExperimentSpec) {
  return { ...spec.isolation, memoryMiB: spec.evaluator.memoryMiB ?? spec.isolation.memoryMiB };
}

/** One limiter per controller/installed arm; waiting graders retain their task slot. */
export function evaluatorQueue(spec: ExperimentSpec) {
  const limit = Math.min(spec.concurrency, spec.evaluator.concurrency ?? spec.concurrency);
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(grade: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await grade();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
