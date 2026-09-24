# Coor Cfg · 方案 v2（先增两路 TP 手指包）

> 范围调整：相比方案 A，本版本**只新增两路 TP 手指包** `[0x2A, 0x00, 0x04]` 与 `[0x34, 0x00, 0x04]`，
> 暂不建设"Coor Cfg"编辑器 UI。Format 列表作为代码内置常量，**完全自动嗅探**（按 header 字节匹配），无需用户介入。
> 下一步再做完整 schema 编辑器。

---

## 1. 协议推导

### 1.1 单 slot 结构对比

| slot 字段 | tp47（现有） | tp32（现有） | **tp2a（新增）** | **tp34（新增）** |
|------|:---:|:---:|:---:|:---:|
| fingerStatus (u8) | +0 | +0 | +0 | +0 |
| X (u16le) | +1..2 | +1..2 | +1..2 | +1..2 |
| Y (u16le) | +3..4 | +3..4 | +3..4 | +3..4 |
| length (u8) | +5 | — | — | +5 |
| width (u8) | +6 | — | — | +6 |
| pressure | +7 (u8) | — | +5..6 (**u16le**) | +7..8 (**u16le**) |
| **slot size** | **8B** | **5B** | **7B** | **9B** |

### 1.2 包长度推导

固定项：3B header + 5 slots + 4B trailer（scantime_lo/hi + fingerCount + keyState）

| 格式 | header | slots | trailer | **total** |
|------|:---:|:---:|:---:|:---:|
| tp47 | 3 | 5×8=40 | 4 | **47** |
| tp32 | 3 | 5×5=25 | 4 | **32** |
| **tp2a** | 3 | 5×7=35 | 4 | **42** |
| **tp34** | 3 | 5×9=45 | 4 | **52** |

### 1.3 Trailer 字节偏移

trailer 起点 = `header.size + slotCount × slotSize`

| 格式 | trailer 起点 | scantime | fingerCount | keyState |
|------|:---:|:---:|:---:|:---:|
| tp47 | 43 | 43..44 | 45 | 46 |
| tp32 | 28 | 28..29 | 30 | 31 |
| **tp2a** | 38 | 38..39 | 40 | 41 |
| **tp34** | 48 | 48..49 | 50 | 51 |

scantime = u16le / fingerCount = u8 / keyState = u8（沿用现有约定）。

### 1.4 不涉及的字段

- **debugChannels**：47B 笔包专属，**两路新增 TP 手指包均不含调试通道**，`debugChannels` 留空。
- **stylus**：[0x2F, 0x00, 0x08] 笔包**不在本次范围**，parser 仍走原 `parseStylusFrame` 逻辑。

---

## 2. Schema 设计

### 2.1 核心类型（`src/hid/coordinateFormatSchema.ts`）

```ts
/** slot 内单个字段 */
export interface SlotField {
  name: 'fingerStatus' | 'x' | 'y' | 'length' | 'width' | 'pressure';
  offset: number;        // slot 内字节偏移（相对 slot 起点）
  bits: 8 | 16;          // 位宽
  endian?: 'le' | 'be';  // 默认 'le'；u8 时忽略
  signed?: boolean;      // 默认 false
}

/** 帧尾字段（scantime/fingerCount/keyState 等） */
export interface TrailerField {
  name: 'scantime' | 'fingerCount' | 'keyState' | string;
  offset: number;        // 相对 packet 起点
  bits: 8 | 16;
  endian?: 'le' | 'be';
  signed?: boolean;
}

/** 一种完整的坐标包格式 */
export interface CoordinateFormat {
  id: string;            // 'tp47' / 'tp32' / 'tp2a' / 'tp34'
  name: string;          // 显示名
  header: number[];      // [0x2A, 0x00, 0x04]
  totalLength: number;   // 整包字节数
  slotStartOffset: number; // 默认 3
  slotCount: number;     // 默认 5
  slotFields: SlotField[]; // 仅列"实际存在"的字段
  trailer: TrailerField[];
}
```

**关键推导**：
- `slotSize = max(slotField.offset + slotField.bits/8)`
- 解析器按字段表逐个 `extractBits` 即可，**不依赖 hard-coded slotSize**
- 字段不存在 = slotFields 不含该项，解析时不写入，FingerSlot 对应字段保持 `undefined`

