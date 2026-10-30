import { parseArgs } from 'node:util';
import { config } from '../config.ts';
import { Store } from '../store.ts';
import { ingest, SOURCES } from '../ingest.ts';

const { values } = parseArgs({ options: { only: { type: 'string' }, help: { type: 'boolean' } } });

if (values.help) {
  console.log(`Usage: npm run ingest [-- --only ${SOURCES.map((s) => s.meta.id).join(',')}]`);
  process.exit(0);
}

const store = new Store(config.dbPath);
console.log(`Ingesting into ${config.dbPath}`);
const { results } = await ingest(store, { only: values.only?.split(',').map((s) => s.trim()) });
console.log('Counts:', store.counts());
store.close();
process.exitCode = results.every((r) => r.status === 'error') ? 1 : 0;
