import type { buildRtJob } from '../../rt-job.mjs';
import { apiIdentifier, getJson, postJson } from './httpClient';
import { rtCapabilitySchema, rtJobSchema } from './schemas';

export async function getRtCapability(fetcher: typeof fetch = fetch) {
  return rtCapabilitySchema.parse(await getJson('/api/rt/capability', fetcher));
}

// The caller must build and validate job geometry through the existing domain buildRtJob helper.
export async function submitRtJob(projectId: string, job: ReturnType<typeof buildRtJob>, fetcher: typeof fetch = fetch) {
  apiIdentifier(projectId, 'project');
  const record = rtJobSchema.parse(await postJson('/api/rt/jobs', { ...job, projectId }, fetcher));
  if (record.status !== 'queued') throw new Error('The RT job was not queued');
  return record;
}

export async function getRtJob(jobId: string, fetcher: typeof fetch = fetch) {
  const id = apiIdentifier(jobId, 'job');
  const record = rtJobSchema.parse(await getJson(`/api/rt/jobs/${id}`, fetcher));
  if (record.id !== jobId) throw new Error('Response belongs to a different job');
  return record;
}
