# HID I²C 设备读写 —— 第 6 个子 Tab

**日期：** 2026-06-23
**状态：** 待用户审阅
**前置 spec：** [2026-06-23-live-sequence-subtab-design.md](2026-06-23-live-sequence-subtab-design.md)（共享事件管线）
**目标平台：** **Windows only**
**设备类型：** 标准 HID-over-I²C 设备（VID=0x03EB, UsagePage=0x0001, Usage=0x0006）
**操作粒度：** HID 报告级（GET_REPORT / SET_REPORT / OUTPUT / FEATURE）

---

## 1. 概述

在 `HidAnalysisView` 现有 5 个子 Tab 中新增第 6 个：**HID I²C Device**。允许用户：
1. 列出 Windows 上所有 HID 设备
2. 选择一个 HID-I²C 设备并打开
3. 自动加载该设备的 HID Device Descriptor + Report Descriptor
4. 通过命令按钮发送 SET_POWER / RESET / GET_REPORT / SET_REPORT 等
5. 实时显示发出的命令字节流 + 收到的响应（**复用现有 Live Sequence 表格**）

新 Tab 与现有架构完全兼容：命令字节流通过现有 `i2c-raw-frame` IPC 通道发出，渲染层由现有 `LiveHidAnalyzer` 解析为 events，复用 Save MD / Save JSON。

---

## 2. 库选型

### 备选 A：node-hid（推荐）

```ts
import { HID, devices } from 'node-hid';
const list = devices();  // 枚举所有 HID 设备
const dev = new HID(list[0].path);
dev.write([0x00, ...]);  // 同步写
dev.read((err, data) => { ... });  // 异步读
```

**优势**：
- 自动枚举（HID.devices() 列出全部 device path / VID / PID / Usage / UsagePage）
- Windows 64-bit + Node 20 有官方 prebuild，无需手编
- 跨设备统一 API，setOutputReport / getInputReport / getFeatureReport 全支持
- 在 Electron 里通过 `@electron/rebuild` 即可针对 Electron 的 Node ABI 编译

**劣势**：
- 原始模块，需要 `@electron/rebuild`（electron-forge 内置）
- macOS / Linux 上需要额外配置（但**用户已确认 Windows only**——不投入跨平台适配）
- API 偏老（回调式），需 promise 化

### 备选 B：WebHID（已淘汰）

```ts
const [device] = await navigator.hid.requestDevice({ filters: [...] });
await device.open();
await device.sendReport(reportId, data);
```

**淘汰理由**：
- **Windows-only 场景下，强制"系统弹窗选设备" UX 不可接受**——用户已习惯现有 "Refresh → 下拉框选" 模式
- 优势（跨平台、无需 native）在这个项目里不显著

### 选型结论

**采用备选 A（node-hid）**。

---

## 3. 架构

### 3.1 数据流

```
┌────────────────────────────────────────────────────────────┐
│ 主进程 (main.ts)                                            │
│                                                              │
│  - node-hid HID.devices() 列出设备                          │
│  - IPC handlers:                                             │
│      hid-list            → 列出 HID 设备列表                │
│      hid-open (path)     → 打开指定 path 的设备             │
│      hid-close           → 关闭当前设备                     │
│      hid-write (rId, data)  → 同步发 SET_REPORT / OUTPUT  │
│      hid-read (timeoutMs)   → 异步读 input report          │
│  - HID 接收：                                                │
│      device.on('data', (data) => {                          │
│        // 封装为 I2cTransaction 发出 i2c-raw-frame         │
│      });                                                     │
│  - HID 发送：                                                │
│      device.write([0x00, ...]);                             │
│      // 同时把字节流以 i2c-raw-frame 发出（isRead=false）   │
└────────────────────────────────────────────────────────────┘
                            │  contextBridge.exposeInMainWorld
                            ▼
┌────────────────────────────────────────────────────────────┐
│ 渲染进程                                                     │
│                                                              │
│  复用现有 'i2c-raw-frame' 订阅（'onI2cRawFrame'）           │
│  新增 'hidDevice' subTab：                                   │
│    1. Refresh Devices 按钮 → IPC hid-list → 填 <select>     │
│    2. 选定设备后 Connect → IPC hid-open                       │
│    3. 自动加载 HID Device Desc / Report Desc                  │
│       (可选择从设备读，或用户手动输入)                       │
│    4. 命令面板按钮：SET_POWER / RESET / GET_REPORT / ...     │
│       每条命令 → IPC hid-write + UI 显示                      │
│    5. 事件表格复用 Live Sequence 组件（不重复实现）         │
│    6. Save MD / Save JSON 复用 LiveHidAnalyzer 逻辑          │
└────────────────────────────────────────────────────────────┘
```

