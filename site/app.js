const evidence = JSON.parse(document.getElementById('case-data').textContent);
const percentage = (value) => `${Number((value * 100).toFixed(2))}%`;
const phases = {
  search: {
    title: 'Search',
    note: 'Three versions, twelve scored executions. Selection uses this phase only.',
    arms: evidence.search,
  },
  validation: {
    title: 'Independent validation',
    note: 'Fresh H0 and H2 executions; eight scored tasks. These scores do not select or modify the candidate.',
    arms: evidence.validation,
  },
  reuse: {
    title: 'Original-package reuse',
    note: 'Four clean Profiles, four fresh executions. The installed archive and file hashes match the selected candidate.',
    arms: [evidence.reuse],
  },
};
const table = document.getElementById('scores');
const cell = (row, tag, text, scope) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (scope) element.scope = scope;
  row.append(element);
};
for (const input of document.querySelectorAll('input[name="phase"]')) {
  input.addEventListener('change', () => {
    const phase = phases[input.value];
    document.getElementById('phase-note').textContent = phase.note;
    table.replaceChildren();
    table.createCaption().textContent = `${phase.title} · per-task formula-value accuracy`;
    const header = table.createTHead().insertRow();
    cell(header, 'th', 'Task', 'col');
    phase.arms.forEach((arm) => cell(header, 'th', arm.label, 'col'));
    const body = table.createTBody();
    evidence.tasks.forEach((task) => {
      const row = body.insertRow();
      cell(row, 'th', task, 'row');
      phase.arms.forEach((arm) =>
        cell(row, 'td', percentage(arm.samples.find((item) => item.task === task).score)),
      );
    });
    const footer = table.createTFoot().insertRow();
    cell(footer, 'th', 'Mean · full denominator', 'row');
    phase.arms.forEach((arm) => cell(footer, 'td', percentage(arm.mean)));
  });
}
