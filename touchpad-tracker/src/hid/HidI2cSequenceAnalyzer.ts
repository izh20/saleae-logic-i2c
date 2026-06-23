import {
  I2cTransaction, HidI2cEvent, HidI2cDescriptor, ReportField,
} from './types';
import { parseHexString, formatFieldValue } from './HidDescriptorFormatter';
import { parseDescriptor } from './HidI2cDescriptorParser';
import { parseDescriptor as parseReportDescriptor } from './HidDescriptorParser';
import { analyzeReportItems, generateReportSummary } from './ReportAnalyzer';

function parseHexOrDec(val: string): number {
  if (val.startsWith('0x') || val.startsWith('0X')) return parseInt(val, 16);
  return parseInt(val, 10);
}

/**
 * Parse raw I2C log text into structured I2cTransaction objects.
 * Supports: Saleae CSV, bracket-timestamp, W/R: hex, bare hex.
 */
export function parseTransactions(
  logText: string,
  deviceAddress: number,
): I2cTransaction[] {
  if (!logText || !logText.trim()) return [];

  const transactions: I2cTransaction[] = [];
  const lines = logText.split(/\r?\n/);
  let baseTimeMs: number | null = null;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();
    if (!line) continue;

    // Format 1: Saleae CSV — Time[s],Packet ID,Address,Data,Read/Write,ACK/NAK
    const csvMatch = line.match(
      /^([\d.]+)\s*,\s*\d+\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(Read|Write)/i,
    );
    if (csvMatch) {
      const time = parseFloat(csvMatch[1]);
      const addr = parseHexOrDec(csvMatch[2]);
      const dataVal = parseHexOrDec(csvMatch[3]);
      const isRead = csvMatch[4].toLowerCase() === 'read';
      if (addr !== deviceAddress) continue;
      if (baseTimeMs === null) baseTimeMs = time * 1000;
      transactions.push({
        lineNumber, timestamp: time,
        timeMs: time * 1000 - (baseTimeMs || 0),
        address: addr, isRead, data: [dataVal], rawLine,
      });
      continue;
    }

    // Format 2: Bracket timestamp — [123.456] W addr: 0xNN data
    const bracketMatch = line.match(
      /\[([\d.]+)\]\s*(W|R)\s*(0x[0-9a-fA-F]+|\d+)/i,
    );
    if (bracketMatch) {
      const time = parseFloat(bracketMatch[1]);
      const isRead = bracketMatch[2].toUpperCase() === 'R';
      const addr = parseHexOrDec(bracketMatch[3]);
      if (addr !== deviceAddress) continue;
      const dataPart = line.substring(bracketMatch[0].length);
      const data = parseHexString(dataPart);
      if (baseTimeMs === null) baseTimeMs = time * 1000;
      transactions.push({
        lineNumber, timestamp: time,
        timeMs: time * 1000 - (baseTimeMs || 0),
        address: addr, isRead, data, rawLine,
      });
      continue;
    }

    // Format 3: W/R: hex hex ...
    const wrMatch = line.match(/^([WR]):\s*(.+)/i);
    if (wrMatch) {
      const isRead = wrMatch[1].toUpperCase() === 'R';
      const data = parseHexString(wrMatch[2]);
      if (data.length === 0) continue;
      transactions.push({
        lineNumber, timestamp: 0, timeMs: lineNumber,
        address: deviceAddress, isRead, data, rawLine,
      });
      continue;
    }

    // Format 4: write/read to 0xNN ack/nak data: ... (BootUp.txt format)
    const i2cAckMatch = line.match(
      /(write|read)\s+to\s+(0x[0-9a-fA-F]+|\d+)\s+(nak|ack\s+data:\s*(.+))/i,
    );
    if (i2cAckMatch) {
      const isRead = i2cAckMatch[1].toLowerCase() === 'read';
      const addr = parseHexOrDec(i2cAckMatch[2]);
      if (addr !== deviceAddress) continue;
      let data: number[] = [];
      if (i2cAckMatch[3].toLowerCase() !== 'nak') {
        data = parseHexString(i2cAckMatch[4] || '');
      }
      transactions.push({
        lineNumber, timestamp: 0, timeMs: lineNumber,
        address: addr, isRead, data, rawLine,
      });
      continue;
    }

    // Format 5: Bare hex bytes
    const hexBytes = parseHexString(line);
    if (hexBytes.length > 0) {
      transactions.push({
        lineNumber, timestamp: 0, timeMs: lineNumber,
        address: deviceAddress, isRead: false, data: hexBytes, rawLine,
      });
    }
  }

  return transactions;
}

