// WaraToDescriptorGenerator — Generates HID Report Descriptor bytes from .wara (TOML) content.
// Ported from Waratah C# WaraToDescriptorGenerator.cs

import { GlobalItemTag, LocalItemTag, MainItemTag, CollectionType } from './HidConstants';
import { getUsagePageName, getUsageName, TryGetUsageId, GetUsageNameForWara } from './HidUsagePages';

// ── Lightweight .wara TOML parser ──────────────────────────
function parseWaraToml(text: string): any {
  const lines = text.split('\n');
  const result: any = {};
  let current: any = result;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Table array: [[section.subsection...]]
    const tableArrMatch = trimmed.match(/^\[\[(.+)\]\]$/);
    if (tableArrMatch) {
      const parts = tableArrMatch[1].trim().split('.');
      let obj: any = result;
      for (let i = 0; i < parts.length; i++) {
        if (!(parts[i] in obj)) obj[parts[i]] = [];
        const arr = obj[parts[i]];
        if (i === parts.length - 1) {
          arr.push({});
          current = arr[arr.length - 1];
        } else {
          if (arr.length === 0) arr.push({});
          obj = arr[arr.length - 1];
        }
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w[\w\d]*)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const rawVal = kvMatch[2].trim();

    let value: any;

    // String array: ['a', 'b', ...]
    if (rawVal.startsWith('[') && rawVal.includes("'")) {
      const arrMatch = rawVal.match(/'([^']+)'/g);
      if (arrMatch) {
        value = arrMatch.map((s: string) => s.replace(/'/g, '').trim());
      } else {
        continue;
      }
    }
    // String: 'value'
    else if (rawVal.startsWith("'") && rawVal.endsWith("'")) {
      value = rawVal.slice(1, -1);
    }
    // Integer or float array: [0, 255]
    else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1).trim();
      if (inner) {
        value = inner.split(',').map((s: string) => {
          const num = Number(s.trim());
          return isNaN(num) ? s.trim() : num;
        });
      } else {
        value = [];
      }
    }
    // Boolean
    else if (rawVal === 'true') { value = true; }
    else if (rawVal === 'false') { value = false; }
    // Number
    else if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
      value = rawVal.includes('.') ? parseFloat(rawVal) : parseInt(rawVal, 10);
    }
    // String without quotes
    else {
      value = rawVal;
    }

    current[key] = value;
  }

  return result;
}

export class WaraToDescriptorGenerator {
  private _descriptor: number[] = [];
  private _textOutput: string[] = [];
  private _indent = 0;
  private _rawToml = '';
  private _lastReportId = 0;

  generate(tomlContent: string): { text: string; bytes: number[] } {
    this._descriptor = [];
    this._textOutput = [];
    this._rawToml = tomlContent;
    this._lastReportId = 0;

    let doc: any;
    try {
      doc = parseWaraToml(tomlContent);
    } catch (ex: any) {
      throw new Error(`Error - ${ex.message}`);
    }

    // Process applicationCollection
    if (doc.applicationCollection) {
      if (Array.isArray(doc.applicationCollection)) {
        for (const appCol of doc.applicationCollection) {
          this.processApplicationCollection(appCol);
        }
      } else {
        this.processApplicationCollection(doc.applicationCollection);
      }
    }

    // Fallback: top-level usage
    if (this._descriptor.length === 0 && doc.usage) {
      const usageArr = doc.usage;
      if (Array.isArray(usageArr) && usageArr.length >= 2) {
        const pageId = this.getUsagePageId(usageArr[0] || '');
        const usageId = this.getUsageId(pageId, usageArr[1] || '');
        this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
        this.addLocalItem(LocalItemTag.Usage, usageId);
      }
    }

    // Build result
    const lines: string[] = [];
    lines.push('//');
    lines.push('// HID Report Descriptor');
    lines.push(`// Generated from .wara file`);
    lines.push(`// Descriptor size: ${this._descriptor.length} bytes`);
    lines.push('//');
    lines.push('');
    lines.push(`const uint8_t hidReportDescriptor[${this._descriptor.length}] = {`);
    lines.push(this.formatDescriptorAsC());
    lines.push('};');
    lines.push('');
    lines.push('// Parsed items:');
    lines.push(this._textOutput.join('\n'));

    return { text: lines.join('\n'), bytes: [...this._descriptor] };
  }

