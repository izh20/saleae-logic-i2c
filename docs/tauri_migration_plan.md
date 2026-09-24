# Touchpad Tracker · Tauri 迁移方案

> 版本：v1.3 · 更新日期：2026-09-24
> 目标工程：`touchpad-tracker-tauri/`（与原 `touchpad-tracker/` 平行的全新目录，**不修改原工程任何代码**）

> 实施状态：核心迁移已落地；前端与 Rust 自动化检查通过。目标 HID 设备、Saleae 实时链路和三平台安装包仍需实机验收。

---

## 0. 决策结论

**迁移到 Tauri 2.x**。Phase 1 启动时查询当前稳定版本，验证插件兼容性后锁定精确版本并提交 npm/Cargo lockfile；计划阶段不预设已过时的 minor 版本。新建独立工程 `touchpad-tracker-tauri/`。以下性能数据为目标值，最终以 §10 的统一口径实测验收：

| 维度         |              当前 Electron              |          Tauri 目标          |     收益     |
| ------------ | :-------------------------------------: | :---------------------------: | :----------: |
| 安装包体积   |                  95 MB                  |       **< 10 MB**       |   ~90% ↓   |
| 冷启动内存   |                 ~250 MB                 |      **< 100 MB**      |   ~60% ↓   |
| 冷启动时间   |                   ~1s                   |        **< 1s**         |   ~0-50% ↓ |
| HID 原生模块 | `node-hid`（Electron 升级需 rebuild） | `hidapi-rs`（与运行时解耦） | 消除 rebuild |
| 三平台一致性 |             electron-forge             |         tauri-action         |   一套脚本   |

预计工期：**8-12 工作日**（含测试；HID 原型验证结果可能影响上限）。

**前端栈**：复用现工程及 lockfile 已安装的 **React 19.2.x**，迁移期间不改变 React 主版本。

---

## 1. 项目目标

### 1.1 功能等价性（Functional Parity）

迁移完成后，Tauri 版必须能完成 Electron 版所有功能：

- [ ] 5 大工作流：Live / Playback / Frame List / Debug / HID Analysis
- [ ] 6 个 HID Analysis 子 Tab：Power-On Seq / Device Desc / Report Desc / Report Data / Live Sequence / HID I²C Device
- [ ] 4 路 TP 手指包自动嗅探（tp47/tp32/tp2a/tp34）
- [ ] UDP 50000 实时数据接收
- [ ] Saleae CSV / 应用 JSON 录制回放
- [ ] REC 录制 + Save MD / Save JSON 导出
- [ ] 顶部工具栏：I2C Addr / Max X / Max Y / Stylus Mode

### 1.2 非目标（Non-Goals）

- ❌ **不修改** `touchpad-tracker/` 原工程（独立目录，独立版本）
- ❌ 不引入新 UI 特性（保持视觉/交互一致）
- ❌ 不重写已稳定的 HID 协议解析库（仅迁移，不重构）
- ❌ 不支持 IE / 旧 Edge（WebView2 基线 = Chromium Edge）

---

## 2. 技术栈选型

### 2.1 后端（Rust）

| 依赖                       | 版本 | 用途                              |
| -------------------------- | ---- | --------------------------------- |
| `tauri`                  | 2.x  | Tauri 核心框架                    |
| `tauri-plugin-dialog`    | 2.x  | 文件对话框                        |
| `tauri-plugin-fs`        | 2.x  | 文件 I/O                          |
| `tauri-plugin-store`     | 2.x  | 配置持久化（替换 electron-store） |
| `tokio`                  | 1.x  | 异步运行时（UDP / HID 异步 I/O）  |
| `serde` / `serde_json` | 1.x  | JSON 序列化                       |
| `hidapi`                 | 2.6  | HID 设备访问                      |

### 2.2 前端

| 依赖                          | 版本   | 用途                                       |
| ----------------------------- | ------ | ------------------------------------------ |
| `@tauri-apps/api`           | 2.x    | Tauri JS 桥                                |
| `@tauri-apps/plugin-dialog` | 2.x    | 文件对话框（前端调用）                     |
| `@tauri-apps/plugin-fs`     | 2.x    | 文件读写                                   |
| `@tauri-apps/plugin-store`  | 2.x    | 配置存储                                   |
| React                         | 19.2.x | UI 框架（与现工程及 lockfile 一致）        |
| TypeScript                    | 5.7.x  | 类型（适配当前 React / Node 类型依赖）     |
| Vite                          | 5.4.x  | 构建（与现工程一致）                       |

### 2.3 工具链

- Rust：按 Phase 1 选定的 Tauri 2.x 稳定版本所声明的 MSRV 安装并写入 `rust-toolchain.toml`
- Node.js 18+
- Tauri CLI：作为项目 devDependency 安装；CLI、API、Rust crate 和各插件分别使用其互相兼容的精确版本，不假设所有包版本号完全相同

---

## 3. 目录结构

