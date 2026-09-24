import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv[2];

if (!release) {
  console.error('Usage: npm run release -- <version|--patch|--minor|--major>');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [path.join(root, 'scripts', 'version.mjs'), release]);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'tauri', 'build']);
