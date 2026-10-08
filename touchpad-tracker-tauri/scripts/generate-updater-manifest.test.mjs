import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./generate-updater-manifest.mjs', import.meta.url));
const version = '9.9.9';

function writeFile(root, relativePath, contents = 'stub') {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function writeArtifacts(root, { windows = [], macos = [], linux = [] } = {}) {
  const platformDefaults = {
    macos: [
      `Touchpad.Tracker_${version}_aarch64.dmg`,
      'Touchpad.Tracker.app.tar.gz',
      'Touchpad.Tracker.app.tar.gz.sig',
    ],
    windows: [
      `Touchpad.Tracker_${version}_x64-setup.exe`,
      `Touchpad.Tracker_${version}_x64-setup.exe.sig`,
      `Touchpad.Tracker_${version}_x64_en-US.msi`,
    ],
    linux: [
      `Touchpad.Tracker_${version}_amd64.AppImage`,
      `Touchpad.Tracker_${version}_amd64.AppImage.sig`,
    ],
  };

  // Mirror how the workflow drops each platform into its own download directory.
  for (const platform of ['macos', 'windows', 'linux']) {
    for (const name of [...platformDefaults[platform], ...{ windows, macos, linux }[platform]]) {
      writeFile(root, path.join(platform, name));
    }
  }
}

function runManifest(root, output) {
  return execFileSync(process.execPath, [
    scriptPath,
    '--version', version,
    '--tag', `v${version}`,
    '--repository', 'izh20/saleae-logic-i2c',
    '--macos', path.join(root, 'macos'),
    '--windows', path.join(root, 'windows'),
    '--linux', path.join(root, 'linux'),
    '--output', output,
  ], { encoding: 'utf8' });
}

function releaseFixture(extraWindowsFiles = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'manifest-'));
  const output = path.join(root, 'release-artifacts');
  // The real Windows artifact always carries the portable archive; extras stack on top.
  writeArtifacts(root, { windows: [`Touchpad.Tracker_${version}_portable_x64.7z`, ...extraWindowsFiles] });
  runManifest(root, output);
  return { root, output };
}

describe('generate-updater-manifest', () => {
  it('publishes the portable Windows archive alongside the installers', () => {
    const { output } = releaseFixture();

    expect(readdirSync(output)).toContain(`Touchpad.Tracker_${version}_portable_x64.7z`);
  });

  it('still picks the NSIS installer as the Windows updater asset when a portable exe is present', () => {
    const { output } = releaseFixture(['Touchpad Tracker.exe']);

    const manifest = JSON.parse(readFileSync(path.join(output, 'latest.json'), 'utf8'));
    expect(manifest.platforms['windows-x86_64'].url).toContain(`${version}_x64-setup.exe`);
  });

  it('does not ship the loose portable exe as a release asset', () => {
    const { output } = releaseFixture(['Touchpad Tracker.exe']);

    const released = readdirSync(output);
    expect(released).not.toContain('Touchpad.Tracker.exe');
    expect(released.filter(name => name.endsWith('.exe'))).toEqual([`Touchpad.Tracker_${version}_x64-setup.exe`]);
  });

  it('keeps publishing the dmg, msi, and every platform updater asset', () => {
    const { output } = releaseFixture();

    expect(readdirSync(output).sort()).toEqual([
      'Touchpad.Tracker.app.tar.gz',
      'Touchpad.Tracker.app.tar.gz.sig',
      `Touchpad.Tracker_${version}_aarch64.dmg`,
      `Touchpad.Tracker_${version}_amd64.AppImage`,
      `Touchpad.Tracker_${version}_amd64.AppImage.sig`,
      `Touchpad.Tracker_${version}_portable_x64.7z`,
      `Touchpad.Tracker_${version}_x64-setup.exe`,
      `Touchpad.Tracker_${version}_x64-setup.exe.sig`,
      `Touchpad.Tracker_${version}_x64_en-US.msi`,
      'latest.json',
    ]);
    expect(existsSync(path.join(output, 'latest.json'))).toBe(true);
  });
});