```
saleae-logic-proc/
├── touchpad-tracker/                  # 原 Electron 工程（不动）
│   └── ...
├── touchpad-tracker-tauri/            # 新 Tauri 工程
│   ├── src/                           # React + TS 前端
│   │   ├── components/                # 直接复制原 components/*
│   │   │   ├── TrajectoryView.tsx
│   │   │   ├── PlaybackView.tsx
│   │   │   ├── PlaybackControls.tsx
│   │   │   ├── FrameListView.tsx
│   │   │   ├── DebugView.tsx
│   │   │   └── HidAnalysisView.tsx
│   │   ├── hooks/
│   │   │   ├── useRecorder.ts         # 需微调：去掉 electronAPI.saveRecording
│   │   │   └── usePlayer.ts           # 直接复用
│   │   ├── types/
│   │   │   ├── finger.ts              # 直接复用
│   │   │   ├── recording.ts           # 直接复用
│   │   │   └── electron.d.ts          # 替换为 tauri.d.ts
│   │   ├── utils/
│   │   │   └── parseSaleaeTXT.ts      # 直接复用
│   │   ├── hid/                       # 直接复用
│   │   │   ├── coordinateFormatSchema.ts
│   │   │   ├── coordinateParser.ts
│   │   │   ├── HidConstants.ts
│   │   │   ├── HidDescriptorFormatter.ts
│   │   │   ├── HidDescriptorParser.ts
│   │   │   ├── HidI2cDescriptorParser.ts
│   │   │   ├── HidI2cSequenceAnalyzer.ts
│   │   │   ├── HidReportDataParser.ts
│   │   │   ├── HidUsagePages.ts
│   │   │   ├── ReportAnalyzer.ts
│   │   │   ├── ReportBatchParser.ts
│   │   │   ├── WaraGenerator.ts
│   │   │   ├── WaraToDescriptorGenerator.ts
│   │   │   └── types.ts
│   │   ├── App.tsx                    # 替换 electronAPI → Tauri invoke
│   │   ├── main.tsx                   # ReactDOM render 入口
│   │   ├── preload.ts                 # ❌ 删除（Tauri 无 preload 概念）
│   │   ├── tauri.ts                   # 🆕 Tauri API 封装层
│   │   └── index.css
│   ├── src-tauri/                     # Rust 后端
│   │   ├── src/
│   │   │   ├── main.rs                # Tauri 入口
│   │   │   ├── udp_server.rs          # UDP 50000 服务
│   │   │   ├── hid_device.rs          # hidapi 封装
│   │   │   └── commands.rs            # Tauri commands 集合
│   │   ├── icons/                     # 应用图标
│   │   ├── capabilities/
│   │   │   └── default.json           # dialog/fs/store 最小权限
│   │   ├── rust-toolchain.toml        # Rust toolchain 固定（与 Tauri minor 同步）
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── build.rs
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── README.md
└── docs/
    └── tauri_migration_plan.md        # 本文档
```

---

## 4. 模块映射（Electron → Tauri）

| 原 Electron 实现                                      | Tauri 对应                                             | 复用度 | 说明                                              |
| ----------------------------------------------------- | ------------------------------------------------------ | :----: | ------------------------------------------------- |
| `app` / `BrowserWindow`                           | `tauri::Builder`                                     |   🆕   | Rust 入口                                         |
| `dgram.createSocket('udp4')`                        | `tokio::net::UdpSocket`                              |   🆕   | 异步 UDP                                          |
| `parseFingerFrame` / `parseStylusFrame` (main.ts) | 前端适配层解析`raw-frame`                            |  ♻️  | 复用`coordinateParser.ts`；迁移 stylus 解析函数 |
| `webContents.send('finger-frame', ...)`             | 前端`subscribeFingerFrame()` 内部分发                |   🆕   | 保持 UI 消费`FingerFrame` 的契约不变            |
| `webContents.send('i2c-raw-frame', ...)`            | Rust`emit("raw-frame", I2cRawFrame)`                 |   🆕   | 保留地址、方向、寄存器和来源字段                  |
| `ipcMain.handle('get-config')`                      | `tauri-plugin-store` `get()`                         |   🆕   | 前端直调；首次启动前先执行迁移                    |
| `ipcMain.handle('save-config')`                     | `tauri-plugin-store` `set()` + `save()`              |   🆕   | 配置初始化完成后才允许自动保存                    |
| `ipcMain.handle('save-text')`                       | plugin-dialog + plugin-fs                             |   🆕   | 前端适配层保持原返回契约                          |
| `ipcMain.handle('save-recording')`                  | plugin-dialog + plugin-fs                              |   🆕   | 前端适配层保持原返回契约                          |
| `ipcMain.handle('load-recording')`                  | plugin-dialog + plugin-fs                             |   🆕   | 同上                                              |
| `ipcMain.handle('hid-list')`                        | `#[tauri::command] hid_list()`                       |   🆕   | Rust hidapi                                       |
| `ipcMain.handle('hid-open')`                        | `#[tauri::command] hid_open()`                       |   🆕   | 同上                                              |
| `ipcMain.handle('hid-close')`                       | `#[tauri::command] hid_close()`                      |   🆕   | 同上                                              |
| `ipcMain.handle('hid-write')`                       | `#[tauri::command] hid_write()`                      |   🆕   | 同上                                              |
| `ipcMain.handle('hid-read-feature')`                | `#[tauri::command] hid_read_feature()`               |   🆕   | 同上                                              |
| `ipcMain.handle('hid-descriptors')`                 | `#[tauri::command] hid_descriptors()`                |   🆕   | 同上                                              |
| `electron-store`                                    | `tauri-plugin-store` + 一次性迁移                    |   🆕   | schema 相同，但默认存储路径不同                   |
| `dialog.showOpenDialog`                             | `@tauri-apps/plugin-dialog` `open()`               |   🆕   | 前端调用                                          |
| `dialog.showSaveDialog`                             | `@tauri-apps/plugin-dialog` `save()`               |   🆕   | 前端调用                                          |
| `contextBridge.exposeInMainWorld`                   | Tauri 自动通过`invoke` 暴露                          |   🆕   | 无需 preload                                      |
| `ipcRenderer.on('finger-frame', ...)`               | `subscribeFingerFrame(callback)`                     |   🆕   | 前端内存订阅；不是 Tauri event                    |
| `ipcRenderer.invoke('xxx')`                         | `invoke('xxx')`                                      |   🆕   | 前端替换                                          |
| `process.platform`                                  | Rust/Tauri 窗口生命周期事件                           |   🆕   | 原调用仅用于 Electron 主进程退出逻辑，无需前端 OS API |

