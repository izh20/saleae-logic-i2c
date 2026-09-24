# Updater 接入方案 —— v0.1.2（GitHub Releases 渠道）

> 范围：v0.1.2 起在客户端启用 Tauri `Updater` 插件，**只走 GitHub Releases 渠道**。v0.1.2 是需要手动安装的引导版本，第一次正式自动升级从 v0.1.2 → v0.1.3 开始。
> 设计原则：**渠道无关**。endpoints 是字符串数组、签名与渠道解耦、`latest.json` schema 不变 —— 未来追加自有 HTTP / S3 / OSS **不需要升级客户端**，只在 `tauri.conf.json` 多填一个 URL + 让 CI 把 `latest.json` 多镜像一份。
>
> 文档版本：v1.4 · 2026-09-24 · 配套 Tauri CLI 2.11.5 / Tauri v2.x · 配套 `touchpad-tracker-tauri@0.1.1+`

---

## §0 目标与非目标

### 目标

| # | 内容 | 验收 |
|---|------|------|
| G1 | 客户端启动时**自动检测**是否有新版本 | 启动后异步检测；有更新时显示横幅，不阻塞主界面 |
| G2 | 用户在 UI 里「立即更新 / 稍后再说」可拒绝 | 「稍后」不重启、不下载 |
| G3 | 「立即更新」下载完成 → 安装新版 → 重启应用 | Windows 由安装器退出旧进程；macOS / Linux 显式调用 `relaunch()`；重启后版本号变新 |
| G4 | 升级包被中间人篡改 → 拒绝安装 | 点击更新后 UI / console 显示签名校验失败，旧版继续运行 |
| G5 | CI 在各平台 `tauri build` 时产出升级包及独立 `.sig` | macOS `.app.tar.gz`、Windows NSIS `.exe`、Linux `.AppImage` 及对应 `.sig` 均出现在 Release assets |
| G6 | `latest.json` 自动随 Release 发布 | Release 页面能看到 `latest.json` asset |

### 非目标（v1 范围）

| # | 内容 | 说明 |
|---|------|------|
| N1 | 运行时切换更新源（endpoints resolver） | 留到 v0.1.3；v1 只硬编码一个 endpoint |
| N2 | 自有 HTTP / S3 / OSS 渠道 | 留到后续版本；v1 schema/代码/密钥 已为之留好接口 |
| N3 | 多密钥 / 内网独立公钥 | 单密钥对覆盖所有渠道 |
| N4 | 灰度发布 / AB 分流 | `latest.json` 是单一版本号 |
| N5 | macOS Apple Silicon 之外的其他架构 | 仍然只产 `aarch64.dmg`；updater 平台字段同步精简 |
| N6 | 移动端（iOS / Android） | 桌面端 only |
| N7 | v0.1.1 → v0.1.2 自动升级 | v0.1.1 没有 updater；v0.1.2 必须手动安装 |

---

## §1 关键决策

| 决策点 | 选项 | 选定 | 理由 |
|--------|------|------|------|
| 升级机制 | Tauri `Updater` 插件 / 自研 | **Tauri 插件** | 官方维护、签名/回滚/原子安装已完备、跨平台覆盖 |
| 渠道协议 | GitHub Releases / 自有 HTTP / S3-OSS | **GitHub Releases**（v1） | 仓库已公开发行；零额外基础设施 |
| endpoints 形式 | `tauri.conf.json` 硬编码 / 运行时读 store | **硬编码**（v1） | 渠道单一，硬编码足够；resolver 留 v0.1.3 |
| 公钥嵌入 | `tauri.conf.json` / 单独文件 | **`tauri.conf.json` `plugins.updater.pubkey`** | 官方推荐；与其他 plugin 配置同源 |
| 私钥保管 | 本地密钥文件 / GitHub Actions secret | **GitHub Actions secret + 离线备份** | CI 使用 secret；私钥和密码分别做受控离线备份 |
| 升级触发时机 | 启动自动检测 / 手动按钮 / 两者 | **两者** | 启动静默检测 + Help 模态里有「检查更新」按钮 |
| Windows 安装方式 | NSIS / MSI | **仅发布 NSIS** | 静态 manifest 每个平台只有一个 URL，避免 MSI / NSIS 混用 |
| Linux 安装方式 | AppImage / deb / rpm | **仅发布 AppImage** | 静态 manifest 每个平台只有一个 URL，避免 deb/rpm 客户端误装 AppImage |
| macOS 安装方式 | `.app` / `.dmg` | **`.app`** | updater 接受 `.app.tar.gz`；`.dmg` 仅供首次手动安装 |
| 失败 UX | 静默 / toast / 阻塞对话框 | **toast + Help 日志** | 启动失败不打扰用户；点 Help 可见日志 |
| 旧版备份 | Tauri 默认 | **保留默认** | 校验失败/中断时旧版继续运行 |
| 跨平台 channel 命名 | Tauri 平台名 / 自定义 | **Tauri 平台名** | `darwin-aarch64` / `windows-x86_64` / `linux-x86_64` |

