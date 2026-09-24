// HID 1.11 Protocol Constants

export const HID_DESC_LENGTH = 30;
export const HID_DESC_BCD_VERSION = 0x0100;

// I2C protocol command opcodes
export const HID_I2C_CMD_RESET = 0x01;
export const HID_I2C_CMD_GET_REPORT = 0x02;
export const HID_I2C_CMD_SET_REPORT = 0x03;
export const HID_I2C_CMD_GET_IDLE = 0x04;
export const HID_I2C_CMD_SET_IDLE = 0x05;
export const HID_I2C_CMD_GET_PROTOCOL = 0x06;
export const HID_I2C_CMD_SET_PROTOCOL = 0x07;
export const HID_I2C_CMD_SET_POWER = 0x08;

export function getCommandName(opcode: number): string {
  switch (opcode) {
    case 0x01: return 'RESET';
    case 0x02: return 'GET_REPORT';
    case 0x03: return 'SET_REPORT';
    case 0x04: return 'GET_IDLE';
    case 0x05: return 'SET_IDLE';
    case 0x06: return 'GET_PROTOCOL';
    case 0x07: return 'SET_PROTOCOL';
    case 0x08: return 'SET_POWER';
    default: return `CMD_0x${opcode.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}

// Global items (tag values, bits [7:4] of prefix byte)
export enum GlobalItemTag {
  UsagePage = 0x0,
  LogicalMinimum = 0x1,
  LogicalMaximum = 0x2,
  PhysicalMinimum = 0x3,
  PhysicalMaximum = 0x4,
  UnitExponent = 0x5,
  Unit = 0x6,
  ReportSize = 0x7,
  ReportId = 0x8,
  ReportCount = 0x9,
  Push = 0xA,
  Pop = 0xB,
}

// Local items
export enum LocalItemTag {
  Usage = 0x0,
  UsageMinimum = 0x1,
  UsageMaximum = 0x2,
  DesignatorIndex = 0x3,
  DesignatorMinimum = 0x4,
  DesignatorMaximum = 0x5,
  StringIndex = 0x7,
  StringMinimum = 0x8,
  StringMaximum = 0x9,
  Delimiter = 0xA,
}

// Main items
export enum MainItemTag {
  Input = 0x8,
  Output = 0x9,
  Feature = 0xB,
  Collection = 0xA,
  EndCollection = 0xC,
}

// Collection types (data byte of Collection item)
export enum CollectionType {
  Physical = 0x00,
  Application = 0x01,
  Logical = 0x02,
  Report = 0x03,
  NamedArray = 0x04,
  UsageSwitch = 0x05,
  UsageModifier = 0x06,
}

// Input/Output/Feature bit flags
export const MAIN_FLAG_DATA = 0x00;          // bit 0 = 0
export const MAIN_FLAG_CONSTANT = 0x01;      // bit 0 = 1
export const MAIN_FLAG_ARRAY = 0x00;         // bit 1 = 0
export const MAIN_FLAG_VARIABLE = 0x02;      // bit 1 = 1
export const MAIN_FLAG_ABSOLUTE = 0x00;      // bit 2 = 0
export const MAIN_FLAG_RELATIVE = 0x04;      // bit 2 = 1
export const MAIN_FLAG_NO_WRAP = 0x00;       // bit 3 = 0
export const MAIN_FLAG_WRAP = 0x08;          // bit 3 = 1
export const MAIN_FLAG_LINEAR = 0x00;         // bit 4 = 0
export const MAIN_FLAG_NONLINEAR = 0x10;     // bit 4 = 1
export const MAIN_FLAG_PREFERRED = 0x00;     // bit 5 = 0
export const MAIN_FLAG_NO_PREFERRED = 0x20;  // bit 5 = 1
export const MAIN_FLAG_NO_NULL = 0x00;       // bit 6 = 0
export const MAIN_FLAG_NULL_STATE = 0x40;    // bit 6 = 1
export const MAIN_FLAG_NON_VOLATILE = 0x00;  // bit 7 = 0
export const MAIN_FLAG_VOLATILE = 0x80;      // bit 7 = 1
export const MAIN_FLAG_BITFIELD = 0x00;      // bit 8 = 0
export const MAIN_FLAG_BUFFERED = 0x100;     // bit 8 = 1
