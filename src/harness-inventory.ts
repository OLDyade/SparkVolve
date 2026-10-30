import type { Context, Fiber } from '@deepseek-ai/cordis';
import { readPluginInventory } from '@deepseek-ai/dsh-host-plugin-inventory';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { scopeOf } from '@deepseek-ai/dsh-scope';

import '@deepseek-ai/dsh-tools';

/** Observe Cordis's actual bindings. Never simulate dependency resolution from metadata. */
export async function harnessInventory(host: Context, agent: Context) {
  const inventory = await readPluginInventory(host);
  const entries = [...host.loader.entries()];
  const fibers = new Set<Fiber>();
  for (const runtime of host.registry.values()) for (const fiber of runtime.fibers) fibers.add(fiber);
  for (const runtime of agent.registry.values()) for (const fiber of runtime.fibers) fibers.add(fiber);
  for (const fiber of [...fibers])
    for (const impl of Object.values(fiber.store ?? {})) fibers.add(impl.fiber);
  const nodes = [...fibers].map((fiber) => ({
    uid: fiber.uid,
    name: fiber.name,
    state: fiber.state,
    entries: entries.filter((entry) => entry.fiber === fiber).map((entry) => entry.id),
    requires: Object.keys(fiber.inject),
    effects: fiber.getEffects(),
  }));
  const bindings = [...fibers].flatMap((fiber) =>
    Object.entries(fiber.store ?? {}).map(([service, impl]) => ({
      consumer: fiber.uid,
      service,
      provider: impl.fiber.uid,
      providerName: impl.fiber.name,
    })),
  );
  const tools = agent.tools.schemas(scopeOf(agent));
  return {
    format: 'sparkvolve-harness-inventory',
    runtime: getDshRuntimeVersion(),
    inventory,
    nodes,
    bindings,
    tools,
    evidence:
      'Observed native plugin states, injected service bindings and agent-visible tool schemas. Configuration bytes remain in the frozen source; activation does not prove business correctness.',
  };
}
