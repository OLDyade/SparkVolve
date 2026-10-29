import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
const example = path.resolve('examples/structured-data');
type EventRecord = { event_id: string; entity: string; revision: number; action: string; value?: unknown };
type RequestRecord = { method: string; path: string; status: number; latency_ms: number };
type PackageRecord = { name: string; version: string };
type Advisory = PackageRecord & { id: string };
test('fresh public splits preserve zero, null, tombstones and exact joins with independent arithmetic', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'he-data-splits-'));
  const inputs = new Set<string>();
  try {
    for (const split of ['search', 'validation', 'reuse']) {
      const dataset = path.join(root, split);
      await execute('python3', [path.join(example, 'generate.py'), dataset, split]);
      const readInput = async (task: string, file: string) => {
        const bytes = await readFile(path.join(dataset, 'inputs', task, file), 'utf8');
        assert.equal(inputs.has(bytes), false, 'Splits reused the same task input');
        inputs.add(bytes);
        return bytes;
      };
      const expected = async (task: string) =>
        JSON.parse(await readFile(path.join(dataset, 'evaluation', task, 'expected.json'), 'utf8'));
      const events = (await readInput('revision-events', 'events.jsonl'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as EventRecord);
      const unique = [...new Map(events.map((event) => [event.event_id, event])).values()];
      const latest = new Map<string, (typeof events)[number]>();
      for (const event of unique)
        if (!latest.has(event.entity) || latest.get(event.entity)!.revision < event.revision)
          latest.set(event.entity, event);
      const records = [...latest.values()].sort((a, b) => a.entity.localeCompare(b.entity));
      assert.deepEqual(await expected('revision-events'), {
        entities: records
          .filter((event) => event.action === 'upsert')
          .map(({ entity, revision, value }) => ({ entity, revision, value })),
        tombstones: records.filter((event) => event.action === 'delete').map((event) => event.entity),
        unique_event_count: unique.length,
      });
      const logs = (await readInput('request-logs', 'requests.jsonl'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as RequestRecord);
      assert.ok(logs.some((row) => row.latency_ms === 0));
      const groups = new Map<string, typeof logs>();
      for (const row of logs) {
        const key = JSON.stringify([row.method, row.path]);
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const summaries = [...groups.values()]
        .map((rows) => {
          const count = rows.length,
            total = rows.reduce((sum, row) => sum + row.latency_ms, 0);
          const cents = (BigInt(total) * 200n + BigInt(count)) / (2n * BigInt(count));
          return {
            method: rows[0]!.method,
            path: rows[0]!.path,
            count,
            errors: rows.filter((row) => row.status >= 500).length,
            mean_ms: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`,
            p95_ms: rows.map((row) => row.latency_ms).sort((a, b) => a - b)[Math.ceil(0.95 * count) - 1],
          };
        })
        .sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));
      assert.deepEqual(await expected('request-logs'), {
        groups: summaries,
        total_requests: logs.length,
        server_errors: logs.filter((row) => row.status >= 500).length,
      });
      const inventory = JSON.parse(await readInput('dependency-join', 'inventory.json')) as {
        packages: PackageRecord[];
        advisories: Advisory[];
        exceptions: (PackageRecord & { advisory: string })[];
      };
      const matched = inventory.advisories.filter((advisory) =>
        inventory.packages.some((pkg) => pkg.name === advisory.name && pkg.version === advisory.version),
      );
      const suppressed = (advisory: Advisory) =>
        inventory.exceptions.some(
          (exception) =>
            exception.advisory === advisory.id &&
            exception.name === advisory.name &&
            exception.version === advisory.version,
        );
      const result = ({ id, name, version }: Advisory) => ({ advisory: id, name, version });
      assert.deepEqual(await expected('dependency-join'), {
        findings: matched.filter((row) => !suppressed(row)).map(result),
        suppressed: matched.filter(suppressed).map(result),
        unmatched_advisories: inventory.advisories
          .filter((row) => !matched.includes(row))
          .map((row) => row.id),
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
