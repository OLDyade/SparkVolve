import { mkdir, chmod } from 'node:fs/promises';

/** Writable inside the native workspace-write sandbox and separately quota-bound by Docker. */
export const runtimeEnvironment = Object.freeze({
  HOME: '/tmp/evolution-home',
  XDG_CONFIG_HOME: '/tmp/evolution-home/config',
  XDG_CACHE_HOME: '/tmp/evolution-home/cache',
  XDG_DATA_HOME: '/tmp/evolution-home/data',
  XDG_STATE_HOME: '/tmp/evolution-home/state',
  XDG_RUNTIME_DIR: '/tmp/evolution-home/run',
});

export async function initializeRuntimeEnvironment(): Promise<void> {
  for (const [key, directory] of Object.entries(runtimeEnvironment))
    if (process.env[key] !== directory) throw new Error(`Invalid managed runtime environment: ${key}`);
  for (const directory of Object.values(runtimeEnvironment)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
}
