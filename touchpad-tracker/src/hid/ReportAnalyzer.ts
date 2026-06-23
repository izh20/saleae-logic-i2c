import { HidItem, HidItemType, ReportField, ReportType } from './types';
import {
  GlobalItemTag, LocalItemTag, MainItemTag,
  MAIN_FLAG_CONSTANT, MAIN_FLAG_VARIABLE, MAIN_FLAG_RELATIVE,
} from './HidConstants';
import { getUsageName } from './HidUsagePages';
import { formatFieldValue } from './HidDescriptorFormatter';

interface GlobalState {
  usagePage: number;
  logicalMinimum: number;
  logicalMaximum: number;
  physicalMinimum: number;
  physicalMaximum: number;
  unitExponent: number;
  unit: number;
  reportSize: number;
  reportId: number;
  reportCount: number;
}

interface LocalState {
  usages: number[];
  usageMinimum: number;
  usageMaximum: number;
  hasUsageRange: boolean;
}

function createGlobalState(): GlobalState {
  return {
    usagePage: 0, logicalMinimum: 0, logicalMaximum: 0,
    physicalMinimum: 0, physicalMaximum: 0, unitExponent: 0,
    unit: 0, reportSize: 0, reportId: 0, reportCount: 0,
  };
}

function createLocalState(): LocalState {
  return { usages: [], usageMinimum: 0, usageMaximum: 0, hasUsageRange: false };
}

export function analyzeReportItems(items: HidItem[]): ReportField[] {
  const fields: ReportField[] = [];
  const global = createGlobalState();
  let local = createLocalState();
  const stateStack: GlobalState[] = [];

  const bitOffsets = new Map<string, number>();

  function getKey(reportId: number, type: ReportType): string {
    return `${reportId}:${type}`;
  }

  for (const item of items) {
    if (item.itemType === HidItemType.Global) {
      switch (item.tag) {
        case GlobalItemTag.UsagePage: global.usagePage = item.unsignedValue; break;
        case GlobalItemTag.LogicalMinimum: global.logicalMinimum = item.signedValue; break;
        case GlobalItemTag.LogicalMaximum: global.logicalMaximum = item.signedValue; break;
        case GlobalItemTag.PhysicalMinimum: global.physicalMinimum = item.signedValue; break;
        case GlobalItemTag.PhysicalMaximum: global.physicalMaximum = item.signedValue; break;
        case GlobalItemTag.UnitExponent: global.unitExponent = item.signedValue; break;
        case GlobalItemTag.Unit: global.unit = item.unsignedValue; break;
        case GlobalItemTag.ReportSize: global.reportSize = item.unsignedValue; break;
        case GlobalItemTag.ReportId: global.reportId = item.unsignedValue; break;
        case GlobalItemTag.ReportCount: global.reportCount = item.unsignedValue; break;
        case GlobalItemTag.Push: stateStack.push({ ...global }); break;
        case GlobalItemTag.Pop:
          if (stateStack.length > 0) Object.assign(global, stateStack.pop()!);
          break;
      }
    } else if (item.itemType === HidItemType.Local) {
      switch (item.tag) {
        case LocalItemTag.Usage:
          local.usages.push(item.unsignedValue);
          break;
        case LocalItemTag.UsageMinimum:
          local.usageMinimum = item.unsignedValue;
          local.hasUsageRange = true;
          break;
        case LocalItemTag.UsageMaximum:
          local.usageMaximum = item.unsignedValue;
          break;
      }
    } else if (item.itemType === HidItemType.Main) {
      if (item.tag === MainItemTag.Collection || item.tag === MainItemTag.EndCollection) {
        local = createLocalState();
        continue;
      }

      let reportType: ReportType;
      if (item.tag === MainItemTag.Input) reportType = ReportType.Input;
      else if (item.tag === MainItemTag.Output) reportType = ReportType.Output;
      else if (item.tag === MainItemTag.Feature) reportType = ReportType.Feature;
      else continue;

      const flags = item.unsignedValue;
      const isConstant = !!(flags & MAIN_FLAG_CONSTANT);
      const isVariable = !!(flags & MAIN_FLAG_VARIABLE);

      const key = getKey(global.reportId, reportType);
      let bitOffset = bitOffsets.get(key) || 0;

      if (isConstant) {
        // ── Padding (Cnst): single field spanning ReportCount × ReportSize bits ──
        fields.push({
          reportId: global.reportId, type: reportType, usage: '(Padding)',
          bitOffset, bitSize: global.reportSize, count: Math.max(1, global.reportCount),
          logicalMinimum: global.logicalMinimum,
          logicalMaximum: global.logicalMaximum,
          isConstant: true, isVariable: false, isRelative: false,
          usagePage: global.usagePage, usageId: 0,
        });
        bitOffset += global.reportSize * Math.max(1, global.reportCount);
      } else if (isVariable && local.hasUsageRange) {
        // ── Variable + usage range: single field with UsageMin/UsageMax ──
        const minName = getUsageName(global.usagePage, local.usageMinimum);
        const maxName = getUsageName(global.usagePage, local.usageMaximum);
        fields.push({
          reportId: global.reportId, type: reportType,
          usage: `${minName} ~ ${maxName}`,
          bitOffset, bitSize: global.reportSize, count: Math.max(1, global.reportCount),
          logicalMinimum: global.logicalMinimum,
          logicalMaximum: global.logicalMaximum,
          isConstant, isVariable,
          isRelative: !!(flags & MAIN_FLAG_RELATIVE),
          usagePage: global.usagePage, usageId: 0,
          usageMin: local.usageMinimum,
          usageMax: local.usageMaximum,
        });
        bitOffset += global.reportSize * Math.max(1, global.reportCount);
      } else if (isVariable) {
        // ── Variable with non-range usages: iterate ReportCount, lookup usage ──
        // Per HID spec: if fewer usages than ReportCount, last usage extends
        const rc = Math.max(1, global.reportCount);
        for (let i = 0; i < rc; i++) {
          let usageId: number;
          if (i < local.usages.length) {
            usageId = local.usages[i];
          } else if (local.usages.length > 0) {
            usageId = local.usages[local.usages.length - 1]; // extend last
          } else {
            usageId = 0;
          }
          const usageName = getUsageName(global.usagePage, usageId);
          fields.push({
            reportId: global.reportId, type: reportType, usage: usageName,
            bitOffset, bitSize: global.reportSize, count: 1,
            logicalMinimum: global.logicalMinimum,
            logicalMaximum: global.logicalMaximum,
            isConstant, isVariable,
            isRelative: !!(flags & MAIN_FLAG_RELATIVE),
            usagePage: global.usagePage, usageId,
          });
          bitOffset += global.reportSize;
        }
      } else {
        // ── Array item: single field spanning ReportCount × ReportSize bits ──
        let usageDesc: string;
        if (local.hasUsageRange) {
          const minName = getUsageName(global.usagePage, local.usageMinimum);
          const maxName = getUsageName(global.usagePage, local.usageMaximum);
          usageDesc = `Array [${minName} ~ ${maxName}]`;
        } else if (local.usages.length > 0) {
          usageDesc = `Array [${local.usages.map(u => '0x' + u.toString(16).toUpperCase()).join(', ')}]`;
        } else {
          usageDesc = '';
        }
        fields.push({
          reportId: global.reportId, type: reportType, usage: usageDesc,
          bitOffset, bitSize: global.reportSize, count: Math.max(1, global.reportCount),
          logicalMinimum: global.logicalMinimum,
          logicalMaximum: global.logicalMaximum,
          isConstant: false, isVariable: false, isRelative: false,
          usagePage: global.usagePage, usageId: 0,
          usageMin: local.hasUsageRange ? local.usageMinimum : undefined,
          usageMax: local.hasUsageRange ? local.usageMaximum : undefined,
        });
        bitOffset += global.reportSize * Math.max(1, global.reportCount);
      }

      bitOffsets.set(key, bitOffset);
      local = createLocalState();
    }
  }

  return fields;
}

