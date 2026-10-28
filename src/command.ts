import { spawn } from 'node:child_process';

/** A bounded POSIX command owns its process group, including inherited-pipe descendants. */
export async function command(
  program: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('Command process-group ownership requires Linux or macOS');
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
    throw new Error('Command timeoutMs must be positive and within the Node timer range');
  options.signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
      detached: true,
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let failure: unknown;
    let groupStopped = false;
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    const stopGroup = () => {
      if (groupStopped || child.pid === undefined) return;
      groupStopped = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        // A group with no remaining members has already completed its lifecycle.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          clearControls();
          child.stdout.destroy();
          child.stderr.destroy();
          reject(new Error(`Could not terminate command process group ${child.pid}`, { cause: error }));
        }
      }
    };
    const abort = () => {
      failure = options.signal!.reason;
      clearControls();
      stopGroup();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      clearControls();
      stopGroup();
    }, timeoutMs);
    const clearControls = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      failure = error;
      clearControls();
      stopGroup();
    });
    child.once('exit', () => {
      clearControls();
      // A successful launcher must not leave package-manager or shell children behind.
      stopGroup();
    });
    child.once('close', (code, signal) => {
      clearControls();
      if (timedOut)
        reject(
          new Error(
            `${program} timed out after ${timeoutMs} ms: ${Buffer.concat(stdout).toString()}\n${Buffer.concat(stderr).toString()}`,
          ),
        );
      else if (failure !== undefined) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `${program} failed (${code ?? signal}): ${Buffer.concat(stdout).toString()}\n${Buffer.concat(stderr).toString()}`,
          ),
        );
      else resolve(Buffer.concat(stdout).toString().trim());
    });
  });
}
