# Touchpad Tracker

一套围绕 **触摸板 HID-over-I²C** 协议搭建的端到端工具链，覆盖三个层次：

1. **物理层** —— Saleae Logic 2 + 自研 HLA，实时把 I²C 波形解码为 JSON 并通过 UDP 推送。
2. **协议层** —— Electron 主进程解析触摸板 47/32 字节手指包、笔包与 16 通道调试数据。
3. **分析层** —— React 渲染层完成 5 个工作流：实时轨迹 / 录制回放 / 帧列表 / 调试通道 / HID 协议分析。

附带一个 **Waratah** 子工程：用 `.wara`（TOML）文本格式作为 HID Report Descriptor 的可读中间表示，提供与原始字节描述符的双向转换、Power-On 序列分析、HID 字段表解码。

---

## 目录结构

```
.
├── i2c_hla/                              # Logic 2 High-Level Analyzer 扩展
│   ├── extension.json
│   └── i2c_realtime.py                   # I²C → UDP(50000) JSON 推送器
│
├── i2c_udp_receiver.py                   # 命令行 UDP 接收器（调试用）
│
├── touchpad-tracker/                     # Electron + React 主应用
│   ├── src/
│   │   ├── main.ts                       # 主进程：UDP 监听 + 包解析 + IPC
│   │   ├── preload.ts                    # contextBridge 暴露安全 API
│   │   ├── App.tsx                       # 顶层应用 + 5 个 Tab 路由
│   │   ├── components/
│   │   │   ├── TrajectoryView.tsx        # 实时手指/笔轨迹 Canvas
│   │   │   ├── PlaybackView.tsx          # 回放轨迹 + O(1) 撤销 + 快照
│   │   │   ├── PlaybackControls.tsx      # 播放/暂停/进度条/速度
│   │   │   ├── FrameListView.tsx         # 录制/实时帧表
│   │   │   ├── DebugView.tsx             # 16 通道调试数据表
│   │   │   └── HidAnalysisView.tsx       # 4 子 Tab HID 协议分析
│   │   ├── hid/                          # 纯函数协议库（详见下文）
│   │   ├── hooks/
│   │   │   ├── useRecorder.ts            # 录制 → JSON 文件
│   │   │   └── usePlayer.ts              # 回放引擎 + 撤销/快照
│   │   ├── types/
│   │   │   ├── finger.ts                 # FingerFrame / TouchState 等
│   │   │   └── recording.ts              # 录制 JSON Schema
│   │   └── utils/
│   │       └── parseSaleaeTXT.ts         # Saleae CSV → FingerFrame
│   └── ...
│
├── Waratah/                              # C# Waratah 工具集（参考实现）
│   └── WaratahUI.Avalonia/               # 完整 HID 描述符编辑器
│
├── docs/                                 # 设计/性能/回放问题方案
├── touchpad_coor_decode.md               # 触摸板数据帧协议规范
└── README.md                             # 当前文档
```

---

## 快速开始

### 1. 安装依赖

```bash
cd touchpad-tracker
npm install
```

### 2. 启动应用

```bash
npm start
# 或使用国内镜像加速
bash scripts/build.sh
```

应用窗口打开后默认进入 **Live** 模式，等待 UDP 50000 端口上的触摸板数据。

### 3. 加载 Logic 2 HLA（实时采集）

```bash
# macOS
cp -r i2c_hla ~/Library/Application\ Support/SaleaeLogic/Extensions/
```

在 Logic 2 中：

1. 添加 **I2C** 分析器，绑定 SCL=通道 0、SDA=通道 1。
2. 在 Analyzers 面板加载扩展 **I2C Real-time Exporter**。
3. 开始采集。

应用会自动接收数据并实时绘制轨迹。