### 3.2 与现有架构的复用点

| 现有组件 | 复用方式 |
|----------|----------|
| `i2c-raw-frame` IPC 通道 | HID 命令字节流走同一条通道（已有 — 上一轮加的） |
| `LiveHidAnalyzer` 类 | 接收 HID 字节流，分析为 events（已有） |
| Live Sequence Tab 表格 | 复用虚拟滚动 + Total/Showing 统计 + 强制 auto-scroll |
| Save MD / Save JSON | 复用 `liveSequenceEventsToResult` 工具函数 |
| `decodeCommand` / `decodeReportPayload` | 自动按 Report ID 还原字段值 |
| `formatFieldValue` | 输出统一 `0xNN(dec)` 格式 |

**零新增** 协议层代码——所有解析复用现有实现。

---

## 4. 协议细节

### 4.1 HID 设备路径（device path）

Windows 上 node-hid 返回的 `devices()` 形如：

```ts
[
  {
    vendorId: 1003,        // 0x03EB = Atmel (HID-I²C 标准 VID)
    productId: 21441,
    path: '\\\\?\\HID#VID_03EB&PID_53D1#...',
    serialNumber: '',
    release: 1,
    manufacturer: 'Atmel',
    product: 'HID-I²C Demo',
    interface: 0,
    usagePage: 1,          // Generic Desktop
    usage: 6,              // Keyboard / generic
  },
  ...
]
```

**过滤策略**：用户在下拉框中看到**所有** HID 设备（不仅 HID-I²C），因为有些 HID-I²C 设备不严格按标准 usage。预过滤 `usagePage=1 && usage=6` 作为建议，但**不强制**——用户看 desc 后自己判断。

### 4.2 报告 ID 推断

HID 设备的 report 由一个 byte 的 `reportId` 标识（如果设备有 report ID 的话）。`HID` 类暴露 `getReportDescriptor(reportId)`，可读取该 report 的描述符。

设备打开后，前端通过 `IPC hid-read-feature-report(0x01)` 等试探，或直接靠用户从 Report Descriptor 文本中知道 report ID。

### 4.3 SET_REPORT 字节格式

HID 标准 SET_REPORT 字节流：
```
[reportId, ...payload]
```
HID-I²C 设备（标准）封包：
```
[0x00,  // report id
 LEN_LO, LEN_HI,  // 2-byte length
 HID_CMD_LO, HID_CMD_HI,  // HID-over-I²C command register
 ...payload]
```

**主进程转换逻辑**：
- 用户在 UI 点 "GET_REPORT Input#4" 按钮
- 前端调 `IPC hid-write(0, [LEN_LO, LEN_HI, 0x02, 0x21, 0x04, 0])`（构造 GET_REPORT 命令字）
- 主进程 `device.write([0, ...])` 发给设备
- 同时把 `[LEN_LO, LEN_HI, 0x02, 0x21, 0x04, 0]` 字节流以 `i2c-raw-frame` 通道发出（isRead=false, register=computed from len+cmd bytes）

### 4.4 GET_REPORT 命令构造

```
opcodes (HID 1.11):
  0x01  RESET
  0x02  GET_REPORT
  0x03  SET_REPORT
  0x04  GET_IDLE
  0x05  SET_IDLE
  0x08  SET_POWER
```

GET_REPORT 格式（用户 UI 输入 ReportType / ReportId）：
- 字节 0-1: `LEN_LO, LEN_HI` (2-byte)
- 字节 2-3: opcode + reportType(高 nibble) + reportId(低 nibble)
  - 例 GET Input#4: `0x02 0x14` (0x02=GET_REPORT, 0x1=Input, 0x4=reportId)
- 字节 4: extended reportId（如果低 nibble == 0x0F）

### 4.5 Input Report 接收

主进程开 `device.on('data', (buf) => ...)` 异步监听设备主动发来的 Input Report。buf 形如 `[reportId, ...payload]`，转成 `[LEN_LO, LEN_HI, ...buf]` 格式以 `i2c-raw-frame` 通道发出（isRead=true）。

---

## 5. UI 设计

### 5.1 第 6 个子 Tab 整体布局

