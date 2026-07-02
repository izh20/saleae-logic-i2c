import { HidItem, HidItemType } from './types';
import {
  GlobalItemTag, LocalItemTag, MainItemTag,
  MAIN_FLAG_CONSTANT, MAIN_FLAG_VARIABLE, MAIN_FLAG_RELATIVE,
  MAIN_FLAG_WRAP, MAIN_FLAG_NONLINEAR, MAIN_FLAG_NO_PREFERRED,
  MAIN_FLAG_NULL_STATE, MAIN_FLAG_VOLATILE, MAIN_FLAG_BUFFERED,
} from './HidConstants';
import { getUsagePageName, getCollectionTypeName } from './HidUsagePages';

function readU32(bytes: number[], offset: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size && offset + i < bytes.length; i++) {
    val |= (bytes[offset + i] & 0xFF) << (i * 8);
  }
  return val >>> 0;
}

function signExtend(value: number, sizeInBytes: number): number {
  const bits = sizeInBytes * 8;
  const mask = 1 << (bits - 1);
  if (value & mask) {
    return value | (~((1 << bits) - 1));
  }
  return value;
}

/** Parse HID Report Descriptor bytes into a list of HidItem */
export function parseDescriptor(bytes: number[]): HidItem[] {
  const items: HidItem[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const prefix = bytes[offset];

    if (prefix === 0xFE) {
      if (offset + 3 >= bytes.length) break;
      const dataSize = bytes[offset + 1];
      const longTag = bytes[offset + 2];
      const end = offset + 3 + dataSize;
      const rawData = bytes.slice(offset + 3, Math.min(end, bytes.length));
      items.push({
        itemType: HidItemType.Reserved,
        tag: longTag,
        dataSize,
        rawData,
        offset,
        unsignedValue: 0,
        signedValue: 0,
      });
      offset = end;
      continue;
    }

    const dataSize = prefix & 0x03;
    const itemType = ((prefix >> 2) & 0x03) as HidItemType;
    const tag = (prefix >> 4) & 0x0F;

    const actualSize = dataSize === 3 ? 4 : dataSize;
    const rawData = bytes.slice(offset + 1, offset + 1 + actualSize);
    const unsignedValue = readU32(bytes, offset + 1, actualSize);
    const signedValue = signExtend(unsignedValue, actualSize);

    items.push({
      itemType,
      tag,
      dataSize,
      rawData,
      offset,
      unsignedValue,
      signedValue,
    });

    offset += 1 + actualSize;
  }

  return items;
}

export function getItemDescription(item: HidItem): string {
  switch (item.itemType) {
    case HidItemType.Main:
      return getMainItemDescription(item);
    case HidItemType.Global:
      return getGlobalItemDescription(item);
    case HidItemType.Local:
      return getLocalItemDescription(item);
    default:
      return `Reserved(tag=0x${item.tag.toString(16)})`;
  }
}

function getMainItemDescription(item: HidItem): string {
  if (item.tag === MainItemTag.Collection) {
    const ct = item.unsignedValue & 0xFF;
    return `Collection (${getCollectionTypeName(ct)})`;
  }
  if (item.tag === MainItemTag.EndCollection) {
    return 'End Collection';
  }
  if (
    item.tag === MainItemTag.Input ||
    item.tag === MainItemTag.Output ||
    item.tag === MainItemTag.Feature
  ) {
    const typeName =
      item.tag === MainItemTag.Input ? 'Input' :
      item.tag === MainItemTag.Output ? 'Output' : 'Feature';
    const flags = item.unsignedValue;
    const parts: string[] = [];
    if (flags & MAIN_FLAG_CONSTANT) parts.push('Cnst'); else parts.push('Data');
    if (flags & MAIN_FLAG_VARIABLE) parts.push('Var'); else parts.push('Array');
    if (flags & MAIN_FLAG_RELATIVE) parts.push('Rel'); else parts.push('Abs');
    if (flags & MAIN_FLAG_WRAP) parts.push('Wrap');
    if (flags & MAIN_FLAG_NONLINEAR) parts.push('NonLin');
    if (flags & MAIN_FLAG_NO_PREFERRED) parts.push('NoPref');
    if (flags & MAIN_FLAG_NULL_STATE) parts.push('Null');
    if (flags & MAIN_FLAG_VOLATILE) parts.push('Vol');
    if (flags & MAIN_FLAG_BUFFERED) parts.push('Buff');
    return `${typeName} (${parts.join(', ')})`;
  }
  return `Main(tag=0x${item.tag.toString(16)})`;
}

