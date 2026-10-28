import type { ExperimentSpec, ModelSpec, IsolationSpec } from '../src/contracts.js';
import type { FrozenStudyBundleRef, FrozenStudyMethodRef } from '../src/optimizer-study-contracts.js';
import type { StudyJob, StudyState } from '../src/optimizer-study-store.js';

export type ArtifactPlacement =
  | { role: 'G'; arm: string; caseId: string }
  | { role: 'H0'; caseId: string; split: 'search' | 'assessment' }
  | { role: 'selectedHarness'; arm: string; caseId: string; repetition: number; job: string };

export interface InstallationContext {
  id: string;
  role: 'optimizer' | 'executor';
  composition: string | null;
  runtime: ExperimentSpec['runtime'];
  model: ModelSpec;
  isolation: IsolationSpec;
  environment: ExperimentSpec['runtime']['environment'];
  placements: ArtifactPlacement[];
}

export interface ArtifactDelivery {
  id: string;
  sourceDigest: string;
  identity: FrozenStudyBundleRef['artifact']['identity'];
  references: Array<{
    origin: 'inputs' | 'study';
    bundle: FrozenStudyBundleRef | FrozenStudyMethodRef;
    placement: ArtifactPlacement;
  }>;
  contexts: InstallationContext[];
}

export interface DeliveryPlan {
  registrationDigest: string;
  state: StudyState;
  denominator: number;
  slots: Array<{
    arm: string;
    caseId: string;
    repetition: number;
    job: StudyJob | null;
    phase: StudyJob['phase'] | 'cancelled-unreserved';
    selection: 'selected' | 'not-selected';
  }>;
  packages: ArtifactDelivery[];
}

export interface InstallationPolicy {
  allowBuilds: Record<string, boolean>;
}

export interface InstallationConfiguration {
  identity: ArtifactDelivery['identity'];
  profile: ExperimentSpec['runtime']['profile'];
  model: ModelSpec;
  composition: string | null;
  environmentPatch: string | null;
  allowBuilds: InstallationPolicy['allowBuilds'];
}

export interface NativeInstallationReceipt {
  package: string;
  profile: ExperimentSpec['runtime']['profile'];
  composition: string | null;
  tarballDigest: string;
  installed: true;
  nativeComposition: true;
  inferenceRequested: false;
}

export type InstallationResult<T> =
  | { artifact: string; context: string; status: 'passed'; installed: T }
  | { artifact: string; context: string; status: 'failed'; error: string };

export interface OriginalMarkers {
  'registration.json': string;
  'inputs-digest.json': string;
  'study.sqlite': string;
  'study.sqlite-wal': string | null;
}

export interface ArtifactAcceptanceReceipt {
  protocol: 'frozen-study-artifacts-1';
  evidenceRoot: string;
  output: string;
  startedAt: string;
  completedAt: string;
  plan: DeliveryPlan;
  passed: boolean;
  inferenceRequested: false;
  boundary: string;
  originalMarkers?: OriginalMarkers;
  originalMarkersAfter?: OriginalMarkers;
  frameworkSupport?: { path: string; sha256: string; role: string };
  verifier?: {
    scriptDigest: string;
    installationProgramDigest: string;
    commandDigest: string;
    timeoutSeconds: number;
    runtimeBoundary: string;
  };
  installations?: InstallationResult<NativeInstallationReceipt>[];
  originalControlEvidenceUnchanged?: boolean;
  frozenReferencesUnchanged?: boolean;
  deliveryComplete?: boolean;
  installationsPassed?: boolean;
  error?: string;
}

export function assertSeparateOutput(original: string, output: string): Promise<string>;
export function deliveryPlan(raw: unknown, state: StudyState, jobs: StudyJob[]): DeliveryPlan;
export function installationConfig(
  item: ArtifactDelivery,
  context: InstallationContext,
  policy: InstallationPolicy,
): InstallationConfiguration;
export const installationProgram: string;
export function collectPackages<T>(
  plan: DeliveryPlan,
  install: (item: ArtifactDelivery, context: InstallationContext) => Promise<T>,
  saveResult: (result: InstallationResult<T>) => Promise<void>,
): Promise<InstallationResult<T>[]>;
export function main(args?: string[]): Promise<ArtifactAcceptanceReceipt>;
