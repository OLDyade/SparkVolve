import type { OutcomeConstraintSpec, TaskRun } from './contracts.js';

export interface ConstraintAssessment {
  constraint: OutcomeConstraintSpec;
  status: 'passed' | 'violated' | 'unavailable';
  denominator: number;
  observed: number;
  aggregate: { numerator: string; denominator: string } | null;
  samples: Array<{
    run: string;
    task: string;
    repetition: number;
    value: number | null;
    status: 'passed' | 'violated' | 'unavailable' | 'observed';
    reason: string | null;
  }>;
}

// Grade numbers have already been parsed as finite JS numbers. Interpret their canonical
// JSON decimal representations exactly, so aggregation cannot introduce threshold drift.
function decimal(value: number): { coefficient: bigint; scale: number } {
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const [integer, fraction = ''] = mantissa!.split('.');
  const coefficient = BigInt(integer! + fraction);
  const scale = fraction.length - Number(exponent);
  return scale < 0 ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 } : { coefficient, scale };
}

function exactMean(values: readonly number[]): { numerator: bigint; denominator: bigint } {
  const terms = values.map(decimal);
  const scale = terms.reduce((maximum, term) => Math.max(maximum, term.scale), 0);
  const numerator = terms.reduce(
    (sum, term) => sum + term.coefficient * 10n ** BigInt(scale - term.scale),
    0n,
  );
  const denominator = BigInt(values.length) * 10n ** BigInt(scale);
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

/** Only independent grader observations count. Missing observations are never imputed. */
export function assessConstraints(
  constraints: readonly OutcomeConstraintSpec[],
  runs: readonly TaskRun[],
): ConstraintAssessment[] {
  return constraints.map((constraint) => {
    const satisfies = (value: number) =>
      constraint.operator === 'gte' ? value >= constraint.threshold : value <= constraint.threshold;
    const samples: ConstraintAssessment['samples'] = runs.map((run) => {
      const value = run.phase === 'scored' ? run.grade?.metrics[constraint.metric] : undefined;
      const available = typeof value === 'number' && Number.isFinite(value);
      return {
        run: run.id,
        task: run.task,
        repetition: run.repetition,
        value: available ? value : null,
        status: !available
          ? 'unavailable'
          : constraint.aggregation === 'mean'
            ? 'observed'
            : satisfies(value)
              ? 'passed'
              : 'violated',
        reason: available ? null : run.phase === 'scored' ? 'metric_missing' : `run_${run.phase}`,
      };
    });
    const observed = samples.filter((sample) => sample.value !== null).length;
    const complete = samples.length > 0 && observed === samples.length;
    const mean =
      constraint.aggregation === 'mean' && complete
        ? exactMean(samples.map((sample) => sample.value!))
        : null;
    const threshold = decimal(constraint.threshold);
    const left = mean ? mean.numerator * 10n ** BigInt(threshold.scale) : 0n;
    const right = mean ? threshold.coefficient * mean.denominator : 0n;
    const violated =
      constraint.aggregation === 'each'
        ? samples.some((sample) => sample.status === 'violated')
        : mean !== null && (constraint.operator === 'gte' ? left < right : left > right);
    return {
      constraint,
      status: violated ? 'violated' : complete ? 'passed' : 'unavailable',
      denominator: runs.length,
      observed,
      aggregate: mean
        ? { numerator: mean.numerator.toString(), denominator: mean.denominator.toString() }
        : null,
      samples,
    };
  });
}
