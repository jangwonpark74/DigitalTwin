import type { WorkspaceSnapshot } from '../api/schemas';

type ProjectRecord = WorkspaceSnapshot['projects'][number];

// Shell-only context; project validation and planning calculations remain in the domain modules.
export function buildPreviewContext(record: ProjectRecord | null, projectCount: number) {
  if (!record) return null;
  const project = record.project as {
    map: { city: string; cluster: string };
    sites: { cells: unknown[] }[];
    ue: { count: number };
  };
  return {
    name: record.name,
    city: project.map.city,
    cluster: project.map.cluster,
    projectCount,
    siteCount: project.sites.length,
    cellCount: project.sites.reduce((total, site) => total + site.cells.length, 0),
    ueCount: project.ue.count,
    activityCount: record.activity.length,
  };
}
