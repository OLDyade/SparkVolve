/** Generate an offline, read-only tour from the committed historical experiment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const check = process.argv.length === 3 && process.argv[2] === '--check';
assert.ok(process.argv.length === 2 || check, 'Usage: node scripts/render-tour.mjs [--check]');
const source = 'docs/evidence/2026-10-27-continuous-acceptance.json';
const report = 'docs/acceptance-continuous.md';
const sourceBytes = await readFile(new URL(source, root));
const reportBytes = await readFile(new URL(report, root));
const evidence = JSON.parse(sourceBytes.toString('utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rows = reportBytes
  .toString('utf8')
  .split('\n')
  .filter((line) => /^\| (Baseline `|`[a-f\d])/.test(line));
const candidates = evidence.search.candidates;
assert.equal(rows.length, candidates.length, 'Mechanism table must describe every recorded version');
assert.ok(candidates.length > 1);
const identities = new Map(candidates.map((candidate) => [candidate.digest, candidate]));
assert.equal(identities.size, candidates.length);
const mechanisms = rows.map((row, index) => {
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((s) => s.trim().replaceAll('`', ''));
  const candidate = candidates[index];
  assert.ok(cells[0].includes(candidate.digest.slice(0, 8)), 'Mechanism narrative identity mismatch');
  assert.equal(candidate.ordinal, index);
  assert.equal(candidate.denominator, candidate.runs.length);
  assert.ok(candidate.parents.every((id) => identities.has(id)));
  assert.ok(candidate.mean >= 0 && candidate.mean <= 1);
  return { description: cells[1], decision: cells[3] };
});
const validation = evidence.validation.comparison.results;
assert.deepEqual(
  validation.map((arm) => arm.id),
  ['baseline', 'candidate'],
);
for (const arm of validation) {
  assert.equal(
    arm.samples.length,
    evidence.validation.selection.tasks * evidence.validation.selection.repetitions,
  );
  assert.ok(
    Math.abs(arm.samples.reduce((sum, sample) => sum + sample.score, 0) / arm.samples.length - arm.mean) <
      1e-12,
  );
}
const payload = {
  evidence,
  mechanisms,
  sources: [
    { file: source, sha256: sha(sourceBytes) },
    { file: report, sha256: sha(reportBytes) },
  ],
};
// JSON in a non-executable script element must not terminate its HTML container.
const encoded = JSON.stringify(payload)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');
const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Let the Harness Evolve · A Real Experiment, Explained</title>
<style>
:root{--ink:#16223a;--muted:#4e617d;--blue:#3157c8;--bluewash:#edf1fc;--line:#d8e0ed;--rust:#a73e29;--paper:#fff;--soft:#f4f6fa;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--paper);font-size:16px;line-height:1.65}
*{box-sizing:border-box}body{margin:0}a{color:var(--blue);text-underline-offset:4px}a:hover{text-decoration-thickness:2px}button{font:inherit;cursor:pointer}button,a{touch-action:manipulation}:focus-visible{outline:3px solid var(--blue);outline-offset:4px}button:disabled{cursor:default;color:var(--muted)}h1,h2,h3,p{margin:0}h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.15;letter-spacing:-.035em;font-weight:760;text-wrap:balance}h2{font-size:clamp(1.45rem,3vw,2.05rem);line-height:1.3;letter-spacing:-.025em}h3{font-size:1.16rem}p{max-width:72ch}code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86em}.muted{color:var(--muted)}.rust{color:var(--rust)}.skip{position:absolute;left:1rem;top:-8rem;background:white;padding:1rem;z-index:4}.skip:focus{top:1rem}
header,main,footer{max-width:1240px;margin:auto;padding-inline:clamp(20px,5vw,64px)}header{padding-top:28px}.masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:28px;border-bottom:1px solid var(--line);font-size:.88rem}.masthead strong{font-size:.95rem}.masthead nav{display:flex;gap:20px;flex-wrap:wrap}.intro{padding:44px 0 36px;display:grid;grid-template-columns:1fr 280px;gap:32px;align-items:end}.slogan{margin-top:14px;color:var(--blue);font-size:clamp(1rem,2vw,1.4rem);font-weight:600}.intro p:last-child{margin-top:18px;color:var(--muted)}.intro aside{padding-left:24px;border-left:1px solid var(--line);font-size:.9rem}.intro aside p+p{margin-top:10px}.history{font-weight:650}.workflow{display:flex;list-style:none;padding:16px 0;margin:0;border-block:1px solid var(--line);gap:12px;align-items:center;flex-wrap:wrap;font-size:.92rem}.workflow li{display:flex;align-items:center;gap:12px}.workflow li+li:before{content:"→";color:var(--muted)}
section{padding-block:44px;border-bottom:1px solid var(--line)}.section-head{display:flex;gap:24px;justify-content:space-between;align-items:baseline;margin-bottom:24px}.section-head p{font-size:.92rem;color:var(--muted)}.search{display:grid;grid-template-columns:270px minmax(0,1fr);gap:40px}.lineage{display:flex;flex-direction:column;gap:4px;position:relative}.version{background:white;border:0;border-bottom:1px solid var(--line);text-align:left;padding:16px 14px;color:var(--ink);min-height:100px;display:grid;grid-template-columns:1fr auto;gap:4px 12px}.version[aria-pressed="true"]{background:var(--bluewash);color:var(--blue);border-bottom-color:var(--blue)}.version .name{font-weight:700}.version .score{font-variant-numeric:tabular-nums;font-weight:700}.version small{grid-column:1/-1;color:var(--muted);font-size:.78rem}.version .decision{grid-column:1/-1;font-size:.82rem}.selection{min-width:0}.selection-top{display:flex;justify-content:space-between;gap:20px;align-items:start;margin-bottom:18px}.selection-top h3{font-size:1.5rem}.decision-text{font-size:.9rem;font-weight:650;color:var(--rust)}.identity{overflow-wrap:anywhere;color:var(--muted);margin-top:5px;font-size:.75rem}.mechanism{font-size:1.06rem;min-height:3.3em;margin:18px 0}.facts{display:flex;gap:8px 24px;flex-wrap:wrap;font-size:.88rem;margin-bottom:20px}.facts dt{color:var(--muted)}.facts dd{margin:0}.facts>div{display:flex;gap:8px}.table-wrap{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;text-align:left;font-size:.88rem;white-space:nowrap}th{font-weight:600;color:var(--muted);font-size:.8rem;border-bottom:1px solid var(--line);padding:12px 12px 12px 0}td{padding:12px 12px 12px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}td:last-child,th:last-child{text-align:right;padding-right:0}.meter{display:flex;align-items:center;gap:14px}.track{height:7px;max-width:120px;min-width:50px;flex:1;background:#e8ecf3}.fill{height:100%;background:var(--blue);display:block}.number{min-width:70px;text-align:right}.note{font-size:.85rem;color:var(--muted);margin-top:18px}.usage{display:flex;gap:12px 30px;flex-wrap:wrap;padding:18px 0;font-size:.85rem}.usage b{display:block;font-size:1rem;font-weight:650;font-variant-numeric:tabular-nums}.usage span{color:var(--muted)}details{margin-top:14px}summary{cursor:pointer;font-size:.88rem;color:var(--blue);padding-block:8px}pre{background:var(--soft);padding:18px;max-height:420px;overflow:auto;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0}.cost{margin-top:28px;padding:22px 0 0;border-top:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between;gap:20px;flex-wrap:wrap}.cost p{font-size:.88rem}.cost strong{font-variant-numeric:tabular-nums}.cost .note{margin:0;flex-basis:100%}
.validation-summary{display:grid;grid-template-columns:1fr 1.7fr;gap:40px;align-items:start}.verdict{font-size:1.25rem;font-weight:650;margin-bottom:12px}.validation-summary>div>p{font-size:.92rem}.delta{font-variant-numeric:tabular-nums;font-size:1.6rem;font-weight:650;letter-spacing:-.025em;margin-top:14px}.delta small{font-size:.85rem;font-weight:400;letter-spacing:0;color:var(--muted);display:block}.validation-detail{margin-top:24px}.validation-detail .table-wrap{margin-top:12px}.validation-table .fill.candidate{background:var(--rust)}.archive{display:grid;grid-template-columns:1fr 1fr;gap:48px}.archive p{font-size:.93rem;margin-top:14px}.archive dl{margin:20px 0}.archive dt{font-size:.8rem;color:var(--muted);margin-top:14px}.archive dd{margin:4px 0 0;overflow-wrap:anywhere;font-size:.78rem}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.action{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;min-height:44px;text-decoration:none;border:1px solid var(--blue);background:white;color:var(--blue);font-size:.88rem;border-radius:4px}.action.primary{background:var(--blue);color:white}.action:hover{background:var(--bluewash);color:var(--blue)}footer{padding-block:28px 48px;color:var(--muted);font-size:.8rem}footer .sources{display:grid;gap:9px;margin-top:18px}footer code{overflow-wrap:anywhere;font-size:.9em}.noscript{margin:24px;padding:16px;background:#fff0e8}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:800px){.intro{grid-template-columns:1fr;padding-top:30px;gap:24px}.intro aside{padding:16px 0 0;border-left:0;border-top:1px solid var(--line)}.search{grid-template-columns:1fr;gap:28px}.lineage{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.version{min-height:104px;padding:14px 12px}.validation-summary,.archive{grid-template-columns:1fr;gap:24px}.section-head{display:block}.section-head p{margin-top:10px}section{padding-block:34px}.mechanism{min-height:0}.selection-top{gap:10px}.masthead{align-items:start}.masthead nav{gap:8px 16px}.masthead nav a:last-child{display:none}.workflow{font-size:.8rem;gap:8px}.workflow li{gap:8px}.cost{margin-top:22px}}
@media(prefers-reduced-motion:no-preference){.selection{animation:appear .2s ease-out}@keyframes appear{from{opacity:.8;transform:translateY(3px)}to{opacity:1;transform:none}}} @media print{button,.actions,.skip{display:none}.search{grid-template-columns:1fr}.lineage{display:none}details>pre{max-height:none}.table-wrap{overflow:visible}section{break-inside:avoid}header,main,footer{max-width:none;padding-inline:0}}
</style>
</head>
<body>
<!-- THESIS: Read one real evolution attempt through its lineage, decisions and independent validation; no fabricated interactive run.
OWN-WORLD: Existing evidence-chart language: white paper, navy text, blue baseline/selection, gray alternatives, rust negative outcomes.
STORY: Select a version, inspect its mechanism and task evidence, compare independent arms, then enter the real installation/run documentation.
FIRST VIEWPORT: Project title and preserved slogan; historical boundary at right; actual lineage beside the selected candidate's task records.
FORM: Narrow, explicitly specified extension of the project's existing evidence graphics; no new visual-world selection.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
Local built-world record: tour.design.md. -->
<a href="#experiment" class="skip">Skip to the experiment</a>
<header>
 <div class="masthead"><strong>Harness Evolution</strong><nav aria-label="Documentation"><a href="../README.md">Project home</a><a href="acceptance-continuous.md">Full experiment report</a><a href="components.md">Architecture</a></nav></div>
 <div class="intro"><div><h1>Let the Harness Evolve</h1><p class="slogan">Evolve the Harness, Not the Model.</p><p>Follow a real search: inspect plugin changes, test them against tasks, and see how capabilities become reusable research assets.</p></div><aside><p class="history">Historical experiment replay · <time id="date"></time></p><p>Read offline, without an API key or model calls. This run used public synthetic Excel tasks and did not establish a stable accuracy improvement.</p><a href="#validation">Jump to independent validation</a></aside></div>
 <ol class="workflow" aria-label="Experiment workflow"><li>Seed capability</li><li>Autonomous mutation</li><li>Task grading and selection</li><li>Independent validation</li><li>Archive and reuse</li></ol>
</header>
<main>
 <section id="experiment" aria-labelledby="search-title"><div class="section-head"><h2 id="search-title">One search. Every version retained.</h2><p id="search-context"></p></div><div class="search"><nav class="lineage" id="lineage" aria-label="Select a candidate"></nav><div class="selection" id="selection" role="region" aria-label="Selected candidate evidence"><div class="selection-top"><div><h3 id="candidate-title"></h3><p class="identity mono" id="candidate-identity"></p></div><p id="candidate-decision" class="decision-text"></p></div><p class="mechanism" id="mechanism"></p><dl class="facts" id="facts"></dl><div class="table-wrap" tabindex="0" aria-label="Task scores; scroll horizontally"><table><thead><tr><th scope="col">Task</th><th scope="col">Full task score</th><th scope="col">Non-target preservation</th></tr></thead><tbody id="task-rows"></tbody></table></div><div class="usage" id="usage"></div><p class="note">Preservation was a reporting metric in this historical contract, not a retrospective promotion gate. Declared mutation actions do not establish actual structural changes.</p><details><summary>Inspect the original candidate record</summary><pre id="candidate-raw"></pre></details><p class="sr-only" id="selected-status" role="status" aria-live="polite"></p></div></div><div class="cost"><p>Optimizer usage, accounted separately <strong id="optimizer-calls"></strong></p><p id="optimizer-tokens"></p><p class="note">Tool implementations, Schemas, and prompt contributions changed; cordis.patch did not. This run does not establish topology-search benefits. Calls count DSH adapter streams; provider-internal retries are not inferred.</p></div></section>
 <section id="validation" aria-labelledby="validation-title"><div class="section-head"><h2 id="validation-title">Independent validation on new tasks</h2><p id="validation-context"></p></div><div class="validation-summary"><div><p class="verdict rust" id="validation-verdict"></p><p id="selection-rule"></p><p class="delta rust" id="validation-delta"></p></div><div><div class="table-wrap" tabindex="0" aria-label="Independent validation summary; scroll horizontally"><table class="validation-table"><thead><tr><th scope="col">Arms</th><th scope="col">Mean</th><th scope="col">Scored</th><th scope="col">Execution failed</th><th scope="col">Cancelled</th></tr></thead><tbody id="validation-rows"></tbody></table></div><p class="note" id="failure-context"></p><p class="note">The denominator includes every registered task. Business performance, model variability, and transport failures all affect these results; the entire mean difference cannot be attributed to plugin quality.</p></div></div><details class="validation-detail"><summary>Task-by-task, repetition-by-repetition comparison · including failures and cancellations</summary><div class="table-wrap" tabindex="0" aria-label="Paired validation samples; scroll horizontally"><table><thead><tr><th scope="col">Task / Repetition</th><th scope="col">Baseline</th><th scope="col">Mutation</th><th scope="col">Candidate status</th><th scope="col">Delta</th></tr></thead><tbody id="paired-rows"></tbody></table></div></details></section>
 <section class="archive" aria-labelledby="archive-title"><div><h2 id="archive-title">Keep the capabilities. Keep the evidence.</h2><p>Non-promoted candidates can be exported as research assets for inspection and further mutation. Imports preserve byte identity; historical scores do not enter new selection decisions.</p><dl><dt>Archived candidate</dt><dd class="mono" id="archive-candidate"></dd><dt>Package SHA256</dt><dd class="mono" id="archive-package"></dd><dt>Research archive SHA256</dt><dd class="mono" id="archive-record"></dd></dl><p class="note" id="archive-result"></p></div><div><h3>From understanding to hands-on use</h3><p>This replay presents completed historical evidence. Configure a model and follow the documented commands to evolve with your own tasks and evaluation contract. Capability installation can be tried independently.</p><div class="actions"><a class="action primary" href="user-journey.md">Run real evolution</a><a class="action" href="use-capability.md">Install a capability</a><button class="action" type="button" id="download">Download experiment JSON</button></div><p class="note">This page does not offer an unverified best-plugin download. Historical non-promoted packages are not recommended defaults.</p><details><summary>Model and runtime identity</summary><pre id="runtime"></pre></details></div></section>
</main>
<footer><p>Generated from repository records and the experiment report. Dates refer to the historical run. For current engineering status, see <a href="completion.md">implementation status</a>.</p><p>Regenerate: <code>node scripts/render-tour.mjs</code>.The entire page works offline. Keep the repository layout intact when following documentation links.</p><div class="sources" id="sources"></div></footer>
<noscript><p class="noscript">Enable JavaScript for the interactive tour. You can also read the <a href="acceptance-continuous.md">Full experiment report</a> or <a href="evidence/2026-10-27-continuous-acceptance.json">original machine record</a>.</p></noscript>
<script id="experiment-data" type="application/json">${encoded}</script>
<script>
'use strict';
const {evidence:d,mechanisms,sources}=JSON.parse(document.getElementById('experiment-data').textContent);
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
const percent=value=>new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:3}).format(value);
const number=value=>new Intl.NumberFormat('en-US').format(value);
const label=c=>c.ordinal===0?'Baseline':'Mutation '+c.ordinal;
const byID=new Map(d.search.candidates.map(c=>[c.digest,c]));
const actions={enable:'Enable',disable:'Disable',tune:'Tune',swap:'Replace',compose:'Compose',author:'Author'};
const phases={scored:'Scored',execution_failed:'Execution failed',cancelled:'Cancelled'};
const deltaText=value=>(value>0?'+':'')+new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(value*100)+' pp';
function scoreCell(value,kind=''){const cell=el('td');const meter=el('div',undefined,'meter');const track=el('span',undefined,'track');track.setAttribute('aria-hidden','true');const fill=el('span',undefined,'fill '+kind);fill.style.width=(value*100)+'%';track.append(fill);meter.append(track,el('span',percent(value),'number'));cell.append(meter);return cell;}
$('date').textContent=d.date;$('date').dateTime=d.date;
$('search-context').textContent=d.search.candidates.length+' versions · '+d.search.candidates[0].denominator+' tasks per version · one frozen contract';
const buttons=d.search.candidates.map((c,index)=>{const b=el('button',undefined,'version');b.type='button';b.setAttribute('aria-controls','selection');b.setAttribute('aria-pressed','false');b.append(el('span',label(c),'name'),el('span',percent(c.mean),'score'),el('small',c.parents.length?'Parents: '+c.parents.map(id=>label(byID.get(id))).join(' / '):'Researcher-provided seed capability'),el('span',mechanisms[index].decision,'decision'));b.addEventListener('click',()=>select(index));b.addEventListener('keydown',event=>{let next;if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();buttons[next].focus();select(next);}});$('lineage').append(b);return b;});
function select(index){const c=d.search.candidates[index];buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));$('candidate-title').textContent=label(c);$('candidate-identity').textContent=c.digest;$('candidate-decision').textContent=mechanisms[index].decision;$('mechanism').textContent=mechanisms[index].description;$('facts').replaceChildren();for(const [key,value]of [['Declared actions',c.actions.map(a=>{if(!(a in actions))throw Error('Unknown recorded mutation action');return actions[a];}).join(' / ')],['Scored tasks',c.runs.filter(r=>r.phase==='scored').length+' / '+c.denominator],['Execution failed',c.failures]]){const div=el('div');div.append(el('dt',key),el('dd',value));$('facts').append(div);}$('task-rows').replaceChildren();for(const r of c.runs){const row=el('tr');row.append(el('td',r.task,'mono'),scoreCell(r.score),el('td',percent(r.metrics.preserved)));$('task-rows').append(row);}$('usage').replaceChildren();for(const [key,value]of [['Executor requests started',c.usage.started],['Reported input tokens',c.usage.inputTokensReported],['Reported output tokens',c.usage.outputTokensReported]]){const item=el('div');item.append(el('b',number(value)),el('span',key));$('usage').append(item);}$('candidate-raw').textContent=JSON.stringify(c,null,2);$('selected-status').textContent='Selected '+label(c)+', '+mechanisms[index].decision+', mean '+percent(c.mean);}
select(0);
$('optimizer-calls').textContent=number(d.search.optimizerUsage.started)+' requests · '+number(d.search.summary.consumedSeconds)+' seconds';
$('optimizer-tokens').textContent='Reported input '+number(d.search.optimizerUsage.inputTokensReported)+' / output '+number(d.search.optimizerUsage.outputTokensReported)+' tokens';
const selection=d.validation.selection,arms=d.validation.comparison.results,comparison=d.validation.comparison.comparisons[0];
$('validation-context').textContent=selection.tasks+' new synthetic task families × '+selection.repetitions+' repetitions × '+arms.length+' arms';
$('validation-verdict').textContent=comparison.strictImprovement?'The full-denominator mean improved':'No strict improvement';
$('selection-rule').textContent='The predeclared rule selects the completed mutation with the highest search score, choosing the earliest on ties: '+label(byID.get(selection.candidate))+'.The frozen baseline and candidate run separately on new tasks; validation feedback is withheld from the optimizer.';
$('validation-delta').append(el('span',deltaText(comparison.meanDelta)),el('small','Candidate mean − Baseline mean'));
for(const arm of arms){const count=phase=>arm.samples.filter(s=>s.phase===phase).length;const row=el('tr');row.append(el('td',arm.id==='baseline'?'Baseline':label(byID.get(arm.candidate))),scoreCell(arm.mean,arm.id),el('td',count('scored')+' / '+arm.samples.length),el('td',count('execution_failed')),el('td',count('cancelled')));$('validation-rows').append(row);}
$('failure-context').textContent=d.validation.executionFailure;
const samples=new Map(arms[1].samples.map(s=>[JSON.stringify([s.task,s.repetition]),s]));
for(const baseline of arms[0].samples){const candidate=samples.get(JSON.stringify([baseline.task,baseline.repetition]));if(!candidate)throw Error('Missing paired record');const row=el('tr');row.append(el('td',baseline.task+' / '+(baseline.repetition+1),'mono'),el('td',percent(baseline.score)),el('td',percent(candidate.score)),el('td',phases[candidate.phase]),el('td',deltaText(candidate.score-baseline.score)));$('paired-rows').append(row);}
$('archive-candidate').textContent=d.archive.candidate;$('archive-package').textContent=d.archive.packageSha256;$('archive-record').textContent=d.archive.recordSha256;
if(d.archive.candidate!==d.archive.importedDigest)throw Error('Archive and import identities differ');
$('archive-result').textContent='Imported source identity matches; inherited historical scores:  '+d.archive.importedScores+' .';
$('runtime').textContent=JSON.stringify({date:d.date,model:d.model,runtime:d.runtime,optimizerHarness:d.optimizerHarness},null,2);
for(const source of sources){const item=el('div');const a=el('a',source.file);a.href=source.file.slice(5);item.append(a,el('br'),el('code','SHA256 '+source.sha256));$('sources').append(item);}
$('download').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(d,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='2026-10-27-continuous-acceptance.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
</script>
</body>
</html>
`;
const output = new URL('docs/tour.html', root);
if (check) {
  assert.equal(await readFile(output, 'utf8'), html, 'Tour is stale: run node scripts/render-tour.mjs');
} else {
  await writeFile(output, html);
}
console.log(
  JSON.stringify({
    output: fileURLToPath(output),
    sources: payload.sources,
    candidates: candidates.length,
    validationSamples: validation.reduce((sum, arm) => sum + arm.samples.length, 0),
    networkRequests: false,
    modelCalls: false,
  }),
);