### 2.2 内置 Preset

```ts
export const BUILTIN_FORMATS: CoordinateFormat[] = [
  // ── 现有 47B 手指包 ──
  {
    id: 'tp47',
    name: 'TP v1 47B (length+width+pressure u8)',
    header: [0x2F, 0x00, 0x04],
    totalLength: 47,
    slotStartOffset: 3,
    slotCount: 5,
    slotFields: [
      { name: 'fingerStatus', offset: 0, bits: 8 },
      { name: 'x', offset: 1, bits: 16, endian: 'le' },
      { name: 'y', offset: 3, bits: 16, endian: 'le' },
      { name: 'length', offset: 5, bits: 8 },
      { name: 'width', offset: 6, bits: 8 },
      { name: 'pressure', offset: 7, bits: 8 },
    ],
    trailer: [
      { name: 'scantime', offset: 43, bits: 16, endian: 'le' },
      { name: 'fingerCount', offset: 45, bits: 8 },
      { name: 'keyState', offset: 46, bits: 8 },
    ],
  },

  // ── 现有 32B 手指包 ──
  {
    id: 'tp32',
    name: 'TP v1 32B (X/Y only)',
    header: [0x20, 0x00, 0x04],
    totalLength: 32,
    slotStartOffset: 3,
    slotCount: 5,
    slotFields: [
      { name: 'fingerStatus', offset: 0, bits: 8 },
      { name: 'x', offset: 1, bits: 16, endian: 'le' },
      { name: 'y', offset: 3, bits: 16, endian: 'le' },
    ],
    trailer: [
      { name: 'scantime', offset: 28, bits: 16, endian: 'le' },
      { name: 'fingerCount', offset: 30, bits: 8 },
      { name: 'keyState', offset: 31, bits: 8 },
    ],
  },

  // ── 新增 tp2a：5×7 slot，无 length/width，pressure 为 u16le ──
  {
    id: 'tp2a',
    name: 'TP v1 42B (no L/W, pressure u16le)',
    header: [0x2A, 0x00, 0x04],
    totalLength: 42,
    slotStartOffset: 3,
    slotCount: 5,
    slotFields: [
      { name: 'fingerStatus', offset: 0, bits: 8 },
      { name: 'x', offset: 1, bits: 16, endian: 'le' },
      { name: 'y', offset: 3, bits: 16, endian: 'le' },
      // length / width 故意省略 = 不存在
      { name: 'pressure', offset: 5, bits: 16, endian: 'le' },
    ],
    trailer: [
      { name: 'scantime', offset: 38, bits: 16, endian: 'le' },
      { name: 'fingerCount', offset: 40, bits: 8 },
      { name: 'keyState', offset: 41, bits: 8 },
    ],
  },

  // ── 新增 tp34：5×9 slot，length/width u8，pressure u16le ──
  {
    id: 'tp34',
    name: 'TP v1 52B (L/W u8, pressure u16le)',
    header: [0x34, 0x00, 0x04],
    totalLength: 52,
    slotStartOffset: 3,
    slotCount: 5,
    slotFields: [
      { name: 'fingerStatus', offset: 0, bits: 8 },
      { name: 'x', offset: 1, bits: 16, endian: 'le' },
      { name: 'y', offset: 3, bits: 16, endian: 'le' },
      { name: 'length', offset: 5, bits: 8 },
      { name: 'width', offset: 6, bits: 8 },
      { name: 'pressure', offset: 7, bits: 16, endian: 'le' },
    ],
    trailer: [
      { name: 'scantime', offset: 48, bits: 16, endian: 'le' },
      { name: 'fingerCount', offset: 50, bits: 8 },
      { name: 'keyState', offset: 51, bits: 8 },
    ],
  },
];

/** 编译期冻结：UI 不可删除/禁用，确保任意历史录制都能找到对应 format */
Object.freeze(BUILTIN_FORMATS);
```

---

## 3. 解析器 API（`src/hid/coordinateParser.ts`）

