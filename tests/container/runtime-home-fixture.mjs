import assert from 'node:assert/strict';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    async resolveModel(provider, id) {
      return {
        provider,
        id,
        name: 'No inference fixture',
        context: { contextWindow: 262144 },
        reasoning: { efforts: [{ id: 'off', name: 'off' }] },
      };
    }
    async *stream() {
      throw Error('This environment regression must not call a model');
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Fixture());
}
export async function probe({ call, observe, ctx }) {
  const result = await call('bash', {
    command: `python3 -c "import os,pathlib; h=os.environ['HOME']; s=os.statvfs(h); assert s.f_blocks*s.f_frsize==134217728; assert os.stat(h).st_mode&511==448; assert os.stat(os.environ['XDG_RUNTIME_DIR']).st_mode&511==448; pathlib.Path(h+'/.write-probe').write_text('ok')" && mkdir -p /workspace/convert && soffice --headless --convert-to csv --outdir /workspace/convert /workspace/input.xlsx && cat /workspace/convert/input.csv`,
    description: 'Verify default LibreOffice profile inside native sandbox',
  });
  assert.equal(result.value.exitCode, 0, JSON.stringify(result.value));
  assert.equal(result.value.sandbox.enforcement, 'full');
  assert.match(result.value.stdout.text, /7,42/);
  assert.doesNotMatch(
    result.value.stderr.text,
    /dconf-CRITICAL|No writable cache|User installation could not be completed/,
  );
  await new Promise((resolve, reject) => {
    ctx.inject(['sandbox'], async (services) => {
      try {
        const wrapped = await services.sandbox.confine(
          ['true'],
          { mode: 'workspace-write', workspaceRoot: '/workspace' },
          new AbortController().signal,
        );
        await observe('sandbox-backend', { argv: wrapped.argv, enforcement: wrapped.enforcement });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  await observe('default-profile', {
    recalculated: 42,
    homeBytes: 134217728,
    mode: '0700',
    cacheWarnings: false,
  });
}
