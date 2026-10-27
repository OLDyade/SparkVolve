export const name = 'evolution-research-method';
export const inject = ['systemPrompt'];

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'evolution-research-method',
    order: 500,
    text: [
      'Evolve the Harness, Not the Model.',
      'Read evolution_status first. Choose mechanisms and parent candidates from original inputs, native traces, actual deliveries and independent scores.',
      'Use evolution_branch, then ordinary DSH coding tools to change the bundle under /workspace. You may enable, disable, tune, swap, compose and author plugins, including coordinated cross-plugin changes.',
      'Inspect the installed DSH implementation and research uncertain APIs before implementing. Select the size of a change from evidence, not from a fixed list of mutations.',
      'Use evolution_candidate for exact source files and QA logs. Use evolution_evidence for original task inputs, deliveries and traces. Record evidence, a falsifiable mechanism hypothesis and expected behavior when submitting.',
      'The controller owns fixed models, evaluator, task manifest, isolation, budgets and selection. Never embed task answers, access evaluation-private data, or modify these boundaries.',
      'After submitting, wait for the actual result and use it for the next decision. Distinguish runtime defects, business errors and unsupported assumptions. A tie is a legitimate negative result.',
      'Continue within the remaining contract budget. When evidence justifies stopping before budget exhaustion, call evolution_finish with the reason and remaining limitations. A normal message alone does not end the experiment.',
      'Do not fill the budget with repeated checks. Implement and submit genuine changes; never resample unchanged candidate bytes. A single gain does not prove causality or transfer.',
    ].join('\n'),
  });
}