export interface AnalysisResult {
  events: HidI2cEvent[];
  hidDescriptor: HidI2cDescriptor | null;
  reportDescriptorBytes: number[];
  reportFields: ReportField[];
  otherReadCount: number;
  otherWriteCount: number;
}

// ── Helpers ────────────────────────────────────────────────

function readU16LE(data: number[], offset: number): number {
  if (offset + 1 >= data.length) return 0;
  return (data[offset] & 0xFF) | ((data[offset + 1] & 0xFF) << 8);
}

function hexDump(data: number[], start: number, count: number): string {
  const end = Math.min(start + count, data.length);
  const parts: string[] = [];
  for (let i = start; i < end; i++) parts.push(data[i].toString(16).toUpperCase().padStart(2, '0'));
  return parts.join(' ');
}

function extractBits(data: number[], startBit: number, bitCount: number): number {
  let result = 0;
  for (let i = 0; i < bitCount; i++) {
    const byteIdx = Math.floor((startBit + i) / 8);
    const bitIdx = (startBit + i) % 8;
    if (byteIdx < data.length && ((data[byteIdx] >> bitIdx) & 1) === 1)
      result |= (1 << i);
  }
  return result;
}

function formatField(name: string, value: number, bits: number): string {
  return `${name}=${formatFieldValue(value, bits)}`;
}

function getReportTypeName(rt: number): string {
  switch (rt) { case 1: return 'Input'; case 2: return 'Output'; case 3: return 'Feature'; default: return `Type${rt}`; }
}

/** Decode HID I2C command opcode into human-readable description */
function decodeCommand(
  opcode: number,
  fullData: number[],
  commandRegister: number,
  reportFields: ReportField[] | null,
): string {
  const cmdHigh = (opcode >> 8) & 0xFF;
  const cmdLow = opcode & 0xFF;
  const cmdRegHex = '0x' + commandRegister.toString(16).toUpperCase().padStart(4, '0');

  switch (cmdHigh) {
    case 0x01:
      return `Software Reset → Force device re-initialize<br>CMD_REG=${cmdRegHex} Opcode=0x01`;

    case 0x02: {
      const reportType = (cmdLow >> 4) & 0x03;
      let reportId = cmdLow & 0x0F;
      if (reportId === 0x0F && fullData.length > 6) reportId = fullData[6];
      const rtStr = getReportTypeName(reportType);
      return `Get Report ${rtStr}#${reportId.toString(16).toUpperCase()} → Host requests current report state<br>CMD_REG=${cmdRegHex} Opcode=0x${opcode.toString(16).toUpperCase()} Type=${rtStr}(${reportType}) ID=0x${reportId.toString(16).toUpperCase()}`;
    }

    case 0x03: {
      const setType = (cmdLow >> 4) & 0x03;
      let reportId = cmdLow & 0x0F;
      const extended = reportId === 0x0F;
      const stStr = getReportTypeName(setType);

      if (fullData.length >= 8) {
        const payloadStart = 8;
        if (payloadStart < fullData.length) {
          let payloadRepId = fullData[payloadStart];
          if (extended || (reportId === 0 && payloadRepId !== 0)) reportId = payloadRepId;
          const dataLen = fullData.length - payloadStart - 1;
          const decoded = decodeReportPayload(fullData, payloadStart + 1, reportId, stStr, reportFields);
          const dataHex = dataLen > 0 ? hexDump(fullData, payloadStart + 1, Math.min(dataLen, 32)) : '';
          const fieldStr = decoded ? `[${decoded}]` : (dataLen > 0 ? `[${dataHex}]` : '(empty)');
          return `Set Report ${stStr}#${reportId.toString(16).toUpperCase()} → ${fieldStr}<br>CMD_REG=${cmdRegHex} Opcode=0x${opcode.toString(16).toUpperCase()}`;
        }
      }
      return `Set Report ${stStr}#${reportId.toString(16).toUpperCase()}<br>CMD_REG=${cmdRegHex} Opcode=0x${opcode.toString(16).toUpperCase()}`;
    }

    case 0x04: return `Get Idle Rate → Query periodic report interval<br>CMD_REG=${cmdRegHex} Opcode=0x04`;
    case 0x05: {
      const dur = cmdLow === 0 ? '0 (disable forced report)' : `${cmdLow}×4ms`;
      return `Set Idle Rate → Force report every ${dur}<br>CMD_REG=${cmdRegHex} Opcode=0x05`;
    }
    case 0x06: return `Get Protocol Mode → Query Boot/Report protocol<br>CMD_REG=${cmdRegHex} Opcode=0x06`;
    case 0x07: return `Set Protocol Mode → ${cmdLow === 0 ? 'Boot Protocol' : 'Report Protocol'}<br>CMD_REG=${cmdRegHex} Opcode=0x07`;
    case 0x08:
      return cmdLow === 0
        ? `Power On (D0) → Device enters normal full-power mode<br>CMD_REG=${cmdRegHex} Opcode=0x0800`
        : `Sleep (D1) → Device enters low-power standby mode<br>CMD_REG=${cmdRegHex} Opcode=0x0801`;
    default:
      return `Unknown command<br>CMD_REG=${cmdRegHex} Opcode=0x${opcode.toString(16).toUpperCase()}`;
  }
}

