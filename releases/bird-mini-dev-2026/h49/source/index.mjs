import { readFileSync } from 'node:fs';

/**
 * Per-call deadline for the executor's BASH tool only.
 *
 * Mechanism (measured, and re-checked in this checkpoint against the mounted
 * databases): a bash command whose SQL is pathologically expensive does not
 * finish; it returns only when the harness kills the task at the wall clock. The
 * champion's bird-056 run is the clean example - one exploratory UNION ALL
 * statement consumed 292 of the 300 s task clock, the answer was written at 297 s
 * and the run was killed in the next model step; the champion's bird-028 run
 * never wrote answer.sql at all. A previous session shipped essentially this
 * race for ALL non-exempt tools and its five deadline tasks became 028 pass,
 * 056 pass, 058 pass, 107 wrong, 175 pass (4/5 delivered), at 155/180 - a
 * profile in which the wall-clock repair worked while the other 15 losses were
 * ordinary wrong SQL. That candidate also changed guidance.md, so its total did
 * not isolate the wrapper; this one keeps guidance.md byte-identical to the
 * 159/180 champion, so the only changed variable is "one bash call cannot eat
 * the task clock".
 *
 * Why a race rather than an abort: aborting exec.signal alone is not enough. A
 * tool that ignores the signal (a bash command blocked in sqlite is exactly that)
 * keeps its promise pending, so awaiting next() still returns only when the
 * command finishes. Racing next() against our own timer is what bounds the call.
 *
 * 60 s: delivered answers on this manifest return in well under a second; the
 * bound only bites the pathological statement and leaves more than three minutes
 * of the task clock to write and verify an answer.
 */
const CALL_BUDGET_MS = 60_000;
const CODE = 'BIRD_BASH_DEADLINE';

function deadlineResult(ms) {
  const message = `bash call exceeded ${Math.round(ms / 1000)}s and was stopped to preserve the task clock. `
    + 'Do not re-run the same statement. Write the best answer you can to /workspace/answer.sql now, '
    + 'then, only if time remains, run one cheaper variant (filter on an indexed column first; avoid a '
    + 'leading-wildcard LIKE over a large table; count a join\'s rows before aggregating over it).';
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'BashDeadlineError', code: CODE } },
  };
}

export const inject = ['systemPrompt'];

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'bird-guidance',
    order: 500,
    interpolate: false,
    text: readFileSync(new URL('./guidance.md', import.meta.url), 'utf8'),
  });

  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'bash') return next();

    const mine = new AbortController();
    const upstream = exec.signal;
    if (upstream !== undefined) {
      if (upstream.aborted) mine.abort(upstream.reason);
      else upstream.addEventListener('abort', () => mine.abort(upstream.reason), { once: true });
    }
    exec.signal = mine.signal;

    let fired = false;
    let timer;
    const expiry = new Promise((resolve) => {
      timer = setTimeout(() => {
        fired = true;
        mine.abort(new Error(CODE));
        resolve({ timedOut: true });
      }, CALL_BUDGET_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      const raced = await Promise.race([
        next().then((r) => ({ r }), (e) => ({ e })),
        expiry,
      ]);
      if (raced.timedOut) return deadlineResult(CALL_BUDGET_MS);
      if ('e' in raced) {
        if (fired) return deadlineResult(CALL_BUDGET_MS);
        throw raced.e;
      }
      if (fired) return deadlineResult(CALL_BUDGET_MS);
      return raced.r;
    } finally {
      clearTimeout(timer);
      exec.signal = upstream;
    }
  });
}