---

## §2 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                   用户机器（运行 v0.1.x 客户端）                      │
│                                                                     │
│  ┌──────────────┐    start() / Help 触发    ┌────────────────────┐ │
│  │  React App   │ ────────────────────────▶ │ @tauri-apps/plugin │ │
│  │  App.tsx     │                          │   -updater (前端)   │ │
│  └──────────────┘                          └──────────┬─────────┘ │
│         │                                            │            │
│         │ toast 显示更新日志 / 触发重启               ▼            │
│         │                                  ┌────────────────────┐ │
│         │                                  │   Tauri Core (Rust)│ │
│         │                                  │  tauri-plugin-     │ │
│         │                                  │     updater        │ │
│         │                                  └──────────┬─────────┘ │
│         │                                             │           │
└─────────┼─────────────────────────────────────────────┼───────────┘
          │   ① GET https://github.com/.../latest/latest.json
          ▼                                             │
   ┌────────────┐                                       │
   │  GitHub    │                                       │
   │  Releases  │ ◀────────────────────────────────────┘
   │  /latest   │   ② 解析 platforms.<target>.url + signature
   │            │   ③ 下载升级包（带进度事件）
   └────────────┘   ④ 用嵌入 pubkey 校验 signature
                    ⑤ 校验通过 → 退出旧版 → 解压 → 替换 → 启动新版
                    ⑥ 失败 → 保留旧版 + 错误日志
```

```
┌────────────────────────────────────────────────────────────────────┐
│                  CI（GitHub Actions · 三平台并行）                    │
│                                                                     │
│  matrix:                                                            │
│    [macos-14] → tauri build → *.app.tar.gz + *.sig                  │
│    [windows]  → tauri build → *-setup.exe + *.sig                  │
│    [ubuntu]   → tauri build → *.AppImage + *.sig                   │
│                                                                     │
│  各平台 build job：                                                 │
│    ① 注入 TAURI_SIGNING_PRIVATE_KEY，由 Tauri 构建期签名            │
│  聚合 job：                                                         │
│    ② 读取三个独立 .sig 文件 → 生成 latest.json                     │
│    ③ softprops/action-gh-release 上传 assets                       │
│       - 各平台升级包 + 对应 .sig                                   │
│       - latest.json（asset 名固定为 latest.json）                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## §3 客户端实现

### 3.1 依赖

**Rust 侧** —— [src-tauri/Cargo.toml](../../touchpad-tracker-tauri/src-tauri/Cargo.toml) 增加：

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**前端侧** —— [package.json](../../touchpad-tracker-tauri/package.json) `dependencies` 增加：

```json
"@tauri-apps/plugin-updater": "^2",
"@tauri-apps/plugin-process": "^2"
```

### 3.2 插件注册

[src-tauri/src/lib.rs](../../touchpad-tracker-tauri/src-tauri/src/lib.rs) 在 `tauri::Builder::default()` 后追加：

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

**关键说明**：构建期 Tauri 会读取 `tauri.conf.json` 的 `plugins.updater.pubkey` 自动嵌入；运行期无需手动传入。Windows 安装时会自动退出；macOS / Linux 必须在 `downloadAndInstall()` 完成后显式调用 `relaunch()`。

### 3.3 配置

[src-tauri/tauri.conf.json](../../touchpad-tracker-tauri/src-tauri/tauri.conf.json) 新增 `plugins.updater`：

```jsonc
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/izh20/saleae-logic-i2c/releases/latest/download/latest.json"
      ],
      "pubkey": "<从 ~/.tauri/keys/key.pub 粘贴>",
      "windows": { "installMode": "passive" }
    }
  }
}
```

> `bundle.createUpdaterArtifacts` 在当前 Tauri CLI 2.11.5 schema 中存在且默认是 `false`。必须显式设为 `true`，构建期才会生成 updater artifact 和同名 `.sig`。