  private processApplicationCollection(appCol: any): void {
    if (appCol.usage && Array.isArray(appCol.usage)) {
      const pageId = this.getUsagePageId(appCol.usage[0] || '');
      const usageId = this.getUsageId(pageId, appCol.usage[1] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.Usage, usageId);
    }
    this.addMainItem(MainItemTag.Collection, CollectionType.Application);
    this._indent++;
    this.processCollection(appCol);
    this._indent--;
    this.addMainItem(MainItemTag.EndCollection, null);
  }

  private processCollection(collection: any): void {
    const reportInstances = this.getReportInstanceOrder(collection);
    const indices: Record<string, number> = { inputReport: 0, outputReport: 0, featureReport: 0 };

    for (const reportKey of reportInstances) {
      if (!(reportKey in collection)) continue;
      const idx = indices[reportKey];
      let reportType: MainItemTag;
      switch (reportKey) {
        case 'inputReport': reportType = MainItemTag.Input; break;
        case 'outputReport': reportType = MainItemTag.Output; break;
        case 'featureReport': reportType = MainItemTag.Feature; break;
        default: continue;
      }

      const reportObj = collection[reportKey];
      if (Array.isArray(reportObj) && idx < reportObj.length) {
        this.processSingleReport(reportObj[idx], reportType);
      } else if (!Array.isArray(reportObj) && idx === 0) {
        this.processSingleReport(reportObj, reportType);
      }
      indices[reportKey] = idx + 1;
    }
  }

