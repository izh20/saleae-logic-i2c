/**
 * 坐标包解析器（schema-driven）
 *
 * 按 header 字节自动匹配内置 CoordinateFormat，再按 format 定义解析整个 packet。
 * 替换原 main.ts / parseSaleaeTXT.ts 中两份重复的 parseFingerFrame 手写逻辑。
 */

import { FingerFrame, FingerSlot, StylusSlot, StylusState } from '../types/finger';
import {
  BUILTIN_FORMATS,
  CoordinateFormat,
  SlotField,
  TrailerField,
  computeSlotSize,
} from './coordinateFormatSchema';

/**
 * 按 header 字节匹配 format（按 BUILTIN_FORMATS 顺序，第一个完全匹配即返回）
 *
 * @param header packet 前 N 字节
 * @param formats 可选的自定义 format 列表；默认使用 BUILTIN_FORMATS
 * @returns 命中的 format，未命中返回 null
 */
export function matchFormat(
  header: number[],
  formats: ReadonlyArray<CoordinateFormat> = BUILTIN_FORMATS,
): CoordinateFormat | null {
  if (!header || header.length === 0) return null;
  for (const fmt of formats) {
    if (fmt.header.length > header.length) continue;
    let matched = true;
    for (let i = 0; i < fmt.header.length; i++) {
      if (fmt.header[i] !== header[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return fmt;
  }
  return null;
}

/**
 * 从 packet 提取字段值
 *
 * - bits=8：直接返回 byte
 * - bits=16：按 endian 组合 u16，默认 little-endian
 * - signed=true：对结果做有符号扩展（(v << 16) >> 16）
 *
 * 越界返回 0（与旧 parseFingerFrame 的"dataLen 不足"行为一致——丢弃该字段）。
 */
export function extractField(packet: number[], field: SlotField | TrailerField): number {
  const { offset, bits } = field;
  const endian = field.endian ?? 'le';
  const signed = field.signed ?? false;

  if (bits === 8) {
    if (offset >= packet.length) return 0;
    const v = packet[offset] & 0xff;
    return signed ? ((v << 24) >> 24) : v;
  }

  // bits === 16
  if (offset + 1 >= packet.length) return 0;
  const lo = packet[offset] & 0xff;
  const hi = packet[offset + 1] & 0xff;
  let v = endian === 'be' ? ((lo << 8) | hi) : ((hi << 8) | lo);
  if (signed) v = (v << 16) >> 16;
  return v;
}

/**
 * 通用手指包解析（schema-driven）
 *
 * @param packet    完整 packet 字节数组
 * @param timestamp 时间戳（毫秒）
 * @param format    已匹配的 CoordinateFormat
 * @returns 解析后的 FingerFrame；packet 长度不足或字段缺失时返回 null
 */
export function parseFingerFrameByFormat(
  packet: number[],
  timestamp: number,
  format: CoordinateFormat,
): FingerFrame | null {
  if (packet.length < format.totalLength) return null;

  const slotSize = computeSlotSize(format);
  const slots: FingerSlot[] = [];

  for (let i = 0; i < format.slotCount; i++) {
    const slotBase = format.slotStartOffset + i * slotSize;
    if (slotBase + slotSize > packet.length) break;

    // 必备字段：fingerStatus（每个 slot 必须有）
    const fingerStatus = extractField(packet, {
      name: 'fingerStatus',
      offset: slotBase,
      bits: 8,
    } as SlotField);
    const fingerId = (fingerStatus >> 4) & 0x0f;
    const state = fingerStatus & 0x0f;

    const slot: FingerSlot = { fingerId, state, x: 0, y: 0 };

    // 按 slotFields 顺序解析其余字段
    for (const field of format.slotFields) {
      if (field.name === 'fingerStatus') continue; // 已处理
      const v = extractField(packet, {
        ...field,
        offset: slotBase + field.offset,
      });
      (slot as any)[field.name] = v;
    }

    slots.push(slot);
  }

  // 解析帧尾
  let scantime = 0;
  let fingerCount = 0;
  let keyState: number | undefined;

  for (const field of format.trailer) {
    const v = extractField(packet, field);
    if (field.name === 'scantime') scantime = v;
    else if (field.name === 'fingerCount') fingerCount = v;
    else if (field.name === 'keyState') keyState = v;
  }

  return {
    timestamp,
    packetType: format.totalLength,
    slots,
    fingerCount,
    scantime,
    keyState,
  };
}

/**
 * 高层入口：自动嗅探 header → 匹配 format → 解析
 *
 * stylus 包 [0x2F, 0x00, 0x08] 不在 BUILTIN_FORMATS 内，需要调用方另行处理。
 */
export function tryParseFingerFrame(
  packet: number[],
  timestamp: number,
  formats: ReadonlyArray<CoordinateFormat> = BUILTIN_FORMATS,
): { frame: FingerFrame; format: CoordinateFormat } | null {
  if (packet.length < 3) return null;
  const fmt = matchFormat(packet.slice(0, 3), formats);
  if (!fmt) return null;
  const frame = parseFingerFrameByFormat(packet, timestamp, fmt);
  if (!frame) return null;
  return { frame, format: fmt };
}

export function parseStylusFrame(packet: number[], timestamp: number): FingerFrame | null {
  if (packet.length < 15 || packet[0] !== 0x2f || packet[1] !== 0 || packet[2] !== 0x08) {
    return null;
  }

  const readU16 = (offset: number) => (packet[offset] ?? 0) | ((packet[offset + 1] ?? 0) << 8);
  const readI16 = (offset: number) => (readU16(offset) << 16) >> 16;
  const stylus: StylusSlot = {
    stylusId: packet[4] ?? 0,
    state: (packet[3] ?? 0) as StylusState,
    x: readU16(5),
    y: readU16(7),
    tipPressure: readU16(9),
    xTilt: readI16(11),
    yTilt: readI16(13),
  };
  const debugChannels = Array.from({ length: 16 }, (_, index) => readI16(15 + index * 2));

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
    debugChannels,
  };
}
