/** Reserved broker capabilities; no dependency on host/controller implementation. */
export const studyPaths = [
  '/study/status',
  '/study/branch',
  '/study/submit',
  '/study/events',
  '/study/finish',
  '/study/search',
  '/study/evidence',
  '/study/materialize',
] as const;
