import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return process.argv[index + 1];
}

function findFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? findFiles(entryPath) : [entryPath];
  });
}

function findExactlyOne(files, description, predicate) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${description}: expected exactly one file, found ${matches.length}: ${matches.join(', ')}`);
  }
  return matches[0];
}

function updaterAsset(directory, description, predicate) {
  const files = findFiles(directory);
  const asset = findExactlyOne(files, description, file => predicate(path.basename(file)) && !file.endsWith('.sig'));
  const signature = `${asset}.sig`;
  if (!existsSync(signature)) {
    throw new Error(`${description}: missing signature ${signature}`);
  }
  return { asset, signature, files };
}

function copyToRelease(source, outputDirectory) {
  const target = path.join(outputDirectory, path.basename(source));
  cpSync(source, target);
  return path.basename(target);
}

const version = readArgument('--version');
const tag = readArgument('--tag');
const repository = readArgument('--repository');
const macosDirectory = readArgument('--macos');
const windowsDirectory = readArgument('--windows');
const linuxDirectory = readArgument('--linux');
const outputDirectory = readArgument('--output');

for (const directory of [macosDirectory, windowsDirectory, linuxDirectory]) {
  if (!statSync(directory).isDirectory()) {
    throw new Error(`Artifact input is not a directory: ${directory}`);
  }
}
mkdirSync(outputDirectory, { recursive: true });

const macos = updaterAsset(macosDirectory, 'macOS updater artifact', name => name.endsWith('.app.tar.gz'));
const windows = updaterAsset(windowsDirectory, 'Windows updater artifact', name => name.endsWith('.exe'));
const linux = updaterAsset(linuxDirectory, 'Linux updater artifact', name => name.endsWith('.AppImage'));
const dmg = findExactlyOne(macos.files, 'macOS DMG installer', file => file.endsWith('.dmg'));

const releaseBaseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
const platforms = {};
for (const [target, updater] of [
  ['darwin-aarch64', macos],
  ['windows-x86_64', windows],
  ['linux-x86_64', linux],
]) {
  const assetName = copyToRelease(updater.asset, outputDirectory);
  copyToRelease(updater.signature, outputDirectory);
  platforms[target] = {
    url: `${releaseBaseUrl}/${encodeURIComponent(assetName)}`,
    signature: readFileSync(updater.signature, 'utf8').trim(),
  };
}
copyToRelease(dmg, outputDirectory);

writeFileSync(path.join(outputDirectory, 'latest.json'), `${JSON.stringify({
  version,
  notes: `release ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2)}\n`);