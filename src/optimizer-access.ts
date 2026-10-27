import { z } from 'zod';
import { digest } from './artifacts.js';
import { Digest } from './contracts.js';
import type { Candidate } from './contracts.js';
import type { Controller } from './controller.js';
import type { ExperimentEvent } from './events.js';
import type { EvidenceReferenceSpec } from './evidence.js';

export const OptimizerCursor = z.strictObject({
  experimentId: z.uuid(),
  viewDigest: Digest,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type OptimizerCursor = z.infer<typeof OptimizerCursor>;

/** The raw ledger remains host-only. Every optimizer response is projected here. */
export class OptimizerAccess {
  readonly viewDigest: string;
  constructor(readonly controller: Controller) {
    this.viewDigest = digest({ specification: controller.spec, projection: 'optimizer-feedback-1' });
  }
  private get mechanical() {
    return this.controller.spec.hostSearchProtocol.feedback === 'mechanical';
  }
  private candidate(candidate: Candidate) {
    return {
      digest: candidate.digest,
      ordinal: candidate.ordinal,
      proposal: candidate.proposal,
      phase: candidate.phase === 'champion' || candidate.phase === 'rejected' ? 'settled' : candidate.phase,
      ...(candidate.build ? { build: candidate.build } : {}),
      ...(candidate.buildError ? { buildError: candidate.buildError } : {}),
      ...(candidate.qaError ? { qaError: candidate.qaError } : {}),
    };
  }
  submission(candidate: Candidate) {
    return this.mechanical ? this.candidate(candidate) : candidate;
  }
  status() {
    const state = this.controller.status();
    const spec = this.controller.spec;
    const specification = {
      name: spec.name,
      objective: spec.objective,
      purpose: spec.purpose,
      hostSearchProtocol: spec.hostSearchProtocol,
      isolation: spec.isolation,
      egress: spec.egress,
      runtime: spec.runtime,
      executor: spec.executor,
      optimizer: spec.optimizer,
      optimizerHarness: spec.optimizerHarness,
      candidate: spec.candidate,
      tasks: spec.tasks.map(({ id, prompt, input, inputDigest }) => ({ id, prompt, input, inputDigest })),
      repetitions: spec.repetitions,
      concurrency: spec.concurrency,
      timeoutSeconds: spec.timeoutSeconds,
      failureLimit: spec.failureLimit,
      budget: spec.budget,
      metric: spec.metric,
      constraints: spec.constraints,
      probes: spec.probes,
      researchLibrary: spec.researchLibrary,
    };
    if (!this.mechanical) return { ...state, specification, cursor: this.cursor() };
    return {
      cursor: this.cursor(),
      specification,
      seed: state.candidates[0]?.digest ?? null,
      candidates: state.candidates.map((item) => this.candidate(item)),
      pendingSubmissions: state.pendingSubmissions.map((item) => this.candidate(item)),
      conclusion: state.conclusion ? { reason: state.conclusion.reason, at: state.conclusion.at } : null,
    };
  }
  private events(): ExperimentEvent[] {
    const events: ExperimentEvent[] = [];
    for (const event of this.controller.store.events()) {
      let value: Omit<ExperimentEvent, 'sequence'> | undefined;
      if (!this.mechanical) value = event;
      else {
        const body = event.body as Record<string, unknown>;
        switch (event.type) {
          case 'candidate.submission_started':
          case 'candidate.frozen':
            value = { at: event.at, type: event.type, body: this.candidate(event.body as Candidate) };
            break;
          case 'candidate.built':
            value = {
              at: event.at,
              type: event.type,
              body: { candidate: body.candidate, build: body.build },
            };
            break;
          case 'candidate.build_failed':
            value = {
              at: event.at,
              type: event.type,
              body: { candidate: body.candidate, error: body.error },
            };
            break;
          case 'candidate.qa':
            value = {
              at: event.at,
              type: event.type,
              body: { candidate: body.candidate, ExitCode: body.ExitCode },
            };
            break;
          case 'candidate.admitted':
            value = { at: event.at, type: event.type, body: { candidate: body.candidate } };
            break;
          case 'candidate.decision':
            value = { at: event.at, type: 'candidate.settled', body: { candidate: body.candidate } };
            break;
          case 'search.concluded':
            value = { at: event.at, type: event.type, body: { reason: body.reason } };
            break;
        }
      }
      if (value) events.push({ ...value, sequence: events.length + 1 });
    }
    return events;
  }
  cursor(): OptimizerCursor {
    return {
      experimentId: this.controller.store.getMeta('experimentId')!,
      viewDigest: this.viewDigest,
      sequence: this.events().length,
    };
  }
  page(raw: OptimizerCursor, limit: number) {
    const cursor = OptimizerCursor.parse(raw);
    if (
      cursor.experimentId !== this.controller.store.getMeta('experimentId') ||
      cursor.viewDigest !== this.viewDigest
    )
      throw new Error('Cursor belongs to another optimizer feedback view');
    const all = this.events();
    if (cursor.sequence > all.length) throw new Error('Cursor is ahead of the optimizer view');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid view page limit');
    const events = all.slice(cursor.sequence, cursor.sequence + limit);
    return {
      cursor: { ...cursor, sequence: cursor.sequence + events.length },
      events,
      hasMore: all.length > cursor.sequence + events.length,
    };
  }
  async wait(cursor: OptimizerCursor, options: { timeoutMs: number; limit: number; signal?: AbortSignal }) {
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
      options.signal?.throwIfAborted();
      const rawCursor = this.controller.store.cursor();
      const page = this.page(cursor, options.limit);
      if (page.events.length || Date.now() >= deadline) return page;
      // Hidden events may wake the host; they never advance or wake the visible cursor.
      await this.controller.store.wait(rawCursor, {
        timeoutMs: Math.max(0, deadline - Date.now()),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }
  }
}

/** Authorize before looking up IDs or reading bytes, including every materialization alias. */
export function authorizeOptimizerEvidence(controller: Controller, reference: EvidenceReferenceSpec): void {
  const spec = controller.spec;
  if (reference.kind === 'probe' && spec.probes === null) throw new Error('Probe evidence is not authorized');
  if (reference.kind === 'asset' && spec.researchLibrary === null)
    throw new Error('Research library evidence is not authorized');
  if (spec.hostSearchProtocol.feedback === 'mechanical' && reference.kind === 'run')
    throw new Error(
      'Execution evidence is not authorized by the mechanical feedback protocol; use task input',
    );
}
