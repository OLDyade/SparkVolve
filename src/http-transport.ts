import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { Agent, fetch, install } from 'undici';

export const name = 'evolution-http-transport';
export const Config = Schema.object({ timeoutSeconds: Schema.number().min(0).required() });
export interface Config {
  timeoutSeconds: number;
}

let active = false;
const globals = [
  'fetch',
  'Headers',
  'Response',
  'Request',
  'FormData',
  'WebSocket',
  'CloseEvent',
  'ErrorEvent',
  'MessageEvent',
  'EventSource',
] as const;

// One isolated native host owns this transport. Node's built-in fetch may impose
// a separate 300s header deadline even when the model SDK allows a longer request.
// Install the matching Undici fetch family and explicitly own its dispatcher.
export function installTransport(timeoutSeconds: number): () => Promise<void> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    throw new Error('HTTP transport requires a positive execution budget');
  if (active) throw new Error('HTTP transport already installed in this native host');
  const before = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const agent = new Agent({
    connect: { timeout: timeoutSeconds * 1000 },
    headersTimeout: timeoutSeconds * 1000,
    bodyTimeout: timeoutSeconds * 1000,
  });
  install();
  const managedFetch: typeof fetch = (input, init) => fetch(input, { ...init, dispatcher: agent });
  Reflect.set(globalThis, 'fetch', managedFetch);
  const owned = new Map(globals.map((key) => [key, Reflect.get(globalThis, key)]));
  active = true;
  return async () => {
    for (const key of globals) {
      if (Reflect.get(globalThis, key) !== owned.get(key)) continue;
      const descriptor = before.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    active = false;
    await agent.destroy();
  };
}

export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => installTransport(config.timeoutSeconds));
}