/** Decode report payload bytes into "Field=Value" pairs */
function decodeReportPayload(
  data: number[],
  payloadStart: number,
  reportId: number,
  reportType: string,
  reportFields: ReportField[] | null,
): string | null {
  if (!reportFields || !data) return null;

  const matchFields = reportFields
    .filter(f =>
      f.reportId === reportId &&
      (f.type === 0 && reportType === 'Input' ||
       f.type === 1 && reportType === 'Output' ||
       f.type === 2 && reportType === 'Feature') &&
      !f.isConstant)
    .sort((a, b) => a.bitOffset - b.bitOffset);

  if (matchFields.length === 0) return null;

  const parts: string[] = [];
  for (const field of matchFields) {
    if (parts.length >= 10) { parts.push('...'); break; }

    let name = field.usage.length > 22 ? field.usage.substring(0, 20) + '..' : field.usage;
    const count = field.count;

    if (count > 8) {
      const v0 = extractBits(data, payloadStart * 8 + field.bitOffset, field.bitSize);
      parts.push(`${name}[${count}]=0x${v0.toString(16).toUpperCase()}...`);
      continue;
    }

    for (let i = 0; i < count && parts.length < 10; i++) {
      const absBit = payloadStart * 8 + field.bitOffset + i * field.bitSize;
      const val = extractBits(data, absBit, field.bitSize);
      const itemName = count > 1 ? `${name}[${i}]` : name;
      parts.push(formatField(itemName, val, field.bitSize));
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Pre-scan transactions to parse report descriptor early for field-level command decoding */
function preScanReportFields(
  deviceTx: I2cTransaction[],
  hidDescRegister: number,
): ReportField[] | null {
  let desc: HidI2cDescriptor | null = null;
  for (let i = 0; i < deviceTx.length; i++) {
    const tx = deviceTx[i];
    if (!tx.isRead && tx.data.length >= 2) {
      const reg = readU16LE(tx.data, 0);
      if (reg === hidDescRegister && tx.data.length === 2) {
        if (i + 1 < deviceTx.length && deviceTx[i + 1].isRead && deviceTx[i + 1].data.length >= 30)
          try { desc = parseDescriptor(deviceTx[i + 1].data); } catch { /* ignore */ }
      } else if (desc && reg === desc.reportDescRegister && tx.data.length === 2) {
        if (i + 1 < deviceTx.length && deviceTx[i + 1].isRead) {
          try {
            const items = parseReportDescriptor(deviceTx[i + 1].data);
            return analyzeReportItems(items);
          } catch { /* ignore */ }
        }
      }
    } else if (tx.isRead && !desc && tx.data.length >= 30)
      try { desc = parseDescriptor(tx.data); } catch { /* ignore */ }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  Main analysis — mirrors C# HidI2cSequenceAnalyzer.Analyze
// ═══════════════════════════════════════════════════════════

export function analyzeSequence(
  transactions: I2cTransaction[],
  deviceAddress: number,
  hidDescRegister: number,
): AnalysisResult {
  const events: HidI2cEvent[] = [];
  let hidDescriptor: HidI2cDescriptor | null = null;
  let reportDescriptorBytes: number[] = [];
  let reportFields: ReportField[] = [];
  let order = 0;

  // Count other-address transactions
  let otherReadCount = 0;
  let otherWriteCount = 0;
  const deviceTx: I2cTransaction[] = [];
  for (const t of transactions) {
    if (t.address === deviceAddress || t.address === 0) {
      deviceTx.push(t);
    } else {
      if (t.isRead) otherReadCount++; else otherWriteCount++;
    }
  }

  if (deviceTx.length === 0) return { events, hidDescriptor, reportDescriptorBytes, reportFields, otherReadCount, otherWriteCount };

  // Pre-scan: ONLY parse report descriptor fields for command-level decoding.
  // Do NOT assign hidDescriptor or reportDescriptorBytes from pre-scan —
  // those must be set in the main analysis loop so events are emitted correctly.
  const preScanFields = preScanReportFields(deviceTx, hidDescRegister);
  if (preScanFields) reportFields = preScanFields;

  let pendingRead: string | null = null;

  function pushEvent(
    tsVal: number, timeMsVal: number,
    dir: string, type: string, desc: string,
    rawData: number[], reportId: string = '',
  ) {
    events.push({
      order: ++order,
      timestamp: tsVal,
      timeMs: timeMsVal,
      direction: dir,
      eventType: type,
      reportId,
      description: desc,
      rawData,
    });
  }

  for (let i = 0; i < deviceTx.length; i++) {
    const tx = deviceTx[i];

    // Skip NAK / empty data transactions
    if (tx.data.length === 0) {
      pushEvent(tx.timestamp, tx.timeMs,
        tx.isRead ? 'Host ← Device' : 'Host → Device',
        'NAK (No ACK)',
        `No ACK<br>ADDR=0x${tx.address.toString(16).toUpperCase().padStart(2, '0')}`,
        [], '');
      continue;
    }

    const dir = tx.isRead ? 'Host ← Device' : 'Host → Device';

    if (!tx.isRead && tx.data.length >= 2) {
      // ═══ WRITE (length >= 2) ═══
      const register = readU16LE(tx.data, 0);

      if (register === hidDescRegister && tx.data.length === 2) {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Read HID Descriptor',
          `Request HID Device Descriptor<br>REG=0x${hidDescRegister.toString(16).toUpperCase().padStart(4, '0')}`,
          tx.data);
        pendingRead = 'hid_desc';

        // Peek ahead: if next tx is a read, parse descriptor now
        if (i + 1 < deviceTx.length && deviceTx[i + 1].isRead) {
          const resp = deviceTx[i + 1];
          if (resp.data.length >= 30) {
            try { hidDescriptor = parseDescriptor(resp.data); } catch { /* ignore */ }
          }
        }
      } else if (hidDescriptor && register === hidDescriptor.reportDescRegister && tx.data.length === 2) {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Read Report Descriptor',
          `Request Report Descriptor<br>REG=0x${register.toString(16).toUpperCase().padStart(4, '0')}`,
          tx.data);
        pendingRead = 'report_desc';

        if (i + 1 < deviceTx.length && deviceTx[i + 1].isRead) {
          reportDescriptorBytes = deviceTx[i + 1].data;
        }
      } else if (hidDescriptor && register === hidDescriptor.commandRegister) {
        // Command register — opcode at data[2:4]
        let opcode = 0;
        if (tx.data.length >= 4) opcode = readU16LE(tx.data, 2);
        const cmdOpcode = (opcode >> 8) & 0xFF;
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Send Command',
          decodeCommand(opcode, tx.data, register, reportFields),
          tx.data);

        if (cmdOpcode === 0x02) {
          // GET_REPORT — expect response
          const rt = ((opcode & 0xFF) >> 4) & 0x03;
          let rid = opcode & 0x0F;
          if (rid === 0x0F && tx.data.length >= 7) rid = tx.data[6];
          const typeName = rt === 1 ? 'Input' : rt === 2 ? 'Output' : 'Feature';
          pendingRead = `get_report_${typeName}_0x${rid.toString(16).toUpperCase()}`;
        } else {
          pendingRead = null;
        }
      } else if (hidDescriptor && register === hidDescriptor.outputRegister) {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Output Report',
          `Send Output Report<br>OUTPUT_REG=0x${register.toString(16).toUpperCase().padStart(4, '0')}`,
          tx.data);
        pendingRead = null;
      } else if (hidDescriptor && register === hidDescriptor.dataRegister) {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Set Report (Data)',
          `Write Data Register<br>DATA_REG=0x${register.toString(16).toUpperCase().padStart(4, '0')}`,
          tx.data);
        pendingRead = null;
      } else {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Write Data',
          `Write register 0x${register.toString(16).toUpperCase().padStart(4, '0')} (${tx.data.length}B)`,
          tx.data);
        pendingRead = null;
      }

    } else if (tx.isRead) {
      // ═══ READ ═══

      if (pendingRead === 'hid_desc' && tx.data.length >= 30) {
        try { hidDescriptor = parseDescriptor(tx.data); } catch { /* ignore */ }
        const desc = hidDescriptor;
        pushEvent(tx.timestamp, tx.timeMs, dir, 'HID Descriptor Response',
          desc
            ? `Received HID Device Descriptor (${tx.data.length}B)<br>VID=0x${desc.vendorId.toString(16).toUpperCase().padStart(4, '0')} PID=0x${desc.productId.toString(16).toUpperCase().padStart(4, '0')}<br>ReportDescReg=0x${desc.reportDescRegister.toString(16).toUpperCase().padStart(4, '0')} CmdReg=0x${desc.commandRegister.toString(16).toUpperCase().padStart(4, '0')} DataReg=0x${desc.dataRegister.toString(16).toUpperCase().padStart(4, '0')} MaxInput=${desc.maxInputLength}B`
            : `Received ${tx.data.length}B but HID Descriptor parse failed`,
          tx.data);
        pendingRead = null;

      } else if (pendingRead === 'report_desc') {
        reportDescriptorBytes = tx.data;
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Report Descriptor Response',
          `Received Report Descriptor (${tx.data.length}B), parsed as field layout`,
          tx.data);
        pendingRead = null;

      } else if (pendingRead && pendingRead.startsWith('get_report_')) {
        // Response to Get Report command
        const reportInfo = pendingRead.substring('get_report_'.length);
        if (tx.data.length >= 2) {
          const length = readU16LE(tx.data, 0);
          if (length >= 3 && tx.data.length >= 3) {
            const repId = tx.data[2];
            const dataBytes = Math.min(length - 3, tx.data.length - 3);
            const decoded = decodeReportPayload(tx.data, 3, repId, reportInfo, reportFields);
            const grField = decoded != null
              ? `[${decoded}]`
              : (dataBytes > 0 ? `[${hexDump(tx.data, 3, Math.min(dataBytes, 16))}${dataBytes > 16 ? '...' : ''}]` : '(empty)');
            pushEvent(tx.timestamp, tx.timeMs, dir, 'Get Report Response',
              `Received ${reportInfo} current value → ${grField}<br>LEN=${length}B`,
              tx.data, `0x${repId.toString(16).toUpperCase()}`);
          } else {
            pushEvent(tx.timestamp, tx.timeMs, dir, 'Get Report Response',
              `Received ${reportInfo} LEN=${length}B`, tx.data);
          }
        } else {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Get Report Response',
            `Received ${reportInfo} (${tx.data.length}B)`, tx.data);
        }
        pendingRead = null;

      } else if (tx.data.length >= 30 && !hidDescriptor) {
        // Might be descriptor response without prior write
        try { hidDescriptor = parseDescriptor(tx.data); } catch { /* ignore */ }
        if (hidDescriptor) {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'HID Descriptor Response',
            `Received HID Device Descriptor (${tx.data.length}B)`, tx.data);
        } else {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Read Data',
            `Received ${tx.data.length}B`, tx.data);
        }

      } else if (tx.data.length >= 2) {
        // Check for HID I2C input report format: [len_lo, len_hi, report_id, data...]
        const length = readU16LE(tx.data, 0);
        if (length === 0) {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Input (empty)',
            'No input data from device (empty Input, LEN=0)', tx.data);
        } else if (length >= 3 && length <= tx.data.length) {
          const repId = tx.data[2];
          const decoded = decodeReportPayload(tx.data, 3, repId, 'Input', reportFields);
          const inField = decoded != null
            ? `[${decoded}]`
            : `payload=${length - 2}B`;
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Input Report',
            `Received Input Report Input#${repId.toString(16).toUpperCase()} → ${inField}<br>LEN=${length}B`,
            tx.data, `0x${repId.toString(16).toUpperCase()}`);
        } else if (length > 0 && length <= tx.data.length) {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Input Report',
            `Received Input Report LEN=${length}B payload=${length - 2}B`, tx.data);
        } else {
          pushEvent(tx.timestamp, tx.timeMs, dir, 'Read Data',
            `Received ${tx.data.length}B`, tx.data);
        }
      } else {
        pushEvent(tx.timestamp, tx.timeMs, dir, 'Read Data',
          `Received ${tx.data.length}B`, tx.data);
      }

    } else {
      // Write with length < 2
      pushEvent(tx.timestamp, tx.timeMs, dir, 'Write Data',
        `Write ${tx.data.length}B`, tx.data);
    }
  }

  return { events, hidDescriptor, reportDescriptorBytes, reportFields, otherReadCount, otherWriteCount };
}

