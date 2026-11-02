import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../config.ts';
import { Store } from '../store.ts';
import { buildSnapshot, SNAPSHOT_BUDGET_BYTES } from '../snapshot.ts';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = resolve(values.out ?? resolve(config.webDist, '../public/snapshot.json'));

const store = new Store(config.dbPath);
const snapshot = buildSnapshot(store);
store.close();

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify(snapshot);
writeFileSync(out, json);
console.log(`Wrote ${out} (${(json.length / 1e6).toFixed(1)} MB, ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges)`);
if (json.length > SNAPSHOT_BUDGET_BYTES) {
  const msg = `Snapshot is ${(json.length / 1e6).toFixed(1)} MB, above the ${(SNAPSHOT_BUDGET_BYTES / 1e6).toFixed(0)} MB budget; review retention (server/src/retention.ts).`;
  // A GitHub Actions annotation makes this visible on the workflow run without failing the deploy.
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=Snapshot size::${msg}` : `Warning: ${msg}`);
}
