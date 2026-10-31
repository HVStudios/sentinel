import { readFileSync } from 'node:fs';
import { HttpError, type fetchJson, type fetchText } from '../../src/http.ts';

/** Recorded payloads keyed by host, so the full pipeline can run offline (tests and the e2e seed). */
export const FIXTURE_NOW = new Date('2026-10-30T20:00:00Z');

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(read(name));

export const fixtureFetchJson = (async (url: string) => {
  const u = new URL(url);
  switch (u.host) {
    case 'www.cisa.gov':
      return json('kev.json');
    case 'services.nvd.nist.gov':
      return u.search.includes('hasKev') ? json('nvd.json') : { ...json('nvd.json'), vulnerabilities: [], totalResults: 0 };
    case 'api.first.org':
      return json('epss.json');
    case 'earthquake.usgs.gov':
      return json('usgs.json');
    case 'eonet.gsfc.nasa.gov':
      return json('eonet.json');
    case 'hn.algolia.com':
      return json('hn.json');
    case 'query.wikidata.org':
      return json('wikidata.json');
    case 'api.gdeltproject.org':
      throw new HttpError(429, 'HTTP 429 from api.gdeltproject.org');
    default:
      throw new Error(`no fixture for ${url}`);
  }
}) as typeof fetchJson;

/** Feeds: the Canadian Cyber Centre's Atom feed for the CCCS entry, BleepingComputer's RSS for every other feed. */
export const fixtureFetchText = (async (url: string) =>
  read(new URL(url).host.endsWith('cyber.gc.ca') ? 'atom-cccs.xml' : 'rss-bleepingcomputer.xml')) as typeof fetchText;
