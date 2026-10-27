import isNumber from 'is-number';

export function numeric(value: unknown): boolean {
  return isNumber(value);
}
