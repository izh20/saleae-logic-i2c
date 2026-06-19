import { ReportField, ParsedReportFrame, TouchContact, TouchFrame } from './types';
import { parseSingleFrame } from './HidReportDataParser';
import { parseHexString } from './HidDescriptorFormatter';

/** Extract I2C address from a log line like "read to 0x2C ack data: ..." */
export function extractI2cAddress(line: string): number | null {
  const match = line.match(/^(?:read|write)\s+to\s+(?:0x)?([0-9A-Fa-f]{1,2})\b/i);
  if (match) {
    const addr = parseInt(match[1], 16);
    if (!isNaN(addr)) return addr;
  }
  return null;
}

/** Parse multiple lines of report data, returning frames grouped by Report ID.
 *  Mirrors Waratah C# ReportBatchParser.ParseAllFrames. */
export function parseAllFrames(
  lines: string[],
  allFields: ReportField[],
  hasLengthPrefix: boolean,
  addrFilter: number | null,
): { groups: Map<number, ParsedReportFrame[]>; skipped: number } {
  const groups = new Map<number, ParsedReportFrame[]>();
  let skipped = 0;
  let frameIdx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    const lineAddr = extractI2cAddress(trimmed);
    if (addrFilter !== null && lineAddr !== null && lineAddr !== addrFilter) {
      skipped++;
      continue;
    }

    let data: number[];
    try {
      data = parseHexString(trimmed);
    } catch {
      skipped++;
      continue;
    }
    if (data.length === 0) continue;

    const frame = parseSingleFrame(data, allFields, hasLengthPrefix, frameIdx);
    if (frame) {
      if (!groups.has(frame.reportId)) groups.set(frame.reportId, []);
      groups.get(frame.reportId)!.push(frame);
    }
    frameIdx++;
  }

  return { groups, skipped };
}

/** Extract touch frames from parsed report frames */
export function extractTouchFrames(frames: ParsedReportFrame[]): TouchFrame[] {
  const touchFrames: TouchFrame[] = [];

  for (const frame of frames) {
    const f = frame.fields;
    const hasX = 'X' in f || 'x' in f;
    if (!hasX) continue;

    const scanTime = f['Scan Time'] || f['scanTime'] || 0;
    const contactCount = f['Contact Count'] || f['contactCount'] || 1;
    const button = f['Button'] || f['button'] || 0;

    const contacts: TouchContact[] = [];
    for (let c = 0; c < contactCount; c++) {
      const suffix = c > 0 ? ` ${c + 1}` : '';
      contacts.push({
        contactId: f[`Contact Identifier${suffix}`] || c,
        x: f[`X${suffix}`] || 0,
        y: f[`Y${suffix}`] || 0,
        pressure: f[`Tip Pressure${suffix}`] || 0,
        tipSwitch: f[`Tip Switch${suffix}`] || 0,
        touchValid: f[`Touch Valid${suffix}`] || f[`In Range${suffix}`] || 0,
        inRange: f[`In Range${suffix}`] || 0,
        width: f[`Width${suffix}`],
        height: f[`Height${suffix}`],
      });
    }

    touchFrames.push({
      frameIndex: frame.frameIndex,
      reportId: frame.reportId,
      scanTime, contactCount, button, contacts,
    });
  }

  return touchFrames;
}

/** Generate a Markdown table of touch frames */
export function generateTouchMarkdown(frames: TouchFrame[]): string {
  if (frames.length === 0) return 'No touch frames found.';

  let md = `## Touch Frames (${frames.length} frames)\n\n`;
  md += '| # | ScanTime | Contact | X | Y | Pressure | Tip |\n';
  md += '|---|----------|---------|---|---|----------|------|\n';
  for (const f of frames) {
    for (const c of f.contacts) {
      md += `| ${f.frameIndex} | ${f.scanTime} | ${c.contactId} | ${c.x} | ${c.y} | ${c.pressure} | ${c.tipSwitch} |\n`;
    }
  }
  return md;
}
