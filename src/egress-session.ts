import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import { atomicJSON, digest, fileDigest, treeDigest } from './artifacts.js';
import { command, Docker, type ContainerSpec, type ContainerReference } from './docker.js';
import { EgressConfig, EgressRoute, type Route } from './egress.js';
import { isolationReceipt, verifyIsolation, containerIdentity } from './isolation.js';
import type { IsolationSpec } from './contracts.js';
import type { NetworkSpec } from './network.js';
import { allocateNetwork } from './network-pool.js';

interface Network {
  Id: string;
  Name: string;
  Driver: string;
  Internal: boolean;
  EnableIPv6: boolean;
  Labels: Record<string, string>;
  Options: Record<string, string>;
  IPAM: { Config: Array<{ Subnet: string }> };
  Containers: Record<string, { Name: string }>;
}
interface Intent {
  identity: string;
  phase: 'preparing' | 'ready' | 'stopping' | 'stopped';
  isolated: string;
  uplink: string;
  broker: string;
  brokerIP: string | null;
  isolatedId: string | null;
  uplinkId: string | null;
  brokerId: string | null;
  subnets: { isolated: string | null; uplink: string | null };
}
interface Release {
  identity: string;
  phase: 'releasing' | 'released';
  outcome: 'completed' | 'failed';
  containers: ContainerReference[];
  networks: Array<{ name: string; id: string }>;
  evidence: Record<string, string | null>;
}
export interface EgressSessionSpec {
  root: string;
  execution: string;
  image: string;
  isolation: IsolationSpec;
  routes: Route[];
  timeoutSeconds: number;
}
export interface EgressLifecycle {
  prepare(credentials: NodeJS.ProcessEnv): Promise<void>;
  verify(active: boolean): Promise<void>;
  candidateNetwork(): Promise<NetworkSpec>;
  stop(): Promise<void>;
  release(worker: ContainerReference): Promise<void>;
  abort(worker?: ContainerSpec): Promise<void>;
}
export type EgressFactory = (spec: EgressSessionSpec, docker: Docker) => EgressLifecycle;
export const createEgressSession: EgressFactory = (spec, docker) => new EgressSession(spec, docker);