> **pubkey 是一次性产出**。第一次配好以后不再变。私钥绝不入库，仅保存在 GitHub Actions secret 和受控的离线备份中。

### 3.4 能力（capabilities）

[src-tauri/capabilities/default.json](../../touchpad-tracker-tauri/src-tauri/capabilities/default.json) 的 `permissions` 数组追加：

```jsonc
"updater:default",
"process:allow-restart"
```

否则前端 `check()` 或 `relaunch()` 调用会被沙箱拒绝。这里只开放重启，不开放任意退出。

### 3.5 前端接线

新建 [src/updater/index.ts](../../touchpad-tracker-tauri/src/updater/index.ts) —— 把 updater 调用收敛到一个模块，方便 v0.1.3 接入 resolver：

```ts
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
  available: Update;
  version: string;
  notes?: string;
}

/**
 * 启动期静默检测。返回 null 表示「无更新 / 检测失败（不打扰）」。
 * 失败原因写入 console 即可，不打扰用户。
 */
export async function detectUpdateOnStartup(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    return update ? { available: update, version: update.version, notes: update.body } : null;
  } catch (e) {
    console.warn('[updater] startup check failed:', e);
    return null;
  }
}

/**
 * 手动触发检测（Help 模态里「检查更新」按钮）。
 * 抛错给调用方显示给用户。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  return update ? { available: update, version: update.version, notes: update.body } : null;
}

/**
 * 下载 + 安装 + 重启。
 * Windows 安装器自动退出旧进程；macOS / Linux 安装后显式重启。
 */
export async function installAndRestart(
  info: UpdateInfo,
  onProgress?: (event: DownloadEvent) => void,
): Promise<void> {
  await info.available.downloadAndInstall(onProgress);
  await relaunch();
}
```

### 3.6 UI 接入点

[src/App.tsx](../../touchpad-tracker-tauri/src/App.tsx) 改动：

1. 启动时调一次 `detectUpdateOnStartup()`（在 `useEffect(() => {}, [])` 中）：
   - 有更新 → setState 标记「发现新版本 vX.Y.Z」+ 弹一个非阻塞 toast/横幅（不阻塞操作）
2. Help 模态的「版本信息」一节增加：
   - 「检查更新」按钮（手动 `checkForUpdate()`）
   - 当前版本号 `v{appVersion}`（已有）
   - 「发现新版本 vX.Y.Z」时显示「立即更新 / 稍后」按钮
3. 「立即更新」按钮调 `installAndRestart(info)`：
   - 关闭 Help 模态
   - 根据 `Started / Progress / Finished` 事件显示下载进度
  - Windows 安装器自动退出旧进程；macOS / Linux 安装完成后调用 `relaunch()`

### 3.7 不在范围内

- ❌ 不做 macOS Intel 版升级源（保持单架构）
- ❌ 不做 S3/OSS 镜像（v1 客户端不感知；CI 不上传到别处）
- ❌ 不做 endpoints resolver（v0.1.3）

---

## §4 一次性密钥引导

### 4.1 本地生成（只在开发机执行一次）

```bash
cd touchpad-tracker-tauri/src-tauri
npx tauri signer generate -w ~/.tauri/keys/key.key -p "<密码>"
# 产出：
#   ~/.tauri/keys/key.key  —— 私钥（PEM + 加密密码），**绝不入库**
#   ~/.tauri/keys/key.pub  —— 公钥
```

把 `key.pub` 内容**原样**粘到 `tauri.conf.json` 的 `plugins.updater.pubkey` 字段（一行字符串，无换行）。

### 4.2 GitHub 仓库配 secret

在 https://github.com/izh20/saleae-logic-i2c/settings/secrets/actions 加两个 secret：

