import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import path from 'node:path';
import { atomicJSON } from './artifacts.js';

const Record = z.object({
  id: z.string(),
  kind: z.enum(['started', 'result', 'failed', 'closed_incomplete']),
  durationMs: z.number().nonnegative().optional(),
  usage: z
    .object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative() })
    .nullable()
    .optional(),
});
export async function requestMetrics(file: string): Promise<unknown> {
  const records = (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => Record.parse(JSON.parse(line)));
  const started = new Set(records.filter((r) => r.kind === 'started').map((r) => r.id));
  if (started.size !== records.filter((r) => r.kind === 'started').length)
    throw new Error('Duplicate request start');
  const terminal = records.filter((r) => r.kind === 'result' || r.kind === 'failed');
  if (new Set(terminal.map((r) => r.id)).size !== terminal.length)
    throw new Error('Duplicate request settlement');
  if (terminal.some((r) => !started.has(r.id))) throw new Error('Settlement without request start');
  return {
    unit: 'DSH adapter stream attempts; provider-internal HTTP retries may not be separately observable',
    started: started.size,
    results: terminal.filter((r) => r.kind === 'result').length,
    failed: terminal.filter((r) => r.kind === 'failed').length,
    unfinished: started.size - terminal.length,
    inputTokensReported: terminal.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0),
    outputTokensReported: terminal.reduce((sum, r) => sum + (r.usage?.outputTokens ?? 0), 0),
    missingUsage: terminal.filter((r) => r.usage == null).length,
    requestDurationMsSum: terminal.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
  };
}

/** Collect from durable stream events even when SIGKILL prevented the worker's finally block. */
export async function collectRequestMetrics(trace: string): Promise<void> {
  let metrics: unknown;
  try {
    metrics = await requestMetrics(path.join(trace, 'requests.jsonl'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // No observer started: callers report usage unavailable, never zero.
    return;
  }
  await atomicJSON(path.join(trace, 'metrics.json'), metrics);
}