### 关键决策：解析在哪一层做？

`parseFingerFrame` / `parseStylusFrame` 当前在 main.ts（Node）执行。

**已选方案 A：前端解析。** Rust 将 Saleae UDP 消息标准化为完整的 `I2cRawFrame` 后发送唯一的 Tauri 事件 `raw-frame`；前端 `tauri.ts` 适配层先把每一帧分发给 HID Analysis，再依次调用 `tryParseFingerFrame` 和迁移后的 `parseStylusFrame`，解析成功后通过前端内存订阅分发 `FingerFrame`。Tauri 后端不发送 `finger-frame`。

该适配层必须保持现有 UI 契约：业务组件不直接理解 Tauri event，也不自行重复解析。项目数据率约为 100 Hz × 50 B，跨 WebView 传输开销可忽略。Rust 端负责从 UDP 字段计算 `i2cAddress`、`isRead` 和二字节写入对应的小端 `register`，确保 Live Sequence 行为与 Electron 版一致。

---

## 5. 数据流对照

### 5.1 Live 模式（实时 UDP 接收）

**Electron**：

```
┌─────────────────────────────────────────────────────────┐
│ Saleae Logic 2 + HLA                                    │
│   解析 I²C → JSON {type, data}                          │
│   UDP 50000                                             │
└──────────────────────┬──────────────────────────────────┘
                       │ UDP datagram (JSON string)
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Electron main.ts (Node.js)                              │
│   dgram.createSocket('udp4').bind(50000)                │
│   - 接收 msg → JSON.parse                               │
│   - parseFingerFrame / parseStylusFrame                 │
│   - mainWindow.webContents.send('finger-frame', frame)  │
└──────────────────────┬──────────────────────────────────┘
                       │ IPC (WebContents.send)
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│   window.electronAPI.onFingerFrame(cb)                  │
│   → 5 大 UI 工作流分发                                  │
└─────────────────────────────────────────────────────────┘
```

**Tauri**：

```
┌─────────────────────────────────────────────────────────┐
│ Saleae Logic 2 + HLA                                    │
│   解析 I²C → JSON {type, data}                          │
│   UDP 50000                                             │
└──────────────────────┬──────────────────────────────────┘
                       │ UDP datagram (JSON string)
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Tauri Rust (src-tauri/src/udp_server.rs)                │
│   tokio::net::UdpSocket::bind("127.0.0.1:50000")        │
│   - spawn task 接收 msg → JSON.parse                    │
│   - 标准化为完整 I2cRawFrame                            │
│     app.emit("raw-frame", {timestamp, i2cAddress,       │
│       isRead, register, rawBytes, source: "udp"})       │
└──────────────────────┬──────────────────────────────────┘
                       │ Tauri event (Channel or emit)
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│   listen("raw-frame", cb)                              │
│   ├─ 分发 I2cRawFrame → HID Analysis                    │
│   └─ finger/stylus 解析 → 分发 FingerFrame → UI         │
└─────────────────────────────────────────────────────────┘
```

> **改动点**：UDP 接收和字段标准化在 Rust，前端适配层统一完成坐标解析与双路事件分发（方案 A）。

### 5.2 HID I²C Device Tab

**Electron**：

```
HidAnalysisView → electronAPI.hidList/Open/Close/Write/ReadFeature
              → ipcMain.handle('hid-*') in main.ts
              → node-hid 调用
              → mainWindow.webContents.send('i2c-raw-frame', ...)
```

**Tauri**：

```
HidAnalysisView → invoke('hid_list' / 'hid_open' / ...)
              → #[tauri::command] in src-tauri/src/hid_device.rs
              → HID worker（唯一持有 hidapi::HidDevice）
              → app.emit("raw-frame", I2cRawFrame)
```

> **关键变化**：所有 `electronAPI.hidXxx` 调用改为 `invoke('hid_xxx')`。打开设备后启动专用阻塞 worker，由它唯一持有句柄并轮询 input report；command 通过 channel 向 worker 发送 write/read-feature/close 请求，避免阻塞读取与写命令争抢同一把锁。断开、读取错误、窗口退出时都必须取消 worker 并释放设备。

### 5.3 配置存储

**Electron**：

```ts
const store = new Store({ defaults: { config: DEFAULT_CONFIG } });
ipcMain.handle('get-config', () => store.get('config'));
ipcMain.handle('save-config', (_, cfg) => store.set('config', cfg));
```

