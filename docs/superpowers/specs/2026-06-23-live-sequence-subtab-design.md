# Live Sequence subTab —— 实时 HID-over-I²C 协议分析

**日期：** 2026-06-23
**状态：** 待用户审阅
**前置 spec：** [2026-06-12-hid-i2c-analysis-integration-feasibility.md](2026-06-12-hid-i2c-analysis-integration-feasibility.md)

---

## 1. 概述

在现有 `HidAnalysisView` 5 个子 Tab 中新增第 5 个：**Live Sequence**。

按用户原话：
> 增加一个 hid 数据解析面板，按照 power on seq 里面的逻辑，用户主动将 hid 描述符和报告描述符给到 hid 数据解析面板里，然后通过 start listen 实时将 hid 数据解析出来，包括 command 和 report。

与现有 Power-On Seq Tab 的区别：

| | Power-On Seq | **Live Sequence（新增）** |
|---|---|---|
| 数据源 | 用户粘贴静态 I²C 日志文本（5 种格式） | 主进程通过 `i2c-raw-frame` IPC 推送的实时字节流 |
| descriptor 来源 | **自动探测**（扫描整段日志找 HID Desc Response + Report Desc Response） | **用户手动输入**两个 textarea |
| 时机 | 一次分析 | 持续增量 |
| 事件分类 | 同 9 种 eventType | **同 9 种 eventType** |
| 解析深度 | 全 9 种（含 GET_REPORT 配对） | 7 种无配对 + Get Report Response 兜底（见 §5） |

**复用目标**：把现有 `analyzeSequence` 内部状态机抽出，支持增量推送，让 5 个子 Tab 共享同一份协议解码逻辑。

---

## 2. 用户界面

新增 1 个 subTab，与现有 4 个并列：

```
[ HID Analysis ]
  ├── Power-On Seq      (静态文本 → events 表格)
  ├── Device Desc       (30 字节 → Markdown)
  ├── Report Desc       (任意长度 → 字段表 + .wara)
  ├── Report Data       (粘贴 / 实时帧 → 字段表)
  └── Live Sequence     (新增：descriptor 输入 + Start Listening + 实时 events 表格)
```

### 2.1 Live Sequence 子 Tab 布局

**上半区：descriptor 输入面板**

```
┌─────────────────────────────────────────────────────────────────┐
│ [HID Desc: 30B textarea]              [Load]  status: Loaded  │
│ [Report Desc: hex textarea]           [Load]  status: Loaded  │
│ [Addr: 0x__] [Desc Reg: 0x____]                              │
│ [Start Listening] [Stop]                                      │
└─────────────────────────────────────────────────────────────────┘
```

- 3 个 textarea / input：HID Device Desc 30B、Report Desc（任意长 hex）、I²C Addr + Desc Reg（与 Power-On Seq 的 `seqAddr` / `seqReg` 同一字段）
- 每个文本框右侧 `Load` 按钮：把 hex 解析成 descriptor，调 `parseDescriptor`（HID-I²C）和 `parseReportDescriptor` + `analyzeReportItems`（Report），将结果存入本 subTab 的 ref
- 实时模式与 Power-On Seq 共享 `reportDataDescHex` 吗？**不**。Live Sequence 自己的 descriptor 上下文是独立的（live 监听期间由用户锁定，避免中途切换 descriptor 改变语义）

**下半区：实时 events 表格**

按 Power-On Seq 的 `generateSequenceMarkdown` 渲染样式：

| # | Time (s) | Direction | Event Type | ReportID | Description | Raw Data |
|---|----------|-----------|------------|----------|-------------|----------|
| 1 | 0.000    | Host → Device | Read HID Descriptor |   | `Request HID Device Descriptor REG=0x0001` | `0x01 0x00` |
| 2 | 0.000    | Host ← Device | HID Descriptor Response |   | `Received HID Device Descriptor (30B) VID=... PID=...` | `0x1E 0x00 ...` |
| 3 | 0.000    | Host → Device | Send Command |   | `Set Power (D0) → Device enters normal full-power mode` | `0x05 0x00 0x00 0x08` |
| 4 | 0.000    | Host → Device | Read Report Descriptor |   | `Request Report Descriptor REG=0x0002` | `0x02 0x00` |
| 5 | 0.000    | Host ← Device | Report Descriptor Response |   | `Received Report Descriptor (246B), parsed as field layout` | `05 01 09 02 ...` |
| 6 | 0.000    | Host → Device | Send Command |   | `Set Report Feature#0x02 → [data hex]` | `0x05 0x00 0x33 0x02 ...` |
| 7 | 0.000    | Host ← Device | Get Report Response | Input#0x04 | `Received Input current value → [X=0x32(50), Y=0xE2(-30), ...]` | `0x05 0x00 0x03 0x00 0x00` |