```
┌────────────────────────────────────────────────────────────┐
│ HID I²C Device                                              │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ [Refresh Devices]  Device: [<select>]  [Connect]      │ │
│ │ Path: \\?\HID#VID_03EB&PID_53D1#...                    │ │
│ │ VID=0x03EB PID=0x53D1 Manufacturer=Atmel Product=...    │ │
│ │ [HID Desc (auto-fetched 30B)]   [Load from device]    │ │
│ │ [Report Desc (auto-fetched hex)] [Load from device]    │ │
│ │ Addr: [0x0001] Desc Reg: [0x0002]                     │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                              │
│ Commands:                                                    │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ [SET_POWER D0]  [SET_POWER D1]  [RESET]                │ │
│ │ [GET_REPORT ▼ Type:Input ReportId:0x04] [Send]         │ │
│ │ [SET_REPORT ▼ Type:Output ReportId:0x04]               │ │
│ │   Payload hex: [____________________________] [Send]   │ │
│ │ [Custom: Opcode:__ Type:__ ReportId:__ Payload:__]     │ │
│ │   [Send]                                                │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                              │
│ Status: ● Connected | Sent 12 cmds, received 47 reports    │
│                                                              │
│ [Live events table — 复用 Live Sequence 虚拟滚动表格]       │
│  Total: 59 events    Showing rows 1-50                     │
│  # | Time | Direction | Event Type | ReportID | Description │
│  ...                                                         │
│                                                              │
│ [Save MD] [Save JSON]                                       │
└────────────────────────────────────────────────────────────┘
```

### 5.2 工具栏（设备选择 + 自动加载）

```tsx
<div style={{...toolbar}}>
  <button onClick={refreshDevices}>Refresh Devices</button>
  <select value={selectedPath} onChange={e => setSelectedPath(e.target.value)}>
    {deviceList.map(d => (
      <option key={d.path} value={d.path}>
        {d.product} ({d.vendorId.toString(16)}:{d.productId.toString(16)})
      </option>
    ))}
  </select>
  <button onClick={connect} disabled={!selectedPath}>Connect</button>
  <button onClick={disconnect} disabled={!connected}>Disconnect</button>
</div>
```

`refreshDevices()` → `IPC hid-list` → 后端调 `HID.devices()` → 返回 list

### 5.3 命令面板

**快捷按钮**（高频命令）：
- `SET_POWER D0` (opcode 0x08, param 0) — 唤醒设备
- `SET_POWER D1` (opcode 0x08, param 1) — 待机
- `RESET` (opcode 0x01) — 复位

**GET_REPORT**（Type / ReportId / 长度可选）：
- 下拉选 Input/Output/Feature
- 输入 ReportId（0-15 短格式 / 0x0F + 扩展字节 长格式）
- 构造 `cmd = 0x02 | (type << 4) | reportId`，加上 `LEN_LO, LEN_HI` 头

**SET_REPORT**：同上 + 16-byte payload 文本框

**Custom**：完全自由格式（16-byte hex input）—— 给高级用户

### 5.4 事件表格

**直接复用** Live Sequence Tab 的虚拟滚动 + Total/Showing + auto-scroll 到底部。**不重写一份**。

### 5.5 状态栏

```
● Connected |  12 cmds sent | 47 reports received
● Disconnected |  (灰显)
● Error: <error message>  (红色)
```

---

## 6. IPC 契约

### 6.1 主进程 → 渲染进程（events）

| Channel | Direction | Payload | 说明 |
|---------|-----------|---------|------|
| `i2c-raw-frame` | main→renderer | `{ timestamp, i2cAddress, isRead, register, rawBytes }` | **已存在**，HID 字节流走这条 |
| `hid-device-list-updated` | main→renderer | `HIDDeviceInfo[]` | 设备热插拔通知（可选，初版不做） |

### 6.2 渲染进程 → 主进程（invoke）

| Method | Args | Returns | 说明 |
|--------|------|---------|------|
| `hid-list()` | — | `HIDDeviceInfo[]` | 列出所有 HID 设备 |
| `hid-open(path)` | `string` | `{ success: boolean, error?: string, hidDesc?: number[], reportDesc?: number[] }` | 打开设备，可选自动读 desc |
| `hid-close()` | — | `{ success }` | 关闭当前设备 |
| `hid-write(reportId, data)` | `number, number[]` | `{ success, error?, sentBytes: number }` | 写一个 report |
| `hid-read-feature(reportId)` | `number` | `{ data?: number[], error? }` | 同步读 feature report |
| `hid-descriptors()` | — | `{ hidDesc, reportDesc }` | 读已经打开设备的两个 descriptor |

