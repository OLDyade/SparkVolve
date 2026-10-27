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
  .filter((line) => /^\| (基线 `|`[a-f\d])/.test(line));
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
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>让 Harness 自己进化 · 真实实验导览</title>
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
<a href="#experiment" class="skip">跳到实验记录</a>
<header>
 <div class="masthead"><strong>Harness Evolution</strong><nav aria-label="文档导航"><a href="../README.md">项目首页</a><a href="acceptance-continuous.md">完整实验报告</a><a href="components.md">技术架构</a></nav></div>
 <div class="intro"><div><h1>让 Harness 自己进化</h1><p class="slogan">Evolve the Harness, Not the Model.</p><p>跟随一次真实搜索，看插件如何被改写，改动如何接受任务检验，以及实验能力如何留下可复用的研究档案。</p></div><aside><p class="history">历史实验回放 · <time id="date"></time></p><p>离线阅读，无需密钥，不启动模型。使用公开合成 Excel 任务；本轮没有证明稳定正确率提升。</p><a href="#validation">直接查看独立复验</a></aside></div>
 <ol class="workflow" aria-label="实验流程"><li>原始能力</li><li>自主变异</li><li>任务评分与裁决</li><li>独立复验</li><li>归档与复用</li></ol>
</header>
<main>
 <section id="experiment" aria-labelledby="search-title"><div class="section-head"><h2 id="search-title">一次搜索，完整保留每个版本</h2><p id="search-context"></p></div><div class="search"><nav class="lineage" id="lineage" aria-label="选择候选版本"></nav><div class="selection" id="selection" role="region" aria-label="所选候选证据"><div class="selection-top"><div><h3 id="candidate-title"></h3><p class="identity mono" id="candidate-identity"></p></div><p id="candidate-decision" class="decision-text"></p></div><p class="mechanism" id="mechanism"></p><dl class="facts" id="facts"></dl><div class="table-wrap" tabindex="0" aria-label="逐题评分，可横向滚动"><table><thead><tr><th scope="col">任务</th><th scope="col">完整任务得分</th><th scope="col">非目标保留率</th></tr></thead><tbody id="task-rows"></tbody></table></div><div class="usage" id="usage"></div><p class="note">保留率是该历史合同的报告项；其分数没有被追加为事后晋级门槛。声明的变异动作不等于已证实的结构变更。</p><details><summary>展开所选版本的原始机器记录</summary><pre id="candidate-raw"></pre></details><p class="sr-only" id="selected-status" role="status" aria-live="polite"></p></div></div><div class="cost"><p>优化器独立记账 <strong id="optimizer-calls"></strong></p><p id="optimizer-tokens"></p><p class="note">工具实现、Schema 与提示贡献发生变化；本轮 cordis.patch 未变，不用于证明拓扑搜索收益。调用单位为 DSH adapter stream，供应商内部重试不另作推算。</p></div></section>
 <section id="validation" aria-labelledby="validation-title"><div class="section-head"><h2 id="validation-title">独立复验，让结论接受新任务检验</h2><p id="validation-context"></p></div><div class="validation-summary"><div><p class="verdict rust" id="validation-verdict"></p><p id="selection-rule"></p><p class="delta rust" id="validation-delta"></p></div><div><div class="table-wrap" tabindex="0" aria-label="独立复验汇总，可横向滚动"><table class="validation-table"><thead><tr><th scope="col">组</th><th scope="col">均值</th><th scope="col">评分</th><th scope="col">执行失败</th><th scope="col">取消</th></tr></thead><tbody id="validation-rows"></tbody></table></div><p class="note" id="failure-context"></p><p class="note">分母包含全部登记任务。业务表现、模型随机性与通信故障共同影响本轮结果；不能把均值差全归因于插件质量。</p></div></div><details class="validation-detail"><summary>逐题、逐次对照 · 包括失败与取消</summary><div class="table-wrap" tabindex="0" aria-label="逐次复验对照，可横向滚动"><table><thead><tr><th scope="col">任务 / 重复</th><th scope="col">基线</th><th scope="col">变异</th><th scope="col">变异状态</th><th scope="col">差值</th></tr></thead><tbody id="paired-rows"></tbody></table></div></details></section>
 <section class="archive" aria-labelledby="archive-title"><div><h2 id="archive-title">实验结束，能力与证据留下来</h2><p>未晋级候选可作为研究资产导出，供下一实验检查和再变异。导入保留字节身份，旧成绩不会进入新实验裁决。</p><dl><dt>归档候选</dt><dd class="mono" id="archive-candidate"></dd><dt>包 SHA256</dt><dd class="mono" id="archive-package"></dd><dt>研究档案 SHA256</dt><dd class="mono" id="archive-record"></dd></dl><p class="note" id="archive-result"></p></div><div><h3>从理解机制，到实际使用</h3><p>回放呈现已完成的历史证据。配置模型并执行公开命令，即可用自己的任务和评测合同启动真实进化；安装能力的流程可单独体验。</p><div class="actions"><a class="action primary" href="user-journey.md">启动真实进化</a><a class="action" href="use-capability.md">安装与使用能力</a><button class="action" type="button" id="download">下载原始实验 JSON</button></div><p class="note">本页不提供未经验证的“最佳插件”下载。历史未晋级包不作为推荐默认能力。</p><details><summary>模型与运行身份</summary><pre id="runtime"></pre></details></div></section>
