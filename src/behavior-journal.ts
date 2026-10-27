import { atomicJSON, canonical } from './artifacts.js';

/** Author-supplied observations, not independent grading or automatic assertions. */
export class BehaviorJournal {
  private observations: unknown[] = [];
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly file: string) {}

  start(): Promise<void> {
    return this.persist('running');
  }

  observe(label: string, value: unknown): Promise<void> {
    if (typeof label !== 'string' || label.trim().length === 0)
      throw new Error('Observation label must be a nonempty string');
    // Reject non-JSON values instead of silently dropping fields or changing NaN to null.
    return this.append({ kind: 'value', label, value: JSON.parse(canonical(value)) });
  }

  tool(name: string, args: Record<string, unknown>, result: unknown): Promise<void> {
    return this.append({ kind: 'tool', name, arguments: args, result });
  }

  finish(status: 'passed' | 'failed', error?: string): Promise<void> {
    if (this.closed) throw new Error('Behavior journal is already closed');
    this.closed = true;
    return this.persist(status, error);
  }

  private append(observation: Record<string, unknown>): Promise<void> {
    if (this.closed) throw new Error('Cannot observe after the behavior suite has finished');
    this.observations.push(
      JSON.parse(JSON.stringify({ sequence: this.observations.length + 1, ...observation })),
    );
    return this.persist('running');
  }

  private persist(status: 'running' | 'passed' | 'failed', error?: string): Promise<void> {
    const snapshot = JSON.parse(
      JSON.stringify({ status, observations: this.observations, ...(error === undefined ? {} : { error }) }),
    );
    // Concurrent tool calls/observations must not rename an older snapshot over the final report.
    this.pending = this.pending.then(() => atomicJSON(this.file, snapshot));
    return this.pending;
  }
}
