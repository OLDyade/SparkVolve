import { lstatSync } from 'node:fs';
import path from 'node:path';

/** Opening the trusted cancellation ledger permanently closes admission for this attempt. */
export function assertNotCancelled(root: string): void {
  try {
    lstatSync(path.join(root, 'cancellation.sqlite'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Experiment cancellation has started; new work is forbidden');
}
