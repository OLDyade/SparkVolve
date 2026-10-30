"""Public synthetic development fixtures; no claim of unseen benchmark data."""
import argparse
import json
import shutil
from pathlib import Path


def fixtures(split='search'):
    offset = {'search': 0, 'validation': 11, 'reuse': 29}[split]
    events = [
        {'event_id': 'e4', 'entity': 'alpha', 'revision': 4, 'action': 'upsert', 'value': 'new'},
        {'event_id': 'e1', 'entity': 'alpha', 'revision': 1, 'action': 'upsert', 'value': 'old'},
        {'event_id': 'e6', 'entity': 'beta', 'revision': 6, 'action': 'delete'},
        {'event_id': 'e2', 'entity': 'beta', 'revision': 2, 'action': 'upsert', 'value': 'obsolete'},
        {'event_id': 'e7', 'entity': 'gamma', 'revision': 7, 'action': 'upsert', 'value': ''},
        {'event_id': 'e4', 'entity': 'alpha', 'revision': 4, 'action': 'upsert', 'value': 'new'},
        {'event_id': 'e5', 'entity': 'gamma', 'revision': 5, 'action': 'delete'},
        {'event_id': 'e8', 'entity': 'delta', 'revision': 8, 'action': 'upsert', 'value': None},
    ]
    logs = [
        {'method': 'GET', 'path': '/orders', 'status': status, 'latency_ms': latency}
        for status, latency in [(200, 10), (200, 20), (500, 80), (404, 40), (200, 30)]
    ] + [
        {'method': 'POST', 'path': '/orders', 'status': status, 'latency_ms': latency}
        for status, latency in [(201, 0), (503, 100), (201, 20)]
    ] + [{'method': 'GET', 'path': '/health', 'status': 200, 'latency_ms': 2}]
    inventory = {
        'packages': [{'name': 'red', 'version': '1.0'}, {'name': 'red', 'version': '2.0'},
                     {'name': 'blue', 'version': '1.0'}, {'name': 'green', 'version': '0.9'}],
        'advisories': [{'id': 'A1', 'name': 'red', 'version': '1.0'},
                       {'id': 'A2', 'name': 'blue', 'version': '1.0'},
                       {'id': 'A3', 'name': 'orange', 'version': '1.0'}],
        'exceptions': [{'advisory': 'A2', 'name': 'blue', 'version': '1.0'}],
    }
    cases = [
        ('revision-events', 'events.jsonl', events,
         'Read /input/events.jsonl. Deduplicate identical event_id records, then choose the greatest integer revision independently for each entity, regardless of file order. A latest delete is a tombstone; an upsert after a delete restores the entity. Empty strings and null are real values. Write /workspace/result.json with exactly: entities (array of {entity, revision, value}, ordered by entity), tombstones (array of entity strings, sorted), unique_event_count (integer count after event_id deduplication).',
         {'entities': [{'entity': 'alpha', 'revision': 4, 'value': 'new'},
                       {'entity': 'delta', 'revision': 8, 'value': None},
                       {'entity': 'gamma', 'revision': 7, 'value': ''}],
          'tombstones': ['beta'], 'unique_event_count': 7}),
        ('request-logs', 'requests.jsonl', logs,
         'Read /input/requests.jsonl. Each line is one request. Group by the exact pair (method,path); do not combine different methods. Errors have status >=500 (404 is not an error). Per group calculate count, errors, mean_ms as a string with exactly two decimal places rounded half up, and p95_ms using nearest rank: sorted latency at 1-based ceil(0.95*count). Include zero latencies. Write /workspace/result.json with exactly: groups (array of {method,path,count,errors,mean_ms,p95_ms} ordered by method then path), total_requests (integer), server_errors (integer).',
         {'groups': [{'method': 'GET', 'path': '/health', 'count': 1, 'errors': 0, 'mean_ms': '2.00', 'p95_ms': 2},
                     {'method': 'GET', 'path': '/orders', 'count': 5, 'errors': 1, 'mean_ms': '36.00', 'p95_ms': 80},
                     {'method': 'POST', 'path': '/orders', 'count': 3, 'errors': 1, 'mean_ms': '40.00', 'p95_ms': 100}],
          'total_requests': 9, 'server_errors': 2}),
        ('dependency-join', 'inventory.json', inventory,
         'Read /input/inventory.json. Join each advisory to installed packages by exact name AND exact version (no range or version inference). An exception suppresses only the exact (advisory id, name, version) triple. Write /workspace/result.json with exactly: findings (unsuppressed matches as {advisory,name,version}, sorted by advisory/name/version), suppressed (suppressed matches in the same shape/order), unmatched_advisories (sorted IDs with no installed exact match). This is synthetic inventory data, not an external vulnerability lookup.',
         {'findings': [{'advisory': 'A1', 'name': 'red', 'version': '1.0'}],
          'suppressed': [{'advisory': 'A2', 'name': 'blue', 'version': '1.0'}],
          'unmatched_advisories': ['A3']}),
    ]
    # Separate public fixture instances retain the same declared semantics. These
    # are within-family checks, not a claim of transfer to unknown task families.
    if offset:
        for row in events:
            row['revision'] += offset
            row['entity'] = f'{split}-{row["entity"]}'
            row['event_id'] = f'{split}-{row["event_id"]}'
        event_expected = cases[0][4]
        for row in event_expected['entities']:
            row['revision'] += offset
            row['entity'] = f'{split}-{row["entity"]}'
        event_expected['tombstones'] = [f'{split}-{name}' for name in event_expected['tombstones']]
        for row in logs:
            row['path'] = f'/{split}{row["path"]}'
            # Preserve the zero boundary while varying positive observations.
            if row['latency_ms']:
                row['latency_ms'] += offset
        log_expected = cases[1][4]
        means = [f'{2 + offset:.2f}', f'{36 + offset:.2f}', f'{(120 + 2 * offset) / 3:.2f}']
        for row, mean in zip(log_expected['groups'], means):
            row['path'] = f'/{split}{row["path"]}'
            row['mean_ms'] = mean
            row['p95_ms'] += offset
        for rows in inventory.values():
            for row in rows:
                row['name'] = f'{split}-{row["name"]}'
                row['version'] = f'{offset}.{row["version"]}'
        join_expected = cases[2][4]
        for rows in [join_expected['findings'], join_expected['suppressed']]:
            for row in rows:
                row['name'] = f'{split}-{row["name"]}'
                row['version'] = f'{offset}.{row["version"]}'
    return cases


def generate(root, split='search'):
    root.mkdir(parents=True, exist_ok=False)
    tasks = []
    for name, filename, data, prompt, expected in fixtures(split):
        inputs, evaluation = root / 'inputs' / name, root / 'evaluation' / name
        inputs.mkdir(parents=True)
        evaluation.mkdir(parents=True)
        content = '\n'.join(json.dumps(row) for row in data) if filename.endswith('.jsonl') else json.dumps(data, indent=2)
        (inputs / filename).write_text(content + '\n')
        (evaluation / 'expected.json').write_text(json.dumps(expected, indent=2))
        shutil.copyfile(Path(__file__).with_name('grade.py'), evaluation / 'grade.py')
        tasks.append({'id': name, 'input': f'inputs/{name}', 'evaluation': f'evaluation/{name}', 'prompt': prompt})
    (root / 'tasks.json').write_text(json.dumps(tasks, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('split', choices=['search', 'validation', 'reuse'], nargs='?', default='search')
    args = parser.parse_args()
    generate(args.output, args.split)
