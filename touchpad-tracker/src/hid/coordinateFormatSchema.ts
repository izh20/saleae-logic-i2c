/**
 * 坐标包格式 Schema
 *
 * 每种坐标包（手指/笔）对应一个 CoordinateFormat 定义，描述其：
 * - header 字节序列（用于自动嗅探）
 * - 整包字节数
 * - slot 数量与每个 slot 内字段布局
 * - 帧尾 metadata（scantime/fingerCount/keyState）布局
 *
 * 内置 4 种 TP 手指包格式：
 * - tp47  : 0x2F 0x00 0x04,  47B,  5×8B slot（含 L/W/P u8）
 * - tp32  : 0x20 0x00 0x04,  32B,  5×5B slot（仅 X/Y）
 * - tp2a  : 0x2A 0x00 0x04,  42B,  5×7B slot（无 L/W，pressure u16le）
 * - tp34  : 0x34 0x00 0x04,  52B,  5×9B slot（L/W u8，pressure u16le）
 *
 * 注意：BUILTIN_FORMATS 在末尾被 Object.freeze 冻结，确保：
 * - UI 无法删除/禁用任一内置格式
 * - 任意历史录制的 packetType 都能在反查时命中对应 format
 */

/** slot 内单个字段定义 */
export interface SlotField {
  name: 'fingerStatus' | 'x' | 'y' | 'length' | 'width' | 'pressure';
  /** slot 内字节偏移（相对 slot 起点） */
  offset: number;
  /** 位宽：u8 / u16le / u16be */
  bits: 8 | 16;
  /** 字节序，默认 'le'；bits=8 时忽略 */
  endian?: 'le' | 'be';
  /** 是否有符号；当前所有 TP 字段都是无符号 */
  signed?: boolean;
}

/** 帧尾 metadata 字段 */
export interface TrailerField {
  name: 'scantime' | 'fingerCount' | 'keyState' | string;
  /** 相对 packet 起点 */
  offset: number;
  bits: 8 | 16;
  endian?: 'le' | 'be';
  signed?: boolean;
}

/** 一种完整的坐标包格式描述 */
export interface CoordinateFormat {
  /** 唯一标识（不写入 FingerFrame/JSON，仅供日志/调试） */
  id: string;
  /** 显示名（预留 UI 使用） */
  name: string;
  /** 帧头字节序列，按序匹配 UDP/CSV packet 前 N 字节 */
  header: number[];
  /** 整包字节数 */
  totalLength: number;
  /** 第一个 slot 在 packet 内的字节偏移 */
  slotStartOffset: number;
  /** slot 数量（默认 5） */
  slotCount: number;
  /** slot 内字段定义；只列"实际存在"的字段 */
  slotFields: SlotField[];
  /** 帧尾字段（scantime/fingerCount/keyState 等） */
  trailer: TrailerField[];
}

/**
 * 计算 slot 实际字节数 = max(slotField.offset + slotField.bits/8)
 */
export function computeSlotSize(format: CoordinateFormat): number {
  let size = 0;
  for (const f of format.slotFields) {
    const end = f.offset + f.bits / 8;
    if (end > size) size = end;
  }
  return size;
}

/**
 * 内置 TP 手指包格式（不可变）
 */
export const BUILTIN_FORMATS: CoordinateFormat[] = [
  // ── tp47：现有 47B 手指包 ──
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

  // ── tp32：现有 32B 简化手指包 ──
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

  // ── tp2a：新增 42B 手指包（无 L/W，pressure u16le） ──
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

  // ── tp34：新增 52B 手指包（L/W u8，pressure u16le） ──
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

// 冻结内置 format 列表，确保 UI 不可变，回放永远可反查
Object.freeze(BUILTIN_FORMATS);
for (const fmt of BUILTIN_FORMATS) {
  Object.freeze(fmt.header);
  Object.freeze(fmt.slotFields);
  Object.freeze(fmt.trailer);
}