| Secret 名 | 内容 | 用途 |
|-----------|------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.tauri/keys/key.key` 的完整 PEM 内容 | CI 签名 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设的密码 | 解密私钥 |

### 4.3 验证

- 启用 `createUpdaterArtifacts` 后，本地 `tauri build` 必须提供 `TAURI_SIGNING_PRIVATE_KEY` 和密码；日常只验证前端时可使用 `npm run build`
- 当前开发机未安装完整 Xcode，本地 macOS bundle 验证需先安装 Xcode；安装前使用 `workflow_dispatch` 验证 CI 产物
- v0.1.2 是 updater 引导版本：安装 v0.1.2 后检查生产 endpoint 应显示「已是最新」；自动升级链路使用测试 endpoint 验证 v0.1.2 → v0.1.3-test.1

---

## §5 CI 改动

### 5.1 [tauri-release.yml](../../.github/workflows/tauri-release.yml) 改动一览

按 §5.2 – §5.5 四处插入/调整。

### 5.2 在各平台 build job 中生成并签名 updater 产物

Tauri v2 在 `bundle.createUpdaterArtifacts: true` 时生成 updater artifact 与同名 `.sig`。注入私钥和密码后，CLI 在目标平台构建期签名。不要把三平台产物下载到 Ubuntu 后用 `tauri signer sign` 二次签名。

矩阵按平台固定 bundle 类型，避免同一 `OS-ARCH` 下出现多种不可区分的安装格式：

```yaml
strategy:
  matrix:
    include:
      - name: macOS
        os: macos-14
        bundles: app,dmg
        artifact_name: touchpad-tracker-macos
      - name: Windows
        os: windows-latest
        bundles: nsis
        artifact_name: touchpad-tracker-windows
      - name: Linux
        os: ubuntu-22.04
        bundles: appimage
        artifact_name: touchpad-tracker-linux
