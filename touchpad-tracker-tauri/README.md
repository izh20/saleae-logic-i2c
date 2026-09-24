# Touchpad Tracker (Tauri)

> **状态**：核心迁移已完成，目标 HID 设备与跨平台打包仍待实机验证。详见 [迁移方案](../docs/tauri_migration_plan.md)。

Tauri 2.x 重写版本，与 [touchpad-tracker/](../touchpad-tracker/)（Electron 版本）功能等价。

## 设计目标

| 指标 | Electron 版 | Tauri 版目标 |
|------|:---:|:---:|
| 安装包体积 | 95 MB | **< 10 MB** |
| 冷启动内存 | ~250 MB | **< 100 MB** |
| 冷启动时间 | ~1s | **< 0.5s** |
| HID 原生模块 | `node-hid`（需 rebuild） | `hidapi-rs`（无 rebuild） |

## 开发

```bash
npm install
npm test
npm run tauri dev
```

生产构建使用 `npm run tauri build`。Rust 单元测试可通过
`cargo test --manifest-path src-tauri/Cargo.toml` 运行。

## 版本管理

`package.json` 是唯一版本源；Tauri 安装包从该文件读取版本，版本脚本同步
`Cargo.toml` 和 lockfile。生产构建前会自动检查版本一致性。

```bash
npm run version:check          # 检查各处版本是否一致
npm run version:set -- 1.2.3  # 设置指定 SemVer 版本
npm run version:patch          # 0.1.0 -> 0.1.1
npm run version:minor          # 0.1.0 -> 0.2.0
npm run version:major          # 0.1.0 -> 1.0.0
```

正式发布应使用一条命令完成升版本和打包，避免重复发布相同版本：

```bash
npm run release -- 1.2.3    # 发布指定版本
npm run release -- --patch  # 自动升级补丁版本并发布
```

版本会同时出现在应用界面、macOS `Info.plist`、DMG 文件名和 Windows 安装包元数据中。

## 跨平台构建

Tauri 桌面安装包需要在目标系统上原生构建，不能在 macOS 上直接生成完整的
Windows 和 Linux 安装包。仓库中的
`.github/workflows/tauri-release.yml` 使用 GitHub Actions 并行构建：

| 平台 | Runner | 发布产物 |
|------|--------|----------|
| macOS | `macos-14` | `.dmg` |
| Windows | `windows-latest` | `.msi`、NSIS `.exe` |
| Linux | `ubuntu-22.04` | `.AppImage`、`.deb`、`.rpm` |

在 GitHub 的 **Actions → Tauri Cross-Platform Release → Run workflow** 中可手动
构建当前版本，产物会保留 30 天。正式发布流程：

```bash
npm run version:set -- 0.2.0
git add touchpad-tracker-tauri .github/workflows/tauri-release.yml
git commit -m "release: v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

标签必须与 `package.json` 版本完全一致。三个平台构建全部成功后，CI 会创建
GitHub Release 并附上所有安装包。

本地构建 Windows 版需要 Node.js 22、Rust stable、Microsoft C++ Build Tools 和
WebView2；进入项目目录后运行 `npm ci && npm run tauri build`。

本地构建 Ubuntu 22.04/24.04 版需先安装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev \
	libayatana-appindicator3-dev librsvg2-dev libudev-dev patchelf rpm
npm ci
npm run tauri build
```

应用启动后自动监听 `127.0.0.1:50000` 的 Saleae UDP 数据。首次运行且 Tauri
配置不存在时，会从 Electron 的 `touchpad-tracker/config.json` 单向导入配置。

## 目录结构

```
touchpad-tracker-tauri/
├── src/                   # React + TS 前端（迁移自原 touchpad-tracker/src）
│   ├── components/
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   ├── hid/               # coordinateParser / coordinateFormatSchema 等
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/             # Rust 后端（新增）
│   ├── src/
│   │   ├── main.rs
│   │   ├── udp_server.rs
│   │   ├── hid_device.rs
│   │   └── commands.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── README.md
```

HID 后端使用专用 Rust worker 独占设备；UDP 与 HID 输入统一发布为
`raw-frame`，坐标解析和 UI 订阅在前端适配层完成。
