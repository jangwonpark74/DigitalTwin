import { getJson } from './httpClient';
import { projectsEnvelopeSchema } from './schemas';

// Project lifecycle mutations belong to the canonical workspace controller, never this read adapter.
export async function listProjects(fetcher: typeof fetch = fetch) {
  return projectsEnvelopeSchema.parse(await getJson('/api/projects', fetcher)).projects;
}