**Tauri**（保留 electron-store 的 JSON schema）：

```ts
// 前端
import { Store } from '@tauri-apps/plugin-store';
// 加载与 electron-store 相同的 config.json schema：{ config: TouchpadConfig }
const store = await Store.load('config.json');
const cfg = await store.get('config');
await store.set('config', newCfg);
await store.save();
```

Rust migration command 只负责读取和校验旧 Electron 文件，将可选配置返回前端；前端仍统一通过 plugin-store 写入 Tauri store：

```rust
#[tauri::command]
fn import_electron_config() -> Result<Option<TouchpadConfig>, String> { ... }
```

**已确认**：采用前端 `tauri-plugin-store` 直调，并保留 `config.json` 的原有 schema（key=`config`, value=`TouchpadConfig`）。两种运行时的默认应用数据目录不同，因此不直接共用物理文件。

**Electron 配置查找路径**（按 `productName='touchpad-tracker'` + Electron 默认 `app.getPath('userData')` 推导）：

| OS | Electron 路径 | Tauri 路径 |
|----|---------------|------------|
| macOS | `~/Library/Application Support/touchpad-tracker/config.json` | `~/Library/Application Support/com.izh20.touchpad-tracker/config.json` |
| Windows | `%APPDATA%\touchpad-tracker\config.json` | `%APPDATA%\com.izh20.touchpad-tracker\config.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/touchpad-tracker/config.json` | `${XDG_DATA_HOME:-~/.local/share}/com.izh20.touchpad-tracker/config.json` |

**迁移流程**（仅在 Tauri store 不存在时尝试）：
1. Rust migration command 按当前 OS 推导 Electron 配置路径
2. 读取 `config.json`，反序列化为 `TouchpadConfig` 校验
3. 校验通过 → 返回配置给前端，由前端写入 Tauri store
4. 旧文件不存在、正在写入或 JSON 校验失败时记录警告并使用默认配置，不阻塞启动；下一次启动可再次尝试
5. Tauri store 创建后不再读取 Electron 文件，两版后续写入彼此隔离

应用启动时必须先完成“读取 Tauri store → 必要时迁移 → 设置 React config”的初始化流程，再启用配置自动保存。不得在异步初始化完成前把 `DEFAULT_CONFIG` 写入 store，否则会抢先创建文件并跳过迁移。

迁移是单向的一次性快照，不要求两个应用运行时互斥，也不使用无法覆盖跨进程场景的进程内 `try_lock`。

### 5.4 跨边界接口契约

```ts
// 由 Rust emit('raw-frame', payload) 推送
interface I2cRawFrame {
   timestamp: number;
   i2cAddress: number;
   isRead: boolean;
   register: number | null;   // 仅 !isRead && data.length===2 时计算，否则 null
   rawBytes: number[];
   source: 'udp' | 'hid';
}

// 由前端 subscribeFingerFrame(callback) 内存订阅消费；不是 Tauri event
// 字段定义直接复用 touchpad-tracker/src/types/finger.ts
interface FingerFrame {
   timestamp: number;
   packetType: number;          // 47 / 32 / 42 / 52（由 CoordinateFormat.totalLength 决定）
   slots: FingerSlot[];
   fingerCount: number;
   scantime: number;
   keyState?: number;
   stylus?: StylusSlot;
   debugChannels?: number[];    // 16 个 s16 LE，仅 stylus 包（47B）有值
   rawBytes?: number[];
}

// HID commands 返回结构
interface HidWriteResult {
   success: boolean;
   error?: string;
   sentBytes: number;
}

interface HidOpenResult {
   success: boolean;
   error?: string;
   hidDesc?: number[];          // 自动读取的 30 字节 HID 设备描述符
   reportDesc?: number[];
}
```

- `raw-frame` payload 必须严格符合 `I2cRawFrame`；前端适配层返回幂等的 unsubscribe 函数。
- `raw-frame` 是唯一承载实时帧的 Tauri event；`FingerFrame` 只在前端适配层内部发布，禁止调用 `listen('finger-frame')`。
- `hid_open` 返回 `HidOpenResult`，自动尝试 `getFeatureReport(0, 31)` 填充 `hidDesc`。
- `hid_close` 返回 `{ success, error? }`。
- `hid_write` 返回 `HidWriteResult`，写入 hidapi 前必须把 `reportId` 放在首字节；发出的分析事件继续使用 HID-I²C 长度前缀。
- `hid_read_feature` 返回 `{ data?, error? }`；`hid_descriptors` 返回 `{ hidDesc, reportDesc }`。
- 所有 Rust 错误转换为可序列化结果，不能把 panic 或不可序列化错误暴露到 `invoke` 边界。
- `FingerFrame` 字段类型直接 import 自 `touchpad-tracker/src/types/finger.ts`，Tauri 工程复用该文件即可保证契约一致。

---

## 6. 迁移阶段

### Phase 1 · 骨架 + HID 风险探针（1-2 工作日）

**目标**：Tauri 工程能启动，显示 React 空壳 UI。

**任务清单**：

