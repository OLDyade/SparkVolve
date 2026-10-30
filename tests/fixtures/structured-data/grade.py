"""Independent data-only grader: never import or execute a candidate delivery."""
import argparse
import json
from decimal import Decimal
from pathlib import Path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON member: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def load(file):
    return json.loads(file.read_text(), object_pairs_hook=unique_object,
                      parse_constant=reject_constant, parse_float=Decimal)


def equal(actual, expected):
    # JSON numbers compare exactly by value; true must not pass an expected 1.
    if type(expected) in (int, Decimal):
        return type(actual) in (int, Decimal) and actual == expected
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(equal(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(equal(a, b) for a, b in zip(actual, expected))
    return actual == expected


def grade(delivery, evaluation):
    expected = load(evaluation / 'expected.json')
    if not isinstance(expected, dict) or not expected:
        raise ValueError('Evaluator requires a nonempty expected object')
    try:
        actual = load(delivery / 'result.json')
    except (FileNotFoundError, ValueError, UnicodeError) as error:
        return {'score': 0, 'metrics': {'valid_json': 0},
                'feedback': f'Delivery result.json is absent or invalid: {type(error).__name__}'}
    if not isinstance(actual, dict):
        return {'score': 0, 'metrics': {'valid_json': 1}, 'feedback': 'Delivery must be a JSON object'}
    checks = {key: key in actual and equal(actual[key], value) for key, value in expected.items()}
    checks['exact_top_level_keys'] = actual.keys() == expected.keys()
    return {'score': sum(checks.values()) / len(checks), 'metrics': {'valid_json': 1},
            'feedback': json.dumps({'checks': checks}, sort_keys=True)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--delivery', type=Path, default=Path('/delivery'))
    parser.add_argument('--evaluation', type=Path, default=Path('/evaluation'))
    parser.add_argument('--output', type=Path, default=Path('/workspace/result.json'))
    args = parser.parse_args()
    args.output.write_text(json.dumps(grade(args.delivery, args.evaluation), allow_nan=False))
