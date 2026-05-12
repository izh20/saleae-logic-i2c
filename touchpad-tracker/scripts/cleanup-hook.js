// Electron Forge packageAfterCopy hook — 删除不必要的文件以减小包体积
const fs = require('fs');
const path = require('path');

// 仅保留这些 locale（Electron 自带 ~60 个语言包，只保留英语和简体中文）
const KEEP_LOCALES = new Set([
  'en', 'en.lproj', 'en-US.pak',
  'zh_CN.lproj', 'zh_CN', 'zh-CN.pak',
]);

const SAFE_TO_DELETE = ['LICENSE', 'LICENSES.chromium.html', 'version'];

module.exports = async function (forgeConfig, buildPath, electronVersion, platform, arch) {
  console.log('[cleanup-hook] Processing:', buildPath);
  console.log('[cleanup-hook] Platform:', platform, 'Arch:', arch);

  removeUnusedLocales(buildPath);
  removeUnnecessaryFiles(buildPath);

  // 统计 app 目录大小
  logSize('app code', buildPath);

  // 统计 Electron 根目录大小（往上两级）
  const appRoot = path.resolve(buildPath, '..', '..');
  logSize('Electron root', appRoot);
};

function removeUnusedLocales(packageDir) {
  const resourceDirs = findResourceDirs(packageDir);

  for (const resDir of resourceDirs) {
    const basename = path.basename(resDir);

    // Remove locale .pak files (Chromium i18n data, Windows/Linux)
    // resDir 可能是 locales/ 目录本身，也可能是其父目录
    if (basename === 'locales') {
      removeLocalePaks(resDir);
      continue;
    }

    // Remove .lproj locale dirs (macOS)
    // resDir 是 Resources/ 目录，.lproj 在其下
    try {
      const entries = fs.readdirSync(resDir);
      for (const entry of entries) {
        if (entry.endsWith('.lproj') && !KEEP_LOCALES.has(entry)) {
          const localePath = path.join(resDir, entry);
          if (fs.statSync(localePath).isDirectory()) {
            fs.rmSync(localePath, { recursive: true });
            console.log('[cleanup-hook] Removed locale:', entry);
          }
        }
      }
    } catch { /* not a resources dir */ }

    // 也可能 locales/ 在 Resources/ 子目录下 (部分Linux构建结构)
    const localesPakDir = path.join(resDir, 'locales');
    if (fs.existsSync(localesPakDir)) {
      removeLocalePaks(localesPakDir);
    }
  }
}

function removeLocalePaks(localesDir) {
  try {
    const localeFiles = fs.readdirSync(localesDir);
    let removed = 0;
    for (const file of localeFiles) {
      if (file.endsWith('.pak') && !KEEP_LOCALES.has(file)) {
        const fullPath = path.join(localesDir, file);
        const fileSize = fs.statSync(fullPath).size;
        fs.rmSync(fullPath);
        removed++;
        console.log('[cleanup-hook] Removed locale pak: ' + file + ' (' + (fileSize / 1024).toFixed(1) + ' KB)');
      }
    }
    if (removed > 0) {
      console.log('[cleanup-hook] Total locale paks removed: ' + removed);
    }
  } catch { /* skip */ }
}

function removeUnnecessaryFiles(packageDir) {
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SAFE_TO_DELETE.includes(entry.name)) {
          const p = path.join(dir, entry.name);
          fs.rmSync(p, { recursive: true });
          console.log('[cleanup-hook] Removed file:', p);
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name));
        }
      }
    } catch { /* skip */ }
  }
  walk(packageDir);
}

function findResourceDirs(packageDir) {
  const result = [];

  // 从 app 目录往上找父级 Resources 和 locales 目录
  // macOS:  .../Electron.app/Contents/Resources/app → ../ 就是 Resources
  // Windows: .../resources/app → ../../ 的根目录有 locales/
  let current = path.resolve(packageDir, '..');
  for (let i = 0; i < 3 && current !== '/'; i++) {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          // macOS .lproj 在 Resources/ 下
          if (name === 'Resources') {
            const resPath = path.join(current, name);
            if (!result.includes(resPath)) result.push(resPath);
          }
          // Chromium .pak 文件在 locales/ 下 (Windows/Linux)
          if (name === 'locales') {
            const localePath = path.join(current, name);
            if (!result.includes(localePath)) result.push(localePath);
          }
        }
      }
    } catch { /* skip */ }
    current = path.resolve(current, '..');
  }

  return result;
}

function logSize(label, dir) {
  let totalSize = 0;
  function walk(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const p = path.join(d, entry.name);
        if (entry.isFile()) {
          totalSize += fs.statSync(p).size;
        } else if (entry.isDirectory()) {
          walk(p);
        }
      }
    } catch { /* skip */ }
  }
  walk(dir);
  console.log('[cleanup-hook] ' + label + ' size: ' + (totalSize / 1024 / 1024).toFixed(1) + ' MB');
}