1. 在临时目录运行 `npm create tauri-app@latest` 后将脚手架移入 `touchpad-tracker-tauri/`，避免覆盖现有 README；确认当前稳定版本和插件兼容矩阵后锁定精确依赖并提交 lockfile
2. 配置 `tauri.conf.json`：
   - `productName: "Touchpad Tracker"`
   - `identifier: "com.izh20.touchpad-tracker"`
   - `frontendDist: "../dist"` (Vite 输出)
   - `beforeDevCommand: "npm run dev"`
   - `beforeBuildCommand: "npm run build"`
3. 创建 `src-tauri/capabilities/default.json`，仅授予主窗口所需的 dialog、fs 和 store 权限；文件系统权限限制到用户通过 dialog 选择的路径和应用数据目录
4. 复制 `touchpad-tracker/src/components/` `hooks/` `types/` `utils/` `hid/` 到 `touchpad-tracker-tauri/src/`
5. 写 `src/tauri.ts`：把 `electronAPI` 调用映射到 `invoke()`、`listenRawFrame()` 和前端内存订阅
6. 替换 `App.tsx` 中所有 `window.electronAPI.xxx` → `tauri.xxx`
7. 替换 `useRecorder.ts` 中 `electronAPI.saveRecording` → 用 `plugin-dialog` + `plugin-fs`
8. 删除 `preload.ts`（Tauri 无 preload）
9. 跑 `npm run tauri dev`，验证 React 界面和 HMR
10. 完成 HID 风险探针：枚举并打开设备，以 worker 连续读取，同时验证写入与安全关闭；若目标设备暂不可用，至少用普通 HID 设备验证生命周期

**验收**：

- [ ] Tauri 应用窗口启动
- [ ] React 顶部工具栏 + 5 个 Tab 按钮可见
- [ ] 点击 Tab 切换正常（无业务数据）
- [ ] HID worker 原型不会因阻塞读取卡住 write/close

### Phase 2 · UDP + 坐标包解析（1-2 工作日）

**目标**：Live 模式能接收 UDP 数据并自动分流 4 种 TP 格式。

**任务清单**：

1. `src-tauri/src/udp_server.rs`：实现 tokio UDP 监听 + JSON 解析
2. `src-tauri/src/commands.rs`：注册 udp start/stop command（可选，自动启动）
3. `src-tauri/src/main.rs`：启动时 spawn UDP server task
4. UDP server 收到 `{type: 'TX', data: {addr, rw, data: [...]}}` 后：
   - 解析并校验为 `I2cRawFrame`
   - 保留 `i2cAddress`、`isRead`、`source='udp'`
   - 仅对非读方向且恰好 2 字节的数据计算小端 `register`，其余为 `null`
   - `app_handle.emit("raw-frame", payload)` 推送给所有窗口
5. 前端 `src/tauri.ts`：暴露 `listenRawFrame(cb)` 方法
6. 前端适配层把 raw frame 分发给 HID Analysis，并调用 `coordinateParser.tryParseFingerFrame`
7. **stylus 解析迁移**：将 `touchpad-tracker/src/main.ts:64-89` 的 `parseStylusFrame` 提取到 `coordinateParser.ts` 新增 `parseStylusFrame(packet, timestamp)` 函数，复用 `extractField`。前端适配层在 finger 失败后继续尝试 stylus；stylus 的 debug channels（bytes[15..46]）解析也并入该函数
8. 适配层对外暴露 `subscribeFingerFrame`，`App.tsx` 与 `TrajectoryView` 保持消费 `FingerFrame`
9. **测试范围**：现工程没有自动化测试基线；在 Tauri 工程引入 Vitest，为现有 finger parser、新增 stylus parser、UDP 标准化和订阅清理建立最小回归测试

**验收**：

- [ ] 启动 Saleae HLA 推 UDP 数据
- [ ] 应用 Live 模式实时显示坐标轨迹
- [ ] 4 种 TP 格式（tp47/tp32/tp2a/tp34）都能正确解析
- [ ] Stylus 头 [0x2F, 0x00, 0x08] 也正确解析

### Phase 3 · HID 模块（2-3 工作日）

**目标**：HID I²C Device tab 能完整工作。

**任务清单**：

1. `Cargo.toml` 添加 `hidapi = "2.3"`
2. `src-tauri/src/hid_device.rs`：实现 HID worker，唯一持有 `hidapi::HidDevice`：
   - 阻塞读取循环 + 有界 command channel
   - write/read-feature/close 请求与响应
   - 断开、读取错误、重复 open 和应用退出清理
3. `src-tauri/src/commands.rs` 注册 6 个 Tauri commands，并保持 §5.4 的返回结构：
   - `hid_list() -> Vec<HidDeviceInfo>`
   - `hid_open(path: String) -> HidOpenResult`
   - `hid_close() -> HidCloseResult`
   - `hid_write(report_id: u8, data: Vec<u8>) -> HidWriteResult`
   - `hid_read_feature(report_id: u8) -> HidReadFeatureResult`
   - `hid_descriptors() -> HidDescriptors`
4. worker 收到 input report 时补 HID-I²C 长度前缀，并 emit `raw-frame`（source=`hid`）
5. `hid_write` 前置 report ID，并按 Electron 版规则生成对应的分析事件
6. 前端 `tauri.ts`：暴露 6 个类型化 `hidXxx()` 方法
7. `HidAnalysisView.tsx`：替换 `electronAPI.hidXxx` → `tauri.hidXxx`
8. 增加 mock worker 测试，覆盖 read/write/close、重复 open、设备断开和错误序列化

