# Debug View 设计文档

**日期**: 2026-06-11
**状态**: 待用户审阅
**适用范围**: `touchpad-tracker/src/`

## 背景与目标

当前触摸板工具支持笔（Stylus）轨迹显示，但笔数据包的 0-14 字节（stylus 字段）之外还有 15-46 字节（共 32 字节）保留了原始调试数据。这些数据未在 UI 中暴露，调试时需手动分析原始字节。

**目标**：在工具中新增独立 Debug 视图，将笔包后 32 字节解析为 16 通道 s16（小端）数据并以可滚动、可切换格式的方式显示出来。

## 范围

- ✅ 新增独立的 Debug Tab 视图
- ✅ 解析笔包 bytes[15..46] 为 16 个 s16 小端值
- ✅ 支持十进制/十六进制/有符号/无符号 等多种数值格式
- ✅ 保留最近 200 帧数据
- ✅ Live 模式实时更新
- ✅ Playback 模式支持查看录制文件
- ✅ 从 Debug 视图可"返回"到上一个视图（live / playback）
- ✅ 录制文件向后兼容（旧 JSON 文件无 debugChannels 字段）
- ❌ 不做：波形图/趋势图/多通道统计（YAGNI）
- ❌ 不做：通道重命名/标签自定义（YAGNI）
- ❌ 不做：debug 数据导出（YAGNI）

## 数据流

```
I2C 47字节笔包
  ↓
HLA (i2c_hla/i2c_realtime.py) — 透传，不解析
  ↓ UDP/JSON
Electron main.ts::parseStylusFrame — 增加 debug 通道解析
  ↓ IPC 'finger-frame'
App.tsx — 路由到 DebugView
  ↓
DebugView.tsx — 显示
```

回放路径：

```
Saleae CSV/TXT 文件
  ↓
parseSaleaeTXT.ts::parseSaleaeCSVInternal
  frameLen 由 15 → 47（关键：必须读到 47 字节才能包含 debug 区域）
  ↓
parseStylusFrameFromData — 同样增加 debug 解析
  ↓
FingerFrame.debugChannels
  ↓
DebugView.tsx
```

## 数据模型

### 类型变更

`types/finger.ts` — 在 `FingerFrame` 接口中新增可选字段：

```typescript
export interface FingerFrame {
  // ... 已有字段
  stylus?: StylusSlot;       // 0-14 字节
  debugChannels?: number[];  // 新增：15-46 字节，16 个 s16 小端值
}
```

字段类型为 `number[]` 而非 `Int16Array`：保持与项目其他 number 数组（如 `slots`）一致；16 个值的复制开销可忽略。

### 解析函数

在 `main.ts` 和 `parseSaleaeTXT.ts` 中复用同一份逻辑（不抽公共模块以避免跨文件耦合，按既有约定各文件内联实现）：

```typescript
/**
 * Parse bytes[15..46] as 16 s16 little-endian values.
 * Returns 16 values, filling with 0 if data is shorter than 47.
 */
function parseDebugChannels(data: string[]): number[] {
  const channels: number[] = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offset = 15 + i * 2;
    if (offset + 1 >= data.length) break;
    const low = parseHexOrDec(data[offset]);
    const high = parseHexOrDec(data[offset + 1]);
    channels[i] = ((low | (high << 8)) << 16) >> 16;
  }
  return channels;
}
```

**符号位保留**：`<< 16 >> 16` 双移位是项目内已用的 s16 转换方式（见 `main.ts:132-133` 的 xTilt/yTilt 解析）。

## UI 设计

### 导航

`App.tsx` 顶部导航新增 `Debug` 按钮，与现有 `Live` / `Playback` / `Frame List` 按钮并列：

```tsx
{viewMode !== 'debug' && (
  <button onClick={() => setViewMode('debug')}>Debug</button>
)}
{viewMode === 'debug' && (
  <button onClick={() => setViewMode(prevViewModeRef.current)}>← Back</button>
)}
```

`viewMode` 类型扩展：`'live' | 'playback' | 'frameList' | 'debug'`

`prevViewModeRef` 复用 `App.tsx` 中已存在的引用（用于 `frameList` 模式的回退）：

```typescript
useEffect(() => {
  if (viewMode !== 'frameList' && viewMode !== 'debug') {
    prevViewModeRef.current = viewMode;
  }
}, [viewMode]);
```

### DebugView 组件

`components/DebugView.tsx`（新文件，约 200 行），结构与 `FrameListView.tsx` 对齐：

```
┌────────────────────────────────────────────────────────────┐
│ Format: [Dec (s16) ▾] [Pause] [Clear]      200 frames     │ ← 工具栏
├────────────────────────────────────────────────────────────┤
│  #   │ Scan(100μs)/Δ │ Stylus state │ D0 │ D1 │ ... │ D15 │ ← 表头
├────────────────────────────────────────────────────────────┤
│ 001  │ 12345 (+0.0)  │ release      │  - │  - │ ... │  - │ ← finger 帧
│ 002  │ 12367 (+2.2)  │ hover        │-123│  45 │ ... │-512│ ← stylus 帧
│ 003  │ 12389 (+2.2)  │ tip          │-118│  48 │ ... │-508│
│ ...                                                        │
└────────────────────────────────────────────────────────────┘
```

