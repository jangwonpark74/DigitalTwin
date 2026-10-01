export function apiIdentifier(value: string, kind: string): string {
  if (!/^[\w-]{1,80}$/.test(value)) throw new Error(`Invalid ${kind} ID`);
  return encodeURIComponent(value);
}

async function readJson(response: Response): Promise<unknown> {
  let data: unknown;
  try { data = await response.json() as unknown; }
  catch { throw new Error('The database API did not return JSON. Restart make run with the updated server.'); }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error : `Database request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export async function getJson(path: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  return readJson(await fetcher(path, { cache: 'no-store' }));
}

export async function postJson(path: string, payload: unknown, fetcher: typeof fetch = fetch): Promise<unknown> {
  return readJson(await fetcher(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
}