### 6.3 preload 暴露

```ts
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing ...
  hidList: (): Promise<HIDDeviceInfo[]> => ipcRenderer.invoke('hid-list'),
  hidOpen: (path: string) => ipcRenderer.invoke('hid-open', path),
  hidClose: () => ipcRenderer.invoke('hid-close'),
  hidWrite: (reportId: number, data: number[]) =>
    ipcRenderer.invoke('hid-write', reportId, data),
  hidReadFeature: (reportId: number) =>
    ipcRenderer.invoke('hid-read-feature', reportId),
  hidDescriptors: () => ipcRenderer.invoke('hid-descriptors'),
});
```

**命名约定**：
- IPC channel name（主进程 + preload 字符串）使用 kebab-case：`hid-list` / `hid-open` / `hid-write` 等
- Preload 暴露的 API 方法名（renderer 调的）使用 camelCase：`hidList` / `hidOpen` / `hidWrite` 等

### 6.4 类型扩展

```ts
// types/electron.d.ts
export interface HIDDeviceInfo {
  vendorId: number;
  productId: number;
  path: string;
  serialNumber: string;
  release: number;
  manufacturer: string;
  product: string;
  interface: number;
  usagePage: number;
  usage: number;
}

export interface ElectronAPI {
  // ... existing ...
  hidList?: () => Promise<HIDDeviceInfo[]>;
  hidOpen?: (path: string) => Promise<{
    success: boolean;
    error?: string;
    hidDesc?: number[];
    reportDesc?: number[];
  }>;
  hidClose?: () => Promise<{ success: boolean; error?: string }>;
  hidWrite?: (reportId: number, data: number[]) => Promise<{
    success: boolean;
    error?: string;
    sentBytes: number;
  }>;
  hidReadFeature?: (reportId: number) => Promise<{
    data?: number[];
    error?: string;
  }>;
  hidDescriptors?: () => Promise<{ hidDesc: number[]; reportDesc: number[] }>;
}
```

---

## 7. 关键实现细节

### 7.1 IPC handler：hid-list

```ts
ipcMain.handle('hid-list', async () => {
  try {
    return HID.devices();
  } catch (e) {
    console.error('hid-list error:', e);
    return [];
  }
});
```

### 7.2 IPC handler：hid-open

```ts
let currentHID: HID | null = null;
let currentDeviceInfo: HIDDeviceInfo | null = null;

ipcMain.handle('hid-open', async (_event, path: string) => {
  try {
    if (currentHID) currentHID.close();
    const dev = HID.devices().find(d => d.path === path);
    if (!dev) return { success: false, error: 'Device not found' };

    currentHID = new HID(path);
    currentDeviceInfo = dev;
    currentHID.on('data', (buf: number[]) => {
      // Device pushed an input report
      if (mainWindow) {
        // Wrap in I2cTransaction format: [LEN_LO, LEN_HI, ...buf]
        const wrapped = [buf.length & 0xFF, (buf.length >> 8) & 0xFF, ...buf];
        mainWindow.webContents.send('i2c-raw-frame', {
          timestamp: Date.now(),
          i2cAddress: 0,  // HID doesn't carry I²C address in standard protocol
          isRead: true,
          register: null,
          rawBytes: wrapped,
        });
      }
    });

    // Auto-fetch descriptors if available
    let hidDesc: number[] | undefined;
    let reportDesc: number[] | undefined;
    try {
      const rawHidDesc = currentHID.getFeatureReport(0x00, 31);  // HID descriptor is feature report 0
      if (rawHidDesc && rawHidDesc.length === 31) {
        hidDesc = rawHidDesc;
      }
    } catch { /* ignore */ }

    return { success: true, hidDesc, reportDesc };
  } catch (e: any) {
    return { success: false, error: String(e) };
  }
});
```

### 7.3 IPC handler：hid-write

