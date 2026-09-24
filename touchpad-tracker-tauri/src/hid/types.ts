// HID over I2C protocol types

/** A single I2C bus transaction */
export interface I2cTransaction {
  lineNumber: number;
  timestamp: number;        // seconds (float)
  timeMs: number;           // milliseconds from start
  address: number;          // I2C 7-bit address
  isRead: boolean;          // true = read from device, false = write
  data: number[];           // raw data bytes
  rawLine: string;          // original log line
}

/** HID over I2C descriptor (30 bytes) */
export interface HidI2cDescriptor {
  hidDescLength: number;         // offset 0x00, 2 bytes LE
  bcdVersion: number;           // offset 0x02, 2 bytes LE
  reportDescLength: number;     // offset 0x04, 2 bytes LE
  reportDescRegister: number;  // offset 0x06, 2 bytes LE
  inputRegister: number;       // offset 0x08, 2 bytes LE
  maxInputLength: number;      // offset 0x0A, 2 bytes LE
  outputRegister: number;      // offset 0x0C, 2 bytes LE
  maxOutputLength: number;     // offset 0x0E, 2 bytes LE
  commandRegister: number;     // offset 0x10, 2 bytes LE
  dataRegister: number;        // offset 0x12, 2 bytes LE
  vendorId: number;            // offset 0x14, 2 bytes LE
  productId: number;           // offset 0x16, 2 bytes LE
  versionId: number;           // offset 0x18, 2 bytes LE
  reserved: number;            // offset 0x1A, 4 bytes LE
}

/** HID report descriptor item (one bytecode instruction) */
export enum HidItemType {
  Main = 0,
  Global = 1,
  Local = 2,
  Reserved = 3,
}

export interface HidItem {
  itemType: HidItemType;
  tag: number;              // short item tag (4 bits)
  dataSize: number;         // 0, 1, 2, or 4
  rawData: number[];        // raw data bytes
  offset: number;           // byte offset in source descriptor
  unsignedValue: number;    // data interpreted as unsigned
  signedValue: number;      // data interpreted as signed
}

/** A single field in a HID report, derived from the descriptor */
export enum ReportType {
  Input = 0,
  Output = 1,
  Feature = 2,
}

export interface ReportField {
  reportId: number;
  type: ReportType;
  usage: string;             // human-readable usage name
  bitOffset: number;         // bit position within the report
  bitSize: number;           // width in bits
  count: number;             // report count (usually 1)
  logicalMinimum: number;    // signed minimum
  logicalMaximum: number;    // signed maximum
  isConstant: boolean;
  isVariable: boolean;
  isRelative: boolean;
  usagePage: number;
  usageId: number;
  usageMin?: number;
  usageMax?: number;
}

/** One analyzed HID protocol event in the power-on sequence */
export interface HidI2cEvent {
  order: number;
  timestamp: number;
  timeMs: number;
  direction: string;        // 'Host→Device' or 'Host←Device'
  eventType: string;        // e.g. 'RESET', 'Read HID Descriptor', etc.
  reportId: string;          // Report ID as hex string (e.g. "0x02") or ""
  description: string;
  rawData: number[];
}

/** One parsed field value, with the bit size that was used to extract it. */
export interface ParsedField {
  value: number;
  bitSize: number;
}

/** One parsed report data frame */
export interface ParsedReportFrame {
  frameIndex: number;
  reportId: number;
  fields: Record<string, ParsedField>;  // fieldName → { value, bitSize }
}

/** One touch contact */
export interface TouchContact {
  contactId: number;
  x: number;
  y: number;
  pressure: number;
  tipSwitch: number;
  touchValid: number;
  inRange: number;
  width?: number;
  height?: number;
}

/** One touch frame (all contacts at one point in time) */
export interface TouchFrame {
  frameIndex: number;
  reportId: number;
  scanTime: number;
  contactCount: number;
  button: number;
  contacts: TouchContact[];
}