**关键 UI 细节**：

- **行号**：5 位数右对齐补零（与 `FrameListView` 一致）
- **行高**：28px（与 `FrameListView` 一致）
- **背景色**：奇偶行交替 `#1e1e1e` / `#252526`（与 `FrameListView` 一致）
- **非 stylus 帧的 D0-D15 列**：显示 `—`（dash，破折号），不显示数字
- **stylus 帧的 D0-D15 列**：根据 Format 选项格式化

**Format 选项**：

| 选项 | 显示示例 | 适用场景 |
|------|----------|----------|
| `Dec (s16)`（默认） | `-123` | 日常查看有符号值 |
| `Dec (u16)` | `65413` | 原始无符号 0..65535 |
| `Hex` | `0xFF85` | 与字节对照、定位异常 |
| `Binary` | `11111111 10000101` | 调试位级信号 |

格式切换是 UI 局部状态，**不影响**已存帧的 `number[]` 原始数据。

### 状态管理

**Live 模式**：
- DebugView 内部维护 `framesRef: FingerFrame[]`，最长 200 帧
- 接收来自 `App.tsx` 传入的 live frames 列表
- 新帧到达时 `push`，超长时 `shift` 最旧
- 通过 `liveFrameCount` 触发强制重渲染（与 FrameListView 同样的模式）

**Playback 模式**：
- 通过 `player.getFrames()` 读取所有帧
- 取 `slice(-200)` 显示最近 200 帧
- 选中行可触发 `player.seek(index, isBackward)`（与 FrameListView 一致）

**Pause/Resume**：复用 FrameListView 的 `isFrameListPausedRef` 机制，DebugView 内部维护自己的 pause ref，不影响 frameList。

## 错误处理与边界

| 场景 | 行为 |
|------|------|
| `data.length < 15` | 整个 stylus 帧无效，原有 `parseStylusFrame` 返回 `null` |
| `15 ≤ data.length < 47` | stylus 字段有效；debug 通道不足 16 个的填 0；UI 仍按 16 列显示，缺失的列显示 `0` |
| `data.length ≥ 47` | 完整解析 |
| Saleae CSV 中 stylus 帧长度 | 由 15 → 47（`frameLen = 47`） |
| 旧 JSON 录制文件 | 无 `debugChannels` 字段 → UI 全部 `—` |

**性能**：

- 每帧 16 个 s16，200 帧总计 3200 个 number，渲染开销可忽略
- 不使用虚拟滚动：200 行 × 17 列 ≈ 3400 单元格，浏览器可承受
- `forceUpdate` 频率受 IPC 频率限制（笔包约 100-500 Hz），不需额外节流

## 录制兼容性

- 新增的 `debugChannels` 字段为**可选**（`?`）
- 旧版本录制的 JSON 文件没有此字段，DebugView 显示全 `—`
- 新版本录制的 JSON 文件包含此字段，DebugView 正常显示
- 不做版本号迁移（`RecordingFile.version` 仍为 1，向后兼容无需 bump）

## 验证（先验证后上传）

按用户要求，修改后**不直接 commit**，先做以下本地验证：

1. **类型检查**：`cd touchpad-tracker && npx tsc --noEmit` — 无类型错误
2. **构建**：`npm run build` — 构建成功
3. **单元测试**（如适用）：手写一个 47 字节 stylus 测试帧，验证 `parseDebugChannels` 输出
4. **真实数据回放测试**：用 `debug-data/` 目录下的样例 CSV 加载，切到 Debug Tab 验证数值正确
5. **真实实时测试**：连接硬件后，HLA 推 47 字节笔包数据，确认 DebugView 实时更新

验证通过后用户确认再 commit + push。

## 受影响文件

| 文件 | 类型 | 改动概要 |
|------|------|----------|
| `touchpad-tracker/src/types/finger.ts` | 改动 | `FingerFrame` 加 `debugChannels?: number[]` |
| `touchpad-tracker/src/main.ts` | 改动 | `parseStylusFrame` 增加 `debugChannels` 解析 |
| `touchpad-tracker/src/utils/parseSaleaeTXT.ts` | 改动 | `parseStylusFrameFromData` + `parseSaleaeCSVInternal` (frameLen 15→47) |
| `touchpad-tracker/src/App.tsx` | 改动 | viewMode 加 `'debug'`；新增 Debug 按钮与回退；渲染 DebugView |
| `touchpad-tracker/src/components/DebugView.tsx` | 新增 | 完整组件，约 200 行 |
| `README.md` | 改动 | 文档补充 Debug View 说明 |

## 不在范围

- 通道标签/别名自定义（保持 D0..D15 默认命名）
- 波形图/趋势图/统计
- 阈值告警/条件高亮
- 录制文件 debug 字段的导入兼容处理（仅 UI 兼容即可）
- 单独窗口/浮动窗（嵌入主界面 Tab 即可）
