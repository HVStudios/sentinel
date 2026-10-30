import { httpApi, type Api } from './api.ts';
import { createStaticApi, type Snapshot } from './staticApi.ts';

const loadSnapshot = async (): Promise<Snapshot> => {
  const res = await fetch(`${import.meta.env.BASE_URL}snapshot.json`);
  if (!res.ok) throw new Error(`Could not load data snapshot (${res.status})`);
  return (await res.json()) as Snapshot;
};

/** Built with VITE_STATIC=1 for GitHub Pages: no server, data comes from snapshot.json. */
export const api: Api = import.meta.env.VITE_STATIC === '1' ? createStaticApi(loadSnapshot) : httpApi;
