import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Experiment } from '../dist/contracts.js';
import { Controller } from '../dist/controller.js';
import { Store } from '../dist/store.js';
import { treeDigest } from '../dist/artifacts.js';
import { containerSpecification } from '../tests/fixtures.ts';
import { configureEgress } from '../examples/venus/egress.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
assert.ok(process.argv[2], 'Provide a NEW evidence directory');
assert.ok(process.env.VENUS_API_KEY, 'Trusted launcher requires VENUS_API_KEY');
assert.match(process.env.HE_TEST_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/);
const root = path.resolve(process.argv[2]), dataset = path.join(root, 'dataset');
await mkdir(root);
for (const dir of ['dataset/input', 'dataset/private', 'seed']) await mkdir(path.join(root, dir), { recursive: true });
await cp(path.join(repo, 'examples/venus'), path.join(dataset, 'runtime'), { recursive: true });
const model = JSON.parse(await readFile(path.join(repo, 'examples/venus/model.json'), 'utf8'));
model.maxTokens = 1024;
const egress = await configureEgress(path.join(dataset, 'runtime'), model);
await writeFile(path.join(dataset, 'input/request.json'), JSON.stringify({ from: 0, to: 10 }));
await writeFile(path.join(dataset, 'private/grade.mjs'), `
import {readFile,writeFile} from 'node:fs/promises';
const result=JSON.parse(await readFile('/delivery/result.json','utf8'));
await writeFile('/workspace/result.json',JSON.stringify({score:Number(result.sum===55),metrics:{},feedback:'Independent arithmetic delivery check'}));
`);
const packageJSON = { name: '@harness-evolution/native-network-acceptance', version: '1.0.0', type: 'module',
  scripts:{build:'node --check index.mjs'}, files: ['cordis.patch.yml','index.mjs'], dsh: { bundle: { patch: './cordis.patch.yml' } } };
await writeFile(path.join(root,'seed/index.mjs'),'export function apply() {}\n');
await writeFile(path.join(root, 'seed/package.json'), JSON.stringify(packageJSON));
await writeFile(path.join(root, 'seed/package-lock.json'), JSON.stringify({ name: packageJSON.name, version:'1.0.0',
  lockfileVersion:3, packages:{'':{name:packageJSON.name,version:'1.0.0'}} }));
await writeFile(path.join(root, 'seed/cordis.patch.yml'), '[]\n');
const defaults = containerSpecification();
defaults.isolation.network.executor = 'controlled';
const image = process.env.HE_TEST_IMAGE;
const spec = Experiment.parse({ ...defaults, name:'controlled-native-acceptance', egress,
  runtime:{image,dshVersion:'0.2.1-rc.4',profile:'sdk',environment:{directory:'runtime',patch:'cordis.patch.yml',
    digest:await treeDigest(path.join(dataset,'runtime'))}},
  executor:model, optimizer:model,
  candidate:{patch:'cordis.patch.yml',build:{image,timeoutSeconds:60},qa:null},
  evaluator:{image,command:['node','/evaluation/grade.mjs'],timeoutSeconds:30},
  tasks:[{id:'arithmetic',prompt:'Read /input/request.json. Use your bash tool to calculate the inclusive integer sum from from to to using Python. Write JSON {"sum": value} to /workspace/result.json and finish.',
    input:'input',inputDigest:await treeDigest(path.join(dataset,'input')),
    evaluation:'private',evaluationDigest:await treeDigest(path.join(dataset,'private'))}],
  concurrency:1, repetitions:1, failureLimit:0, timeoutSeconds:120 });
await writeFile(path.join(root,'experiment.json'),JSON.stringify(spec,null,2));
const store = new Store(path.join(root,'experiment.sqlite'),spec);
let controller = new Controller(root,dataset,spec,store);
const receipt = {passed:false,image,startedAt:new Date().toISOString()};
try {
  await controller.start();
  const candidate = await controller.seed(path.join(root,'seed'));
  const abort = new AbortController();
  const pumping = controller.pump(abort.signal);
  let pumpDone=false;
  const observedPump=pumping.then(()=>{pumpDone=true;return null;},error=>{pumpDone=true;return error;});
  const deadline=Date.now()+60000;
  let workerID,brokerID;
  while (!pumpDone) {
    const run=store.runs(candidate.digest)[0];
    if(run?.phase==='executing' && (await controller.docker.inspect(run.container))?.Running){
      workerID=(await controller.docker.configuration(run.container)).Id;
      const intent=JSON.parse(await readFile(path.join(root,'runs',run.id,'egress/intent.json'),'utf8'));
      brokerID=(await controller.docker.configuration(intent.broker)).Id;
      break;
    }
    if(Date.now()>deadline) throw Error('No running executor before recovery deadline');
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  if (!workerID || !brokerID) {
    const failure=await observedPump;
    throw Error(`No running worker before interruption: ${failure ?? JSON.stringify(store.candidate(candidate.digest))}`);
  }
  abort.abort(Error('acceptance controller interruption'));
  assert.ok(await observedPump, 'Controller wait must observe interruption');
  await controller.close();
  controller=new Controller(root,dataset,spec,store);
  await controller.start();
  await controller.pump();
  const run=store.runs(candidate.digest)[0];
  assert.equal(run.phase,'scored',run.error);
  assert.equal(run.grade.score,1);
  const runRoot=path.join(root,'runs',run.id);
  const completed=JSON.parse(await readFile(path.join(runRoot,'execution-completion.json'),'utf8'));
  assert.equal(completed.reference.id,workerID);
  const intent=JSON.parse(await readFile(path.join(runRoot,'egress/intent.json'),'utf8'));
  const release=JSON.parse(await readFile(path.join(runRoot,'egress/release.json'),'utf8'));
  assert.equal(release.phase,'released');
  assert.equal(release.containers.find(c=>c.name===intent.broker)?.id,brokerID);
  assert.equal(await controller.docker.inspect(run.container),undefined);
  assert.equal(await controller.docker.inspect(intent.broker),undefined);
  assert.equal(intent.phase,'stopped');
  const usage=JSON.parse(await readFile(path.join(root,'runs',run.id,'trace/metrics.json'),'utf8'));
  const ledger=(await readFile(path.join(root,'runs',run.id,'egress/ledger/requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const starts=ledger.filter(e=>e.phase==='started').length;
  await controller.pump();
  assert.equal((await readFile(path.join(root,'runs',run.id,'egress/ledger/requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(e=>e.phase==='started').length, starts);
  Object.assign(receipt,{passed:true,workerID,brokerID,score:run.grade.score,taskAttempt:run.attempt,
    sameContainersRecovered:true,terminalEvidenceArchived:true,originalContainersReclaimed:true,
    noExtraRequestsOnCompletedResume:true,usage,httpStarted:starts,
    httpFinished:ledger.filter(e=>e.phase==='finished').length});
} catch(error) {
  receipt.error=String(error); throw error;
} finally {
  await controller.close(); store.close();
  await writeFile(path.join(root,'acceptance.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}
