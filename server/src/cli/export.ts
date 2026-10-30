import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../config.ts';
import { Store } from '../store.ts';
import { buildSnapshot } from '../snapshot.ts';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = resolve(values.out ?? resolve(config.webDist, '../public/snapshot.json'));

const store = new Store(config.dbPath);
const snapshot = buildSnapshot(store);
store.close();

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify(snapshot);
writeFileSync(out, json);
console.log(`Wrote ${out} (${(json.length / 1e6).toFixed(1)} MB, ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges)`);