```ts
import { BUILTIN_FORMATS, CoordinateFormat, SlotField, TrailerField } from './coordinateFormatSchema';
import { FingerFrame, FingerSlot } from '../types/finger';

/** 按 header 字节匹配 format，未命中返回 null */
export function matchFormat(header: number[], formats = BUILTIN_FORMATS): CoordinateFormat | null;

/** 提取 packet 对应字段值（u8 直接 byte，u16 小端组合） */
function extractField(packet: number[], field: SlotField | TrailerField): number;

/** 通用手指包解析：返回 FingerFrame | null */
export function parseFingerFrameByFormat(
  packet: number[],
  timestamp: number,
  format: CoordinateFormat,
): FingerFrame | null;
```

**自动嗅探流程**：

```ts
// 伪代码——所有调用方都走这一段
function tryParse(packet: number[], timestamp: number): FingerFrame | null {
  if (packet.length < 3) return null;

  // 1. 先尝试 stylus 专用头 [0x2F, 0x00, 0x08]
  if (packet[0] === 0x2F && packet[1] === 0x00 && packet[2] === 0x08) {
    return parseStylusFrame(packet, timestamp);  // 沿用原函数
  }

  // 2. 自动遍历所有内置 format，按 header 匹配
  const fmt = matchFormat(packet.slice(0, 3));
  if (!fmt) return null;

  // 3. 按匹配到的 format 解析
  return parseFingerFrameByFormat(packet, timestamp, fmt);
}
```

实现要点：
- `extractBits(packet, byteOffset, bits, signed)` 复用 [HidReportDataParser.ts](touchpad-tracker/src/hid/HidReportDataParser.ts) 已有同款函数（LSB-first + 有符号扩展），可直接抽公共化或本地复制 6 行。
- `fingerId = (fingerStatus >> 4) & 0x0F`、`state = fingerStatus & 0x0F`——保留既有约定，写在 `parseFingerFrameByFormat` 内。
- 若 `packet.length < format.totalLength` → 返回 null。
- `FingerSlot.length/width/pressure` 是可选字段；slotFields 不含该项就不写入，保持 `undefined`。

---

## 4. 接入点改造

### 4.1 `src/types/finger.ts`

```ts
export interface FingerFrame {
  timestamp: number;
  packetType: number;          // ← 由 '47 | 32' 改为 number（兼容 42/52 等）
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
  stylus?: StylusSlot;
  debugChannels?: number[];
  rawBytes?: number[];
}
```

**为什么 `packetType` 必须改为 `number`**：

字面量联合 `'47' | '32'` 是编译期枚举——每次新增格式都要改这个联合，所有 `if (frame.packetType === 47)` 都要同步。改为 `number` + 配合 `formatId` 标识语义：

| 字段 | 类型 | 用途 | 使用方 |
|------|------|------|--------|
| `packetType` | `number`（47/32/42/52） | 数值，用于 UI 表格"Pkt"列、FrameList 分组 | 渲染层 |
| `formatId` | **不写**到 FingerFrame / JSON | 运行时只在 parser 内临时使用，不持久化 | 主进程解析器 |

回放时直接 `formats.find(f => f.totalLength === frame.packetType && ...)` 反查 format。

### 4.2 `src/main.ts`

```ts
// 旧: parseFingerFrame(dataArray, timestamp) — 内置两个 if 分支
// 新:
import { matchFormat, parseFingerFrameByFormat } from './hid/coordinateParser';

function parseFingerFrame(data: string[], timestamp: number): FingerFrame | null {
  const bytes = data.map(parseHexOrDec);
  if (bytes.length < 3) return null;

  // 自动嗅探：遍历 BUILTIN_FORMATS 找匹配 header 的 format
  const fmt = matchFormat(bytes.slice(0, 3));
  if (!fmt) return null;

  return parseFingerFrameByFormat(bytes, timestamp, fmt);
}

// parseStylusFrame 保持不变（本次不动 stylus）
```

**净收益**：去掉 60+ 行手写解析逻辑，移除 6 处 hard-coded 常量。

### 4.3 `src/utils/parseSaleaeTXT.ts`

