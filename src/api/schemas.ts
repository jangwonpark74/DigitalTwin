import { z } from 'zod';
import { validateWorkspaceState } from '../../workspaces.mjs';

const projectRecord = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
  project: z.record(z.string(), z.unknown()),
  activity: z.array(z.object({ when: z.string(), title: z.string(), detail: z.string() })),
});

export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  activeProjectId: z.string(),
  projects: z.array(projectRecord).min(1).max(100),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSchema>;
export const workspaceEnvelopeSchema = z.object({
  revision: z.number().int().nonnegative(),
  workspace: workspaceSchema.nullable(),
});
export const saveConfirmationSchema = z.object({ revision: z.number().int().nonnegative() });

export const projectSummarySchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(['active', 'archived']),
  createdAt: z.string(), updatedAt: z.string(),
  taskCount: z.number().int().nonnegative(), artifactCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
});
export const projectsEnvelopeSchema = z.object({ projects: z.array(projectSummarySchema) });

export const artifactSchema = z.object({
  id: z.string(), path: z.string(), name: z.string(), mimeType: z.string(),
  description: z.string(), updatedAt: z.string(),
  size: z.number().int().nonnegative().optional(), content: z.string().optional(),
});
export const artifactsEnvelopeSchema = z.object({ artifacts: z.array(artifactSchema) });

const runBaseSchema = z.object({
  id: z.string(), projectId: z.string(), taskId: z.string().nullable(), kind: z.string(),
  status: z.enum(['queued', 'running', 'cancelling', 'cancelled', 'complete', 'failed', 'interrupted']),
  createdAt: z.string(), completedAt: z.string().nullable(), error: z.string().nullable(),
  retryOf: z.string().nullable().optional(), cancelRequestedAt: z.string().nullable().optional(),
});
export const runSummarySchema = runBaseSchema.extend({ totalPaths: z.number().int().nonnegative().nullable() });
export const runDetailSchema = runBaseSchema.extend({
  input: z.record(z.string(), z.unknown()), result: z.record(z.string(), z.unknown()).nullable(),
  events: z.array(z.object({ sequence: z.number().int().positive(), when: z.string(), status: z.string(), detail: z.string() })).optional(),
});
export const runsEnvelopeSchema = z.object({
  runs: z.array(runSummarySchema), total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const rtCapabilitySchema = z.object({ available: z.boolean(), platform: z.string(), message: z.string(), runContractVersion: z.literal(1).optional(),
  jobActions: z.array(z.enum(['cancel', 'retry'])).optional() });
const rtJobBase = { id: z.string(), createdAt: z.string(), projectId: z.string().nullable().optional(), retryOf: z.string().nullable().optional(), cancelRequestedAt: z.string().nullable().optional() };
export const rtJobSchema = z.discriminatedUnion('status', [
  z.object({ ...rtJobBase, status: z.literal('queued') }),
  z.object({ ...rtJobBase, status: z.literal('running') }),
  z.object({ ...rtJobBase, status: z.literal('cancelling'), cancelRequestedAt: z.string() }),
  z.object({ ...rtJobBase, status: z.literal('cancelled'), error: z.string(), completedAt: z.string() }),
  z.object({ ...rtJobBase, status: z.literal('failed'), error: z.string(), completedAt: z.string() }),
  z.object({ ...rtJobBase, status: z.literal('interrupted'), error: z.string(), completedAt: z.string() }),
  z.object({ ...rtJobBase, status: z.literal('complete'), completedAt: z.string(),
    result: z.object({ totalPaths: z.number().int().nonnegative(), paths: z.array(z.unknown()) }).passthrough() }),
]);

// Transport shape is not project validity: the existing domain rules stay authoritative.
export function parseWorkspaceEnvelope(value: unknown) {
  const envelope = workspaceEnvelopeSchema.parse(value);
  if (envelope.workspace) {
    const errors = validateWorkspaceState(envelope.workspace as Parameters<typeof validateWorkspaceState>[0]);
    if (errors.length) throw new Error(errors[0]);
  }
  return envelope;
}
