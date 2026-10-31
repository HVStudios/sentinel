#!/usr/bin/env node
// Seeds the e2e database and builds both targets: the live app (web/dist, served by the API
// server) and the static GitHub Pages build (e2e/.data/static, served under /sentinel/).
import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';

const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
const data = 'e2e/.data';

run('node', ['--disable-warning=ExperimentalWarning', 'e2e/seed.ts', `${data}/seed.db`, `${data}/snapshot.json`]);
run('npm', ['run', 'build', '-w', 'web']);
rmSync(`${data}/static`, { recursive: true, force: true });
run('npm', ['exec', '-w', 'web', '--', 'vite', 'build', '--outDir', `../${data}/static`, '--emptyOutDir'], { VITE_STATIC: '1', VITE_BASE: '/sentinel/' });
copyFileSync(`${data}/snapshot.json`, `${data}/static/snapshot.json`);
