import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
const example = path.resolve('examples/structured-data');
test('structured-data adapter grades typed outputs independently and retains negative evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-data-domain-'));
  try {
    const dataset = path.join(root, 'dataset'),
      delivery = path.join(root, 'delivery');
    await execute('python3', [path.join(example, 'generate.py'), dataset]);
    await mkdir(delivery);
    const grade = async (task: string) => {
      const result = path.join(root, 'grade.json');
      await execute('python3', [
        path.join(example, 'grade.py'),
        '--delivery',
        delivery,
        '--evaluation',
        path.join(dataset, 'evaluation', task),
        '--output',
        result,
      ]);
      return JSON.parse(await readFile(result, 'utf8'));
    };
    // Literal checks are independent of the generator's expected objects.
    await writeFile(
      path.join(delivery, 'result.json'),
      JSON.stringify({
        findings: [{ advisory: 'A1', name: 'red', version: '1.0' }],
        suppressed: [{ advisory: 'A2', name: 'blue', version: '1.0' }],
        unmatched_advisories: ['A3'],
      }),
    );
    assert.equal((await grade('dependency-join')).score, 1);
    await writeFile(
      path.join(delivery, 'result.json'),
      JSON.stringify({
        entities: [
          { entity: 'alpha', revision: 4, value: 'new' },
          { entity: 'delta', revision: 8, value: null },
          { entity: 'gamma', revision: 7, value: '' },
        ],
        tombstones: ['beta'],
        unique_event_count: 7,
      }),
    );
    assert.equal((await grade('revision-events')).score, 1);
    const valid = {
      groups: [
        { method: 'GET', path: '/health', count: 1, errors: 0, mean_ms: '2.00', p95_ms: 2 },
        { method: 'GET', path: '/orders', count: 5, errors: 1, mean_ms: '36.00', p95_ms: 80 },
        { method: 'POST', path: '/orders', count: 3, errors: 1, mean_ms: '40.00', p95_ms: 100 },
      ],
      total_requests: 9,
      server_errors: 2,
    };
    await writeFile(path.join(delivery, 'result.json'), JSON.stringify(valid));
    assert.equal((await grade('request-logs')).score, 1);
    for (const numericText of ['2.0', '2e0']) {
      await writeFile(
        path.join(delivery, 'result.json'),
        JSON.stringify(valid).replace('"p95_ms":2', `"p95_ms":${numericText}`),
      );
      assert.equal((await grade('request-logs')).score, 1);
    }
    valid.groups[0]!.count = true as unknown as number;
    await writeFile(path.join(delivery, 'result.json'), JSON.stringify(valid));
    const wrong = await grade('request-logs');
    assert.equal(wrong.score, 0.75);
    assert.equal(wrong.feedback.includes('mean_ms'), false); // no expected values leaked
    for (const invalid of ['{"groups":[],"groups":[]}', '{"value":NaN}', 'not json']) {
      await writeFile(path.join(delivery, 'result.json'), invalid);
      assert.equal((await grade('request-logs')).score, 0);
    }
    await rm(path.join(delivery, 'result.json'));
    assert.equal((await grade('request-logs')).score, 0);
    // Corrupted evaluator material is an infrastructure fault, never a business zero.
    await writeFile(path.join(dataset, 'evaluation/request-logs/expected.json'), '{}');
    await assert.rejects(grade('request-logs'), /nonempty expected object/);
    await assert.rejects(execute('python3', [path.join(example, 'generate.py'), dataset]), /FileExistsError/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
