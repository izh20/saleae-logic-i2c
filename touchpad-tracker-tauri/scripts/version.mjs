import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
const cargoToml = readFileSync(cargoPath, 'utf8');
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

if (!cargoVersionMatch) {
  throw new Error('Unable to find the package version in src-tauri/Cargo.toml');
}

function assertVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
}

function nextVersion(current, release) {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Cannot bump invalid version: ${current}`);
  let [, major, minor, patch] = match.map(Number);
  if (release === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (release === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function updateCargoVersion(contents, version) {
  return contents.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("$)/m,
    `$1${version}$2`,
  );
}

function updateCargoLock(contents, version) {
  return contents.replace(
    /(\[\[package\]\]\nname = "touchpad-tracker-tauri"\nversion = ")[^"]+("\n)/,
    `$1${version}$2`,
  );
}

const argument = process.argv[2] ?? '--check';
if (argument === '--check') {
  assertVersion(packageJson.version);
  if (cargoVersionMatch[1] !== packageJson.version) {
    throw new Error(`Version mismatch: package.json=${packageJson.version}, Cargo.toml=${cargoVersionMatch[1]}`);
  }
  if (packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) {
    throw new Error(`Version mismatch: package-lock.json does not match ${packageJson.version}`);
  }
  if (tauriConfig.version !== '../package.json') {
    throw new Error("src-tauri/tauri.conf.json must use '../package.json' as its version source");
  }
  console.log(`Version ${packageJson.version} is consistent.`);
  process.exit(0);
}

const version = argument.startsWith('--')
  ? nextVersion(packageJson.version, argument.slice(2))
  : argument;

if (!['--major', '--minor', '--patch'].includes(argument) && argument.startsWith('--')) {
  throw new Error(`Unknown option: ${argument}`);
}
assertVersion(version);

packageJson.version = version;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

packageLock.version = version;
if (packageLock.packages?.['']) packageLock.packages[''].version = version;
writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);

writeFileSync(cargoPath, updateCargoVersion(cargoToml, version));
const cargoLock = readFileSync(cargoLockPath, 'utf8');
writeFileSync(cargoLockPath, updateCargoLock(cargoLock, version));

console.log(`Updated Touchpad Tracker to ${version}.`);
