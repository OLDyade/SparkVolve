import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Docker } from '../../dist/docker.js';
import { Grade } from '../../dist/contracts.js';
import { treeDigest } from '../../dist/artifacts.js';

// Explicit opt-in: downloaded community workbooks and private reference bytes stay local.
test(
  'pinned official grader handles original and missing deliveries across all three categories',
  { timeout: 600000 },
  async () => {
    const root = process.env.SPARKVOLVE_COMMUNITY_PREPARED;
    assert.ok(root, 'Set SPARKVOLVE_COMMUNITY_PREPARED to a completed --prepare-only root');
    const spec = JSON.parse(await readFile(path.join(root, 'development-spec.json'), 'utf8'));
    const dataset = path.join(root, 'inputs/cases/development');
    const evidence = await mkdtemp(path.join(os.tmpdir(), 'sparkvolve-community-grader-'));
    const docker = new Docker();
    const rows = [];
    const chosen = ['Debugging', 'Financial_Model', 'Template'].map((category) =>
      spec.tasks.find((task) => task.id.startsWith(category + '-')),
    );
    assert.ok(chosen.every(Boolean));
    for (const [index, task] of [...chosen, chosen[0]].entries()) {
      const home = path.join(evidence, String(index));
      await mkdir(home);
      for (const part of ['delivery', 'grade']) await mkdir(path.join(home, part));
      const missing = index === chosen.length;
      if (!missing)
        await copyFile(path.join(dataset, task.input, 'input.xlsx'), path.join(home, 'delivery/output.xlsx'));
      const before = await treeDigest(path.join(dataset, task.evaluation));
      const container = {
        name: 'sparkvolve-grader-qa-' + Date.now() + '-' + index,
        image: spec.evaluator.image,
        command: spec.evaluator.command,
        env: {},
        isolation: spec.isolation,
        network: 'none',
        timeoutSeconds: 600,
        mounts: [
          { source: path.join(home, 'delivery'), target: '/delivery', writable: false },
          { source: path.join(home, 'grade'), target: '/workspace', writable: true },
          { source: path.join(dataset, task.input), target: '/input', writable: false },
          { source: path.join(dataset, task.evaluation), target: '/evaluation', writable: false },
        ],
      };
      const result = await docker.run(container, path.join(home, 'execution'));
      assert.equal(result.ExitCode, 0, 'Independent grader failed; private evidence: ' + home);
      const grade = Grade.parse(JSON.parse(await readFile(path.join(home, 'grade/result.json'), 'utf8')));
      assert.equal(await treeDigest(path.join(dataset, task.evaluation)), before);
      assert.ok(grade.score >= 0 && grade.score <= 1);
      assert.deepEqual(Object.keys(grade.metrics).sort(), [
        'missing_output',
        'official_accuracy',
        'official_regression',
      ]);
      assert.equal(
        grade.feedback,
        'Official aggregate scores only. Inspect authorized source inputs and your own execution evidence for diagnosis.',
      );
      if (missing) {
        assert.equal(grade.score, 0);
        assert.equal(grade.metrics.missing_output, 1);
      }
      rows.push({ task: task.id, delivery: missing ? 'missing' : 'unchanged-input', ...grade });
      await docker.remove(await docker.executionReference(container));
    }
    console.log(JSON.stringify({ evidence, rows }));
  },
);