</main>
<footer><p>由仓库内机器记录与实验报告生成。日期指历史实验；工程能力的最新状态见 <a href="completion.md">落实状态</a>。</p><p>重新生成：<code>node scripts/render-tour.mjs</code>。整个页面可离线打开；点击文档链接时需保留仓库的相对目录。</p><div class="sources" id="sources"></div></footer>
<noscript><p class="noscript">交互导览需要启用 JavaScript。仍可直接阅读 <a href="acceptance-continuous.md">完整实验报告</a> 或 <a href="evidence/2026-10-27-continuous-acceptance.json">原始机器记录</a>。</p></noscript>
<script id="experiment-data" type="application/json">${encoded}</script>
<script>
'use strict';
const {evidence:d,mechanisms,sources}=JSON.parse(document.getElementById('experiment-data').textContent);
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
const percent=value=>new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:3}).format(value);
const number=value=>new Intl.NumberFormat('en-US').format(value);
const label=c=>c.ordinal===0?'基线':'变异 '+c.ordinal;
const byID=new Map(d.search.candidates.map(c=>[c.digest,c]));
const actions={enable:'启用',disable:'停用',tune:'调优',swap:'替换',compose:'组合',author:'创造'};
const phases={scored:'已评分',execution_failed:'执行失败',cancelled:'取消'};
const deltaText=value=>(value>0?'+':'')+new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(value*100)+' pp';
function scoreCell(value,kind=''){const cell=el('td');const meter=el('div',undefined,'meter');const track=el('span',undefined,'track');track.setAttribute('aria-hidden','true');const fill=el('span',undefined,'fill '+kind);fill.style.width=(value*100)+'%';track.append(fill);meter.append(track,el('span',percent(value),'number'));cell.append(meter);return cell;}
$('date').textContent=d.date;$('date').dateTime=d.date;
$('search-context').textContent=d.search.candidates.length+' 个版本 · 每版 '+d.search.candidates[0].denominator+' 题 · 同一冻结合同';
const buttons=d.search.candidates.map((c,index)=>{const b=el('button',undefined,'version');b.type='button';b.setAttribute('aria-controls','selection');b.setAttribute('aria-pressed','false');b.append(el('span',label(c),'name'),el('span',percent(c.mean),'score'),el('small',c.parents.length?'父版本：'+c.parents.map(id=>label(byID.get(id))).join(' / '):'研究者提供的初始能力'),el('span',mechanisms[index].decision,'decision'));b.addEventListener('click',()=>select(index));b.addEventListener('keydown',event=>{let next;if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();buttons[next].focus();select(next);}});$('lineage').append(b);return b;});
function select(index){const c=d.search.candidates[index];buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));$('candidate-title').textContent=label(c);$('candidate-identity').textContent=c.digest;$('candidate-decision').textContent=mechanisms[index].decision;$('mechanism').textContent=mechanisms[index].description;$('facts').replaceChildren();for(const [key,value]of [['声明动作',c.actions.map(a=>{if(!(a in actions))throw Error('Unknown recorded mutation action');return actions[a];}).join(' / ')],['评分完成',c.runs.filter(r=>r.phase==='scored').length+' / '+c.denominator],['执行失败',c.failures]]){const div=el('div');div.append(el('dt',key),el('dd',value));$('facts').append(div);}$('task-rows').replaceChildren();for(const r of c.runs){const row=el('tr');row.append(el('td',r.task,'mono'),scoreCell(r.score),el('td',percent(r.metrics.preserved)));$('task-rows').append(row);}$('usage').replaceChildren();for(const [key,value]of [['执行器请求开始',c.usage.started],['报告输入 tokens',c.usage.inputTokensReported],['报告输出 tokens',c.usage.outputTokensReported]]){const item=el('div');item.append(el('b',number(value)),el('span',key));$('usage').append(item);}$('candidate-raw').textContent=JSON.stringify(c,null,2);$('selected-status').textContent='已选择'+label(c)+'，'+mechanisms[index].decision+'，均值'+percent(c.mean);}
select(0);
$('optimizer-calls').textContent=number(d.search.optimizerUsage.started)+' 次请求 · '+number(d.search.summary.consumedSeconds)+' 秒';
$('optimizer-tokens').textContent='报告输入 '+number(d.search.optimizerUsage.inputTokensReported)+' / 输出 '+number(d.search.optimizerUsage.outputTokensReported)+' tokens';
const selection=d.validation.selection,arms=d.validation.comparison.results,comparison=d.validation.comparison.comparisons[0];
$('validation-context').textContent=selection.tasks+' 类新合成任务 × '+selection.repetitions+' 次重复 × '+arms.length+' 组';
$('validation-verdict').textContent=comparison.strictImprovement?'完整分母均值提高':'没有达到严格提高';
$('selection-rule').textContent='按已完成变异中搜索分最高、同分取最早的预定规则，选出'+label(byID.get(selection.candidate))+'。冻结基线与候选在新任务上分别执行，反馈没有返回优化器。';
$('validation-delta').append(el('span',deltaText(comparison.meanDelta)),el('small','候选均值 − 基线均值'));
for(const arm of arms){const count=phase=>arm.samples.filter(s=>s.phase===phase).length;const row=el('tr');row.append(el('td',arm.id==='baseline'?'基线':label(byID.get(arm.candidate))),scoreCell(arm.mean,arm.id),el('td',count('scored')+' / '+arm.samples.length),el('td',count('execution_failed')),el('td',count('cancelled')));$('validation-rows').append(row);}
$('failure-context').textContent=d.validation.executionFailure;
const samples=new Map(arms[1].samples.map(s=>[JSON.stringify([s.task,s.repetition]),s]));
for(const baseline of arms[0].samples){const candidate=samples.get(JSON.stringify([baseline.task,baseline.repetition]));if(!candidate)throw Error('Missing paired record');const row=el('tr');row.append(el('td',baseline.task+' / '+(baseline.repetition+1),'mono'),el('td',percent(baseline.score)),el('td',percent(candidate.score)),el('td',phases[candidate.phase]),el('td',deltaText(candidate.score-baseline.score)));$('paired-rows').append(row);}
$('archive-candidate').textContent=d.archive.candidate;$('archive-package').textContent=d.archive.packageSha256;$('archive-record').textContent=d.archive.recordSha256;
if(d.archive.candidate!==d.archive.importedDigest)throw Error('Archive and import identities differ');
$('archive-result').textContent='导入后源码身份一致；继承旧成绩 '+d.archive.importedScores+' 项。';
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