```

```yaml
- name: Build Tauri bundles
  env:
    # Tauri CLI 自动从环境变量读取（见 `npx tauri signer sign --help`）
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: npm run tauri build -- --bundles ${{ matrix.bundles }}
```

同时扩展矩阵中的 `artifact_paths`：

```yaml
# macOS
touchpad-tracker-tauri/src-tauri/target/release/bundle/macos/*.app.tar.gz
touchpad-tracker-tauri/src-tauri/target/release/bundle/macos/*.app.tar.gz.sig
# Windows NSIS
touchpad-tracker-tauri/src-tauri/target/release/bundle/nsis/*-setup.exe
touchpad-tracker-tauri/src-tauri/target/release/bundle/nsis/*-setup.exe.sig
# Linux
touchpad-tracker-tauri/src-tauri/target/release/bundle/appimage/*.AppImage
touchpad-tracker-tauri/src-tauri/target/release/bundle/appimage/*.AppImage.sig
```

### 5.3 新增 `generate-update-manifest` job

该 job 等待三个平台构建完成，分别下载 `touchpad-tracker-macos`、`touchpad-tracker-windows`、`touchpad-tracker-linux` 到独立目录，然后调用仓库脚本 `scripts/generate-updater-manifest.mjs`：

1. 递归查找且断言每个平台恰好有一个 updater 产物和同名 `.sig`
2. 读取 `.sig` 完整文本写入 `platforms.<target>.signature`
3. 使用实际产物文件名生成 GitHub Release URL
4. 对 URL 中的 asset 文件名使用 `encodeURIComponent`，确保空格等字符被正确编码
5. 把 DMG、NSIS、AppImage、updater 签名及 `latest.json` 全部复制到 `release-artifacts/`
6. 任一产物、签名或平台条目缺失，或存在同平台多个候选产物时立即失败

不要依赖 upload/download artifact 的内部目录层级，也不要硬编码 `Touchpad.Tracker` 文件名。聚合结果再次上传为名为 `updater-release` 的 Actions artifact。

### 5.4 release job 改成消费聚合 artifact

原 job：

```yaml
release:
  needs: build
```

改为：

```yaml
release:
  needs: [build, generate-update-manifest]
```

并把 `download-artifact` 改成下载 `updater-release` 这个 artifact：

```yaml
- name: Download platform bundles
  uses: actions/download-artifact@v4
  with:
    name: updater-release
    path: release-artifacts
    merge-multiple: true
```

剩下的 `softprops/action-gh-release` 不动 —— 它会把 `release-artifacts/**` 全部上传为 release assets（升级包 + latest.json）。

### 5.5 workflow_dispatch 只构建、不发布

现有 `release` job 已有 `if: startsWith(github.ref, 'refs/tags/')`，因此手动触发只生成 Actions artifacts，不创建草稿 Release，也不会改变 `/releases/latest/`。这条路径用于验证三平台构建和 manifest 生成，不能用于客户端端到端更新测试。

### 5.6 不在范围内

- ❌ 不上传到自有 HTTP / S3 / OSS（v0.1.3+）
- ❌ 不为 Intel Mac / Linux ARM64 加条目（架构精简）
- ❌ 不为 Windows ARM64 加条目（runner 没货）

---

## §6 协议契约

### 6.1 `latest.json` schema（Tauri 定义，客户端只读）

```json
{
  "version": "0.1.2",
  "notes": "release 0.1.2",
  "pub_date": "2026-09-24T11:53:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "<由 §5.3 脚本从 macOS artifact 目录读取实际文件名后填充>",
      "signature": "<base64>"
    },
    "windows-x86_64": {
      "url": "<由 §5.3 脚本从 Windows artifact 目录读取实际文件名后填充>",
      "signature": "<base64>"
    },
    "linux-x86_64": {
      "url": "<由 §5.3 脚本从 Linux artifact 目录读取实际文件名后填充>",
      "signature": "<base64>"
    }
  }
}
```

> **URL 由脚本填充，不要硬编码**。Tauri 默认产物名内嵌版本号与平台代号（形如 `Touchpad.Tracker_0.1.2_x64-setup.exe`），下次升级会脱节 —— §5.3 聚合脚本按后缀递归发现文件并写出实际路径。

- `version` —— 严格 SemVer；Tauri 客户端按 SemVer 比较
- `pub_date` —— ISO 8601；人类可读，Tauri 不强制
- `notes` —— 字符串（前端可展示）
- `platforms.<target>.url` —— 直链（HTTPS）；Tauri 会整文件 GET
- `platforms.<target>.signature` —— base64 字符串；客户端用嵌入 pubkey 校验

### 6.2 三平台 target 字符串与产物对应

| `platforms.<target>` | 客户端 OS / 架构 | CI 产物 | Tauri 实际接受 |
|---|---|---|---|
| `darwin-aarch64` | macOS Apple Silicon | `*.app.tar.gz` | ✅ |
| `windows-x86_64` | Windows x64 | NSIS `*-setup.exe` | ✅；v1 Release 不再发布 MSI，避免安装格式混用 |
| `linux-x86_64` | Linux x86_64 | `*.AppImage` | ✅；v1 Release 不再发布 deb/rpm，避免非 AppImage 客户端误用 updater |

> 暂只支持上述三个 target，Intel Mac / Linux ARM64 / Windows ARM64 用户会**看不到更新**（符合 v0.1.1 发布策略）。

### 6.3 升级包 URL 与同名 `.sig`

启用 `bundle.createUpdaterArtifacts: true` 并提供私钥后，Tauri v2 在构建期生成升级产物及同名 `.sig` 文件。`latest.json` 的 `signature` 必须是 `.sig` 文件的完整文本（base64），不是路径或 URL。`tauri build` 会就地签名，CI 不需要也不应该再手工 `signer sign`。

---

## §7 测试 / 验证

### 7.1 单元 / 集成测试

| 用例 | 验证 | 备注 |
|------|------|------|
| 启动期 `detectUpdateOnStartup()` 无新版 → 返回 null | `latest.json` version == `package.json` version | 不抛错、不打扰 |
| 启动期 `detectUpdateOnStartup()` 有新版 → 返回 `UpdateInfo` | mock `check()` 返回 Update | toast 正常出现 |
| `checkForUpdate()` 网络失败 → 抛错给 Help UI | 模拟断网 | 显示「检查更新失败」 |
| `installAndRestart()` 调用 → 安装并重启 | mock `downloadAndInstall`、`relaunch` | 两者依次调用；下载失败时不调用 `relaunch` |
| 下载进度回调 | mock `Started / Progress / Finished` | UI 百分比或不定进度状态正确 |

### 7.2 手动端到端验证

按下列顺序回归一次：

1. **本地**：
   - 设置签名环境变量后执行 `npm run tauri build`
   - 确认 macOS 同时产出 `.app.tar.gz` 与 `.app.tar.gz.sig`
  - 当前机器需先安装完整 Xcode；未安装前跳过本地 bundle，使用 CI artifact
  - 启动 v0.1.2 → Help → 「检查更新」返回「已是最新」
2. **CI 与发布前验证**：
   - `workflow_dispatch` → 确认三平台 updater 产物、`.sig`、`latest.json` 均在 Actions artifact 中
  - 确认 Release 只包含 DMG / NSIS / AppImage 三种安装格式及 updater 签名，不包含 MSI / deb / rpm
3. **自动升级链路**：
  - 用仅供测试的 Tauri 配置把 endpoint 指向独立测试仓库；生产配置仍指向正式 `/releases/latest/`
  - 在测试仓库发布由同一私钥签名的 `v0.1.3-test.1` 产物和 `latest.json`
  - 安装 v0.1.2 测试构建 → 检查更新 → 下载 → 安装 → 重启后版本为 v0.1.3-test.1
  - 不能用 v0.1.1 验证该链路，因为 v0.1.1 不包含 updater
4. **签名篡改测试**：
   - 下载已发布的 updater 二进制，修改其中一个 byte，并用测试 endpoint 保持原 `signature` 不变
   - 客户端下载后应报告签名校验失败，旧版继续运行
5. **跨平台验证**：
  - 在 Windows 10/11 用 NSIS 安装 v0.1.2 测试构建，验证升级到 v0.1.3-test.1
  - 在 Ubuntu 22.04 / 24.04 用 AppImage 启动 v0.1.2 测试构建，验证升级到 v0.1.3-test.1

### 7.3 验收清单

- [ ] G1-G4 使用 v0.1.2 测试构建和 v0.1.3-test.1 测试 endpoint 完整跑通
- [ ] G5-G6 在 tag push 时跑通
- [ ] §7.2 全部 5 步人工通过
- [ ] README 增补「升级」一节（指向 release 链接）
- [ ] CHANGELOG（若存在）记录 `0.1.2 - 加入自动升级`

---

## §8 升级行为详解（UX 路径）

### 8.1 启动期路径

```
用户启动 v0.1.2 客户端
   │
   ▼
App.tsx useEffect ──▶ detectUpdateOnStartup()
   │
   ├─ 无更新 / 失败 ──▶ 静默（log: no update available）
   │
   └─ 有更新（latest.json version > package.json version）
       │
       ▼
   setState: { updateAvailable: { version, notes } }
       │
       ▼
  顶部横幅：「发现 v0.1.3，点击立即更新」   [立即] [稍后]
       │
       ├─ [稍后] ──▶ 横幅关闭
       │
       └─ [立即] ──▶ installAndRestart(info)
                       │
                       ▼
                   downloadAndInstall(onProgress)
                       │
                       ├─ 下载中 → 「正在准备更新…」toast + 进度
                       │
                       ├─ Windows ──▶ 安装器退出旧进程并安装
                       ├─ macOS/Linux ──▶ 安装完成 → relaunch() → 新版启动
                       │
                       └─ 失败（签名 / 网络） → 横幅变红：「升级失败，请稍后重试」
                                                旧版继续运行
```

### 8.2 Help 模态路径

```
Help 模态 → 「关于 / 版本信息」节
   │
  ├─ 当前版本：v0.1.2（appVersion）
   ├─ 「检查更新」按钮 → checkForUpdate()
   │    │
  │    ├─ 无更新 → toast「已是最新 v0.1.2」
  │    ├─ 有更新 → 显示「v0.1.3 已发布」+ 「立即更新」按钮
   │    └─ 失败 → toast「检查更新失败（看 console）」
   │
   └─ 自动检测状态：上次检测时间 + 结果
```

### 8.3 不打扰原则

- 启动期「有更新」**不阻塞**用户操作 —— 横幅不模态
- 用户点「稍后」即静默，**不再自动弹出**直到下一次重启或手动检查
- 网络失败 / 签名失败 / 磁盘不足 → 横幅红色提示，但**不退出旧版**
- 下载中断后提示失败；v1 不承诺断点保留或续传，用户可重新点「立即更新」

---

## §9 风险与缓解

| ID | 风险 | 等级 | 缓解 |
|----|------|:---:|------|
| R-1 | **签名私钥泄露或丢失**：泄露后可伪造升级包；丢失后无法给已安装客户端发布更新 | 🔴 高 | secret 加 environment protection；私钥和密码分别做离线安全备份；公钥可随配置入库；监控 secret 访问 |
| R-2 | **引导版本边界**：v0.1.1 没有 updater，无法自动升级到 v0.1.2 | 🟡 中 | 明确 v0.1.2 必须手动安装；发布前用测试 endpoint 验证 v0.1.2 → v0.1.3-test.1 |
| R-3 | **macOS 公证**：Tauri 升级会替换 `/Applications/Touchpad Tracker.app`；未公证的 `.app` 会被 Gatekeeper 拦截 | 🟡 中 | 如果 macOS 安装包需要 notarize，加 `tauri.conf.json.bundle.macOS.entitlements` + CI 上 `xcrun notarytool submit`；v1 如果不做公证，至少在 README 写明「首次升级会要求右键打开」 |
| R-4 | **Windows 签名 / SmartScreen**：未签名的 NSIS 安装包触发 SmartScreen 警告 | 🟡 中 | 如已购买代码签名证书，把它通过 `WINDOWS_CERTIFICATE` secret 传给 `tauri build`；否则 README 注明「已知问题」 |
| R-5 | **Linux AppImage 沙箱**：在受限发行版（Fedora Silverblue / NixOS）上无法 mount/执行 | 🟢 低 | 这类用户无法运行任何 AppImage 应用；不在支持范围 |
| R-6 | **构建产物命名随 Tauri 版本变化**：硬编码文件名会导致 manifest 指向不存在的 asset | 🟡 中 | 聚合脚本按后缀递归发现文件，并断言每个平台恰好一个产物及同名 `.sig`；构建缺少签名时直接失败，不在聚合 job 补签 |
| R-7 | **升级时机原子性**：下载和安装完成后应用会退出或重启；如果用户还有未保存的录音/回放，可能丢失当前会话 | 🟢 低 | 触发 `installAndRestart` 前提示「将关闭当前会话」；播放页自动停止 |
| R-8 | **网络分区场景**：`latest.json` 在 GitHub 但用户在国内访问慢 | 🟡 中 | v0.1.3 引入自有 HTTP / 镜像；v1 先文档化此限制 |
| R-9 | **Tauri v2 平台字符串命名变更**：从 `darwin-aarch64` 改为 `macos-aarch64` 等 | 🟢 低 | CI 加 `tauri info` 输出 `target triple`，与 `latest.json.platforms` 字段名做一致性断言 |
| R-10 | **Tauri 插件升级破坏 API**：`@tauri-apps/plugin-updater` 主版本升级可能改 `check()` 返回值 | 🟢 低 | 用 `^2` 版本范围，每次升级前看 changelog；接口差异收敛在 `src/updater/index.ts` 一处 |

---

## §10 验收 / 上线流程

### 10.1 DoD（Definition of Done）

- [ ] §7 全部测试通过
- [ ] §8 三条路径在真机验证（macOS / Windows / Linux 各一）
- [ ] §9 R-1 / R-3 / R-4 至少做到 mitigation 标注
- [ ] README 增补「更新」段（自动检测 + 手动按钮 + 回滚方式）
- [ ] CHANGELOG 写明 v0.1.2 引入自动升级
- [ ] §11 待确认事项全部 close

### 10.2 上线 checklist

```
1. 本地：npx tauri signer generate → 配 secret + pubkey
2. 本地：npm run version:set -- 0.1.2
3. 提交 + push（commit log：feat: 接入 Tauri 自动升级，支持 GitHub Releases 渠道）
4. 打 tag：git tag v0.1.2 && git push origin v0.1.2
5. CI 自动跑三平台 build + sign + release
6. 手动安装 v0.1.2 → 启动 → Help → 检查更新 → 应显示「已是最新」
7. 使用测试 endpoint 验证 v0.1.2 → v0.1.3-test.1 自动升级
8. 签名篡改测试 —— 见 §7.2 第 4 步
9. 三平台各做一次手动端到端（Windows / Linux 上如果只有 CI runner 可用，跳过真机）
10. Release 页面确认 latest.json 在 assets 列表里
```

---

## §11 待确认事项

| # | 问题 | 答复 | 落点 |
|---|------|------|------|
| Q1 | macOS 是否要走 notarize？v1 不走是否接受「首次升级右键打开」体验？ | **同意：v1 不做 notarize**；README 注明「首次升级会要求右键打开」 | §9 R-3 / README 「更新」一节 |
| Q2 | Windows 是否有代码签名证书？没有的话接受 SmartScreen 警告吗？ | **同意：v1 不加证书**；README 注明「已知问题：未签名安装包会触发 SmartScreen 警告」 | §9 R-4 / README 「更新」一节 |
| Q3 | 静态 manifest 无法区分 MSI / NSIS 或 AppImage / deb / rpm，如何避免格式混用？ | **已确认**：v1 Release 只发布 macOS DMG、Windows NSIS、Linux AppImage；不发布 MSI / deb / rpm | §5.2 / §6.2 / README 「更新」一节 |
| Q4 | macOS Intel 版要不要纳入 v0.1.2？ | **不纳入**；保持单架构（aarch64） | §6.2 |
| Q5 | 启动期检测是否给用户「稍后」以外的选择（例如「下次启动再说」）？ | **同意建议**：v1 只给「立即 / 稍后」；下次启动会再检测 | §8.1 |
| Q6 | `tauri signer sign` 在当前 Tauri CLI 上如何工作？ | **已确认**：当前语法为 `sign <FILE>`；CI 由 `tauri build` 生成独立 `.sig`（env 自动读取私钥），CI 不再手工 `signer sign` | §5.2 / §6.3 |

---

## §12 已确认事项

| # | 决策 | 来源 |
|---|------|------|
| C1 | 升级机制：Tauri `Updater` 插件 | 用户 #15 |
| C2 | 渠道：v0.1.2 只 GitHub Releases；后续支持 HTTP / S3 | 用户 #40–41 |
| C3 | 不动 touchpad-tracker（Electron） | 用户 #16 |
| C4 | 两版本绝不同时运行 | 用户 #17 |
| C5 | 暂不上架 Mac App Store / Microsoft Store | 用户 #17 |
| C6 | commit log 用中文 | 用户 #13 |
| C7 | endpoints resolver 留 v0.1.3 | 用户 #41 |
| C8 | 「启动静默检测 + Help 手动按钮」组合 | 方案 §3.6 |
| C9 | §11 Q1-Q6 答复全部按建议采用 | 用户「待确认项按建议来」 |

---

## §13 后续版本路线（不属本文档范围，仅记录）

| 版本 | 范围 | 备注 |
|------|------|------|
| v0.1.2 | GitHub Releases 渠道（本文档） | 唯一渠道、单一硬编码 endpoint |
| v0.1.3 | endpoints resolver + 自有 HTTP 渠道 | UI 切换；fallback 顺序；CI 多镜像一份 `latest.json` |
| v0.1.4 | S3 / OSS 渠道 + 国内 CDN | 仅改 `endpoints` 数组 + CI 加 `aws s3 cp` |
| v0.2.0 | macOS Intel / Linux ARM64 / Windows ARM64 升级源 | 补 `platforms.<target>` 条目 |
| v0.3.0 | 灰度发布（基于 `latest.json?channel=beta`） | 运行时策略 |

---

## 附录 A · 文件改动一览

| 文件 | 类型 | 说明 |
|------|:---:|------|
| `touchpad-tracker-tauri/package.json` | 改 | deps 加 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process` |
| `touchpad-tracker-tauri/src-tauri/Cargo.toml` | 改 | deps 加 `tauri-plugin-updater`、`tauri-plugin-process` |
| `touchpad-tracker-tauri/src-tauri/tauri.conf.json` | 改 | 新增 `bundle.createUpdaterArtifacts`、`plugins.updater.{endpoints,pubkey,windows.installMode}` |
| `touchpad-tracker-tauri/src-tauri/capabilities/default.json` | 改 | permissions 加 `updater:default`、`process:allow-restart` |
| `touchpad-tracker-tauri/src-tauri/src/lib.rs` | 改 | 注册 updater、process 插件 |
| `touchpad-tracker-tauri/src/updater/index.ts` | 新 | 检测 / 安装 / 重启封装 |
| `touchpad-tracker-tauri/src/App.tsx` | 改 | 启动期检测 + Help「检查更新」按钮 + 升级横幅 |
| `touchpad-tracker-tauri/scripts/generate-updater-manifest.mjs` | 新 | 校验三平台产物和签名，生成 `latest.json` |
| `.github/workflows/tauri-release.yml` | 改 | build 时注入签名密钥；新增 manifest 聚合 job；发布 updater assets |
| `touchpad-tracker-tauri/README.md` | 改 | 增补「更新」一节 |

## 附录 B · 参考

- Tauri Updater Plugin 文档：https://tauri.app/plugin/updater/
- Tauri Signer CLI：`npx tauri signer --help`
- GitHub Action secrets：https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions

---

文档版本：v1.4
作者：Claude Code（izh20 协作）
更新：
- v1.1 — §11 待确认项全部按建议关闭
- v1.2 — 按 Tauri v2 实际契约修正构建期签名、产物格式、跨平台重启和验证流程
- v1.3 — 曾误移除 `createUpdaterArtifacts` 和 `tauri-plugin-process`；同时将 `latest.json` URL 改为脚本填充并对齐版本号（错误结论已由 v1.4 撤销）
- v1.4 — 恢复 Tauri v2 必需的 `createUpdaterArtifacts` 和 macOS/Linux `relaunch()`；明确 v0.1.2 为手动引导版本；Release 收敛为 DMG / NSIS / AppImage
关联：[`tauri_migration_plan.md`](./tauri_migration_plan.md) §6 Phase 5 后续