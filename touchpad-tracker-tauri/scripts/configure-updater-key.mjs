import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicKeyPath = process.argv[2];
if (!publicKeyPath) {
  throw new Error('Usage: node scripts/configure-updater-key.mjs <public-key-file>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const publicKey = readFileSync(publicKeyPath, 'utf8').trim();
if (!publicKey) {
  throw new Error(`Updater public key is empty: ${publicKeyPath}`);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!config.plugins?.updater) {
  throw new Error('Missing plugins.updater configuration in tauri.conf.json');
}
config.plugins.updater.pubkey = publicKey;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Configured updater public key from ${publicKeyPath}.`);