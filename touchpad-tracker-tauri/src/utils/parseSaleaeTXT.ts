import { FingerFrame, StylusSlot, StylusState } from '../types/finger';
import { matchFormat, tryParseFingerFrame } from '../hid/coordinateParser';

// Parse hex string to number (supports both hex and decimal)
function parseHexOrDec(val: string): number {
  if (val.startsWith('0x') || val.startsWith('0X')) {
    return parseInt(val, 16);
  }
  return parseInt(val, 10);
}

// Supported I2C addresses for touchpad (configurable)
const DEFAULT_ADDRESSES = [0x2C, 0x15, 0x5D];

// Create address manager
const addressManager = {
  supportedAddresses: [...DEFAULT_ADDRESSES],

  setAddresses(addresses: number[]) {
    this.supportedAddresses = addresses;
  },

  resetAddresses() {
    this.supportedAddresses = [...DEFAULT_ADDRESSES];
  }
};

// Export parseSaleaeCSV as both a function and an object with methods
export const parseSaleaeCSV = Object.assign(
  function(content: string): FingerFrame[] {
    return parseSaleaeCSVInternal(content, addressManager.supportedAddresses);
  },
  addressManager
);

// Parse I2C data array to finger frame（自动嗅探内置 CoordinateFormat）
function parseFingerFrameFromData(data: string[], timestamp: number): FingerFrame | null {
  const bytes = data.map(parseHexOrDec);
  const result = tryParseFingerFrame(bytes, timestamp);
  return result ? result.frame : null;
}

// Parse bytes[15..46] as 16 s16 little-endian debug values.
// Returns 16 zeros if data is shorter than 47 bytes.
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

// Parse stylus frame from data (15 bytes stylus + 32 bytes debug = 47 bytes total)
function parseStylusFrameFromData(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 15) return null;

  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for stylus packet header
  const isStylus = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x08;
  if (!isStylus) return null;

  const stylus: StylusSlot = {
    stylusId: parseHexOrDec(data[4]),
    state: parseHexOrDec(data[3]) as StylusState,
    x: parseHexOrDec(data[5]) | (parseHexOrDec(data[6]) << 8),
    y: parseHexOrDec(data[7]) | (parseHexOrDec(data[8]) << 8),
    tipPressure: parseHexOrDec(data[9]) | (parseHexOrDec(data[10]) << 8),
    xTilt: (parseHexOrDec(data[11]) | (parseHexOrDec(data[12]) << 8)) << 16 >> 16,
    yTilt: (parseHexOrDec(data[13]) | (parseHexOrDec(data[14]) << 8)) << 16 >> 16,
  };

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
    debugChannels: parseDebugChannels(data),
  };
}

/**
 * Parse Saleae Logic exported CSV file to extract FingerFrame array
 * CSV format:
 * Time [s],Packet ID,Address,Data,Read/Write,ACK/NAK
 * 1.555302937500000,0,0x2C,0x20,Read,ACK
 * 1.555347500000000,0,0x2C,0x00,Read,ACK
 * ...
 *
 * Each line is ONE BYTE of data. We need to:
 * 1. Collect all data bytes in order
 * 2. Scan for frame headers (0x2F 0x00 0x04 or 0x20 0x00 0x04)
 * 3. Parse each frame
 */
function parseSaleaeCSVInternal(content: string, supportedAddrs: number[]): FingerFrame[] {
  const frames: FingerFrame[] = [];
  // Handle both \n and \r\n line endings
  const lines = content.split(/\r?\n/);

  console.log('parseSaleaeCSV: total lines:', lines.length, 'supported addresses:', supportedAddrs);

  // Collect all I2C data bytes in order
  const allData: string[] = [];
  const allTimes: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV: Time [s],Packet ID,Address,Data,Read/Write,ACK/NAK
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const time = parseFloat(parts[0]);
    const address = parts[2].trim();
    const data = parts[3].trim();
    const rw = parts[4].trim();

    // Filter I2C addresses - accept configurable addresses
    // Default supported: 0x2C, 0x15, 0x5D
    const addrNum = parseHexOrDec(address);
    if (!supportedAddrs.includes(addrNum) || rw !== 'Read') continue;

    allData.push(data);
    allTimes.push(time);
  }

  console.log('parseSaleaeCSV: total data bytes collected:', allData.length);

  // Debug: scan for all 0x2F bytes to find potential packet headers
  const potentialHeaders: number[] = [];
  for (let j = 0; j < Math.min(allData.length, 500); j++) {
    if (parseHexOrDec(allData[j]) === 0x2F) {
      potentialHeaders.push(j);
    }
  }
  console.log('parseSaleaeCSV: found 0x2F at positions:', potentialHeaders.slice(0, 20));

  // Scan for frame headers and parse frames
  let i = 0;
  let frameIndex = 0;
  let stylusCount = 0;
  let fingerCount = 0;
  while (i < allData.length - 2) {
    const byte0 = parseHexOrDec(allData[i]);
    const byte1 = parseHexOrDec(allData[i + 1]);
    const byte2 = parseHexOrDec(allData[i + 2]);

    // Stylus packet first (0x2F 0x00 0x08) — 不在 BUILTIN_FORMATS 中
    const isStylus = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x08;

    // 自动嗅探手指包 format（tp47/tp32/tp2a/tp34 中匹配的第一个）
    const fingerFmt = matchFormat([byte0, byte1, byte2]);

    // Debug: log first few header detections
    if (frameIndex < 5 && (isStylus || fingerFmt)) {
      console.log(`parseSaleaeCSV: byte[${i}]=${byte0.toString(16)}, byte[${i+1}]=${byte1.toString(16)}, byte[${i+2}]=${byte2.toString(16)} - isStylus=${isStylus}, fingerFmt=${fingerFmt?.id ?? 'none'}`);
    }

    if (isStylus) {
      // Stylus packet: 15 bytes stylus data + 32 bytes debug channels = 47 bytes total
      const frameLen = 47;
      const endIdx = i + frameLen;

      if (endIdx <= allData.length) {
        const frameData = allData.slice(i, endIdx);
        const timestamp = allTimes[i] || 0;
        const frame = parseStylusFrameFromData(frameData, timestamp);

        if (frame) {
          frames.push(frame);
          stylusCount++;
          console.log(`parseSaleaeCSV: parsed stylus frame at byte ${i}, stylus.state=${frame.stylus?.state}, x=${frame.stylus?.x}, y=${frame.stylus?.y}`);
        }
        i = endIdx;
        frameIndex++;
      } else {
        i++;
      }
    } else if (fingerFmt) {
      const frameLen = fingerFmt.totalLength;
      const endIdx = i + frameLen;

      if (endIdx <= allData.length) {
        const frameData = allData.slice(i, endIdx);
        const timestamp = allTimes[i] || 0;
        const frame = parseFingerFrameFromData(frameData, timestamp);

        if (frame) {
          frames.push(frame);
          fingerCount++;
          console.log(`parseSaleaeCSV: parsed frame ${frameIndex} at byte ${i}, format=${fingerFmt.id} (${frameLen}B), fingerCount: ${frame.fingerCount}`);
        }
        i = endIdx;
        frameIndex++;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  console.log(`parseSaleaeCSV: total frames parsed: ${frames.length} (stylus: ${stylusCount}, finger: ${fingerCount})`);
  return frames;
}

// Alias for backward compatibility
export const parseSaleaeTXT = parseSaleaeCSV;
