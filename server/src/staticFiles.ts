import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Serves the built web app (one directory of files produced by Vite) without a third-party
 * static-file plugin. Deliberately small and strict:
 * - GET/HEAD only; anything under /api/ that has no route is a JSON 404;
 * - paths are decoded once and resolved inside the root, and symlinks must also resolve inside it;
 *   traversal, null bytes, backslashes and dotfiles are refused;
 * - extensionless paths fall back to index.html (client-side routes); missing files are 404.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

type Resolved = { file: string; size: number; mtime: Date } | 'forbidden' | 'missing';

async function resolveFile(root: string, urlPath: string): Promise<Resolved> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return 'forbidden';
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return 'forbidden';
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return 'forbidden';
  const candidate = resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(root + sep)) return 'forbidden';
  try {
    const real = await realpath(candidate);
    if (real !== root && !real.startsWith(root + sep)) return 'forbidden';
    const info = await stat(real);
    if (!info.isFile()) return 'missing';
    return { file: real, size: info.size, mtime: info.mtime };
  } catch {
    return 'missing';
  }
}

export async function registerStaticFiles(app: FastifyInstance, rootDir: string): Promise<void> {
  const root = await realpath(rootDir);

  const send = (req: FastifyRequest, reply: FastifyReply, f: { file: string; size: number; mtime: Date }, urlPath: string) => {
    const ext = extname(f.file).toLowerCase();
    reply
      .header('content-type', TYPES[ext] ?? 'application/octet-stream')
      .header('content-length', f.size)
      .header('last-modified', f.mtime.toUTCString())
      .header('x-content-type-options', 'nosniff')
      // Vite fingerprints files under /assets/, so they never change; the HTML shell must be revalidated.
      .header('cache-control', urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return req.method === 'HEAD' ? reply.send() : reply.send(createReadStream(f.file));
  };

  app.setNotFoundHandler(async (req, reply) => {
    const urlPath = req.url.split('?')[0] ?? '/';
    if (urlPath.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(405).header('allow', 'GET, HEAD').send({ error: 'method not allowed' });

    const target = await resolveFile(root, urlPath === '/' ? '/index.html' : urlPath);
    if (target === 'forbidden') return reply.code(404).send({ error: 'not found' });
    if (target !== 'missing') return send(req, reply, target, urlPath);
    // Client-side routes have no file extension; serve the app shell for them.
    if (!extname(urlPath)) {
      const shell = await resolveFile(root, '/index.html');
      if (typeof shell === 'object') return send(req, reply, shell, '/index.html');
    }
    return reply.code(404).send({ error: 'not found' });
  });
}
