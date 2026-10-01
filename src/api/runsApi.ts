import { apiIdentifier, getJson } from './httpClient';
import { runDetailSchema, runsEnvelopeSchema } from './schemas';

export async function listRuns(projectId: string,
  { limit = 200, offset = 0 }: { limit?: number; offset?: number } = {}, fetcher: typeof fetch = fetch) {
  const id = apiIdentifier(projectId, 'project');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Run list limit must be 1–200');
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Run list offset must be 0–1,000,000');
  const page = runsEnvelopeSchema.parse(await getJson(`/api/projects/${id}/runs?limit=${limit}&offset=${offset}`, fetcher));
  if (page.runs.some(run => run.projectId !== projectId)) throw new Error('Run belongs to a different project');
  if (page.runs.length > limit || (page.runs.length > 0 && page.total < offset + page.runs.length) ||
      page.nextOffset !== (offset + page.runs.length < page.total ? offset + page.runs.length : null)) {
    throw new Error('Run pagination response is inconsistent');
  }
  return page;
}

export async function getRun(projectId: string, runId: string, fetcher: typeof fetch = fetch) {
  apiIdentifier(projectId, 'project');
  const id = apiIdentifier(runId, 'run');
  const run = runDetailSchema.parse(await getJson(`/api/runs/${id}`, fetcher));
  if (run.id !== runId || run.projectId !== projectId) throw new Error('Run belongs to a different project');
  return run;
}