function getGlobalItemDescription(item: HidItem): string {
  const v = item.unsignedValue;
  switch (item.tag) {
    case GlobalItemTag.UsagePage: return `Usage Page (${getUsagePageName(v)})`;
    case GlobalItemTag.LogicalMinimum: return `Logical Minimum (${item.signedValue})`;
    case GlobalItemTag.LogicalMaximum: return `Logical Maximum (${item.signedValue})`;
    case GlobalItemTag.PhysicalMinimum: return `Physical Minimum (${item.signedValue})`;
    case GlobalItemTag.PhysicalMaximum: return `Physical Maximum (${item.signedValue})`;
    case GlobalItemTag.UnitExponent: return `Unit Exponent (${item.signedValue})`;
    case GlobalItemTag.Unit: return `Unit (${v})`;
    case GlobalItemTag.ReportSize: return `Report Size (${v})`;
    case GlobalItemTag.ReportId: return `Report ID (${v})`;
    case GlobalItemTag.ReportCount: return `Report Count (${v})`;
    case GlobalItemTag.Push: return 'Push';
    case GlobalItemTag.Pop: return 'Pop';
    default: return `Global(tag=0x${item.tag.toString(16)}, value=${v})`;
  }
}

function getLocalItemDescription(item: HidItem): string {
  const v = item.unsignedValue;
  switch (item.tag) {
    case LocalItemTag.Usage:
      return `Usage (0x${v.toString(16).padStart(4, '0')})`;
    case LocalItemTag.UsageMinimum:
      return `Usage Minimum (0x${v.toString(16).padStart(4, '0')})`;
    case LocalItemTag.UsageMaximum:
      return `Usage Maximum (0x${v.toString(16).padStart(4, '0')})`;
    case LocalItemTag.DesignatorIndex: return `Designator Index (${v})`;
    case LocalItemTag.DesignatorMinimum: return `Designator Minimum (${v})`;
    case LocalItemTag.DesignatorMaximum: return `Designator Maximum (${v})`;
    case LocalItemTag.StringIndex: return `String Index (${v})`;
    case LocalItemTag.StringMinimum: return `String Minimum (${v})`;
    case LocalItemTag.StringMaximum: return `String Maximum (${v})`;
    case LocalItemTag.Delimiter:
      return v === 0 ? 'Delimiter (Open)' : 'Delimiter (Close)';
    default: return `Local(tag=0x${item.tag.toString(16)}, value=${v})`;
  }
}

export function formatCommentedHex(bytes: number[]): string {
  const items = parseDescriptor(bytes);
  let indent = 0;
  let result = '';
  for (const item of items) {
    if (item.tag === MainItemTag.EndCollection) {
      indent = Math.max(0, indent - 2);
    }
    const hex = item.rawData.length > 0
      ? item.rawData.map(b =>
          '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(', ')
      : '';
    const prefixByte = ((item.itemType << 2) |
      (item.dataSize === 4 ? 3 : item.dataSize) |
      (item.tag << 4));
    const prefixHex = '0x' + prefixByte.toString(16).toUpperCase().padStart(2, '0');
    // Always end with a trailing comma so the formatted output can be
    // pasted directly into a C array initializer (e.g.
    //   uint8_t desc[] = { 0x05, 0x01, 0x09, 0x02, ... };
    // ) without reformatting. Comments stay inline.
    const fullHex = hex ? `${prefixHex}, ${hex},` : `${prefixHex},`;
    const desc = getItemDescription(item);
    result += `${'  '.repeat(indent)}${fullHex.padEnd(32)} // ${desc}\n`;
    if (item.tag === MainItemTag.Collection) {
      indent++;
    }
  }
  return result.trim();
}