/** Generate Markdown report — mirrors C# GenerateMarkdown */
export function generateSequenceMarkdown(result: AnalysisResult): string {
  const { events, hidDescriptor, reportDescriptorBytes, reportFields, otherReadCount, otherWriteCount } = result;

  let md = '### HID over I2C Power-On Sequence Analysis\n\n';

  if (hidDescriptor) {
    md += `**Device**: VID=0x${hidDescriptor.vendorId.toString(16).toUpperCase().padStart(4, '0')}, PID=0x${hidDescriptor.productId.toString(16).toUpperCase().padStart(4, '0')}, Report Descriptor=${hidDescriptor.reportDescLength} bytes\n\n`;
  }

  md += '### Sequence Events\n\n';
  md += '| # | Time | Direction | Event Type | ReportID | Description | Raw Data |\n';
  md += '|---|------|------|------|------|------|------|\n';

  for (const evt of events) {
    const timeStr = evt.timestamp ? evt.timestamp.toString() : '-';
    const rawHex = evt.rawData.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const rawShort = rawHex.length > 40 ? rawHex.substring(0, 37) + '...' : rawHex;
    const safeDesc = (evt.description || '').replace(/\|/g, '&#124;');
    const safeRid = evt.reportId || '';
    md += `| ${evt.order} | ${timeStr} | ${evt.direction} | **${evt.eventType}** | ${safeRid} | ${safeDesc} | \`${rawShort}\` |\n`;
  }

  md += '\n### Summary\n\n';
  md += `- **Target device transactions**: ${events.length}\n`;
  if (otherReadCount > 0 || otherWriteCount > 0) {
    md += `- **Other-address transactions**: read ${otherReadCount}, write ${otherWriteCount} (ignored)\n`;
  }
  const typeGroups = new Map<string, number>();
  for (const e of events) typeGroups.set(e.eventType, (typeGroups.get(e.eventType) || 0) + 1);
  for (const [type, count] of [...typeGroups].sort((a, b) => b[1] - a[1])) {
    md += `- **${type}**: ${count}\n`;
  }

  // HID Descriptor section
  if (hidDescriptor) {
    md += '\n---\n\n';
    md += '## HID Descriptor\n\n';
    md += generateDescriptorMarkdown(hidDescriptor);
  }

  // Report Descriptor section
  if (reportDescriptorBytes && reportDescriptorBytes.length > 0) {
    md += '\n---\n\n';
    md += '## Report Descriptor\n\n';
    md += `**Raw bytes (${reportDescriptorBytes.length}):**\n\n`;
    md += '```\n';
    const perLine = reportDescriptorBytes.length <= 32 ? 8 : reportDescriptorBytes.length <= 512 ? 16 : 32;
    for (let i = 0; i < reportDescriptorBytes.length; i += perLine) {
      md += hexDump(reportDescriptorBytes, i, perLine) + '\n';
    }
    md += '```\n\n';

    if (reportFields.length > 0) {
      md += '### Report Format Analysis\n\n';
      md += generateReportSummary(reportFields);
    }
  }

  return md;
}

