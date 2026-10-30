#!/usr/bin/env node
// Mirrors docs/BACKLOG.md into GitHub Issues using the gh CLI.
// Usage: node scripts/create-github-issues.mjs [--dry-run] [--repo owner/name]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const repoIdx = args.indexOf('--repo');
const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;

const text = readFileSync(new URL('../docs/BACKLOG.md', import.meta.url), 'utf8');
const entries = text.split(/^### /m).slice(1).map((chunk) => {
  const [heading, ...rest] = chunk.split('\n');
  const body = rest.join('\n').replace(/\n## [\s\S]*$/, '').trim();
  const meta = body.match(/Priority: (\S+) · Labels: ([^·]+) · Status: (.+)/);
  const labels = meta ? [meta[1], ...meta[2].split(',').map((l) => l.trim())] : [];
  return { title: heading.trim(), body, labels, done: meta?.[3].startsWith('done') };
});

const gh = (ghArgs) => execFileSync('gh', repo ? [...ghArgs, '--repo', repo] : ghArgs, { encoding: 'utf8' });

if (!dryRun) {
  for (const label of new Set(entries.flatMap((e) => e.labels))) {
    try { gh(['label', 'create', label, '--force']); } catch { /* label may already exist */ }
  }
}
for (const e of entries) {
  if (dryRun) { console.log(`[${e.labels.join(', ')}] ${e.title}${e.done ? ' (done)' : ''}`); continue; }
  const url = gh(['issue', 'create', '--title', e.title, '--body', e.body, ...e.labels.flatMap((l) => ['--label', l])]).trim();
  console.log(url);
  if (e.done) gh(['issue', 'close', url, '--reason', 'completed']);
}
