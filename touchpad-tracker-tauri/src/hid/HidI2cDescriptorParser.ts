import { HidI2cDescriptor } from './types';
import { HID_DESC_LENGTH, HID_DESC_BCD_VERSION } from './HidConstants';
import { formatByteCount } from './HidDescriptorFormatter';

export function parseDescriptor(data: number[]): HidI2cDescriptor | null {
  if (!data || data.length < HID_DESC_LENGTH) return null;

  const readU16 = (offset: number): number =>
    (data[offset] & 0xFF) | ((data[offset + 1] & 0xFF) << 8);

  const readU32 = (offset: number): number =>
    (data[offset] & 0xFF) |
    ((data[offset + 1] & 0xFF) << 8) |
    ((data[offset + 2] & 0xFF) << 16) |
    ((data[offset + 3] & 0xFF) << 24);

  return {
    hidDescLength: readU16(0x00),
    bcdVersion: readU16(0x02),
    reportDescLength: readU16(0x04),
    reportDescRegister: readU16(0x06),
    inputRegister: readU16(0x08),
    maxInputLength: readU16(0x0A),
    outputRegister: readU16(0x0C),
    maxOutputLength: readU16(0x0E),
    commandRegister: readU16(0x10),
    dataRegister: readU16(0x12),
    vendorId: readU16(0x14),
    productId: readU16(0x16),
    versionId: readU16(0x18),
    reserved: readU32(0x1A),
  };
}

export function validateDescriptor(desc: HidI2cDescriptor): string[] {
  const warnings: string[] = [];
  if (desc.hidDescLength !== HID_DESC_LENGTH) {
    warnings.push(`HID Desc Length should be ${HID_DESC_LENGTH}, got ${desc.hidDescLength}`);
  }
  if (desc.bcdVersion !== HID_DESC_BCD_VERSION) {
    warnings.push(`BCD Version should be 0x${HID_DESC_BCD_VERSION.toString(16)}, got 0x${desc.bcdVersion.toString(16)}`);
  }
  if (desc.reportDescLength === 0) {
    warnings.push('Report Descriptor Length is 0');
  }
  if (desc.reportDescRegister === 0) {
    warnings.push('Report Descriptor Register is 0');
  }
  if (desc.inputRegister === 0) {
    warnings.push('Input Register is 0');
  }
  if (desc.reserved !== 0) {
    warnings.push(`Reserved should be 0, got 0x${desc.reserved.toString(16)}`);
  }
  return warnings;
}

export function generateMarkdown(desc: HidI2cDescriptor): string {
  const warnings = validateDescriptor(desc);
  const validStr = warnings.length === 0
    ? '✅ **All checks passed**'
    : '⚠️ **Warnings:**\n' + warnings.map(w => `- ${w}`).join('\n');

  const fmt = (v: number): string => '0x' + v.toString(16).toUpperCase().padStart(4, '0');

  return `## HID I2C Device Descriptor

### Device Information
| Field | Value |
|-------|-------|
| VID | ${fmt(desc.vendorId)} |
| PID | ${fmt(desc.productId)} |
| Version | ${fmt(desc.versionId)} |
| BCD Version | ${fmt(desc.bcdVersion)} |
| Report Desc Length | ${formatByteCount(desc.reportDescLength)} bytes |

### Register Map
| Register | Address | Max Length | Direction |
|----------|---------|------------|-----------|
| Report Descriptor | ${fmt(desc.reportDescRegister)} | — | Read |
| Input | ${fmt(desc.inputRegister)} | ${formatByteCount(desc.maxInputLength)} bytes | Read |
| Output | ${fmt(desc.outputRegister)} | ${formatByteCount(desc.maxOutputLength)} bytes | Write |
| Command | ${fmt(desc.commandRegister)} | — | Write |
| Data | ${fmt(desc.dataRegister)} | — | Read/Write |

### Raw Fields
| Offset | Field | Value | Description |
|--------|-------|-------|-------------|
| 0x00 | wHIDDescLength | ${formatByteCount(desc.hidDescLength)} | Descriptor length |
| 0x02 | bcdVersion | ${fmt(desc.bcdVersion)} | Protocol version |
| 0x04 | wReportDescLength | ${formatByteCount(desc.reportDescLength)} | Report descriptor length |
| 0x06 | wReportDescRegister | ${fmt(desc.reportDescRegister)} | Report desc register addr |
| 0x08 | wInputRegister | ${fmt(desc.inputRegister)} | Input register addr |
| 0x0A | wMaxInputLength | ${formatByteCount(desc.maxInputLength)} | Max input length |
| 0x0C | wOutputRegister | ${fmt(desc.outputRegister)} | Output register addr |
| 0x0E | wMaxOutputLength | ${formatByteCount(desc.maxOutputLength)} | Max output length |
| 0x10 | wCommandRegister | ${fmt(desc.commandRegister)} | Command register addr |
| 0x12 | wDataRegister | ${fmt(desc.dataRegister)} | Data register addr |
| 0x14 | wVendorID | ${fmt(desc.vendorId)} | USB VID |
| 0x16 | wProductID | ${fmt(desc.productId)} | USB PID |
| 0x18 | wVersionID | ${fmt(desc.versionId)} | Firmware version |
| 0x1A | Reserved | ${formatByteCount(desc.reserved)} | Reserved |

### Validation
${validStr}
`;
}
