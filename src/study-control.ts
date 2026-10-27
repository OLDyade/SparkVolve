import { z } from 'zod';
import { Digest, Id, Proposal, RelativePath } from './contracts.js';
import { EventCursor } from './events.js';
import { capabilityRoutes } from './control-routes.js';
import { StudySearchRequest, StudyEvidenceReference } from './study-evidence.js';
import { studyPaths } from './study-paths.js';
export { studyPaths } from './study-paths.js';

/** This capability never names a validation dataset, file path or task grader. */
export const studyRequests = {
  '/study/status': z.strictObject({}),
  '/study/branch': z.strictObject({ parent: Digest, draft: Id }),
  '/study/submit': z.strictObject({ proposal: Proposal, composition: RelativePath }),
  '/study/events': z.strictObject({
    cursor: EventCursor,
    timeoutMs: z.number().int().min(0).max(30_000).default(30_000),
    limit: z.number().int().min(1).max(100).default(100),
  }),
  '/study/finish': z.strictObject({ reason: z.string().min(1) }),
  '/study/search': StudySearchRequest,
  '/study/evidence': StudyEvidenceReference,
  '/study/materialize': StudyEvidenceReference,
} as const;
export type StudyRoute = keyof typeof studyRequests;
export const studyControlRoutes = (endpoint: string, timeoutSeconds: number) =>
  capabilityRoutes(endpoint, timeoutSeconds, studyPaths);

/** A source draft is writable at the meta agent's /workspace mount; identities describe its frozen parent. */
export const StudyBranchReceipt = z
  .strictObject({
    draft: Id,
    path: z.string(),
    targetRole: z.literal('search-optimizer'),
    parent: z.strictObject({
      candidateId: Digest,
      sourceDigest: Digest,
      methodIdentity: Digest,
      composition: RelativePath,
    }),
  })
  .refine((receipt) => receipt.path === `/workspace/${receipt.draft}`, {
    message: 'Branch receipt must address the published draft in the agent workspace',
  });
export type StudyBranchResult = z.infer<typeof StudyBranchReceipt>;

/** Implemented by the trusted coordinator; all data returned here must be development-only. */
export interface StudyControl {
  status(): unknown;
  branch(parent: string, draft: string): Promise<StudyBranchResult>;
  submit(input: z.infer<(typeof studyRequests)['/study/submit']>): Promise<unknown>;
  events(input: z.infer<(typeof studyRequests)['/study/events']>, signal: AbortSignal): Promise<unknown>;
  finish(reason: string): Promise<unknown>;
  search(jobID: string): Promise<unknown>;
  evidence(input: z.infer<typeof StudyEvidenceReference>): Promise<unknown>;
  materialize(input: z.infer<typeof StudyEvidenceReference>): Promise<unknown>;
}