function generateDescriptorMarkdown(desc: HidI2cDescriptor): string {
  const fmt4 = (v: number) => '0x' + v.toString(16).toUpperCase().padStart(4, '0');

  let md = '**Raw bytes (30):**\n\n```\n';
  // Rebuild descriptor bytes in order for hex dump
  const bytes: number[] = [];
  const w16 = (v: number) => { bytes.push(v & 0xFF); bytes.push((v >> 8) & 0xFF); };
  const w32 = (v: number) => { for (let i = 0; i < 4; i++) bytes.push((v >> (i * 8)) & 0xFF); };
  w16(desc.hidDescLength); w16(desc.bcdVersion); w16(desc.reportDescLength);
  w16(desc.reportDescRegister); w16(desc.inputRegister); w16(desc.maxInputLength);
  w16(desc.outputRegister); w16(desc.maxOutputLength); w16(desc.commandRegister);
  w16(desc.dataRegister); w16(desc.vendorId); w16(desc.productId);
  w16(desc.versionId); w32(desc.reserved);
  md += hexDump(bytes, 0, 30) + '\n```\n\n';

  md += '| Offset | Field | Value |\n|--------|-------|-------|\n';
  md += `| 0x00 | wHIDDescLength | ${desc.hidDescLength} |\n`;
  md += `| 0x02 | bcdVersion | ${fmt4(desc.bcdVersion)} |\n`;
  md += `| 0x04 | wReportDescLength | ${desc.reportDescLength} |\n`;
  md += `| 0x06 | wReportDescRegister | ${fmt4(desc.reportDescRegister)} |\n`;
  md += `| 0x08 | wInputRegister | ${fmt4(desc.inputRegister)} |\n`;
  md += `| 0x0A | wMaxInputLength | ${desc.maxInputLength} |\n`;
  md += `| 0x0C | wOutputRegister | ${fmt4(desc.outputRegister)} |\n`;
  md += `| 0x0E | wMaxOutputLength | ${desc.maxOutputLength} |\n`;
  md += `| 0x10 | wCommandRegister | ${fmt4(desc.commandRegister)} |\n`;
  md += `| 0x12 | wDataRegister | ${fmt4(desc.dataRegister)} |\n`;
  md += `| 0x14 | wVendorID | ${fmt4(desc.vendorId)} |\n`;
  md += `| 0x16 | wProductID | ${fmt4(desc.productId)} |\n`;
  md += `| 0x18 | wVersionID | ${fmt4(desc.versionId)} |\n`;
  md += `| 0x1A | Reserved | ${desc.reserved} |\n\n`;

  // Validation
  const warnings: string[] = [];
  if (desc.hidDescLength !== 30) warnings.push(`HID Desc Length should be 30, got ${desc.hidDescLength}`);
  if (desc.bcdVersion !== 0x0100) warnings.push(`BCD Version should be 0x0100`);
  if (desc.reportDescLength === 0) warnings.push('Report Descriptor Length is 0');
  if (desc.reportDescRegister === 0) warnings.push('Report Descriptor Register is 0');
  if (desc.inputRegister === 0) warnings.push('Input Register is 0');
  if (desc.reserved !== 0) warnings.push(`Reserved should be 0`);
  md += '**Validation:**\n\n';
  if (warnings.length === 0) {
    md += '✅ All checks passed\n';
  } else {
    for (const w of warnings) md += `- ⚠️ ${w}\n`;
  }

  return md;
}
