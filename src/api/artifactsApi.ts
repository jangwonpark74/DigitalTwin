import { apiIdentifier, getJson } from './httpClient';
import { artifactSchema, artifactsEnvelopeSchema } from './schemas';

type Artifact = ReturnType<typeof artifactSchema.parse>;

function withinProject(file: Artifact, projectName: string) {
  const prefix = `${projectName}/`;
  if (!file.path.startsWith(prefix)) throw new Error('Artifact belongs to a different project');
  const segments = file.path.slice(prefix.length).split('/');
  if (segments.at(-1) !== file.name || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid database artifact path');
  }
  return file;
}

export async function listArtifacts(projectId: string, projectName: string,
  { content = false }: { content?: boolean } = {}, fetcher: typeof fetch = fetch) {
  const id = apiIdentifier(projectId, 'project');
  const url = `/api/projects/${id}/artifacts${content ? '?content=1' : ''}`;
  const files = artifactsEnvelopeSchema.parse(await getJson(url, fetcher)).artifacts;
  if (content && files.some(file => file.content === undefined)) throw new Error('Database artifact record is incomplete');
  return files.map(file => withinProject(file, projectName));
}

export async function getArtifact(projectId: string, projectName: string, artifactId: string,
  fetcher: typeof fetch = fetch) {
  const project = apiIdentifier(projectId, 'project');
  const artifact = apiIdentifier(artifactId, 'artifact');
  const file = artifactSchema.parse(await getJson(`/api/projects/${project}/artifacts/${artifact}`, fetcher));
  if (file.id !== artifactId || file.content === undefined) throw new Error('Database artifact record is incomplete');
  return withinProject(file, projectName);
}