> 通道固定为 SCL=0、SDA=1（参见 [通道配置](#通道配置)）。

### 4. 仅做离线分析（不接 Saleae）

跳过 HLA 安装。直接通过 **Open File** 打开以下任一格式：

- 应用录制的 `.json`
- Saleae 导出的 `.csv` / `.txt`

文件被解析为 `FingerFrame[]` 后进入 **Playback** 模式。

---

## 五大工作流

应用顶部导航栏在以下 5 个模式间切换：

| 模式 | 数据源 | 用途 |
|------|--------|------|
| **Live** | UDP 实时流 | 实时绘制手指 / 笔轨迹 |
| **Playback** | 录制文件 / Saleae 导出 | 单帧回放 + 撤销 / 快照 |
| **Frame List** | 实时累加 / 录制 | 列出每帧 scantime、finger、stylus、pkt |
| **Debug** | 实时 / 录制 | 解析 stylus 包 bytes[15..46] 的 16 个 s16 通道 |
| **HID Analysis** | 文本粘贴 / 实时帧 | 协议层分析（5 个子 Tab，详见下文） |

### Live — 实时轨迹

[src/components/TrajectoryView.tsx](touchpad-tracker/src/components/TrajectoryView.tsx) 在 `<canvas>` 上按 fingerId 维护独立轨迹，按 stylus 维护独立轨迹，状态机驱动绘制：

- `LargeRelease` / `FingerRelease` → 清除该 fingerId 的轨迹
- `LargeTouch` / `FingerTouch` → 追加点（LargeTouch 用空心圆 + 4px 半径，FingerTouch 用实心圆 + 2px 半径）
- Stylus `Release` → 插入断点标记，避免画线跨过 release
- 帧率由 scantime 推导（单位 100μs，跨 0xFFFF 自动回绕）

顶部状态栏实时显示：Hz、Fingers、ScanTime、Key、每指坐标 (X, Y, L, W, P)、笔 (state, X, Y, P, TiltX, TiltY)。`key_state == 1` 时右上角弹出红色 **KEY DOWN** 提示。

### Playback — 回放

[src/hooks/usePlayer.ts](touchpad-tracker/src/hooks/usePlayer.ts) 是回放引擎：

- **加载**：支持 JSON（应用格式）和 Saleae CSV，自动嗅探。
- **播放速度** 10–500 Hz 可调，按 `1000/speed` ms 步进。
- **单帧撤销**：每帧维护 `FrameDiff`，记录已删除的轨迹与新追加的点；`stepBackward` 时直接 `undoStack.pop()`，**O(1) 反演**。
- **跨帧重定位**：`seek(i, isBackward)` 步长 > 1 时回退到最近一个 snapshot（每 200 帧）全量重放，避免 O(n²)。
- **快捷键**：`Space` 播放/暂停、`←/→` 逐帧。
- 通过点选 **Frame List** 中某行也能跳转到该帧。

录制格式 `RecordingFile` 见 [src/types/recording.ts](touchpad-tracker/src/types/recording.ts)。

### Frame List — 帧列表

[src/components/FrameListView.tsx](touchpad-tracker/src/components/FrameListView.tsx) 同时支持实时与回放两种模式：

- **实时模式**：`Start` / `Stop` / `Clear` 控制累加，最大 20000 帧（FIFO 丢弃），自动滚到底部。
- **回放模式**：点击行可跳转到该帧进行回放。
- 列：`#` / `Scan(100μs) + Δms` / `Fingers(id,state,x,y,l,w,p)` / `Stylus(state,x,y,p,tx,ty)` / `Pkt`（47/32）。

### Debug — 调试通道

[src/components/DebugView.tsx](touchpad-tracker/src/components/DebugView.tsx) 解析每个 frame 的 `debugChannels`（如果存在）：将 stylus 包的 `bytes[15..46]` 视作 16 个 little-endian s16。

- 格式切换：`Dec (s16)` / `Dec (u16)` / `Hex` / `Binary`
- 实时模式下保留最近 200 帧，支持 `Pause` / `Resume` / `Clear`
- 旧录制文件（无 `debugChannels` 字段）兼容，缺失列显示 `—`

### HID Analysis — 协议分析

[src/components/HidAnalysisView.tsx](touchpad-tracker/src/components/HidAnalysisView.tsx) 提供 5 个子 Tab，是整个项目最复杂的纯逻辑分析模块：

#### Tab 1 · Power-On Seq

- 支持 5 种 I2C 日志格式（Saleae CSV / `[ts] W/R addr: hex` / `W: hex hex` / `write/read to 0xNN ack data: ...` / 裸 hex）
- 预扫描 `deviceTx` 解析 HID 描述符与 Report 描述符，提取字段表
- 解码 HID-I²C 命令寄存器 opcode：`0x01 RESET` / `0x02 GET_REPORT` / `0x03 SET_REPORT` / `0x04 GET_IDLE` / `0x05 SET_IDLE` / `0x06 GET_PROTOCOL` / `0x07 SET_PROTOCOL` / `0x08 SET_POWER`（D0/D1）
- 描述符含 VID/PID/寄存器地址/最大输入输出长度；带 ✅ / ⚠️ 校验
- **Save MD** 导出完整 Markdown 分析报告

#### Tab 2 · Device Desc

- 30 字节 HID-over-I²C 设备描述符按字段解码（`wHIDDescLength` / `bcdVersion` / `wReportDescLength` / `wReportDescRegister` / `wInputRegister` / `wMaxInputLength` / ...）
- 输出寄存器映射表 + 原始字段表 + 校验结论

#### Tab 3 · Report Desc

- 解析 HID Report Descriptor 字节码（`HidDescriptorParser`）
- `analyzeReportItems` 将 Main/Global/Local items 展开为 `ReportField[]`，含 Usage 名称、bitOffset/bitSize、Logical/Physical Range
- `formatCommentedHex` 可选带注释的 hex 视图
- **Desc → .wara**：将描述符导出为 Waratah 工具链的 TOML 文本格式
- **.wara → Desc**：把编辑过的 `.wara` 文本重新生成字节描述符（用于"通过修改 .wara 来变体衍生新设备"）
- **Save MD** 导出字段表

#### Tab 4 · Report Data Parser

- 加载 Report Descriptor → 解析字段表
- 静态模式：粘贴一行行 `01 01 32 E2 ...` 的 report data，按 Report ID 分组输出字段表
- 实时模式：**Start Listening** 后订阅 `electronAPI.onFingerFrame`，每收到一帧立即按当前字段表解析、虚拟滚动显示、自动滚到底部
- 字段表使用 `react-window` 风格的窗口化渲染，5 千帧不卡顿
- 2 字节长度前缀开关（`LEN_REG`）

#### Tab 5 · Live Sequence

按 Power-On Seq 同样的逻辑实时分析 HID-over-I²C 协议流量。适合调试**任意标准 HID-I²C 设备**（vendor 测试、其他带 HID-I²C 的 I²C 设备）。**触摸板本身不按标准 HID-I²C 走**——这个 Tab 是为通用 HID-I²C 调试设计的。

- 用户手动输入：HID Device Desc (30B) + HID Report Desc + Addr + Desc Reg
- 实时模式：**Start Listening** 订阅 `i2c-raw-frame` IPC，每条 I²C TX 进入 `LiveHidAnalyzer.pushTransaction` 增量分析
- 复用 `analyzeSequence` 的 9 种 eventType：Read HID Descriptor / HID Descriptor Response / Read Report Descriptor / Report Descriptor Response / Send Command（opcode 全解码）/ Get Report Response（带字段级 payload）/ Output Report / Set Report (Data) / Input Report
- 事件表格按 Power-On Seq 风格（# / Time / Direction / Event Type / ReportID / Description）实时刷新
- **无 events 上限**——`LiveHidAnalyzer.allEvents` 持续 append；长跑可累积到数十万条（每条 ~150B，1 小时 @ 100Hz ≈ 50MB），用户通过 **Save MD / Save JSON** 把当前累积导出后 **Clear** 清空来控内存
- **Save MD** — 把 events 列表导出为 Power-On Seq 同款 Markdown 表格（复用 `generateSequenceMarkdown`）
- **Save JSON** — 导出为机器可读 JSON（含 `version` / `recordedAt` / `deviceAddress` / `hidDescRegister` / `hidDescriptor` / `eventCount` / `events[]`），便于二次分析
- **架构核心**：`LiveHidAnalyzer` 类（[HidI2cSequenceAnalyzer.ts](touchpad-tracker/src/hid/HidI2cSequenceAnalyzer.ts)）持有 hidDescriptor / reportFields / pendingRead / order / events 状态，每次 push 一条 I²C 事务返回 0+ 新事件。`processSingleTransaction` 是 batch 与 live 共享的公共函数——Live Sequence 与 Power-On Seq **逻辑 100% 等价**（parity 验证：840 events 全等）。
- 区别于 Power-On Seq：用户**手动**输入两份 descriptor，不做自动探测；Get Report Response 在 live 模式下用 `pendingRead='get_report_*'` 弱配对（无法预知 host 下一个 GET_REPORT 的 Report ID），orphan response 按通用 Input Report 降级

---

## HID 协议库（`src/hid/`）

库是**纯函数**、**零依赖**的，方便单测与复用：

| 文件 | 职责 |
|------|------|
| [types.ts](touchpad-tracker/src/hid/types.ts) | `I2cTransaction` / `HidI2cDescriptor` / `HidItem` / `ReportField` / `TouchFrame` / `ParsedReportFrame` |
| [HidConstants.ts](touchpad-tracker/src/hid/HidConstants.ts) | HID 1.11 tag 枚举、Main item 标志位、Collection 类型 |
| [HidUsagePages.ts](touchpad-tracker/src/hid/HidUsagePages.ts) | Generic Desktop / Digitizers / Button / Consumer 等页面+usage 名映射 |
| [HidDescriptorParser.ts](touchpad-tracker/src/hid/HidDescriptorParser.ts) | 字节流 → `HidItem[]`，含 long item (0xFE) 与有符号数自动扩展 |
| [HidI2cDescriptorParser.ts](touchpad-tracker/src/hid/HidI2cDescriptorParser.ts) | 30 字节 HID-I²C 设备描述符解码 + 校验 |
| [ReportAnalyzer.ts](touchpad-tracker/src/hid/ReportAnalyzer.ts) | 跟踪 Global state stack（UsagePage/Logical/ReportSize/ReportId）展开 Input/Output/Feature 为 `ReportField[]` |
| [HidI2cSequenceAnalyzer.ts](touchpad-tracker/src/hid/HidI2cSequenceAnalyzer.ts) | 多格式日志解析 + opcode 解码 + 字段级命令 payload 还原 + 描述符校验 + Markdown 输出 |
| [HidReportDataParser.ts](touchpad-tracker/src/hid/HidReportDataParser.ts) | LSB-first 位提取 + 有符号扩展 + `parseSingleFrame`（带长度前缀 / Report ID 前缀） |
| [ReportBatchParser.ts](touchpad-tracker/src/hid/ReportBatchParser.ts) | 批量行解析、按 Report ID 分组、提取 `TouchFrame` 序列 |
| [HidDescriptorFormatter.ts](touchpad-tracker/src/hid/HidDescriptorFormatter.ts) | 灵活 hex 字符串解析（容忍 `0xNN,` / `data:` / `//` / `;` / `nak`） |
| [WaraGenerator.ts](touchpad-tracker/src/hid/WaraGenerator.ts) | `HidItem[]` → `.wara` TOML（含 usageTransform、maxSignedSizeRange、physicalValueRange 等高级特性） |
| [WaraToDescriptorGenerator.ts](touchpad-tracker/src/hid/WaraToDescriptorGenerator.ts) | `.wara` TOML → 字节描述符 + C 数组输出 + item 文本追踪 |

### `.wara` 格式示例

```toml
[[applicationCollection]]
usage = ['Digitizers', 'Touch Pad']

    [[applicationCollection.inputReport]]
    id = 4

        [[applicationCollection.inputReport.variableItem]]
        usage = ['Digitizers', 'Finger']
        sizeInBits = 8
        logicalValueRange = [0, 10]
        count = 5
        reportFlags = ['constant']

        [[applicationCollection.inputReport.arrayItem]]
        usageRange = ['Digitizers', 'Tip Switch', 'In Range']
        count = 5
```

`.wara` 是 Waratah C# 项目的内部表示；TS 端实现与 C# 端完全等价，可作为快速迭代描述符的中间产物。

---

## 触摸板协议

触摸板走 **HID over I²C**（`report_id = 0x04`）私有数据格式，三种包头：

| 帧头 | 长度 | 含义 |
|------|------|------|
| `[0x2F, 0x00, 0x04]` | **47 字节** | 完整手指包（含 Length/Width/Pressure + 调试通道 0..15） |
| `[0x20, 0x00, 0x04]` | **32 字节** | 简化手指包（仅坐标 + scantime/fingerCount/keyState） |
| `[0x2F, 0x00, 0x08]` | **47 字节** | 笔包（bytes 0..14 stylus + bytes 15..46 调试通道） |

### 47 字节手指包

```
Byte  0..2   : 0x2F, 0x00, 0x04  (帧头)
Byte  3..42  : 5 个 slot × 8 字节，每个 slot：
                 +0 fingerStatus : [7:4]=fingerId, [3:0]=state
                 +1,2 X[15:0]   : X 坐标 (小端)
                 +3,4 Y[15:0]   : Y 坐标 (小端)
                 +5 length
                 +6 width
                 +7 pressure
Byte  43..44 : scantime (u16 LE, 100μs 单位)
Byte  45     : fingerCount
Byte  46     : keyState
```

### 32 字节手指包

5 个 slot × 5 字节（无 length/width/pressure），scantime/fingerCount/keyState 偏移到 28/30/31。

### 笔包（47 字节）

```
Byte  0..2   : 0x2F, 0x00, 0x08  (帧头)
Byte  3      : state  0x20=Hover, 0x21=Tip, 0x00=Release
Byte  4      : stylusId  固定 0x80
Byte  5..6   : X[15:0] LE
Byte  7..8   : Y[15:0] LE
Byte  9..10  : Tip Pressure[15:0] LE
Byte  11..12 : X Tilt[15:0] LE (有符号)
Byte  13..14 : Y Tilt[15:0] LE (有符号)
Byte  15..46 : 16 个 s16 LE 调试通道
```

### 状态值

| state | 含义 | 处理 |
|-------|------|------|
| `3` | Finger Touch | 追加点（细线 + 实心 2px 圆） |
| `2` | Large Touch | 追加点（细线 + 空心 4px 圆） |
| `1` | Finger Release | 清除该 fingerId 轨迹 |
| `0` | Large Release | 清除该 fingerId 轨迹 |

---

## 工作原理

```
┌────────────────────────────────────────────────────┐
│ Logic 2 + Saleae Logic Pro 16                      │
│   I²C analyzer (SCL=0, SDA=1)                      │
└────────────────┬───────────────────────────────────┘
                 │ AnalyzerFrame (start/stop/addr/data/ack)
                 ▼
┌────────────────────────────────────────────────────┐
│ i2c_hla  (Python HLA)                              │
│   - 按 transaction 累积 byte                       │
│   - 序列化为 JSON {type, data}                      │
│   - UDP 50000 单包发送                              │
└────────────────┬───────────────────────────────────┘
                 │ UDP datagram
                 ▼
┌────────────────────────────────────────────────────┐
│ Electron main.ts  (Node)                           │
│   - dgram.createSocket('udp4').bind(50000)         │
│   - parseFingerFrame / parseStylusFrame            │
│   - mainWindow.webContents.send('finger-frame', …) │
│   - electron-store 持久化 TouchpadConfig            │
└────────────────┬───────────────────────────────────┘
                 │ contextBridge.electronAPI.onFingerFrame
                 ▼
┌────────────────────────────────────────────────────┐
│ React Renderer (App.tsx)                           │
│   Live       → TrajectoryView (实时 Canvas)        │
│   Playback   → PlaybackView (回放 + 撤销/快照)     │
│   Frame List → FrameListView (表格)                │
│   Debug      → DebugView (16 通道表)               │
│   HID Anlys  → HidAnalysisView (4 子 Tab)          │
└────────────────────────────────────────────────────┘
```

数据流单向、零外部依赖：除 Saleae 硬件 + Logic 2 外，整个软件栈可纯软件运行（直接加载 JSON/CSV 录制文件回放）。

---

## 快捷键

| 按键 | 功能 |
|------|------|
| `H` | 显示/隐藏帮助 |
| `R` | 开始/停止录制 |
| `C` | 清除所有轨迹（手指 + 笔） |
| `K` | 仅清除笔轨迹（Live 模式） |
| `Space` | 播放/暂停（Playback 模式） |
| `←` / `→` | 逐帧后退/前进（Playback 模式） |

---

## 文件格式

### 应用录制格式（`.json`）

```json
{
  "version": 1,
  "recordedAt": "2026-03-22T10:30:00.000Z",
  "config": { "maxX": 4000, "maxY": 3000, "stylusParseMode": "tp" },
  "frames": [
    {
      "timestamp": 1234567890,
      "packetType": 47,
      "slots": [
        { "fingerId": 0, "state": 3, "x": 100, "y": 200, "length": 8, "width": 8, "pressure": 80 }
      ],
      "fingerCount": 1,
      "scantime": 1000,
      "keyState": 0,
      "stylus": {
        "stylusId": 128,
        "state": 33,
        "x": 1500,
        "y": 1000,
        "tipPressure": 150,
        "xTilt": 10,
        "yTilt": -5
      },
      "debugChannels": [-12, 348, 0, 1024, ...]
    }
  ]
}
```

### Saleae CSV

```
Time [s],Packet ID,Address,Data,Read/Write,ACK/NAK
1.555302937500000,0,0x2C,0x2F,Read,ACK
1.555347500000000,0,0x2C,0x00,Read,ACK
1.555367500000000,0,0x2C,0x04,Read,ACK
...
```

每行一个字节，解析器按目标 I²C 地址过滤、扫描帧头、拼装为完整帧。

支持的 I²C 地址默认 `[0x2C, 0x15, 0x5D]`，可在界面右上角 **I2C Addr** 实时修改（调用 `parseSaleaeCSV.setAddresses(...)`）。

---

## 关键技术点

### 性能

- **绘制节流**：每帧只更新 stats ref，渲染走 `requestAnimationFrame` 限速 60 FPS
- **大型帧表虚拟滚动**：`HidAnalysisView` 中 Live 模式使用 `react-window` 风格的手写虚拟列表（`ROW_H=22, BUFFER=10`），5 万帧不卡
- **增量 flush**：`Report Data Parser` 实时模式下使用 200ms `setTimeout` 节流，原始文本与字段表分两路 buffer
- **快照回放**：每 200 帧存一份 trajectory 深度拷贝，跨帧 seek 用二分查找最近 snapshot

### 撤销/快照

[PlaybackView.tsx](touchpad-tracker/src/components/PlaybackView.tsx) 维护：

- `undoStackRef`: 每帧 `FrameDiff`（`deletedFingerTrajectories` / `appendedFingerIds` / `stylusPointsBefore` / `deletedStylusTrajectory`）
- `snapshotsRef`: 每 200 帧 `{index, trajectories, stylusTrajectory, undoStack}` 完整拷贝

`stepBackward` → 直接 `pop()` 撤销栈，O(1)；
`seek(i, true)`, `i - currentIndex > 1` → 从最近 snapshot 全量重放到 i。

### 协议鲁棒性

- 帧头扫描容忍任意长度的 0x2F/0x20 prefix，找到就锁定后续 47/32 字节
- scantime 跨 0xFFFF 自动 `+65536` 回绕处理
- `extractBits` 按 LSB-first 提取（符合 HID 规范），`signExtend` 处理有符号字段
- 多格式 I²C 日志输入，自动嗅探 Saleae CSV / 时间戳方括号 / 冒号 / 裸 hex

---

## 打包发布

使用 electron-forge，支持 macOS / Windows / Linux：

```bash
cd touchpad-tracker

# 国内镜像加速 + 跳过 SSL 校验
bash scripts/build.sh

# 走代理
bash scripts/build.sh --proxy 127.0.0.1:7897

# 指定平台
bash scripts/build.sh --mac
bash scripts/build.sh --win
bash scripts/build.sh --linux
```

产物路径：

- macOS: `out/make/zip/darwin/`
- Windows: `out/make/squirrel.windows/xx/Touchpad Tracker.exe`
- Linux: `out/make/zip/linux/`

打包后无需 Node.js / npm，可直接分发独立可执行文件。

---

## 通道配置

| 信号 | 通道 |
|------|------|
| SCL  | 0    |
| SDA  | 1    |

> 通道号硬编码于 i2c_hla 与 main.ts。如需修改需要同步两处（I²C analyzer 的 channel 绑定 + main.ts 解析的目标地址过滤）。

---

## 相关文档

- [touchpad_coor_decode.md](touchpad_coor_decode.md) — 触摸板坐标帧协议详细规范
- [docs/DESIGN.md](docs/DESIGN.md) — 设计系统参考（Apple HIG 风格）
- [docs/performance优化方案.md](docs/performance优化方案.md) — 性能优化笔记
- [docs/回放后退卡顿问题修复方案.md](docs/回放后退卡顿问题修复方案.md) — 撤销/快照机制设计
- [docs/帧数据列表界面方案.md](docs/帧数据列表界面方案.md) — Frame List 视图方案
- [Waratah/](Waratah/) — C# 参考实现（WaratahUI.Avalonia 是完整 GUI）

---

## 故障排除

### HLA 扩展加载失败

- 确认 `i2c_hla` 已复制到 `~/Library/Application Support/SaleaeLogic/Extensions/`
- 重启 Logic 2

### 应用无法接收数据

- 检查 Logic 2 中 HLA 是否启用
- 确认防火墙允许 UDP 50000
- 确认应用已启动并显示 "UDP Connected"

### CSV 解析返回 0 帧

- 确认 I²C 地址列与界面右上角的 **I2C Addr** 一致
- 确认 Logic 2 导出时选择 I2C 协议分析（不是原始采样数据）

### 播放时轨迹不正确

- 调整播放速度（10–500 Hz）
- 调整触摸板分辨率 Max X/Y（默认 4000×3000）

### HID Analysis 的 .wara 转换失败

- 检查 `.wara` 顶层 `[[applicationCollection]]` 是否存在
- 检查每个 `usage = [...]` 是 2 元素（page + name）
- 检查 TOML 缩进/括号匹配