- 表格**无 events 上限**——`LiveHidAnalyzer.allEvents` 持续 append；长跑累积到几十万条时通过 Save → Clear 控内存
- Live mode 时**仅追加**新行到表格底部，**不**重排
- `rawBytes` 列省略 — 改放在 `Description` 列内联（避免列过宽）
- 顶部 `Listening...` 状态徽章

### 2.2 与 Power-On Seq 的视觉一致性

| 元素 | Power-On Seq | Live Sequence |
|------|--------------|---------------|
| 表格列 | # / Time / Direction / Event Type / ReportID / Description / Raw Data | # / Time / Direction / Event Type / ReportID / Description（rawBytes 内联到 Description） |
| Markdown 渲染 | `marked` 解析后 `setSeqHtml` | 同（但用 `setLiveSeqHtml`） |
| 状态徽章 | 无 | `Listening: 200 frames captured` |

---

## 3. 数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│  Saleae Logic 2 + i2c_hla (Python)                                  │
│  抓取 I²C 波形 → ADDR / DATA / STOP frames                        │
└────────────────┬─────────────────────────────────────────────────────┘
                 │ UDP 50000 (JSON)
                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  main.ts UDP handler                                                  │
│  - parseFingerFrame / parseStylusFrame  → 'finger-frame' IPC        │
│  - 原始 TX bytes                      → 'i2c-raw-frame' IPC         │
│    (payload: { timestamp, i2cAddress, isRead, register, rawBytes })│
└────────────────┬─────────────────────────────────────────────────────┘
                 │ contextBridge: window.electronAPI.onI2cRawFrame
                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LiveHidAnalyzer (new, in src/hid/)                                  │
│  - 持有 state: hidDescriptor / reportFields / pendingRead / events │
│  - pushTransaction(txn) → HidI2cEvent[] (增量事件)                │
│  - 100% 复用 processTransaction() (analyzeSequence 抽出的函数)   │
└────────────────┬─────────────────────────────────────────────────────┘
                 │ 'events[]' (in-memory)
                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Live Sequence subTab UI                                              │
│  - Start Listening → new LiveHidAnalyzer + subscribe onI2cRawFrame│
│  - 每条新 event 推入 events ref + 触发重渲染 (RAF 节流 60Hz)     │
│  - 表格无 events 上限；用 Save + Clear 控内存                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 IPC payload 变化

`i2c-raw-frame` payload 增 2 个字段（**只增不删，向后兼容**）：

```ts
// 旧（commit 510473b）
interface I2cRawFrame {
  timestamp: number;
  i2cAddress: number;
  rawBytes: number[];
}

// 新
interface I2cRawFrame {
  timestamp: number;
  i2cAddress: number;
  isRead: boolean;   // 新增：从 HLA message.data.rw 透传
  register: number | null;  // 新增：write 2 字节时 = (data[0] | data[1]<<8)，read 时 = null
  rawBytes: number[];
}
```