  private getReportInstanceOrder(collection: any): string[] {
    const order: string[] = [];
    if (this._rawToml) {
      const lines = this._rawToml.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[[')) continue;
        const m = trimmed.match(/^\[\[applicationCollection\.(featureReport|inputReport|outputReport)\]\]$/);
        if (m) {
          if (m[1] === 'featureReport') order.push('featureReport');
          else if (m[1] === 'inputReport') order.push('inputReport');
          else if (m[1] === 'outputReport') order.push('outputReport');
        }
      }
    }
    if (order.length === 0) {
      if (collection.inputReport) {
        const cnt = Array.isArray(collection.inputReport) ? collection.inputReport.length : 1;
        for (let i = 0; i < cnt; i++) order.push('inputReport');
      }
      if (collection.outputReport) {
        const cnt = Array.isArray(collection.outputReport) ? collection.outputReport.length : 1;
        for (let i = 0; i < cnt; i++) order.push('outputReport');
      }
      if (collection.featureReport) {
        const cnt = Array.isArray(collection.featureReport) ? collection.featureReport.length : 1;
        for (let i = 0; i < cnt; i++) order.push('featureReport');
      }
    }
    return order;
  }

  private processSingleReport(report: any, reportType: MainItemTag): void {
    if (report.id !== undefined) {
      const rid = report.id;
      if (rid > 0 && rid !== this._lastReportId) {
        this.addGlobalItem(GlobalItemTag.ReportId, rid);
        this._lastReportId = rid;
      }
    }

    if (report.usageRelation && Array.isArray(report.usageRelation)) {
      const pageId = this.getUsagePageId(report.usageRelation[0] || '');
      const usageId = this.getUsageId(pageId, report.usageRelation[1] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.Usage, usageId);
      this.addMainItem(MainItemTag.Collection, CollectionType.Physical);
      this._indent++;
      this.processReportContent(report, reportType);
      this._indent--;
      this.addMainItem(MainItemTag.EndCollection, null);
    } else {
      this.processReportContent(report, reportType);
    }
  }

  private processReportContent(report: any, reportType: MainItemTag): void {
    const order = this.getItemDocumentOrder(report);
    const indices: Record<string, number> = {};

    for (const [itemType] of order) {
      if (!(itemType in indices)) indices[itemType] = 0;
      const idx = indices[itemType];

      switch (itemType) {
        case 'physicalCollection':
          this.processNestedCollectionByIndex(report, 'physicalCollection', CollectionType.Physical, reportType, idx);
          break;
        case 'logicalCollection':
          this.processNestedCollectionByIndex(report, 'logicalCollection', CollectionType.Logical, reportType, idx);
          break;
        case 'variableItem':
          this.processItemByIndex(report, 'variableItem', reportType, idx, (t, rt) => this.processVariableItem(t, rt));
          break;
        case 'paddingItem':
          this.processItemByIndex(report, 'paddingItem', reportType, idx, (t, rt) => this.processPaddingItem(t, rt));
          break;
        case 'arrayItem':
          this.processItemByIndex(report, 'arrayItem', reportType, idx, (t, rt) => this.processArrayItem(t, rt));
          break;
      }
      indices[itemType]++;
    }
  }

  private processItemByIndex(report: any, key: string, reportType: MainItemTag, index: number, processor: (t: any, rt: MainItemTag) => void): void {
    if (!(key in report)) return;
    const obj = report[key];
    if (Array.isArray(obj) && index < obj.length) {
      processor(obj[index], reportType);
    } else if (!Array.isArray(obj) && index === 0) {
      processor(obj, reportType);
    }
  }

  private processNestedCollectionByIndex(parent: any, key: string, colType: CollectionType, reportType: MainItemTag, index: number): void {
    if (!(key in parent)) return;
    const colObj = parent[key];
    let colTable: any = null;
    if (Array.isArray(colObj) && index < colObj.length) colTable = colObj[index];
    else if (!Array.isArray(colObj) && index === 0) colTable = colObj;
    if (!colTable) return;

    if (colTable.usage && Array.isArray(colTable.usage)) {
      const pageId = this.getUsagePageId(colTable.usage[0] || '');
      const usageId = this.getUsageId(pageId, colTable.usage[1] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.Usage, usageId);
    }
    this.addMainItem(MainItemTag.Collection, colType);
    this._indent++;
    this.processReportContent(colTable, reportType);
    this._indent--;
    this.addMainItem(MainItemTag.EndCollection, null);
  }

  private getItemDocumentOrder(report: any): Array<[string, number]> {
    const known = new Set(['variableItem', 'paddingItem', 'arrayItem', 'physicalCollection', 'logicalCollection']);
    const present = Object.keys(report).filter(k => known.has(k));

    if (present.length <= 1) {
      const result: Array<[string, number]> = [];
      for (const key of Object.keys(report)) {
        if (!known.has(key)) continue;
        const obj = report[key];
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) result.push([key, i]);
        } else {
          result.push([key, 0]);
        }
      }
      return result;
    }

