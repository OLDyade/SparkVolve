import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// DSH's adapter taxonomy, never text matching against task/tool errors.
const upstreamCodes = new Set([
  'AUTH',
  'QUOTA',
  'ACCOUNT_QUOTA',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
  'EMPTY_RESPONSE',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
]);
export interface UpstreamFailure {
  requestId: string;
  code: string;
}
const Settlement = z.object({
  id: z.string(),
  kind: z.string(),
  failureCode: z.string().optional(),
  finishReason: z.object({ kind: z.string(), failure: z.object({ code: z.string() }).optional() }).optional(),
});
export async function upstreamFailures(runRoot: string): Promise<UpstreamFailure[]> {
  let source: string;
  try {
    source = await readFile(path.join(runRoot, 'trace/requests.jsonl'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return source
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const row = Settlement.parse(JSON.parse(line));
      const code = row.failureCode ?? row.finishReason?.failure?.code;
      return row.kind === 'failed' && code && upstreamCodes.has(code) ? [{ requestId: row.id, code }] : [];
    });
}
export class UpstreamUnavailable extends Error {
  constructor(
    readonly run: string,
    readonly failures: UpstreamFailure[],
  ) {
    super(
      `Upstream model service failed for run ${run}: ${failures.map((f) => f.code).join(', ')}. Search interrupted; no candidate quality decision or automatic retry.`,
    );
    this.name = 'UpstreamUnavailable';
  }
}
