import Fastify, { type FastifyInstance } from 'fastify';
import { FEED_SORTS, type FeedSort, type Store } from './store.ts';
import { TIMED_TYPES, type NodeType } from './types.ts';
import { ingest, type IngestResult } from './ingest.ts';
import { VERSION } from './version.ts';

export interface AppOptions {
  /** Enables POST /api/ingest. Only turned on when the server is bound to loopback. */
  allowIngest?: boolean;
  runIngest?: (store: Store) => Promise<{ results: IngestResult[] }>;
  logger?: boolean;
  now?: () => Date;
}

const isoDate = { type: 'string', format: 'date-time' } as const;
const timeProps = {
  from: isoDate,
  to: isoDate,
  types: { type: 'string', pattern: `^(${TIMED_TYPES.join('|')})(,(${TIMED_TYPES.join('|')}))*$` },
} as const;

interface TimeQs {
  from?: string;
  to?: string;
  types?: string;
}

const parseTypes = (s?: string): NodeType[] | undefined => (s ? (s.split(',') as NodeType[]) : undefined);
const iso = (s?: string) => (s ? new Date(s).toISOString() : undefined);

export function buildApp(store: Store, opts: AppOptions = {}): FastifyInstance {
  // Reject unknown query params instead of silently stripping them.
  const app = Fastify({ logger: opts.logger ?? false, ajv: { customOptions: { removeAdditional: false } } });
  const now = opts.now ?? (() => new Date());
  let running: Promise<unknown> | null = null;
  let lastIngest: { startedAt: string; finishedAt?: string; results?: IngestResult[]; error?: string } | null = null;

  app.get('/api/health', async () => ({ ok: true, version: VERSION, counts: store.counts() }));

  app.get<{ Querystring: TimeQs & { q?: string; limit?: number; before?: string; sort?: FeedSort } }>(
    '/api/feed',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...timeProps,
            q: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            before: { type: 'string', maxLength: 300 },
            sort: { type: 'string', enum: [...FEED_SORTS], default: 'latest' },
          },
        },
      },
    },
    async (req) => {
      const { from, to, types, q, limit, before, sort } = req.query;
      return store.feed({ from: iso(from), to: iso(to), types: parseTypes(types), q: q?.trim() || undefined, limit, before, sort });
    },
  );

  app.get<{ Querystring: TimeQs }>(
    '/api/map',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: timeProps } } },
    async (req) => {
      const { from, to, types } = req.query;
      return store.mapData({ from: iso(from), to: iso(to), types: parseTypes(types) });
    },
  );

  app.get<{ Querystring: TimeQs & { buckets?: number } }>(
    '/api/timeline',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { ...timeProps, buckets: { type: 'integer', minimum: 1, maximum: 365, default: 60 } },
        },
      },
    },
    async (req, reply) => {
      const to = iso(req.query.to) ?? now().toISOString();
      const from = iso(req.query.from) ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
      if (from >= to) return reply.code(400).send({ error: 'from must be before to' });
      return store.timeline({ from, to, types: parseTypes(req.query.types), buckets: req.query.buckets ?? 60 });
    },
  );

  app.get<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    const node = store.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: 'not found' });
    const edges = store.edgesOf(node.id).map((e) => {
      const otherId = e.src === node.id ? e.dst : e.src;
      const other = store.getNode(otherId);
      return {
        ...e,
        direction: e.src === node.id ? 'out' : 'in',
        other: other ? { id: other.id, type: other.type, title: other.title, occurredAt: other.occurredAt } : { id: otherId, type: null, title: otherId },
      };
    });
    return { node, provenance: store.provenanceFor(node.id), edges };
  });

  app.get<{ Params: { id: string }; Querystring: { depth?: number; limit?: number } }>(
    '/api/graph/:id',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            depth: { type: 'integer', minimum: 1, maximum: 2, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const g = store.graph(req.params.id, req.query.depth, req.query.limit);
      if (!g.nodes.length) return reply.code(404).send({ error: 'not found' });
      return g;
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; limit?: number } }>(
    '/api/stories',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: isoDate, to: isoDate, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        },
      },
    },
    async (req) => ({ stories: store.stories({ from: iso(req.query.from), to: iso(req.query.to), limit: req.query.limit }) }),
  );

  app.get('/api/sources', async () => ({ sources: store.sources(), ingest: { running: Boolean(running), last: lastIngest } }));

  if (opts.allowIngest) {
    const run = opts.runIngest ?? ((s: Store) => ingest(s));
    app.post('/api/ingest', async (_req, reply) => {
      if (running) return reply.code(409).send({ error: 'ingest already running', last: lastIngest });
      lastIngest = { startedAt: now().toISOString() };
      const current = lastIngest;
      running = run(store)
        .then((r) => { current.results = r.results; })
        .catch((err: Error) => { current.error = err.message; })
        .finally(() => { current.finishedAt = now().toISOString(); running = null; });
      return reply.code(202).send({ started: true, startedAt: current.startedAt });
    });
  }

  return app;
}