    const result: Array<[string, number]> = [];
    const counters: Record<string, number> = {};
    const lines = this._rawToml.split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('[[')) continue;
      for (const pk of present) {
        if (trimmed.includes('.' + pk + ']]') || trimmed.endsWith('.' + pk + ']]')) {
          if (!(pk in counters)) counters[pk] = 0;
          result.push([pk, counters[pk]]);
          counters[pk]++;
          break;
        }
      }
    }
    if (result.length > 0) return result;

    const fallback: Array<[string, number]> = [];
    for (const key of Object.keys(report)) {
      if (!known.has(key)) continue;
      const obj = report[key];
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) fallback.push([key, i]);
      } else {
        fallback.push([key, 0]);
      }
    }
    return fallback;
  }

  private processVariableItem(item: any, reportType: MainItemTag): void {
    // Usage
    if (item.usage && Array.isArray(item.usage)) {
      const pageId = this.getUsagePageId(item.usage[0] || '');
      const usageId = this.getUsageId(pageId, item.usage[1] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.Usage, usageId);
    }

    // usageTransform
    if (item.usageTransform && Array.isArray(item.usageTransform)) {
      const pageId = this.getUsagePageId(item.usageTransform[0] || '');
      const baseId = this.getUsageId(pageId, item.usageTransform[1] || '');
      const modifierId = this.getUsageId(pageId, item.usageTransform[2] || '');
      const transformedId = (baseId | modifierId) & 0xFFFF;
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.Usage, transformedId);
    }

    // usageRange
    if (item.usageRange && Array.isArray(item.usageRange)) {
      const pageId = this.getUsagePageId(item.usageRange[0] || '');
      const uMin = this.getUsageId(pageId, item.usageRange[1] || '');
      const uMax = this.getUsageId(pageId, item.usageRange[2] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.UsageMinimum, uMin);
      this.addLocalItem(LocalItemTag.UsageMaximum, uMax);
    }

    // usageUnitMultiplier -> Unit Exponent
    let hasUnitExponent = false;
    if (item.usageUnitMultiplier !== undefined) {
      const multiplier = Number(item.usageUnitMultiplier);
      const exponent = Math.round(Math.log10(multiplier));
      const wireCode = exponent >= 0 ? exponent : 16 + exponent;
      this.addGlobalItem(GlobalItemTag.UnitExponent, wireCode);
      hasUnitExponent = true;
    }

    // sizeInBits
    let sizeInBits = 0;
    let sizeSpecified = false;
    if (item.sizeInBits !== undefined) {
      sizeInBits = Number(item.sizeInBits);
      if (sizeInBits <= 0 || sizeInBits > 32) this.throwError('sizeInBits', `'${sizeInBits}' invalid for size`);
      sizeSpecified = true;
    }

    // logicalValueRange
    let logMin = 0, logMax = 1;
    let logicalSpecified = false;
    if (item.logicalValueRange !== undefined) {
      logicalSpecified = true;
      if (Array.isArray(item.logicalValueRange)) {
        logMin = Number(item.logicalValueRange[0]);
        logMax = Number(item.logicalValueRange[1]);
      } else if (typeof item.logicalValueRange === 'string') {
        const rs = (item.logicalValueRange as string).toLowerCase();
        switch (rs) {
          case 'maxsignedsizerange':
            if (!sizeSpecified) sizeInBits = 8;
            logMin = -(1 << (sizeInBits - 1));
            logMax = (1 << (sizeInBits - 1)) - 1;
            break;
          case 'maxunsignedsizerange':
          default:
            if (!sizeSpecified) sizeInBits = 8;
            logMin = 0;
            logMax = (1 << sizeInBits) - 1;
            break;
        }
      }
    }

    if (!logicalSpecified && sizeSpecified) {
      logMin = 0;
      logMax = (1 << sizeInBits) - 1;
    }

    if (!sizeSpecified) {
      sizeInBits = this.calculateMinBits(logMin, logMax);
    }

    this.addGlobalItem(GlobalItemTag.LogicalMinimum, logMin);
    this.addGlobalItem(GlobalItemTag.LogicalMaximum, logMax);

    // physicalValueRange
    let hasPhysical = false;
    if (item.physicalValueRange && Array.isArray(item.physicalValueRange)) {
      const pMin = Number(item.physicalValueRange[0]);
      const pMax = Number(item.physicalValueRange[1]);
      this.addGlobalItem(GlobalItemTag.PhysicalMinimum, pMin);
      this.addGlobalItem(GlobalItemTag.PhysicalMaximum, pMax);
      hasPhysical = true;
    }

    // unit
    let hasUnit = false;
    if (item.unit !== undefined) {
      const us = (item.unit as string).toLowerCase();
      let unitCode = 0;
      if (us === 'degrees') unitCode = 0x14;
      else if (us === 'centimeter') unitCode = 0x11;
      else if (us === 'inch') unitCode = 0x13;
      if (unitCode !== 0) {
        this.addGlobalItem(GlobalItemTag.Unit, unitCode);
        hasUnit = true;
      }
    }

    this.addGlobalItem(GlobalItemTag.ReportSize, sizeInBits);

    let count = 1;
    if (item.count !== undefined) count = Number(item.count);
    this.addGlobalItem(GlobalItemTag.ReportCount, count);

    let flags = 0x02; // Variable
    if (item.reportFlags && Array.isArray(item.reportFlags)) {
      for (const flag of item.reportFlags) {
        const fs = (flag as string).toLowerCase();
        if (fs === 'constant') flags |= 0x01;
        else if (fs === 'relative') flags |= 0x04;
        else if (fs === 'wrap') flags |= 0x08;
        else if (fs === 'nonlinear') flags |= 0x10;
        else if (fs === 'nopreferred') flags |= 0x20;
        else if (fs === 'nullstate') flags |= 0x40;
        else if (fs === 'volatile') flags |= 0x80;
      }
    }
    this.addMainItem(reportType, flags);

    if (hasPhysical) {
      this.addGlobalItem(GlobalItemTag.PhysicalMinimum, 0);
      this.addGlobalItem(GlobalItemTag.PhysicalMaximum, 0);
    }
    if (hasUnit) this.addGlobalItem(GlobalItemTag.Unit, 0);
    if (hasUnitExponent) this.addGlobalItem(GlobalItemTag.UnitExponent, 0);
  }

  private processPaddingItem(item: any, reportType: MainItemTag): void {
    let sizeInBits = 0;
    if (item.sizeInBits !== undefined) {
      sizeInBits = Number(item.sizeInBits);
      if (sizeInBits <= 0 || sizeInBits > 32) this.throwError('sizeInBits', `'${sizeInBits}' invalid`);
    } else {
      this.throwError('sizeInBits', 'Size must be specified when logicalRange is absent');
    }
    this.addGlobalItem(GlobalItemTag.ReportSize, sizeInBits);
    this.addGlobalItem(GlobalItemTag.ReportCount, 1);
    this.addMainItem(reportType, 0x01); // Constant
  }

  private processArrayItem(item: any, reportType: MainItemTag): void {
    if (item.usageRange && Array.isArray(item.usageRange)) {
      const pageId = this.getUsagePageId(item.usageRange[0] || '');
      const uMin = this.getUsageId(pageId, item.usageRange[1] || '');
      const uMax = this.getUsageId(pageId, item.usageRange[2] || '');
      this.addGlobalItem(GlobalItemTag.UsagePage, pageId);
      this.addLocalItem(LocalItemTag.UsageMinimum, uMin);
      this.addLocalItem(LocalItemTag.UsageMaximum, uMax);
    }

    let logMin = 0, logMax = 1;
    if (item.logicalValueRange && Array.isArray(item.logicalValueRange)) {
      logMin = Number(item.logicalValueRange[0]);
      logMax = Number(item.logicalValueRange[1]);
    }
    this.addGlobalItem(GlobalItemTag.LogicalMinimum, logMin);
    this.addGlobalItem(GlobalItemTag.LogicalMaximum, logMax);

    let sizeInBits = 8;
    if (item.sizeInBits !== undefined) sizeInBits = Number(item.sizeInBits);
    this.addGlobalItem(GlobalItemTag.ReportSize, sizeInBits);

    let count = 1;
    if (item.count !== undefined) count = Number(item.count);
    this.addGlobalItem(GlobalItemTag.ReportCount, count);

    this.addMainItem(reportType, 0x00); // Array (no Variable flag)
  }

  // ── Item Encoding ──

  private calculateMinBits(minValue: number, maxValue: number): number {
    if (minValue >= 0) {
      let bits = 1;
      while ((1 << bits) - 1 < maxValue && bits < 32) bits++;
      return bits;
    } else {
      let bits = 2;
      while (bits < 32) {
        if (-(1 << (bits - 1)) <= minValue && ((1 << (bits - 1)) - 1) >= maxValue) return bits;
        bits++;
      }
      return 32;
    }
  }

  private getSizeCode(size: number): number {
    switch (size) {
      case 0: return 0;
      case 1: return 1;
      case 2: return 2;
      case 4: return 3;
      default: return 1;
    }
  }

  private addGlobalItem(tag: GlobalItemTag, value: number): void {
    const size = this.getMinimumSize(value);
    const prefix = (tag << 4) | (1 << 2) | this.getSizeCode(size);
    this._descriptor.push(prefix);
    this.addValueBytes(value, size);
    const tagName = GlobalItemTag[tag] || "0x" + tag.toString(16);
    const indent = "  ".repeat(this._indent);
    this._textOutput.push(indent + tagName + " (" + value + ")");
  }

  private addLocalItem(tag: LocalItemTag, value: number): void {
    const size = this.getMinimumSize(value);
    const prefix = (tag << 4) | (2 << 2) | this.getSizeCode(size);
    this._descriptor.push(prefix);
    this.addValueBytes(value, size);
    const tagName = LocalItemTag[tag] || "0x" + tag.toString(16);
    const indent = "  ".repeat(this._indent);
    this._textOutput.push(indent + tagName + " (" + value + ")");
  }

  private addMainItem(tag: MainItemTag, value: number | null): void {
    if (value !== null && value !== undefined) {
      const prefix = (tag << 4) | (0 << 2) | 1;
      this._descriptor.push(prefix);
      this._descriptor.push(value & 0xFF);
    } else {
      const prefix = (tag << 4) | (0 << 2) | 0;
      this._descriptor.push(prefix);
    }
    const tagName = MainItemTag[tag] || "0x" + tag.toString(16);
    const indent = "  ".repeat(this._indent);
    this._textOutput.push(indent + tagName + " (" + (value !== null && value !== undefined ? value : "") + ")");
  }

  private getMinimumSize(value: number): number {
    if (value >= -128 && value <= 127) return 1;
    if (value >= -32768 && value <= 32767) return 2;
    return 4;
  }

  private getSizeCode(size: number): number {
    switch (size) {
      case 0: return 0;
      case 1: return 1;
      case 2: return 2;
      case 4: return 3;
      default: return 1;
    }
  }

  private addValueBytes(value: number, size: number): void {
    switch (size) {
      case 1:
        this._descriptor.push(value & 0xFF);
        break;
      case 2:
        this._descriptor.push(value & 0xFF);
        this._descriptor.push((value >> 8) & 0xFF);
        break;
      case 4:
        this._descriptor.push(value & 0xFF);
        this._descriptor.push((value >> 8) & 0xFF);
        this._descriptor.push((value >> 16) & 0xFF);
        this._descriptor.push((value >> 24) & 0xFF);
        break;
    }
  }

  private formatDescriptorAsC(): string {
    const parts: string[] = [];
    for (let i = 0; i < this._descriptor.length; i++) {
      if (i % 16 === 0) parts.push('    ');
      parts.push(`0x${this._descriptor[i].toString(16).toUpperCase().padStart(2, '0')}`);
      if (i < this._descriptor.length - 1) parts.push(', ');
      if ((i + 1) % 16 === 0) parts.push('\n');
    }
    if (this._descriptor.length % 16 !== 0) parts.push('\n');
    return parts.join('');
  }

  // ── Usage Lookup ──

  private getUsagePageId(name: string): number {
    const map: Record<string, number> = {
      'Generic Desktop': 0x01, 'Simulation Controls': 0x02, 'VR Controls': 0x03,
      'Game Controls': 0x05, 'Button': 0x09, 'Keyboard': 0x07, 'Keyboard/Keypad': 0x07,
      'LED': 0x08, 'Telephony Device': 0x0B, 'Telephony': 0x0B,
      'Consumer': 0x0C, 'Digitizers': 0x0D, 'Digitizer': 0x0D,
      'Sensors': 0x20, 'Lighting And Illumination': 0x59,
    };
    const key = Object.keys(map).find(k => k.toLowerCase() === name.toLowerCase());
    if (key) return map[key];
    if (name.startsWith('0x')) return parseInt(name, 16);
    return 0;
  }

  private getUsageId(pageId: number, name: string): number {
    // Try the lookup from HidUsagePages first
    const result = TryGetUsageId(pageId, name);
    if (result !== null) return result;

    // Try parsing "Button N" format
    const btnMatch = name.match(/^Button\s+(\d+)$/i);
    if (btnMatch) {
      const num = parseInt(btnMatch[1], 10);
      if (num >= 1 && num <= 65535) return num;
    }

    // Try hex
    if (name.startsWith('0x')) {
      const val = parseInt(name, 16);
      if (!isNaN(val)) return val;
    }

    return 0;
  }

  private throwError(keyName: string, message: string): void {
    throw new Error(`Error @ '${keyName}': ${message}`);
  }
}