/** Trusted per-execution network. Task containers and original evidence are never recreated here. */
export class EgressSession {
  readonly identity: string;
  constructor(
    readonly spec: EgressSessionSpec,
    readonly docker = new Docker(),
  ) {
    for (const route of spec.routes) EgressRoute.parse(route);
    if (!spec.routes.length) throw Error('Controlled egress requires at least one explicit route');
    this.identity = digest(spec);
  }
  private async intent(): Promise<Intent> {
    const value = JSON.parse(await readFile(path.join(this.spec.root, 'intent.json'), 'utf8')) as Intent;
    if (value.identity !== this.identity) throw Error('Egress launch contract changed');
    return value;
  }
  private async network(name: string): Promise<Network | null> {
    const names = (await command('docker', ['network', 'ls', '--format', '{{.Name}}'])).split('\n');
    if (!names.includes(name)) return null;
    return JSON.parse(await command('docker', ['network', 'inspect', name]))[0] as Network;
  }
  private checkNetwork(
    actual: Network,
    kind: 'isolated' | 'uplink',
    expectedId: string | null,
    subnet: string | null,
  ): void {
    if (
      actual.Driver !== 'bridge' ||
      actual.Internal !== (kind === 'isolated') ||
      actual.EnableIPv6 ||
      actual.Labels['org.harness-evolution.egress'] !== this.identity ||
      (expectedId && actual.Id !== expectedId)
    )
      throw Error(`Egress ${kind} network identity/configuration mismatch`);
    if (!subnet || actual.IPAM.Config.length !== 1 || actual.IPAM.Config[0]?.Subnet !== subnet)
      throw Error(`Egress ${kind} subnet lease mismatch`);
    if (
      kind === 'isolated' &&
      (actual.Options['com.docker.network.bridge.gateway_mode_ipv4'] !== 'isolated' ||
        actual.Options['com.docker.network.bridge.gateway_mode_ipv6'] !== 'isolated')
    )
      throw Error('Egress network is not isolated');
    const allowed = new Set([
      `he-egress-${this.identity.slice(0, 40)}`,
      ...(kind === 'isolated' ? [this.spec.execution] : []),
    ]);
    if (Object.values(actual.Containers ?? {}).some((container) => !allowed.has(container.Name)))
      throw Error(`Unexpected container attached to egress ${kind} network`);
  }
  private configuration(intent: Intent) {
    if (!intent.brokerIP) throw Error('Egress address is not allocated');
    return EgressConfig.parse({ bindAddress: intent.brokerIP, port: 8080, routes: this.spec.routes });
  }
  private resolverConfiguration(): string {
    return this.spec.isolation.network.egressDns.map((address) => `nameserver ${address}\n`).join('');
  }
  private async verifyResolver(): Promise<void> {
    if ((await readFile(path.join(this.spec.root, 'resolv.conf'), 'utf8')) !== this.resolverConfiguration())
      throw Error('Egress resolver configuration changed');
  }
  private container(intent: Intent, credentials: Record<string, string> = {}): ContainerSpec {
    if (!intent.brokerIP) throw Error('Egress address is not allocated');
    return {
      name: intent.broker,
      image: this.spec.image,
      command: ['node', '/app/dist/runtime/egress.js', '/egress-config.json', '/ledger/requests.jsonl'],
      mounts: [
        { source: path.join(this.spec.root, 'config.json'), target: '/egress-config.json', writable: false },
        { source: path.join(this.spec.root, 'resolv.conf'), target: '/etc/resolv.conf', writable: false },
        { source: path.join(this.spec.root, 'ledger'), target: '/ledger', writable: true },
      ],
      isolation: this.spec.isolation,
      timeoutSeconds: this.spec.timeoutSeconds,
      env: credentials,
      network: {
        interfaces: [
          { name: intent.uplink, ipv4: null, gatewayPriority: 1 },
          { name: intent.isolated, ipv4: intent.brokerIP, gatewayPriority: 0 },
        ],
        dns: [],
        hosts: [],
      },
    };
  }
  async candidateNetwork(): Promise<NetworkSpec> {
    const intent = await this.intent();
    if (!intent.brokerIP || intent.phase === 'preparing') throw Error('Egress preparation incomplete');
    return {
      interfaces: [{ name: intent.isolated, ipv4: null, gatewayPriority: 0 }],
      dns: ['127.0.0.1'],
      hosts: [{ name: 'evolution-egress', address: intent.brokerIP }],
    };
  }
  async prepare(credentials: NodeJS.ProcessEnv): Promise<void> {
    await mkdir(path.join(this.spec.root, 'ledger'), { recursive: true });
    let intent: Intent;
    try {
      intent = await this.intent();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const stem = this.identity.slice(0, 40);
      intent = {
        identity: this.identity,
        phase: 'preparing',
        isolated: `he-isolated-${stem}`,
        uplink: `he-uplink-${stem}`,
        broker: `he-egress-${stem}`,
        brokerIP: null,
        isolatedId: null,
        uplinkId: null,
        brokerId: null,
        subnets: { isolated: null, uplink: null },
      };
      await writeFile(path.join(this.spec.root, 'intent.json'), JSON.stringify(intent), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    if (intent.phase !== 'preparing') {
      await this.verify(true);
      return;
    }
    for (const kind of ['isolated', 'uplink'] as const) {
      let network = await this.network(intent[kind]);
      if (!network) {
        if (intent[`${kind}Id`]) throw Error(`Original egress ${kind} network missing; no task retry`);
        await allocateNetwork(
          this.spec.isolation.network.egressPool,
          intent[kind],
          [
            '--label',
            `org.harness-evolution.egress=${this.identity}`,
            ...(kind === 'isolated'
              ? [
                  '--internal',
                  '--opt',
                  'com.docker.network.bridge.gateway_mode_ipv4=isolated',
                  '--opt',
                  'com.docker.network.bridge.gateway_mode_ipv6=isolated',
                ]
              : []),
          ],
          async (subnet) => {
            intent.subnets[kind] = subnet;
            await atomicJSON(path.join(this.spec.root, 'intent.json'), intent);
          },
        );
        network = await this.network(intent[kind]);
      }
      if (!network) throw Error('Created egress network is absent');
      this.checkNetwork(network, kind, intent[`${kind}Id`], intent.subnets[kind]);
      intent[`${kind}Id`] = network.Id;
      if (kind === 'isolated') {
        if (network.IPAM.Config.length !== 1) throw Error('Egress requires one explicit IPv4 subnet');
        const [base, prefix] = ipaddr.parseCIDR(network.IPAM.Config[0]!.Subnet);
        if (base.kind() !== 'ipv4' || prefix > 30)
          throw Error('Egress subnet cannot allocate broker address');
        const value = base.toByteArray().reduce((n, byte) => (n << 8n) + BigInt(byte), 0n) + 2n;
        const address = [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
        if (intent.brokerIP && intent.brokerIP !== address) throw Error('Egress allocated address changed');
        intent.brokerIP = address;
      }
      await atomicJSON(path.join(this.spec.root, 'intent.json'), intent);
    }
    let state = await this.docker.inspect(intent.broker);
    const files = {
      'config.json': JSON.stringify(this.configuration(intent), null, 2) + '\n',
      'resolv.conf': this.resolverConfiguration(),
    };
    for (const [name, contents] of Object.entries(files)) {
      if (!state) {
        try {
          await writeFile(path.join(this.spec.root, name), contents, { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      if ((await readFile(path.join(this.spec.root, name), 'utf8')) !== contents)
        throw Error(`Egress ${name} configuration changed`);
    }
    await this.verifyResolver();
    if (!state) {
      const env: Record<string, string> = {};
      for (const route of this.spec.routes)
        if (route.credential) {
          const key = route.credential.env,
            value = credentials[key];
          if (!value) throw Error(`Missing trusted egress credential: ${key}`);
          env[key] = value;
        }
      await this.docker.create(this.container(intent, env));
      state = await this.docker.inspect(intent.broker);
    }
    verifyIsolation(this.container(intent), await this.docker.configuration(intent.broker));
    if (state?.Status === 'created') await command('docker', ['start', intent.broker]);
    const until = Date.now() + 10000;
    for (;;) {
      if (!(await this.docker.inspect(intent.broker))?.Running)
        throw Error('Egress broker exited during preparation');
      const output = await command('docker', ['logs', intent.broker]);
      if (output.split('\n').some((line) => line.startsWith('{"event":"egress.ready",'))) break;
      if (Date.now() >= until) throw Error('Egress broker readiness timeout');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    intent.brokerId = (await this.docker.configuration(intent.broker)).Id;
    intent.phase = 'ready';
    await atomicJSON(path.join(this.spec.root, 'intent.json'), intent);
    await this.verify(true);
  }
  async verify(active: boolean): Promise<void> {
    const intent = await this.intent();
    await this.verifyResolver();
    if (intent.phase === 'preparing' || !intent.brokerId) throw Error('Egress intent is incomplete');
    if (active && intent.phase !== 'ready') throw Error('Egress broker is already stopping or stopped');
    if (
      digest(JSON.parse(await readFile(path.join(this.spec.root, 'config.json'), 'utf8'))) !==
      digest(this.configuration(intent))
    )
      throw Error('Egress configuration changed');
    for (const kind of ['isolated', 'uplink'] as const) {
      const network = await this.network(intent[kind]);
      if (!network) throw Error(`Original egress ${kind} network missing; no task retry`);
      this.checkNetwork(network, kind, intent[`${kind}Id`], intent.subnets[kind]);
    }
    const state = await this.docker.inspect(intent.broker);
    if (!state) throw Error('Original egress broker missing; no task retry');
    const actual = await this.docker.configuration(intent.broker);
    if (actual.Id !== intent.brokerId) throw Error('Egress broker container identity changed');
    verifyIsolation(this.container(intent), actual);
    if (active && !state.Running) throw Error('Original egress broker is not running; no task retry');
    if (!active && !state.Running && intent.phase === 'ready')
      throw Error('Egress broker stopped outside the lifecycle');
    await atomicJSON(
      path.join(this.spec.root, 'observed.json'),
      isolationReceipt(this.container(intent), actual, await this.docker.host(this.spec.isolation.runtime)),
    );
  }
  async stop(): Promise<void> {
    await this.verify(false);
    const intent = await this.intent();
    if (intent.phase === 'stopped') return;
    intent.phase = 'stopping';
    await atomicJSON(path.join(this.spec.root, 'intent.json'), intent);
    if ((await this.docker.inspect(intent.broker))?.Running)
      await command('docker', ['stop', '--time=5', intent.broker]);
    const result = await this.docker.collect(this.container(intent), path.join(this.spec.root, 'logs'));
    if (result.ExitCode !== 0) throw Error(`Egress broker exited ${result.ExitCode}`);
    intent.phase = 'stopped';
    await atomicJSON(path.join(this.spec.root, 'intent.json'), intent);
  }
  private async releaseRecord(): Promise<Release | null> {
    try {
      const record = JSON.parse(await readFile(path.join(this.spec.root, 'release.json'), 'utf8')) as Release;
      if (record.identity !== this.identity) throw Error('Egress release contract changed');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  private async evidence(): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const entry of [
      'config.json',
      'resolv.conf',
      'logs',
      'ledger',
      'failure-worker',
      'failure-broker',
    ]) {
      try {
        result[entry] = await (['config.json', 'resolv.conf'].includes(entry) ? fileDigest : treeDigest)(
          path.join(this.spec.root, entry),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        result[entry] = null;
      }
    }
    return result;
  }
  private async persistRelease(
    intent: Intent,
    containers: ContainerReference[],
    outcome: Release['outcome'],
  ): Promise<Release> {
    const networks: Release['networks'] = [];
    for (const kind of ['isolated', 'uplink'] as const) {
      const actual = await this.network(intent[kind]);
      if (actual) {
        this.checkNetwork(actual, kind, intent[`${kind}Id`], intent.subnets[kind]);
        networks.push({ name: actual.Name, id: actual.Id });
      } else if (intent[`${kind}Id`]) networks.push({ name: intent[kind], id: intent[`${kind}Id`]! });
    }
    const release: Release = {
      identity: this.identity,
      phase: 'releasing',
      outcome,
      containers,
      networks,
      evidence: await this.evidence(),
    };
    await atomicJSON(path.join(this.spec.root, 'release.json'), release);
    return release;
  }
  private async reclaim(release: Release): Promise<void> {
    if (digest(release.evidence) !== digest(await this.evidence()))
      throw Error('Archived egress evidence changed');
    if (release.phase === 'released') return;
    if (release.phase !== 'releasing') throw Error('Unknown egress release phase');
    for (const container of release.containers) await this.docker.remove(container);
    for (const expected of release.networks) {
      const actual = await this.network(expected.name);
      if (!actual) continue;
      if (actual.Id !== expected.id || actual.Labels['org.harness-evolution.egress'] !== this.identity)
        throw Error('Refusing to remove a replacement network');
      if (Object.keys(actual.Containers ?? {}).length)
        throw Error('Cannot reclaim a network with active endpoints');
      await command('docker', ['network', 'rm', expected.name]);
    }
    release.phase = 'released';
    await atomicJSON(path.join(this.spec.root, 'release.json'), release);
  }
  async release(worker: ContainerReference): Promise<void> {
    let release = await this.releaseRecord();
    if (release) {
      if (
        release.outcome !== 'completed' ||
        !release.containers.some((item) => digest(item) === digest(worker))
      )
        throw Error('Execution does not match the archived egress release');
    } else {
      const intent = await this.intent();
      if (intent.phase !== 'stopped' || !intent.brokerId)
        throw Error('Egress must stop and collect evidence before release');
      release = await this.persistRelease(
        intent,
        [
          worker,
          { name: intent.broker, id: intent.brokerId, intent: containerIdentity(this.container(intent)) },
        ],
        'completed',
      );
    }
    await this.reclaim(release);
  }
  async abort(worker?: ContainerSpec): Promise<void> {
    const release = await this.releaseRecord();
    if (release) {
      await this.reclaim(release);
      return;
    }
    let intent: Intent;
    try {
      intent = await this.intent();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const containers: ContainerReference[] = [];
    for (const [spec, directory] of [
      ...(worker ? [[worker, 'failure-worker'] as const] : []),
      ...(intent.brokerIP ? [[this.container(intent), 'failure-broker'] as const] : []),
    ]) {
      const reference = await this.docker.failureEvidence(spec, path.join(this.spec.root, directory));
      if (reference) containers.push(reference);
    }
    await this.reclaim(await this.persistRelease(intent, containers, 'failed'));
  }
}
