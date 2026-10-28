import { mkdir, chmod } from 'node:fs/promises';

/** The native workspace bind preserves this private, quota-bound tmpfs across tool processes.
 * DSH Bubblewrap creates a new /tmp per command, so HOME must not live below /tmp.
 */
export const runtimeEnvironment = Object.freeze({
  HOME: '/workspace/.harness-home',
  XDG_CONFIG_HOME: '/workspace/.harness-home/config',
  XDG_CACHE_HOME: '/workspace/.harness-home/cache',
  XDG_DATA_HOME: '/workspace/.harness-home/data',
  XDG_STATE_HOME: '/workspace/.harness-home/state',
  XDG_RUNTIME_DIR: '/workspace/.harness-home/run',
});

export async function initializeRuntimeEnvironment(): Promise<void> {
  for (const [key, directory] of Object.entries(runtimeEnvironment))
    if (process.env[key] !== directory) throw new Error(`Invalid managed runtime environment: ${key}`);
  for (const directory of Object.values(runtimeEnvironment)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
}