**验收**：

- [ ] Windows 上枚举 HID 设备列表
- [ ] 连接 vendor HID 设备成功
- [ ] 发送 SET_POWER D0/D1 命令字节流被 Live Sequence 正确解析
- [ ] GET_REPORT / SET_REPORT / Output / Feature 都工作

### Phase 4 · 文件 I/O + 配置迁移（1-2 工作日）

**目标**：录制、回放、Save MD / Save JSON 都工作。

**任务清单**：

1. 安装 `@tauri-apps/plugin-dialog` `@tauri-apps/plugin-store` `@tauri-apps/plugin-fs`
2. 注册 dialog/fs/store 插件，并在 `src-tauri/capabilities/default.json` 配置最小权限
3. `src/tauri.ts`：封装 `saveFile()` `loadFile()` `loadStore()` `saveStore()`
4. 替换 `App.tsx` 中：
   - `electronAPI.saveRecording` → `tauri.saveFile(defaultName, json)`
   - `electronAPI.loadRecording` → `tauri.loadFile()` + dialog
   - `electronAPI.saveText` → `tauri.saveText(defaultName, md)`
   - `electronAPI.getConfig/saveConfig` → `tauri.store.get/set`
5. `HidAnalysisView` 各 Tab 的 Save MD / Save JSON 同样替换
6. 实现 Electron 配置一次性导入：仅在 Tauri store 不存在时，按 §5.3 OS 路径读取并校验 Electron `config.json`；Rust 返回可选配置，前端写入 Tauri store
7. 为 `App.tsx` 增加 config initialized 门控：迁移/加载完成前禁止自动保存，完成后才响应配置变更

**验收**：

- [ ] 点 REC 能保存 .json 录制
- [ ] 点 Open File 能加载 .json / .csv
- [ ] 配置能持久化（maxX/maxY/stylusMode），首次启动可导入 Electron 配置且不会反向覆盖
- [ ] 首次启动不会在迁移完成前把默认配置写入 Tauri store

### Phase 5 · 打包 + 跨平台测试（2-3 工作日）

**目标**：三平台都能产出可分发包，CI 矩阵自动构建。

**任务清单**：

1. 复用图标：从 `touchpad-tracker/assets/` 复制源图到 `src-tauri/icons/`，用 Tauri icon 命令生成完整尺寸及 `icon.icns` / `icon.ico`
2. 配置 `tauri.conf.json` bundle targets：
   - macOS: `app`, `dmg`
   - Windows: `msi`, `nsis`
   - Linux: `deb`, `appimage`
3. 编写 `scripts/build.sh`（参照原 `touchpad-tracker/build.sh`）
4. macOS 本地构建：`npm run tauri build`
5. **CI（已确认启用）**：`.github/workflows/build.yml` 三平台矩阵
   - macOS：按 runner/target 拆分 arm64 与 x64 job，分别产出 `.app` + `.dmg`
   - `windows-latest`：产出 `.msi` + `.exe`
   - `ubuntu-latest`：产出 `.deb` + `.AppImage`
   - 各 job 安装对应 Rust target 与 Linux HID/WebKit 系统依赖
   - 触发条件：push `main` / tag `v*` / PR
   - 产物上传：GitHub Release（tag 触发时）
6. **代码签名（已确认跳过）**：未配置 Apple notarization / Windows signing；首次发布的 .app / .exe 会有 Gatekeeper / SmartScreen 警告，README 注明
7. 测试清单：
   - [ ] macOS arm64 .app 启动正常
   - [ ] 5 大 UI 流程冒烟
   - [ ] HID 设备连接（如果有 Windows 测试机）
   - [ ] 录制/回放往返一致
   - [ ] CI 三平台均构建成功

---

## 7. 依赖对照表

### 7.1 npm 依赖映射

| 原 Electron 工程 (package.json) | Tauri 工程                   |
| ------------------------------- | ---------------------------- |
| `electron`                    | ❌ 删除                      |
| `electron-store`              | `@tauri-apps/plugin-store` |
| `electron-squirrel-startup`   | ❌ 不需要                    |
| `node-hid`                    | ❌ 删除（Rust 端 hidapi）    |
| `dgram` (Node 内置)           | ❌ 删除（Rust tokio）        |
| `@electron-forge/*`           | ❌ 替换为`@tauri-apps/cli` |
| `vite`                        | ✅ 保留                      |
| `react`, `react-dom`        | ✅ 保留                      |
| `typescript`                  | ✅ 保留                      |
| `vitest`                      | 🆕 新增最小解析/适配层测试   |

### 7.2 Rust 新增依赖

| Crate                   | 版本 | 用途                             |
| ----------------------- | ---- | -------------------------------- |
| `tauri`               | 2.x  | 框架核心                         |
| `tauri-plugin-dialog` | 2.x  | 文件对话框                       |
| `tauri-plugin-fs`     | 2.x  | 文件 I/O                         |
| `tauri-plugin-store`  | 2.x  | 配置持久化                       |
| `tauri-build`         | 2.x  | 构建脚本（build.rs）             |
| `tokio`               | 1.x  | 异步运行时（features: ["full"]） |
| `serde`               | 1.x  | 序列化（features: ["derive"]）   |
| `serde_json`          | 1.x  | JSON                             |
| `hidapi`              | 2.3  | HID 设备                         |
| `thiserror`           | 1.x  | 错误类型派生                     |

