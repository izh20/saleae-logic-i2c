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
  // GitHub Release normalizes spaces in uploaded asset names to dots.
  const releaseName = path.basename(source).replaceAll(' ', '.');
  const target = path.join(outputDirectory, releaseName);
  cpSync(source, target);
  return releaseName;
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
// Match the NSIS installer specifically: the Windows artifact directory also carries the
// portable archive, and a bare `.exe` predicate would trip findExactlyOne once anything
// in that directory ships the app as a loose executable.
const windows = updaterAsset(windowsDirectory, 'Windows updater artifact', name => name.endsWith('-setup.exe'));
const linux = updaterAsset(linuxDirectory, 'Linux updater artifact', name => name.endsWith('.AppImage'));
const dmg = findExactlyOne(macos.files, 'macOS DMG installer', file => file.endsWith('.dmg'));
const msi = findExactlyOne(windows.files, 'Windows MSI installer', file => file.endsWith('.msi'));
const portable = findExactlyOne(windows.files, 'Windows portable archive', file => file.endsWith('.7z'));

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
copyToRelease(msi, outputDirectory);
copyToRelease(portable, outputDirectory);

writeFileSync(path.join(outputDirectory, 'latest.json'), `${JSON.stringify({
  version,
  notes: `release ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2)}\n`);