// Formats HID Report Descriptor bytes for human consumption.

export function parseHexString(hex: string): number[] {
  const bytes: number[] = [];
  let remaining = hex;

  // C#-style: strip everything before and including "data:" (handles all I2C log formats)
  const dataIdx = remaining.toLowerCase().lastIndexOf('data:');
  if (dataIdx >= 0) {
    remaining = remaining.substring(dataIdx + 5);
  }

  // Also remove any remaining comment markers
  remaining = remaining
    .replace(/;.*$/gm, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/nak/gi, '');

  // Extract 0xNN patterns
  const hexPrefixRegex = /0x([0-9a-fA-F]{1,2})\b/gi;
  let match;
  while ((match = hexPrefixRegex.exec(remaining)) !== null) {
    bytes.push(parseInt(match[1], 16));
  }

  // If no 0xNN patterns found, fall back to plain hex parsing
  if (bytes.length === 0) {
    let cleaned = remaining.replace(/[^0-9a-fA-F]/g, ' ');
    const parts = cleaned.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.length <= 2) {
        bytes.push(parseInt(part, 16));
      } else {
        for (let i = 0; i < part.length; i += 2) {
          const byteStr = part.substring(i, i + 2);
          if (byteStr.length === 2) bytes.push(parseInt(byteStr, 16));
        }
      }
    }
  }

  return bytes;
}

export function bytesToHex(bytes: number[]): string {
  return bytes
    .map(b => '0x' + (b & 0xFF).toString(16).toUpperCase().padStart(2, '0'))
    .join(', ');
}

export function formatBytes(bytes: number[]): string {
  return bytes
    .map(b => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}