**现有 `i2c-raw-frame` 消费者**（[HidAnalysisView.tsx:616](touchpad-tracker/src/components/HidAnalysisView.tsx#L616)）**不读 `isRead` 和 `register`**，所以只增字段**零回归**。

### 3.2 I²cTransaction 内部表示

`LiveHidAnalyzer.pushTransaction` 接受：

```ts
interface I2cTransaction {
  lineNumber: number;
  timestamp: number;        // seconds (float)
  timeMs: number;           // ms from start
  address: number;
  isRead: boolean;
  data: number[];
  rawLine?: string;
}
```

`main.ts` 在 IPC 发送前把 `I2cRawFrame` 转成 `I2cTransaction`：

```ts
const txn: I2cTransaction = {
  lineNumber: ++counter,
  timestamp: i2cRawFrame.timestamp / 1000,
  timeMs: i2cRawFrame.timestamp - startTime,
  address: i2cRawFrame.i2cAddress,
  isRead: i2cRawFrame.isRead,
  data: i2cRawFrame.rawBytes,
  rawLine: undefined,
};
```

### 3.3 LiveHidAnalyzer 状态机

```ts
class LiveHidAnalyzer {
  private deviceAddress: number;
  private hidDescRegister: number;
  private hidDescriptor: HidI2cDescriptor | null = null;
  private reportFields: ReportField[] = [];
  private pendingRead: string | null = null;
  private order = 0;

  constructor(deviceAddress: number, hidDescRegister: number) { ... }

  /** Reset all state, clear events. Called by Stop button. */
  reset(): void;

  /** Pre-load descriptor (called by Load button, before Start Listening). */
  loadDescriptor(hidDesc: HidI2cDescriptor, reportFields: ReportField[]): void;

  /** Push one I2C transaction. Returns 0+ new events. */
  pushTransaction(tx: I2cTransaction): HidI2cEvent[];

  /** Read all events accumulated so far (for table render). */
  getEvents(): HidI2cEvent[];

  /** Get HID descriptor (for status display). */
  getHidDescriptor(): HidI2cDescriptor | null;
}
```

**`pushTransaction` 内部** = 现有 `analyzeSequence` 主循环（line 345-510）**单条处理**逻辑的提取。原 `analyzeSequence` 改为：

```ts
function processSingleTransaction(
  tx: I2cTransaction, i: number, deviceTx: I2cTransaction[],
  state: AnalyzerState,
): HidI2cEvent[] {
  // ... (extract from analyzeSequence's main loop body) ...
}

export function analyzeSequence(transactions, addr, reg): AnalysisResult {
  const state = createState(addr, reg);
  const events: HidI2cEvent[] = [];
  const deviceTx = transactions.filter(t => t.address === addr || t.address === 0);
  for (let i = 0; i < deviceTx.length; i++) {
    events.push(...processSingleTransaction(deviceTx[i], i, deviceTx, state));
  }
  return { events, ...state };
}
```

**`LiveHidAnalyzer.pushTransaction`** 内部直接调 `processSingleTransaction(tx, -1, [], state)`。`-1` 与 `[]` 让"Peek ahead"分支全部失效（这些只在完整扫描时需要，实时单条推送不需要向前看），保留 `pendingRead` 状态机的核心——这就是为什么能"按 Power-On Seq 逻辑"实时跑。

---

## 4. 关键设计决策

### 4.1 `i2c-raw-frame` 增 `isRead` + `register` 字段：必须

`analyzeSequence` 是 I²C transaction 级的（每条 = 一次 I²C read 或 write）。**没有 `isRead`，无法判断"这是 host→device 写 command"还是"host←device 读 input report"**。这是协议分发的最低输入。

`register` 字段用于快速识别 write 2 字节的 register select（避免主进程再算一次）。前端在分发时仍然用 `analyzeSequence` 自己的 register 匹配逻辑，但保留这个字段方便调试和未来扩展。

### 4.2 不复用 `preScanReportFields`

现有 `analyzeSequence` 的 pre-scan 阶段（line 320-324）扫描整段 transaction 找 HID Desc Response + Report Desc Response 来自动获取字段表。**Live Sequence 跳过这一步**——descriptor 已经在 Load 时由用户输入并存在 `hidDescriptor` / `reportFields` 里。

### 4.3 Get Report Response 配对的局限

**实时单条推送**无法做完整的 `pendingRead='get_report_*'` 配对——因为 host 发 GET_REPORT 与 device 回 response 之间隔着未知数量的其他 transaction。**降级为**：response 进来时按 `[len_lo, len_hi, report_id, ...]` 启发式归类（直接走 `decodeReportPayload`），并在 Description 里加 `(orphan GET_REPORT response)` 标记。

代码位置：[line 442-465](touchpad-tracker/src/hid/HidI2cSequenceAnalyzer.ts#L442-L465) 的 `pendingRead && pendingRead.startsWith('get_report_')` 分支里，对 `pendingRead` 不匹配的情况 fallback 到通用 Input Report 解析。

### 4.4 表格无 events 上限

`LiveHidAnalyzer.allEvents` 持续 append，不做 FIFO 截断。理由：用户对"看到所有数据"的需求大于内存保护；1 hour @ 100Hz × ~150B/event ≈ 50MB，可接受。

控制内存的循环：**Save → Clear**。Save 把累积 events 一次性写到磁盘，Clear 重置 analyzer。运行模式自然成为"长会话 → 周期性 Save-Clear"。

`LiveHidAnalyzer` 内部 `maxEvents` 字段已删除（构造参数也删除）。

### 4.5 渲染节流

实时事件可能高频（触摸板 ~100Hz）。UI 渲染走 `requestAnimationFrame` 节流到 60 FPS——多个 event 在同一帧内合并到一次渲染。

---

## 5. 实现步骤

按以下顺序，每步独立 commit：

### Step 1：主进程补 IPC 字段
- `main.ts` UDP handler：把 `message.data.rw` 转为 `isRead: boolean` 转发；同时从 `[data[0], data[1]]` 计算 `register: number | null`
- `preload.ts`：补类型
- `types/electron.d.ts`：补 `I2cRawFrame` 字段
- **验证**：现有 Tab 4 Start Listening 仍工作（新字段被忽略）

### Step 2：抽 `processSingleTransaction` 公共函数
- `HidI2cSequenceAnalyzer.ts`：从 `analyzeSequence` 主循环抽出单条处理逻辑为 `processSingleTransaction(tx, i, deviceTx, state)`
- 现有 `analyzeSequence` 改为调用 `processSingleTransaction` 在循环里跑
- **验证**：Power-On Seq Tab 行为不变（用现有 `SEQ_SAMPLE` 测试）

### Step 3：新增 `LiveHidAnalyzer` 类
- 同文件新增 `LiveHidAnalyzer` 类
- 提供 `loadDescriptor` / `pushTransaction` / `reset` / `getEvents` / `getHidDescriptor`
- **验证**：单元测试（可选）或 Power-On Seq 行为 + Live Sequence 行为一致

### Step 4：新增 Live Sequence subTab
- `HidAnalysisView.tsx`：在 subTab 列表加 `'liveSequence'`
- 新增 UI 状态：`liveSeqHidDescHex` / `liveSeqReportDescHex` / `liveSeqAddr` / `liveSeqReg` / `liveSeqStatus` / `liveSeqHtml` / `liveSeqEvents` (useState events array)
- 新增 handler：`handleLoadLiveSeqDescriptor` / `handleStartLiveSeqListening` / `handleStopLiveSeqListening`
- 表格行渲染：基于 `liveSeqEvents` 数组 map
- 事件来源：订阅 `onI2cRawFrame`，每条 frame → `LiveHidAnalyzer.pushTransaction` → 拿新 events → setState
- **验证**：粘贴 `power on seq.txt` 到 Power-On Seq Tab 看静态分析；切到 Live Sequence Tab，模拟推送（手动 or 真实 UDP）看实时分析；两者结果一致

### Step 5：rebuild + 验证
- `tsc --noEmit` 零错
- `vite build` 成功
- `electron-forge make --mac` 成功
- 安装包大小变化 < 1MB

---

## 6. 影响范围评估（关键问题）

### 6.1 现有功能会不会受影响？

| 现有功能 | 依赖 | 是否受影响 | 备注 |
|----------|------|------------|------|
| **TrajectoryView** | `onFingerFrame` IPC | ❌ **零影响** | 旧 IPC 通道，main.ts 完全不动 |
| **PlaybackView** | `usePlayer` 接 `onFingerFrame` | ❌ 零影响 | 同上 |
| **Frame List** | App.tsx 总线 `onFingerFrame` | ❌ 零影响 | 同上 |
| **Debug 视图** | App.tsx 总线 `onFingerFrame` | ❌ 零影响 | 同上 |
| **录制** | `useRecorder` 调 `addFrame` | ❌ 零影响 | 旧 IPC 不动 |
| **Power-On Seq** | `analyzeSequence` + `parseTransactions` | ✅ **需验证** | Step 2 重构要保持 100% 行为一致 |
| **Device Desc** | `parseDescriptor` | ❌ 零影响 | 纯函数 |
| **Report Desc** | `parseDescriptor` + `analyzeReportItems` | ❌ 零影响 | 纯函数 |
| **Report Data 静态** | `parseAllFrames` | ❌ 零影响 | 纯函数 |
| **Report Data 实时** | `onI2cRawFrame` | ✅ **需验证** | 新增 `isRead` / `register` 字段——只增不改，零回归 |
| **Help 弹窗** | 静态 | ❌ 零影响 | 不动 |
| **CONFIG（config + saveConfig）** | electron-store | ❌ 零影响 | 不动 |

### 6.2 `i2c-raw-frame` 增字段对现有消费者的影响

唯一现有消费者：[HidAnalysisView.tsx:616](touchpad-tracker/src/components/HidAnalysisView.tsx#L616) `handleStartListening`。

现有代码片段（重构后）：
```ts
const unsub = window.electronAPI.onI2cRawFrame?.((rawFrame) => {
  if (!rawFrame.rawBytes || rawFrame.rawBytes.length === 0) return;
  if (addrFilter !== null && rawFrame.i2cAddress !== addrFilter) return;
  const rawHex = rawFrame.rawBytes.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  // ... parseSingleFrame ...
});
```

**不读 `isRead` / `register`**——完全兼容新字段。

### 6.3 `analyzeSequence` 重构的回归风险

`processSingleTransaction` 抽出后，`analyzeSequence` 主循环变成：
```ts
for (let i = 0; i < deviceTx.length; i++) {
  events.push(...processSingleTransaction(deviceTx[i], i, deviceTx, state));
}
```

**风险点**：
- 主循环里有 3 处"Peek ahead"逻辑（line 371-376 / 383-385 / 467-468），依赖 `i` 和 `deviceTx[i+1]`。这些逻辑**只在预解析场景**有用（Power-On Seq 静态分析用），**Live 场景不需要**（实时收到 HID Desc Response 时 descriptor 已经被用户 Load 了）

**处理方案**：
- `processSingleTransaction` 接受 `i: number` 与 `deviceTx: I2cTransaction[]` 参数
- 调用方：
  - `analyzeSequence` 传 `(deviceTx[i], i, deviceTx, state)`
  - `LiveHidAnalyzer.pushTransaction` 传 `(tx, -1, [], state)`——`i=-1` 跳过所有 Peek ahead

**验证**：
- 现有 `SEQ_SAMPLE` 重新跑 Power-On Seq Tab，对比前后的事件表（应 100% 一致）
- 如果有现成测试可加单元测试 `analyzeSequence(SEQ_SAMPLE) == expected events[]`

### 6.4 Live Sequence Tab 内部风险

- **高频事件渲染**：触摸板 ~100Hz，每次推送 1-3 个 event。需要 RAF 节流。**实现方式**：在 subTab 内部 `useRef<events[]>` 维护，`useState<number>` 维护 tick，每帧追加新 events 后 `setTick(t => t+1)` 触发渲染。已有 `FrameListView` / `LiveFrameTable` 用同模式。
- **descriptor 切换中途**：`LiveHidAnalyzer.loadDescriptor` 只能在 Start 之前调用。Stop 时同时 `reset()` 防止脏 state 污染下次会话。
- **表格行 200 上限**：用 `events.slice(-200)` 截断渲染（不修改 `LiveHidAnalyzer` 内部 `events` 全集，避免丢历史）。

### 6.5 主进程改动的影响

`main.ts` UDP handler 增加 ~10 行：
```ts
const isRead = (message.data.rw || '').toUpperCase() === 'R';
const register = !isRead && dataArray.length === 2
  ? parseHexOrDec(dataArray[0]) | (parseHexOrDec(dataArray[1]) << 8)
  : null;
```

**关键点**：
- HLA 现有 `message.data.rw` 字段在 BootUp.txt 解析（format 4）里被读出，传到 `TX` 消息。确认它在 UDP payload 里**确实存在**（line 88-103 of `HidI2cSequenceAnalyzer.ts` 验证：`(write|read) to 0xNN ...` 模式从行文本解析 `rw`）
- 但是：HLA 的 `flush_transaction` 只在 `START` / `STOP` 时调用，`current_rw` 会被**重置前一次的方向**。**风险**：如果一次 I²C 事务内混合了 read 与 write（异常），HLA 给的 rw 不可靠。

**降级方案**：如果在 BootUp.txt 测试中发现 rw 字段不可用，回到**纯启发式**：
- write 2 字节：register select（计算 register）
- read N 字节：input report
- write > 2 字节：output / set report
- **这种启发式不依赖 HLA 方向字段**

降级后主进程完全不需要 isRead 字段——前端 Live Sequence 自己做启发式分发。**但功能上弱于真正的 analyzeSequence**——这就是 Step 1 的 IPC 增字段是"必须"的原因（如果不依赖 rw 字段降级，可以做但代码丑很多）。

---

## 7. 风险清单

| # | 风险 | 缓解 | 概率 | 影响 |
|---|------|------|------|------|
| R1 | Step 2 重构破坏 Power-On Seq 行为 | 现有 `SEQ_SAMPLE` 重跑对比；单元测试 | 低 | 高 |
| R2 | `i2c-raw-frame` 增字段破坏现有 Tab 4 实时 | 只增不改，新字段被现有消费者忽略 | 极低 | 中 |
| R3 | HLA `rw` 字段不可靠 | 启发式降级方案 | 中 | 中 |
| R4 | 高频事件渲染卡顿（长会话累积大量 events 时） | RAF 节流 + Save→Clear 循环；未来可加虚拟滚动 | 低 | 低 |
| R5 | 触摸板私有协议 vs 标准 HID-I²C 不匹配 | 触摸板不按 HID-I²C 走——Live Sequence 适合**任何标准 HID-I²C 设备**的调试（用户测试 vendor 设备） | 已识别 | 文档说明 |
| R6 | `processSingleTransaction` 抽出后行为微妙变化 | 抽出后立即 diff 事件表 | 低 | 高 |

---

## 8. 测试计划

### 8.1 单元测试（手写，1 个文件）

`src/hid/__tests__/analyzeSequence.test.ts`：
- 用 `SEQ_SAMPLE` 跑 `analyzeSequence` → 期望事件表（从现有 Power-On Seq UI 复制）
- 重构后回归
- `LiveHidAnalyzer` 同样用 `SEQ_SAMPLE` 逐条 push → 期望结果与批处理一致

### 8.2 集成测试

- **真实数据流**：用 `power on seq.txt`（用户提供的 16 行 I²C 日志）作为 Power-On Seq Tab 输入，跑出 events 表
- 切换到 Live Sequence Tab，手动加载同 HID Desc + Report Desc，启动 listening，用脚本**模拟** 16 条 raw frame 通过 IPC（用 node 脚本驱动 `webContents.send`）
- 对比两 Tab 事件表应 100% 一致

### 8.3 回归测试

- TrajectoryView / PlaybackView / Frame List / Debug / 录制 4 个 Tab 行为不变
- Power-On Seq Tab 用 SEQ_SAMPLE 跑通
- Device Desc / Report Desc / Report Data Tab 现有按钮仍工作

---

## 9. 文档更新

- README.md：在"HID Analysis · 4 个子 Tab"章节更新为 5 个子 Tab
- 现有 [2026-06-12-hid-i2c-analysis-integration-feasibility.md](2026-06-12-hid-i2c-analysis-integration-feasibility.md) §1.1 表格加 "5 | Live Sequence（实时）" 行
- Help 弹窗：新增 "Live Sequence" 章节说明

---

## 10. 估算工作量

| Step | 文件 | 行数（additions） | 净增（additions - deletions） |
|------|------|------------------|------------------------------|
| 1 | main.ts / preload.ts / types/electron.d.ts | ~25 | +25 |
| 2 | HidI2cSequenceAnalyzer.ts | ~30 | +15 |
| 3 | HidI2cSequenceAnalyzer.ts | ~80 | +80 |
| 4 | HidAnalysisView.tsx | ~180 | +180 |
| 5 | tests + docs | ~120 | +120 |
| **合计** | | **~435** | **~420** |

不含 README 现有篇幅更新。

---

## 11. 验收标准

- ✅ Power-On Seq Tab 用 `SEQ_SAMPLE` 跑通（重构前后事件表一致）
- ✅ 触摸板路径（0x2C）继续走 `finger-frame` IPC，TrajectoryView / PlaybackView 等下游零变更
- ✅ Live Sequence Tab：
  - 加载 HID Desc + Report Desc 显示 Loaded 状态
  - Start Listening 接收 16 条 raw frame 模拟输入，事件表内容与 Power-On Seq 用 `power on seq.txt` 跑出的一致
  - 表格行数限 200，停止后 events 全集仍可读
- ✅ `tsc --noEmit` 零项目源码错
- ✅ `vite build` + `electron-forge make --mac` 成功
- ✅ 4 个现有 HID Analysis subTab 行为不变