`tauri-plugin-shell`、`chrono`、`anyhow` 首版没有已确认用途，不预装；后续出现具体调用点时再添加。

---

## 8. 关键文件清单

### 8.1 新增文件（Tauri 工程专属）

```
touchpad-tracker-tauri/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               ~80 行
│   │   ├── udp_server.rs         ~120 行
│   │   ├── hid_device.rs         ~200 行
│   │   └── commands.rs           ~150 行
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   └── build.rs
├── src/
│   ├── main.tsx                  ~20 行（替换原 renderer.ts）
│   └── tauri.ts                  ~150 行（Tauri API 封装层）
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

### 8.2 直接复用（从原 `touchpad-tracker/src/` 复制）

```
src/components/*                  6 个文件，~3500 行
src/hooks/{useRecorder,usePlayer}.ts            ~250 行
src/types/{finger,recording}.ts                 ~80 行
src/utils/parseSaleaeTXT.ts                     ~290 行
src/hid/*                         13 个文件，~3500 行（含 coordinateParser / schema）
src/App.tsx                                     ~700 行
src/index.css                                   ~50 行
```

**复用总计**：约 8400 行 TS 业务代码可作为迁移基线。协议解析和大部分 UI 可直接复用；`App.tsx`、`TrajectoryView.tsx`、`HidAnalysisView.tsx`、`useRecorder.ts`、全局类型和事件订阅需要适配。

### 8.3 删除

```
src/main.ts                       ~480 行（Electron 主进程，全部重写为 Rust）
src/preload.ts                    ~75 行（contextBridge，Tauri 无此概念）
src/renderer.ts                   ~30 行（替换为 src/main.tsx）
src/types/electron.d.ts           ~30 行（替换为 src/tauri.d.ts）
```

---

## 9. 风险与对策

| 风险                                        | 等级 | 影响                                             | 对策                                                                          |
| ------------------------------------------- | :---: | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **WKWebView/WebView2 与 Chrome 差异** | 🟡 中 | 部分 CSS / JS API 行为差异                       | Phase 1 后立即全流程冒烟，提前发现；规避 Chrome-only API                      |
| **hidapi-rs 与 node-hid API 不一致**  | 🔴 高 | 阻塞读取可能卡住写入/关闭，设备断开后泄漏 worker | Phase 1 先做单所有者 worker 原型；Phase 3 覆盖生命周期测试                    |
| **Tauri event 高频丢帧**              | 🟡 中 | 100Hz UDP 可能丢事件                             | 首版统一使用`emit` 并做序号压测；若不达标，再把启动命令改为传入 `Channel` |
| **配置默认路径不同**                  | 🟡 中 | Tauri 首次启动看不到 Electron 配置               | 只在 Tauri store 不存在时执行一次性导入，不直接共用物理文件                   |
| **跨平台 HID 构建依赖**               | 🟡 中 | Linux CI 缺少 hidapi/WebKit 系统包导致构建失败   | 在 CI 显式安装依赖，并在三平台分别运行`cargo check`/打包                    |
| **Rust 学习曲线**                     | 🟡 中 | 首次迁移可能延期                                 | 投资 0.5 天读 Tauri 官方教程；找 1 个 Rust 熟手带                             |
| **macOS 公证（notarization）**        | 🟡 中 | 未公证的 .app 启动有 Gatekeeper 警告             | 申请 Apple Developer ID；CI 配置 notarize                                     |
| **Windows Code Signing**              | 🟡 中 | 未签名 .exe 有 SmartScreen 警告                  | 申请 EV 代码签名证书；CI 配置 signtool                                        |
| **WebView2 缺失（旧 Windows）**       | 🟢 低 | Win7/旧 Win10 无法运行                           | 文档注明最低 Win10 1809+                                                      |
| **Tauri 2.x 偶发 bug**                | 🟢 低 | 可能在 Phase 3-4 遇到                            | Phase 1 验证当前稳定版本后精确锁定，并提交 npm/Cargo lockfile                  |
| **迁移时旧配置正在写入**              | 🟢 低 | 单次读取可能得到不完整 JSON                      | 校验失败则使用默认配置且不创建 Tauri store，下次启动再次尝试                  |
| **R-12 · macOS 沙盒**            | 🟢 低 | 暂不计划上架 Mac App Store，Tauri 默认非沙盒运行       | §10 显式声明 v1 不上架 Store；未来上架需补 sandbox entitlements        |
| **R-13 · Linux 系统依赖**        | 🟡 中 | Linux CI 缺 `libhidapi-libusb0` / `libwebkit2gtk-4.1` 导致构建失败 | §6 Phase 5 CI 显式 `apt-get install`；文档给出本地开发同样命令 |

---

## 10. 验收标准（Definition of Done）

### 10.1 功能验收

- [ ] **5 大 UI 工作流** 全部正常工作（与原 Electron 版对照）
- [ ] **4 路 TP 格式** 自动嗅探，行为与原版一致
- [ ] **stylus 笔包** 解析正确
- [ ] **录制 / 回放** 完整往返
- [ ] **HID I²C Device tab** 在 macOS / Windows 都能连接 vendor 设备
- [ ] **Save MD / Save JSON** 导出正常
- [ ] **Help 弹窗** 描述与功能一致

### 10.2 非功能验收

- [ ] macOS arm64 .dmg 目标 < **10 MB**（记录压缩后产物大小）
- [ ] 冷启动目标 < **1s**（macOS M2，连续 5 次去掉最高/最低后取平均）
- [ ] 空载内存目标 < **120 MB**（窗口显示稳定 30 秒后的进程组 RSS）
- [ ] 三平台打包成功（macOS / Windows / Linux）
- [ ] TypeScript strict mode 零错误
- [ ] `cargo clippy` 无 warning

### 10.3 兼容性验收

- [ ] 旧版 `touchpad-tracker/`（Electron）继续维护，**不破坏**
- [ ] 旧 `.json` 录制文件可被 Tauri 版加载（packetType 自描述，向后兼容）
- [ ] Tauri 首次启动可一次性导入 Electron `config.json`，两版 schema 一致但文件独立
- [ ] Electron 与 Tauri 配置文件物理隔离；两版同时运行不会互相覆盖
- [ ] **暂不上架 Mac App Store / Windows Store / Snap Store**（Tauri 默认无沙盒，签名/沙盒工作量超 v1 范围）
- [ ] 首次发布的 .app / .exe 未签名/未公证，README 注明安装步骤（macOS：`xattr -d com.apple.quarantine /Applications/...`）

---

## 11. 时间估算

| Phase                          |  工期  |         累计         |
| ------------------------------ | :----: | :-------------------: |
| Phase 1 · 骨架 + HID 风险探针 | 1-2 天 |        1-2 天        |
| Phase 2 · UDP + 解析          | 1-2 天 |        2-4 天        |
| Phase 3 · HID 模块            | 2-3 天 |        4-7 天        |
| Phase 4 · 文件 I/O + 配置迁移 | 1-2 天 |        5-9 天        |
| Phase 5 · 打包 + 跨平台测试   | 2-3 天 |        7-12 天        |
| **合计（含联调缓冲）**   |        | **8-12 工作日** |

按 1 人全职，约 **2-2.5 周**。

---

## 12. 已确认事项

| # | 事项         | 决策                                                                                                                                  |
| - | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Tauri 版本   | ✅ Phase 1 验证当前 Tauri 2.x stable 及插件兼容矩阵后锁定各包精确版本、Rust toolchain 和 lockfile                               |
| 2 | 解析位置     | ✅**方案 A**：Rust 标准化完整 `I2cRawFrame`；前端适配层解析 finger + stylus 并双路分发                                        |
| 3 | 配置文件格式 | ✅ 保留 electron-store schema；Tauri 首次启动执行一次性导入，之后文件独立                                                             |
| 4 | 图标资源     | ✅ 复用`touchpad-tracker/assets/` 现有资源并生成缺失格式/尺寸                                                                       |
| 5 | CI 平台      | ✅ 启用 GitHub Actions 三平台矩阵；macOS arm64/x64 使用独立 runner/target job                                                         |
| 6 | 代码签名     | ⚠️**无证书**，跳过 Apple notarization 与 Windows signing；首次发布的 .app / .exe 会有 Gatekeeper / SmartScreen 警告，文档注明 |
| 7 | HID 生命周期 | ✅ 专用阻塞 worker 唯一持有设备，command channel 处理写入、feature 和关闭                                                             |
| 8 | stylus 解析归宿 | ✅ 方案 a — 在 `coordinateParser.ts` 内新增 `parseStylusFrame()`，与 finger 解析共置统一 schema 化                          |
| 9 | Electron 配置路径 | ✅ productName=`touchpad-tracker`，按 OS 推导 userData 目录；Rust 只读旧文件，前端写入独立 Tauri store                       |
| 10 | 前端栈版本 | ✅ **React 19.2.x**（与 Electron 工程及 lockfile 一致）；TypeScript 4.5.x、Vite 5.4.x                                      |
| 11 | 性能指标     | ✅ 统一为 **冷启动 < 1s**（macOS M2，5 次均值），原 0.5s 目标过于乐观                                                  |
| 12 | Rust 工具链  | ✅ 按 Phase 1 选定 Tauri 版本的 MSRV 锁定 `rust-toolchain.toml`                                                            |
| 13 | 配置并发 | ✅ 两版文件隔离，无运行时互斥要求；迁移读取失败时使用默认值并在下次启动重试                                                |
| 14 | Store 分发 | ✅ **v1 不上架 Mac App Store / Windows Store / Snap Store**（无沙盒适配，签名/公证工作量超本期范围）                       |
| 15 | CI 矩阵     | ✅ 启用 macOS（arm64+x64 双 job）/ windows-latest（x64）/ ubuntu-latest 三平台；Windows ARM runner **暂不启用**，未来按需补  |

---

## 13. 后续行动

1. 进入 Phase 1：搭建脚手架并锁定 Tauri/Rust/Node 版本
2. 先完成 HID worker 风险探针，验证 read/write/close 生命周期
3. 复制现有 React/TS 源码，建立 §5.4 的类型化 Tauri 适配层
4. 验证空壳 UI、HMR 与 HID 原型，再进入 UDP 迁移

预计 Phase 1 用时 1-2 工作日。
