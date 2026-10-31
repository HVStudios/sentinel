// Builds a deterministic database for the e2e tests from the recorded fixtures (no network).
// Usage: node e2e/seed.ts <db path> <snapshot path>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from '../server/src/store.ts';
import { ingest } from '../server/src/ingest.ts';
import { buildSnapshot } from '../server/src/snapshot.ts';
import { RateLimiter } from '../server/src/http.ts';
import { FIXTURE_NOW, fixtureFetchJson, fixtureFetchText } from '../server/test/fixtures/router.ts';

const [dbPath, snapshotPath] = process.argv.slice(2);
if (!dbPath || !snapshotPath) throw new Error('usage: node e2e/seed.ts <db> <snapshot.json>');

for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
// Fixtures answer instantly; skip the politeness delays meant for real APIs.
RateLimiter.prototype.acquire = async () => {};

const store = new Store(dbPath, () => FIXTURE_NOW.toISOString());
await ingest(store, { ctx: { fetchJson: fixtureFetchJson, fetchText: fixtureFetchText, env: {}, now: () => FIXTURE_NOW, log: () => {} } });
const snapshot = buildSnapshot(store, () => FIXTURE_NOW);
store.close();

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, JSON.stringify(snapshot));
console.log(`seeded ${dbPath}: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges`);