```ts
ipcMain.handle('hid-write', async (_event, reportId: number, data: number[]) => {
  if (!currentHID) return { success: false, error: 'Not connected', sentBytes: 0 };
  try {
    // node-hid write prepends reportId automatically for SET_REPORT
    currentHID.write([reportId, ...data]);
    
    // Forward to LiveHidAnalyzer via existing i2c-raw-frame channel
    if (mainWindow) {
      const wrapped = [(data.length + 1) & 0xFF, ((data.length + 1) >> 8) & 0xFF,
                       reportId, ...data];
      mainWindow.webContents.send('i2c-raw-frame', {
        timestamp: Date.now(),
        i2cAddress: 0,
        isRead: false,
        register: data.length >= 2 ? (data[0] | (data[1] << 8)) & 0xFFFF : null,
        rawBytes: wrapped,
      });
    }
    return { success: true, sentBytes: data.length + 1 };
  } catch (e: any) {
    return { success: false, error: String(e), sentBytes: 0 };
  }
});
```

### 7.4 渲染层：命令构造

```ts
const buildGetReportCommand = (type: 'input' | 'output' | 'feature', reportId: number): number[] => {
  // Bytes 0-1: length prefix (2 bytes including self)
  // Bytes 2-3: opcode (0x02 GET_REPORT) | (type << 4) | reportId
  const typeMap = { input: 1, output: 2, feature: 3 };
  const cmd = 0x02 | (typeMap[type] << 4) | (reportId & 0x0F);
  const data = [cmd & 0xFF, (cmd >> 8) & 0xFF];
  return data;  // length prefix added by main process
};

const buildSetReportCommand = (type, reportId, payload) => {
  const typeMap = { input: 1, output: 2, feature: 3 };
  const cmd = 0x03 | (typeMap[type] << 4) | (reportId & 0x0F);
  return [cmd & 0xFF, (cmd >> 8) & 0xFF, ...payload];
};
```

### 7.5 渲染层：subTab JSX（概要）

```tsx
{subTab === 'hidDevice' && (
  <HidDeviceTab
    onDeviceSelected={...}
    onWriteCommand={(reportId, data) => window.electronAPI.hidWrite?.(reportId, data)}
    onConnect={(path) => window.electronAPI.hidOpen?.(path)}
    onDisconnect={() => window.electronAPI.hidClose?.()}
    descriptors={descriptors}
  />
)}
```

`HidDeviceTab` 内部：
- 顶部：设备选择 + 连接/断开
- 中部：命令面板（高频按钮 + GET/SET/Custom）
- 底部：**复用** `LiveSequenceTab` 的事件表格渲染（提取共用的虚拟滚动 row 渲染函数）

---

## 8. 关键决策

### 8.1 设备选择 UX

**决策**：下拉框（不是系统弹窗），与现有 `I2C Addr` 输入框风格一致。

**理由**：
- 用户已习惯现有"Refresh → 下拉框选"模式
- 自动枚举所有 HID 设备（不仅 HID-I²C）—— 用户看 desc 后自己判断
- 加 usagePage / usage 过滤作为下拉分组（"Standard HID-I²C" / "Other HID"）

### 8.2 i2c-raw-frame 中 i2cAddress 字段

**决策**：HID 设备不携带 I²C 地址（标准 HID 协议没有这层），主进程发 `i2cAddress: 0`。

**理由**：
- 现有 IPC 契约保留向后兼容
- Live Sequence 表格里用 `i2cAddress: 0` 表示"HID 来源"，UI 不显示
- 不需要新加字段

### 8.3 自动加载 descriptor

**决策**：初次 Connect 时**尝试**从设备读 HID Desc（feature report 0）和 Report Desc（input report 0）；**不强制**——读不到时显示提示让用户手动粘贴。

**理由**：
- 标准 HID 设备 descriptor 不一定通过 HID feature report 0 暴露（HID-I²C 设备遵循此规范，但其他 HID 设备不一定）
- 失败不能阻塞主流程

### 8.4 命令面板布局

**决策**：把 `getEvents` 的"事件流"也视为 Live Sequence Tab 的同类——**直接渲染同一个表格组件**。

**理由**：
- 避免代码重复
- 用户在两个 Tab 之间切换时，事件表格样式一致
- Save MD / Save JSON 在两个 Tab 上行为相同

### 8.5 设备热插拔

**决策**：**初版不支持**热插拔监听。仅在用户主动点 "Refresh Devices" 时枚举。

**理由**：
- 实现简单
- 真实使用中 HID-I²C 设备不会频繁热插拔
- 未来可加 `hid-device-list-updated` event 增量更新

---

## 9. 风险与缓解