export function generateReportSummary(fields: ReportField[]): string {
  if (fields.length === 0) return 'No data';

  const typeNames = ['Input', 'Output', 'Feature'];
  const groups = new Map<string, ReportField[]>();
  for (const f of fields) {
    const k = `${f.reportId}:${f.type}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }

  let md = '## Report Descriptor Analysis\n\n';
  for (const [key, groupFields] of groups) {
    const [reportId, typeIdx] = key.split(':').map(Number);
    const reportLabel = reportId > 0 ? `Report ID 0x${reportId.toString(16).toUpperCase().padStart(2, '0')}` : 'No Report ID';
    const typeName = typeNames[typeIdx] || `Type ${typeIdx}`;
    const totalBits = groupFields.reduce((s, f) => s + f.bitSize * f.count, 0);
    const totalBytes = Math.ceil(totalBits / 8);
    md += `### ${reportLabel} | ${typeName} | Total size: ${totalBytes} bytes (${totalBits} bits)\n\n`;

    md += '| Offset | Size | Field | Range/Flags |\n';
    md += '|--------|------|-------|-------------|\n';

    for (const f of groupFields) {
      const fieldTotalBits = f.bitSize * f.count;
      const startBit = f.bitOffset;
      const endBit = startBit + fieldTotalBits - 1;
      const startByte = Math.floor(startBit / 8);
      const endByte = Math.floor(endBit / 8);

      let posStr: string;
      if (startByte === endByte) {
        if (fieldTotalBits < 8) {
          const bitInByte = startBit % 8;
          const bitEnd = bitInByte + fieldTotalBits - 1;
          posStr = bitInByte === bitEnd
            ? `Byte${startByte}[${bitInByte}]`
            : `Byte${startByte}[${bitInByte}:${bitEnd}]`;
        } else {
          posStr = `Byte ${startByte}`;
        }
      } else {
        posStr = `Byte ${startByte}-${endByte}`;
      }

      let sizeStr: string;
      if (f.count > 1 && f.bitSize > 1) {
        sizeStr = `${f.bitSize}b × ${f.count}`;
      } else if (fieldTotalBits >= 8 && fieldTotalBits % 8 === 0) {
        sizeStr = `${fieldTotalBits / 8} bytes`;
      } else {
        sizeStr = `${fieldTotalBits} bit${fieldTotalBits > 1 ? 's' : ''}`;
      }

      const desc = f.isConstant ? `~~[Padding]~~` : f.usage;

      let rangeStr = '';
      if (!f.isConstant) {
        rangeStr = `[${formatFieldValue(f.logicalMinimum, f.bitSize)} ~ ${formatFieldValue(f.logicalMaximum, f.bitSize)}]`;
        if (f.isRelative) rangeStr += ' *(relative)*';
      }

      md += `| ${posStr} | ${sizeStr} | ${desc} | ${rangeStr} |\n`;
    }
    md += '\n';
  }
  return md;
}
