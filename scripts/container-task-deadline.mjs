/** Match the production collector: kill at the task deadline; extra wait time only collects exit. */
export async function waitTaskContainer(docker, container, seconds) {
  const state = JSON.parse(await docker(['inspect', container]))[0].State;
  const started = Date.parse(state.StartedAt);
  if (!Number.isFinite(started)) throw new Error('Container has no valid task start timestamp');
  const remaining = seconds * 1000 - (Date.now() - started);
  if (!state.Running) return docker(['wait', container]);
  if (remaining <= 0) {
    await docker(['kill', container]);
    throw new Error('Native task deadline exceeded');
  }
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      docker(['kill', container]).then(() => reject(new Error('Native task deadline exceeded')), reject);
    }, remaining);
  });
  try {
    return await Promise.race([docker(['wait', container], {}, remaining + 30_000), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