| # | 风险 | 缓解 | 概率 | 影响 |
|---|------|------|------|------|
| R1 | node-hid 在 Electron 33 + Node 20 上 prebuild 不可用 | `@electron/rebuild` 重新编译；如失败回退 WebHID | 低 | 高 |
| R2 | Windows 上需要管理员权限 | Win10+ 已不需要；如报错提示用户 | 低 | 中 |
| R3 | `device.read()` 异步回调与 React state 不匹配 | 包成 Promise + 状态机；input report 走 event-based `setNonBlocking` | 中 | 中 |
| R4 | `i2c-raw-frame` 高频触发 React re-render | 现有虚拟滚动已经处理好；HID input 不超过 1kHz | 低 | 中 |
| R5 | user 操作 HID 设备发出 `0x00` 字节与 SET_REPORT 标志冲突 | node-hid 自动 prepend reportId；本应用不在 data 数组前置 0x00 | 低 | 高 |
| R6 | USB HID 设备拔出后回调异常 | `device.on('error', ...)` 监听 + 状态置 Disconnected | 中 | 低 |
| R7 | 设备 descriptor 解析失败（feature report 0 不存在） | 仅 disable 自动加载；让用户手动 paste | 中 | 低 |

---

## 10. 实施步骤

按依赖顺序，每步独立 commit + 验证：

### Step 1：装包与 native module 重编
- `npm install --save node-hid @types/node-hid`
- `package.json` 加 `"rebuild": "electron-rebuild -f -w node-hid"` script
- `forge.config.ts` 启用 `rebuildConfig`
- 验证 `npm run rebuild` 成功（Windows 上 native module 编译 OK）
- **风险预案**：如果重编失败，回退到 WebHID

### Step 2：主进程 IPC（list/open/close/write/read-feature/descriptors）
- `main.ts` 加 6 个 `ipcMain.handle` + 1 个 `device.on('data')` 监听
- 维护 `currentHID: HID | null` 单一设备引用
- 所有写操作都向 `i2c-raw-frame` 通道转发字节流
- 验证：用真实 HID 设备（如触摸板）打开后能在 Live Sequence Tab 看到命令事件

### Step 3：preload + 类型
- `preload.ts` 暴露 6 个 API
- `types/electron.d.ts` 加 `HIDDeviceInfo` interface + 6 个方法签名

### Step 4：渲染层 subTab
- `HidAnalysisView.tsx` 加 `subTab: 'hidDevice'`
- 新增 `HidDeviceTab` component（独立文件 ~250 行，定义在 HidAnalysisView.tsx 内）
- 设备选择 + 连接/断开 + 命令面板 + **复用** Live Sequence 表格渲染

### Step 5：build + 验证
- `tsc --noEmit` 零错
- `vite build` 成功
- `npm run rebuild` 重编 node-hid
- `electron-forge make --mac`（macOS 上可 build，Windows binary 需在 Windows 机器 build）

---

## 11. 验收标准

- ✅ 在 Windows 上安装后能列出所有 HID 设备
- ✅ 选择一个 HID-I²C 设备 → Connect 成功 → desc 自动加载（或显示提示让用户手动 paste）
- ✅ 点 "SET_POWER D0" 按钮 → 设备收到命令字节流 → 同时在 Live Sequence Tab 表格里出现 "Send Command: Set Power (D0)..." 事件
- ✅ 设备主动发 Input Report → 表格里出现 "Input Report Input#0x04 → [X=0x32(50), Y=0xE2(-30), ...]"
- ✅ 4 个现有 Tab 行为不变
- ✅ TrajectoryView / PlaybackView / Frame List / Debug / 录制 5 个其他组件零变更

---

## 12. 估算工作量

| 步骤 | 文件 | 行数 |
|------|------|------|
| 1 | `package.json` + `forge.config.ts` | ~10 |
| 2 | `main.ts` | ~120 |
| 3 | `preload.ts` + `types/electron.d.ts` | ~50 |
| 4 | `HidAnalysisView.tsx` | ~250 |
| **合计** | | **~430** |

加上 node-hid native 编译（一次 ~2-5 分钟），实施总时间约 1-2 小时。

---

## 13. 文档同步

- README.md：HidAnalysisView 从 5 个子 Tab 改为 6 个；增加 HID I²C Device Tab 章节
- App.tsx Help 弹窗：同步
- spec 文档（本文件）保留

---

## 14. 不在本 spec 范围内

- 设备热插拔监听
- 多设备同时连接
- Linux / macOS 适配（用户已确认 Windows only）
- I²C 字节级操作（用户已确认 HID 报告级）
- 模拟器模式（如果用户后续需要可独立做）
