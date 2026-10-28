import type { Context } from '@deepseek-ai/cordis';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Schema from '@deepseek-ai/schemastery';
import { isAgentLoopRequest, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-system-prompt';

export const name = 'evolution-runtime-observer';
export const inject = ['llm', 'systemPrompt', 'agents', 'tools', 'sessions'];
export const Config = Schema.object({
  file: Schema.string().required(),
  provider: Schema.string().required(),
  model: Schema.string().required(),
  startedAt: Schema.number().required(),
  timeoutSeconds: Schema.number().required(),
});
export interface Config {
  file: string;
  provider: string;
  model: string;
  startedAt: number;
  timeoutSeconds: number;
}
export function apply(ctx: Context, config: Config): void {
  const observerId = randomUUID();
  const record = (event: object): void =>
    appendFileSync(config.file, `${JSON.stringify({ observerId, ...event })}\n`, { mode: 0o600 });
  // Separate ledger preserves the existing request settlement/accounting protocol.
  const event = (value: object): void =>
    appendFileSync(
      `${config.file}.events`,
      `${JSON.stringify({ observerId, at: new Date().toISOString(), ...value })}\n`,
      { mode: 0o600 },
    );
  const lifecycles = new WeakMap<Agent, string>();
  const agentIdentity = (agent: Agent | undefined) => {
    if (!agent) return undefined;
    let lifecycleId = lifecycles.get(agent);
    if (!lifecycleId) {
      lifecycleId = randomUUID();
      lifecycles.set(agent, lifecycleId);
    }
    return { agentId: agent.id, lifecycleId };
  };
  const initiator = () => agentIdentity(ctx.agents.currentInitiator());
  event({ kind: 'observer-started', unit: 'DSH native events; no inferred HTTP or service calls' });
  ctx.on('agent/created', ({ agent, source }) => {
    event({
      kind: 'agent-created',
      ...agentIdentity(agent),
      source,
      header: agent.session.header,
      initiator: initiator(),
    });
  });
  ctx.on('agent/disposed', ({ agent }) => {
    event({ kind: 'agent-disposed', ...agentIdentity(agent) });
  });
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    // The durable session carries exact chunks. Keep native attempt boundaries here,
    // without guessing a join to an llm/stream UUID or counting its usage twice.
    if (frame.type !== 'chunk') event({ kind: 'assistant-frame', ...agentIdentity(agent), frame });
  });
  ctx.on('session/event', (session, entry) => {
    // Native sequence is the join to the persisted session, including PTC events.
    // Do not mirror arbitrary plugin records (which may include private settings).
    if (
      [
        'turn/start',
        'turn/end',
        'step/start',
        'step/end',
        'tool/call',
        'tool/result',
        'tool/ptc-dispatch',
        'tool/ptc-dispatch-start',
      ].includes(entry.type)
    ) {
      event({ kind: 'session-event', sessionId: session.id, entry });
    }
  });
  const executions = new Map<ToolExecutionToken, { id: string; prepared?: number; dispatched?: number }>();
  const execution = (token: ToolExecutionToken) => {
    let state = executions.get(token);
    if (!state) {
      state = { id: randomUUID() };
      executions.set(token, state);
    }
    return state;
  };
  const toolIdentity = (exec: ToolExecution) => ({
    id: execution(exec.token).id,
    ...agentIdentity(exec.agent),
    callId: exec.callId,
    rootCallId: exec.rootCallId,
    ...(exec.parent === undefined ? {} : { parentExecutionId: execution(exec.parent).id }),
    name: exec.name,
  });
  ctx.on('tools/pre-execute', async (exec, next) => {
    execution(exec.token).prepared = performance.now();
    event({ kind: 'tool-prepared', ...toolIdentity(exec), arguments: exec.arguments });
    return next();
  });
  ctx.on('tools/execute', async (exec, next) => {
    execution(exec.token).dispatched = performance.now();
    event({ kind: 'tool-dispatched', ...toolIdentity(exec) });
    return next();
  });
  ctx.on('tools/result', (exec, result) => {
    const state = execution(exec.token),
      now = performance.now();
    event({
      kind: 'tool-result',
      ...toolIdentity(exec),
      // Pre-pipeline rejections have no observed start. Absence is not zero time.
      ...(state.prepared === undefined ? {} : { observedDurationMs: now - state.prepared }),
      ...(state.dispatched === undefined ? {} : { dispatchToResultMs: now - state.dispatched }),
      arguments: exec.arguments,
      result,
    });
  });
  ctx.systemPrompt.context({
    name: 'evolution:execution-budget',
    order: 220,
    required: true,
    interpolate: false,
    text: () =>
      `Execution budget: ${config.timeoutSeconds}s; elapsed: ${Math.max(0, Math.floor((Date.now() - config.startedAt) / 1000))}s. The external controller enforces this wall-clock limit.`,
  });
  ctx.on('llm/stream', async function* (options, next): AsyncIterable<StreamChunk> {
    const id = randomUUID(),
      started = Date.now(),
      monotonicStart = performance.now();
    if (options.provider !== config.provider || options.model !== config.model)
      throw new Error('Model route violates the frozen experiment contract');
    record({
      id,
      kind: 'started',
      at: new Date(started).toISOString(),
      sessionId: options.sessionId,
      initiator: initiator(),
      purpose: options.purpose,
      agentLoopRequest: isAgentLoopRequest(options),
      provider: options.provider,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      maxTokens: options.maxTokens,
      messages: options.messages,
      tools: options.tools,
    });
    let usage: TokenUsage | null = null;
    let finished = false;
    let failure: unknown = null;
    let finishReason: unknown;
    let providerResponse: unknown;
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage;
        if (chunk.type === 'finish') {
          finished = true;
          finishReason = chunk.reason;
          providerResponse = chunk.replayState?.response;
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
            failure = chunk.reason.failure;
        }
        yield chunk;
      }
      if (!finished) throw new Error('Model stream ended without a finish event');
      record({
        id,
        kind: failure ? 'failed' : 'result',
        durationMs: performance.now() - monotonicStart,
        usage,
        usageSource: usage === null ? 'unavailable' : 'adapter-reported',
        finishReason,
        // Adapter-private, versioned facts; never infer a returned model from the
        // requested model when an adapter omits responseModel.
        providerResponse,
        ...(failure ? { error: failure } : {}),
      });
    } catch (error) {
      record({
        id,
        kind: 'failed',
        durationMs: performance.now() - monotonicStart,
        usage,
        usageSource: usage === null ? 'unavailable' : 'adapter-reported',
        finishReason,
        providerResponse,
        error: String(error),
      });
      throw error;
    } finally {
      if (!finished) record({ id, kind: 'closed_incomplete', at: new Date().toISOString() });
    }
  });
}
