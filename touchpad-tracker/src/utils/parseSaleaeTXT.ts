import { FingerFrame, FingerSlot } from '../types/finger';

// Parse hex string to number (supports both hex and decimal)
function parseHexOrDec(val: string): number {
  if (val.startsWith('0x') || val.startsWith('0X')) {
    return parseInt(val, 16);
  }
  return parseInt(val, 10);
}

// Parse I2C data array to finger frame
function parseFingerFrameFromData(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 3) return null;

  // Parse first 3 bytes for header
  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for finger packet header
  const is47Byte = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x04;
  const is32Byte = byte0 === 0x20 && byte1 === 0x00 && byte2 === 0x04;

  if (!is47Byte && !is32Byte) return null;

  const packetType: 47 | 32 = is47Byte ? 47 : 32;
  const slotSize = packetType === 47 ? 8 : 5;
  const dataLen = is47Byte ? 47 : 32;

  if (data.length < dataLen) return null;

  const slots: FingerSlot[] = [];

  // Parse 5 finger slots starting at byte 3
  for (let i = 0; i < 5; i++) {
    const offset = 3 + i * slotSize;
    if (offset >= dataLen) break;

    const fingerStatus = parseHexOrDec(data[offset]);
    const fingerId = (fingerStatus >> 4) & 0x0F;
    const state = fingerStatus & 0x0F;

    const xLow = parseHexOrDec(data[offset + 1]);
    const xHigh = parseHexOrDec(data[offset + 2]);
    const yLow = parseHexOrDec(data[offset + 3]);
    const yHigh = parseHexOrDec(data[offset + 4]);

    const x = xLow | (xHigh << 8);
    const y = yLow | (yHigh << 8);

    const slot: FingerSlot = {
      fingerId,
      state,
      x,
      y,
    };

    // Add extra fields for 47-byte format
    if (packetType === 47 && offset + 7 < dataLen) {
      slot.length = parseHexOrDec(data[offset + 5]);
      slot.width = parseHexOrDec(data[offset + 6]);
      slot.pressure = parseHexOrDec(data[offset + 7]);
    }

    slots.push(slot);
  }

  // Parse packet metadata
  const metaOffset = packetType === 47 ? 43 : 28;
  const scantimeLow = parseHexOrDec(data[metaOffset]);
  const scantimeHigh = parseHexOrDec(data[metaOffset + 1]);
  const scantime = scantimeLow | (scantimeHigh << 8);
  const fingerCount = parseHexOrDec(data[metaOffset + 2]);
  const keyState = parseHexOrDec(data[metaOffset + 3]);

  return {
    timestamp,
    packetType,
    slots,
    fingerCount,
    scantime,
    keyState,
  };
}

/**
 * Parse Saleae Logic exported TXT file to extract FingerFrame array
 * TXT format: {timestamp} {address} {data0} {data1} {data2} ...
 */
export function parseSaleaeTXT(content: string): FingerFrame[] {
  const frames: FingerFrame[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const address = parseHexOrDec(parts[1]);

    // Filter I2C TX frames (address 0x2C)
    if (address !== 0x2C) continue;

    const data = parts.slice(2);
    // TXT files don't preserve original timestamp, use current time
    const timestamp = Date.now();

    const frame = parseFingerFrameFromData(data, timestamp);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}