```ts
// 同样的替换：parseFingerFrameFromData → parseFingerFrameByFormat
// CSV 扫描循环里要把 packetLen 改成 format.totalLength：

while (i < allData.length - 2) {
  const header = [parseHexOrDec(allData[i]), parseHexOrDec(allData[i+1]), parseHexOrDec(allData[i+2])];

  // 先尝试 stylus 头
  if (header[0] === 0x2F && header[1] === 0x00 && header[2] === 0x08) {
    // 沿用原 stylus 解析逻辑
    // ...
    continue;
  }

  // 自动匹配手指包 format
  const fmt = matchFormat(header);
  if (fmt) {
    const endIdx = i + fmt.totalLength;
    if (endIdx <= allData.length) {
      const bytes = allData.slice(i, endIdx).map(parseHexOrDec);
      const frame = parseFingerFrameByFormat(bytes, timestamp, fmt);
      if (frame) { frames.push(frame); }
      i = endIdx;
      continue;
    }
  }
  i++;
}
```

### 4.4 顶部工具栏

**本次不改**——自动嗅探无需用户介入，**不新增 Format 下拉**。

### 4.5 录制 JSON 兼容

- **录制 JSON schema 不变**：tp2a 录制出来的帧就是 `packetType: 42`，slot 数组里 `length/width` 字段不出现（undefined → JSON 省略），`pressure` 是 u16 数值。
- **回放兜底**：通过 `packetType` 反查 format（`BUILTIN_FORMATS.find(f => f.totalLength === frame.packetType)`），BUILTIN_FORMATS 是冻结常量，回放永远能找到对应 format。
- **混合录制**：JSON 里前后帧的 `packetType` 不同（部分 tp47 + 部分 tp2a）也能正确反查各自动 format。

---

## 5. 校验与测试

| 场景 | 期望 |
|------|------|
| UDP 收到 `[0x2A, 0x00, 0x04, ...42B...]` | `packetType=42`，`slots[i].pressure` 是 u16 数值，无 length/width |
| UDP 收到 `[0x34, 0x00, 0x04, ...52B...]` | `packetType=52`，`slots[i].length/width` 是 u8，`pressure` 是 u16 |
| UDP 收到 `[0x2F, 0x00, 0x04, ...47B...]` | 与现状一致（tp47），`packetType=47` |
| UDP 收到 `[0x20, 0x00, 0x04, ...32B...]` | 与现状一致（tp32），`packetType=32` |
| 同一 UDP 流交替 tp47 和 tp2a | 每帧独立按 header 嗅探，互不干扰 |
| 录制文件回放（tp47 旧 json，无 formatId） | `packetType=47` → 反查 tp47 → 正常渲染 |
| 录制文件回放（tp2a 新 json） | `packetType=42` → 反查 tp2a → 正常渲染 |
| Header 不匹配的 packet | 返回 null（静默丢弃，与现状一致） |

---

## 6. 文件改动清单

```
新增：
  src/hid/coordinateFormatSchema.ts     ~120 行（类型 + BUILTIN_FORMATS + Object.freeze）
  src/hid/coordinateParser.ts           ~80 行（matchFormat + parseFingerFrameByFormat + extractField）
  docs/coor_cfg_方案_v2_新增tp2a_tp34.md  (本文档)

修改：
  src/types/finger.ts                   packetType: number（联合 → number）
  src/main.ts                           替换 parseFingerFrame 内 60+ 行硬编码
  src/utils/parseSaleaeTXT.ts           同上 + CSV 扫描循环按 format.totalLength 切片
```

---

## 7. 不在本次范围

- ❌ Coor Cfg 编辑器 UI（顶部下拉 / 独立 Tab 都不做）
- ❌ Export/Import profile JSON
- ❌ Live Preview（粘贴 hex 解析）
- ❌ stylus 格式的可配置化（仍走原 parseStylusFrame）
- ❌ 自定义 vendor profile 上传
- ❌ UI 上对 format 的任何交互（启用/禁用/选择）

---

## 8. 关键设计决策总结

| 决策 | 选择 | 理由 |
|------|------|------|
| 用户介入 | **完全无** | header 字节已唯一标识 format，自动嗅探 |
| UI 入口 | **不新增** | 无需下拉、无需配置项 |
| Format 列表 | **代码常量 + Object.freeze** | UI 不可改，确保任意历史录制都能反查 |
| packetType 字段 | 扩为 `number` | 避免联合类型频繁修改 |
| 录制 JSON | **不变** | packetType 自描述足够，slot 字段按需序列化 |
| 回放 format 反查 | `packetType` → `BUILTIN_FORMATS` | 不依赖 formatId 字符串约定 |
