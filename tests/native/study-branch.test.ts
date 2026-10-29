import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import * as Study from '../../src/study-plugin.js';
import { serveStudy } from '../../src/study-api.js';
import { StudyBranchReceipt } from '../../src/study-control.js';
import { studyBranchFixture } from '../study-branch-fixture.js';

test('native DSH branch tool renders the actual coordinator receipt and preserves edits on replay', async () => {
  const f = await studyBranchFixture(),
    abort = new AbortController(),
    ctx = new Context();
  const env = 'SPARKVOLVE_NATIVE_BRANCH_CAPABILITY';
  process.env[env] = 'e'.repeat(64);
  const server = await serveStudy(f.control, process.env[env], 0, '127.0.0.1', abort.signal);
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing address');
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(Study, { endpoint: `http://127.0.0.1:${address.port}`, tokenEnv: env });
    const call = async () => {
      const result = await ctx.tools.execute({
        callId: ToolCallId('native-study-branch'),
        name: 'optimizer_study_branch',
        arguments: { parent: f.store.methods()[0]!.id, draft: 'native-method' },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(typeof result.value, 'string');
      assert.deepEqual(result.content, [{ type: 'text', text: result.value }]);
      return StudyBranchReceipt.parse(JSON.parse(String(result.value)));
    };
    const receipt = await call();
    assert.equal(receipt.path, '/workspace/native-method');
    assert.equal(receipt.targetRole, 'search-optimizer');
    assert.equal(receipt.parent.sourceDigest, f.spec.baseline.source.digest);
    assert.ok(!JSON.stringify(receipt).includes(f.root));
    const composition = path.join(f.root, 'drafts', receipt.path.slice('/workspace/'.length), 'plugins.yml');
    assert.equal(await readFile(composition, 'utf8'), '[]');
    await writeFile(composition, '# native editor changed the returned draft\n[]');
    assert.deepEqual(await call(), receipt);
    assert.match(await readFile(composition, 'utf8'), /native editor changed/);
  } finally {
    await ctx.fiber.dispose();
    delete process.env[env];
    abort.abort();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await f.close();
  }
});
