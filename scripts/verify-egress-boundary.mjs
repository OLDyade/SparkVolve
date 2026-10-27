import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// Architectural acceptance only: these HTTP fixtures are not the production credential broker.
const exec = promisify(execFile);
const image = process.env.HE_TEST_IMAGE;
const runtime = process.env.HE_TEST_RUNTIME;
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/, 'HE_TEST_IMAGE must be an immutable local image ID');
assert.ok(runtime, 'HE_TEST_RUNTIME is required');
const root = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Usage: node scripts/verify-egress-boundary.mjs <new-evidence-directory>');
await mkdir(root); // Refuse to overwrite evidence from any earlier invocation.
const prefix = `he-egress-${randomUUID().slice(0, 12)}`;
const networks = [],
  containers = [];
const receipt = {
  startedAt: new Date().toISOString(),
  image,
  runtime,
  networks: [],
  containers: [],
  observations: {},
};
const fixtureCredential = randomUUID();

async function docker(args, env = {}) {
  const { stdout } = await exec('docker', args, {
    env: { ...process.env, ...env },
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}
async function network(kind, options) {
  const name = `${prefix}-${kind}`;
  await docker(['network', 'create', ...options, name]);
  networks.push(name);
  const [actual] = JSON.parse(await docker(['network', 'inspect', name]));
  receipt.networks.push(actual);
  return actual;
}
async function create(kind, networkName, script, env = {}, extra = [], selectedRuntime = runtime) {
  const name = `${prefix}-${kind}`;
  await docker(
    [
      'create',
      '--name',
      name,
      '--runtime',
      selectedRuntime,
      '--entrypoint=',
      '--user',
      '1000:1000',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      '--memory=128m',
      '--memory-swap=128m',
      '--cpus=0.25',
      '--network',
      networkName,
      ...extra,
      ...Object.keys(env).flatMap((key) => ['--env', key]),
      image,
      'node',
      '--input-type=module',
      '-e',
      script,
    ],
    env,
  );
  containers.push(name);
  return name;
}
async function ready(name) {
  await docker(['start', name]);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const output = await docker(['logs', name]);
    const record = output.split('\n').find((line) => line.startsWith('{"ready":'));
    if (record) return JSON.parse(record);
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', name]));
    assert.equal(state.Running, true, `Fixture exited before readiness: ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Fixture readiness timeout: ${name}`);
}
async function run(name) {
  await docker(['start', name]);
  const exitCode = await docker(['wait', name]);
  const output = await docker(['logs', name]);
  await writeFile(path.join(root, `${name}.stdout.log`), output);
  assert.equal(exitCode, '0', `Network acceptance failed in ${name}: ${output}`);
  return JSON.parse(output);
}

try {
  receipt.daemon = JSON.parse(
    await docker([
      'info',
      '--format',
      '{"version":{{json .ServerVersion}},"kernel":{{json .KernelVersion}},"architecture":{{json .Architecture}},"runtimes":{{json .Runtimes}}}',
    ]),
  );
  assert.ok(Object.hasOwn(receipt.daemon.runtimes, runtime));
  const ordinary = await network('ordinary', ['--internal']);
  const isolated = await network('isolated', [
    '--internal',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv4=isolated',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv6=isolated',
  ]);
  const uplink = await network('uplink', []);
  assert.equal(isolated.Internal, true);
  assert.equal(isolated.EnableIPv6, false);
  assert.equal(isolated.Options['com.docker.network.bridge.gateway_mode_ipv4'], 'isolated');

  // Deliberate host service proves the ordinary internal network is not a host-access boundary.
  // Trusted fixture runtime is runc, independently of the candidate runtime under test.
  const nonce = randomUUID();
  const host = await create(
    'host',
    'host',
    `
    import http from 'node:http';
    const server = http.createServer((req,res) => {
      if(req.url === '/health') return res.end(process.env.NONCE);
      if(req.url !== '/model' || req.headers.authorization !== 'Bearer '+process.env.FIXTURE_CREDENTIAL) {
        res.writeHead(403); return res.end('denied');
      }
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({authenticated:true,nonce:process.env.NONCE}));
    });
    server.listen(0,'0.0.0.0',()=>console.log(JSON.stringify({ready:true,port:server.address().port})));
  `,
    { NONCE: nonce, FIXTURE_CREDENTIAL: fixtureCredential },
    [],
    'runc',
  );
  const { port } = await ready(host);
  const hostGateway = ordinary.IPAM.Config[0].Gateway;
  const ordinaryGuest = await create(
    'positive',
    ordinary.Name,
    `
    import assert from 'node:assert/strict';
    const result = await fetch(process.env.URL,{signal:AbortSignal.timeout(4000)});
    assert.equal(await result.text(),process.env.NONCE);
    console.log(JSON.stringify({ordinaryInternalReachesHost:true}));
  `,
    { URL: `http://${hostGateway}:${port}/health`, NONCE: nonce },
  );
  receipt.observations.positiveControl = await run(ordinaryGuest);

  const proxy = await create(
    'broker-fixture',
    uplink.Name,
    `
    import http from 'node:http';
    const server = http.createServer((req,res) => {
      if(req.method !== 'POST' || req.url !== '/invoke') {res.writeHead(403);return res.end('denied');}
      const upstream = http.request({host:process.env.UPSTREAM_HOST,port:process.env.UPSTREAM_PORT,
        path:'/model',method:'POST',headers:{authorization:'Bearer '+process.env.FIXTURE_CREDENTIAL}}, reply=> {
          res.writeHead(reply.statusCode,{'content-type':'application/json'});reply.pipe(res);
        });
      upstream.on('error',()=>{res.writeHead(502);res.end('upstream failed');});
      req.pipe(upstream);
    });
    server.on('connect',(req,socket)=>socket.end('HTTP/1.1 403 Forbidden\\r\\nContent-Length: 0\\r\\n\\r\\n'));
    server.listen(8080,'0.0.0.0',()=>console.log(JSON.stringify({ready:true})));
  `,
    {
      UPSTREAM_HOST: uplink.IPAM.Config[0].Gateway,
      UPSTREAM_PORT: String(port),
      FIXTURE_CREDENTIAL: fixtureCredential,
    },
    [],
    'runc',
  );
  await docker(['network', 'connect', '--alias', 'broker', isolated.Name, proxy]);
  await ready(proxy);
  const [proxyInspect] = JSON.parse(await docker(['inspect', proxy]));
  const brokerIP = proxyInspect.NetworkSettings.Networks[isolated.Name].IPAddress;

  const guest = await create(
    'candidate',
    isolated.Name,
    `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import {Resolver} from 'node:dns/promises';
    import {readFile} from 'node:fs/promises';
    import {networkInterfaces} from 'node:os';
    const blocked = async(host,port)=>await new Promise((resolve,reject)=>{
      const socket=net.createConnection({host,port});
      socket.setTimeout(1200,()=>{socket.destroy();resolve('timeout');});
      socket.once('connect',()=>{socket.destroy();reject(new Error('Unexpected direct connection: '+host+':'+port));});
      socket.once('error',e=>resolve(e.code));
    });
    assert.equal(process.env.FIXTURE_CREDENTIAL,undefined);
    const environment=await readFile('/proc/self/environ','utf8');
    assert.ok(!environment.includes('FIXTURE_CREDENTIAL='));
    const result=await fetch('http://broker:8080/invoke',{method:'POST',
      headers:{authorization:'Bearer guest-controlled-invalid'},signal:AbortSignal.timeout(4000)});
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{authenticated:true,nonce:process.env.NONCE});
    const denied=await fetch('http://broker:8080/forbidden',{signal:AbortSignal.timeout(4000)});
    assert.equal(denied.status,403);
    const destinations=JSON.parse(process.env.DESTINATIONS);
    const failures=[];
    for(const host of destinations) failures.push({host,result:await blocked(host,Number(process.env.HOST_PORT))});
    failures.push({host:'1.1.1.1:443',result:await blocked('1.1.1.1',443)});
    failures.push({host:'2606:4700:4700::1111:443',result:await blocked('2606:4700:4700::1111',443)});
    for(const addresses of Object.values(networkInterfaces())) for(const address of addresses)
      if(address.family==='IPv6') assert.equal(address.internal,true,'unexpected non-loopback IPv6');
    const dns=new Resolver({timeout:500,tries:1});
    await assert.rejects(dns.resolve4('example.com'));
    dns.setServers(['1.1.1.1']);
    await assert.rejects(dns.resolve4('example.com'));
    console.log(JSON.stringify({brokerAuthenticated:true,credentialAbsent:true,unapprovedPathDenied:true,
      directConnections:failures,externalDNSRejected:true,route:await readFile('/proc/net/route','utf8'),
      resolvConf:await readFile('/etc/resolv.conf','utf8')}));
  `,
    {
      NONCE: nonce,
      HOST_PORT: String(port),
      DESTINATIONS: JSON.stringify(
        [hostGateway, uplink.IPAM.Config[0].Gateway, isolated.IPAM.Config[0].Gateway].filter(Boolean),
      ),
    },
    ['--dns', '127.0.0.1', '--add-host', `broker:${brokerIP}`],
  );
  receipt.observations.isolatedCandidate = await run(guest);
  const [guestInspect] = JSON.parse(await docker(['inspect', guest]));
  assert.deepEqual(Object.keys(guestInspect.NetworkSettings.Networks), [isolated.Name]);
  assert.deepEqual(guestInspect.HostConfig.Dns, ['127.0.0.1']);
  assert.deepEqual(guestInspect.HostConfig.ExtraHosts, [`broker:${brokerIP}`]);
  assert.equal(guestInspect.HostConfig.Runtime, runtime);
  receipt.observations.candidateSettings = {
    networkMode: guestInspect.HostConfig.NetworkMode,
    dns: guestInspect.HostConfig.Dns,
    hosts: guestInspect.HostConfig.ExtraHosts,
    user: guestInspect.Config.User,
    runtime: guestInspect.HostConfig.Runtime,
    capDrop: guestInspect.HostConfig.CapDrop,
    networks: guestInspect.NetworkSettings.Networks,
  };
  await docker(['stop', '--time', '1', proxy]);
  const closed = await create(
    'broker-stopped',
    isolated.Name,
    `
    import assert from 'node:assert/strict';
    await assert.rejects(fetch(process.env.URL,{method:'POST',signal:AbortSignal.timeout(2000)}));
    console.log(JSON.stringify({brokerStoppedRequestFailed:true}));
  `,
    { URL: `http://${brokerIP}:8080/invoke` },
    ['--dns', '127.0.0.1'],
  );
  receipt.observations.closed = await run(closed);
  receipt.passed = true;
} catch (error) {
  receipt.passed = false;
  receipt.error = String(error);
  throw error;
} finally {
  // Persist sanitized settings and logs before disposing only this invocation's fixtures.
  const cleanupErrors = [];
  for (const name of containers) {
    try {
      const [value] = JSON.parse(await docker(['inspect', name]));
      receipt.containers.push({ name, id: value.Id, image: value.Image, state: value.State });
      const logs = await exec('docker', ['logs', name], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
      await writeFile(path.join(root, `${name}.stdout.log`), logs.stdout);
      await writeFile(path.join(root, `${name}.stderr.log`), logs.stderr);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
    try {
      await docker(['rm', '--force', name]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  for (const name of networks.reverse()) {
    try {
      await docker(['network', 'rm', name]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  receipt.completedAt = new Date().toISOString();
  receipt.cleanupErrors = cleanupErrors;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Fixture cleanup/evidence failed');
}
console.log(JSON.stringify({ passed: receipt.passed, evidence: root, runtime, image }));
