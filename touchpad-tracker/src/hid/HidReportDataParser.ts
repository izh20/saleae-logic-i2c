import { ReportField, ParsedReportFrame } from './types';

/** Extract bits from a byte array (LSB first per HID spec) */
export function extractBits(data: number[], bitOffset: number, bitSize: number): number {
  if (bitSize === 0) return 0;
  let result = 0;
  for (let i = 0; i < bitSize; i++) {
    const globalBit = bitOffset + i;
    const byteIdx = Math.floor(globalBit / 8);
    const bitInByte = globalBit % 8;
    if (byteIdx < data.length) {
      if ((data[byteIdx] >> bitInByte) & 1) {
        result |= (1 << i);
      }
    }
  }
  return result >>> 0;
}

/** Sign-extend a value to 32 bits */
export function signExtend(value: number, bitSize: number): number {
  if (bitSize >= 32 || bitSize === 0) return value;
  const mask = 1 << (bitSize - 1);
  if (value & mask) {
    return value | (~((1 << bitSize) - 1));
  }
  return value;
}

/**
 * Parse a single report data frame into structured field values.
 * Mirrors Waratah C# ReportBatchParser.ParseSingleFrame.
 * @param reportData raw bytes (may include length prefix + report ID)
 * @param allFields field definitions from ReportAnalyzer
 * @param hasLengthPrefix whether data begins with 2-byte HID I2C length prefix
 * @param frameIndex sequential frame number
 * @returns ParsedReportFrame or null if no fields match
 */
export function parseSingleFrame(
  reportData: number[],
  allFields: ReportField[],
  hasLengthPrefix: boolean,
  frameIndex: number,
): ParsedReportFrame | null {
  if (!reportData || reportData.length === 0) return null;

  let dataOffset = 0;
  let declaredLength = 0;

  if (hasLengthPrefix && reportData.length >= 2) {
    declaredLength = reportData[0] | (reportData[1] << 8);
    dataOffset = 2;
  }

  let reportId = 0;
  const hasReportId = allFields.some(f => f.reportId > 0);
  if (hasReportId && dataOffset < reportData.length) {
    reportId = reportData[dataOffset];
    dataOffset++;
  }

  const matchingFields = allFields
    .filter(f => f.reportId === reportId)
    .sort((a, b) => a.bitOffset - b.bitOffset);

  if (matchingFields.length === 0) return null;

  // Build payload: from dataOffset to end, capped by declaredLength
  let payloadLen: number;
  if (declaredLength > 0) {
    payloadLen = Math.min(declaredLength - dataOffset, reportData.length - dataOffset);
  } else {
    payloadLen = reportData.length - dataOffset;
  }
  payloadLen = Math.max(0, payloadLen);
  const payload = reportData.slice(dataOffset, dataOffset + payloadLen);

  const frame: ParsedReportFrame = { frameIndex, reportId, fields: {} };

  for (const field of matchingFields) {
    if (field.isConstant) continue;

    if (field.count > 1 && field.isVariable) {
      const isSigned = field.logicalMinimum < 0;
      for (let idx = 0; idx < field.count; idx++) {
        const bitOff = field.bitOffset + idx * field.bitSize;
        const rawVal = extractBits(payload, bitOff, field.bitSize);
        const signedVal = (field.bitSize > 1 && isSigned)
          ? signExtend(rawVal, field.bitSize) : rawVal;
        const val = field.bitSize === 1 ? rawVal : signedVal;

        // Build field name: use Usage range if available, else Usage ID
        let fieldName = field.usage;
        if (field.usageMin !== undefined && field.usageMax !== undefined) {
          const usageId = field.usageMin + idx;
          fieldName = `${field.usage}_${usageId}`;
        }

        // Dedup duplicate field names: Name, Name_1, Name_2, etc.
        let key = fieldName;
        let dupCount = 0;
        while (frame.fields[key] !== undefined) {
          dupCount++;
          key = `${fieldName}_${dupCount}`;
        }
        frame.fields[key] = val;
      }
    } else {
      const rawVal = extractBits(payload, field.bitOffset, field.bitSize);
      const signedVal = (field.bitSize > 1 && field.logicalMinimum < 0)
        ? signExtend(rawVal, field.bitSize) : rawVal;
      const val = field.bitSize === 1 ? rawVal : signedVal;

      // Dedup: if key already exists, append _N suffix
      let key = field.usage;
      let dupCount = 0;
      while (frame.fields[key] !== undefined) {
        dupCount++;
        key = `${field.usage} ${dupCount}`;
      }
      frame.fields[key] = val;
    }
  }

  return frame;
}

/** Generate a Markdown table for parsed report bytes */
export function generateMarkdown(
  reportData: number[],
  fields: ReportField[],
  hasLengthPrefix: boolean,
): string {
  let md = '## Report Data Analysis\n\n';

  const hex = reportData.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  md += `### Raw Bytes\n\`\`\`\n${hex}\n\`\`\`\n\n`;

  const result = parseSingleFrame(reportData, fields, hasLengthPrefix, 0);
  if (!result) return md + 'Failed to parse.\n';

  md += `### Report ID: ${result.reportId}\n\n`;
  md += '| Field | Value |\n|-------|-------|\n';
  for (const [name, value] of Object.entries(result.fields)) {
    md += `| ${name} | ${value} |\n`;
  }
  return md;
}
