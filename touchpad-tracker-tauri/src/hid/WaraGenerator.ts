// WaraGenerator — Converts parsed HID items into .wara (TOML) descriptor format.
// Ported from Waratah C# WaraGenerator.cs

import { HidItem, HidItemType } from './types';
import {
  GlobalItemTag, LocalItemTag, MainItemTag, CollectionType,
  MAIN_FLAG_CONSTANT, MAIN_FLAG_VARIABLE, MAIN_FLAG_RELATIVE,
  MAIN_FLAG_WRAP, MAIN_FLAG_NONLINEAR, MAIN_FLAG_NO_PREFERRED,
  MAIN_FLAG_NULL_STATE, MAIN_FLAG_VOLATILE,
} from './HidConstants';
import {
  getUsagePageName, getUsageName, getCollectionTypeName,
} from './HidUsagePages';

enum NodeKind { Root, Collection, DataItem }

interface TreeNode {
  nodeType: NodeKind;
  collType?: CollectionType;
  mainTag?: MainItemTag;
  flags: number;
  usagePage: number;
  usage: number;
  usages: number[];
  usageMin: number;
  usageMax: number;
  hasUsageRange: boolean;
  logicalMin: number;
  logicalMax: number;
  hasLogical: boolean;
  physicalMin: number;
  physicalMax: number;
  hasPhysical: boolean;
  reportSize: number;
  reportCount: number;
  reportId: number;
  unit: number;
  hasUnit: boolean;
  unitExponent: number;
  children: TreeNode[];
}

function createTreeNode(type: NodeKind): TreeNode {
  return {
    nodeType: type, collType: undefined, mainTag: undefined,
    flags: 0, usagePage: 0, usage: 0,
    usages: [], usageMin: 0, usageMax: 0, hasUsageRange: false,
    logicalMin: 0, logicalMax: 0, hasLogical: false,
    physicalMin: 0, physicalMax: 0, hasPhysical: false,
    reportSize: 0, reportCount: 0, reportId: 0,
    unit: 0, hasUnit: false, unitExponent: 0,
    children: [],
  };
}

interface GlobalState {
  usagePage: number;
  logicalMin: number;
  logicalMax: number;
  hasLogical: boolean;
  physicalMin: number;
  physicalMax: number;
  hasPhysical: boolean;
  reportSize: number;
  reportCount: number;
  reportId: number;
  unit: number;
  hasUnit: boolean;
  unitExponent: number;
}

function createGlobalState(): GlobalState {
  return {
    usagePage: 0, logicalMin: 0, logicalMax: 0, hasLogical: false,
    physicalMin: 0, physicalMax: 0, hasPhysical: false,
    reportSize: 0, reportCount: 0, reportId: 0,
    unit: 0, hasUnit: false, unitExponent: 0,
  };
}

interface LocalState {
  usages: number[];
  usageMin: number;
  usageMax: number;
  hasRange: boolean;
}

function createLocalState(): LocalState {
  return { usages: [], usageMin: 0, usageMax: 0, hasRange: false };
}

interface ParserState {
  root: TreeNode;
  currentCollection: TreeNode;
  collectionStack: TreeNode[];
  global: GlobalState;
  local: LocalState;
}

function createParserState(): ParserState {
  const root = createTreeNode(NodeKind.Root);
  return {
    root,
    currentCollection: root,
    collectionStack: [],
    global: createGlobalState(),
    local: createLocalState(),
  };
}

interface ReportSection {
  reportType: string;
  usageRelation?: number;
  usageRelationPage: number;
  reportId: number;
  items: TreeNode[];
}

function processGlobal(item: HidItem, state: ParserState): void {
  switch (item.tag) {
    case GlobalItemTag.UsagePage:
      state.global.usagePage = item.unsignedValue; break;
    case GlobalItemTag.LogicalMinimum:
      state.global.logicalMin = item.signedValue; state.global.hasLogical = true; break;
    case GlobalItemTag.LogicalMaximum:
      state.global.logicalMax = item.signedValue; state.global.hasLogical = true; break;
    case GlobalItemTag.PhysicalMinimum:
      state.global.physicalMin = item.signedValue; state.global.hasPhysical = true; break;
    case GlobalItemTag.PhysicalMaximum:
      state.global.physicalMax = item.signedValue; state.global.hasPhysical = true; break;
    case GlobalItemTag.ReportSize:
      state.global.reportSize = item.unsignedValue; break;
    case GlobalItemTag.ReportCount:
      state.global.reportCount = item.unsignedValue; break;
    case GlobalItemTag.ReportId:
      state.global.reportId = item.unsignedValue; break;
    case GlobalItemTag.Unit:
      state.global.unit = item.unsignedValue; state.global.hasUnit = true; break;
    case GlobalItemTag.UnitExponent:
      state.global.unitExponent = item.signedValue; break;
  }
}

function processLocal(item: HidItem, state: ParserState): void {
  switch (item.tag) {
    case LocalItemTag.Usage:
      state.local.usages.push(item.unsignedValue); break;
    case LocalItemTag.UsageMinimum:
      state.local.usageMin = item.unsignedValue; state.local.hasRange = true; break;
    case LocalItemTag.UsageMaximum:
      state.local.usageMax = item.unsignedValue; state.local.hasRange = true; break;
  }
}

function processMain(item: HidItem, state: ParserState): void {
  switch (item.tag) {
    case MainItemTag.Collection: {
      const colType = item.unsignedValue as CollectionType;
      const node = createTreeNode(NodeKind.Collection);
      node.collType = colType;
      node.usagePage = state.global.usagePage;
      node.usage = state.local.usages.length > 0
        ? state.local.usages[state.local.usages.length - 1] : 0;
      state.currentCollection.children.push(node);
      state.collectionStack.push(state.currentCollection);
      state.currentCollection = node;
      state.local = createLocalState();
      break;
    }
    case MainItemTag.EndCollection:
      if (state.collectionStack.length > 0) {
        state.currentCollection = state.collectionStack.pop()!;
      }
      state.global.hasPhysical = false;
      state.global.physicalMin = 0;
      state.global.physicalMax = 0;
      state.global.hasUnit = false;
      state.global.unit = 0;
      state.global.unitExponent = 0;
      break;
    case MainItemTag.Input:
    case MainItemTag.Output:
    case MainItemTag.Feature: {
      const dataNode = createTreeNode(NodeKind.DataItem);
      dataNode.mainTag = item.tag as MainItemTag;
      dataNode.flags = item.unsignedValue;
      dataNode.usagePage = state.global.usagePage;
      dataNode.logicalMin = state.global.logicalMin;
      dataNode.logicalMax = state.global.logicalMax;
      dataNode.hasLogical = state.global.hasLogical;
      dataNode.physicalMin = state.global.physicalMin;
      dataNode.physicalMax = state.global.physicalMax;
      dataNode.hasPhysical = state.global.hasPhysical;
      dataNode.reportSize = state.global.reportSize;
      dataNode.reportCount = state.global.reportCount;
      dataNode.reportId = state.global.reportId;
      dataNode.unit = state.global.unit;
      dataNode.hasUnit = state.global.hasUnit;
      dataNode.unitExponent = state.global.unitExponent;
      dataNode.usages.push(...state.local.usages);
      dataNode.usageMin = state.local.usageMin;
      dataNode.usageMax = state.local.usageMax;
      dataNode.hasUsageRange = state.local.hasRange;
      state.currentCollection.children.push(dataNode);
      state.local = createLocalState();
      break;
    }
  }
}

function buildTree(items: HidItem[], state: ParserState): void {
  for (const item of items) {
    switch (item.itemType) {
      case HidItemType.Global: processGlobal(item, state); break;
      case HidItemType.Local: processLocal(item, state); break;
      case HidItemType.Main: processMain(item, state); break;
    }
  }
}

function emitTree(root: TreeNode, sb: string[]): void {
  for (const child of root.children) {
    if (child.nodeType === NodeKind.Collection && child.collType === CollectionType.Application) {
      emitApplicationCollection(child, sb);
    }
  }
}

function emitApplicationCollection(appCol: TreeNode, sb: string[]): void {
  sb.push('[[applicationCollection]]');
  sb.push(`usage = ['${getPageName(appCol.usagePage)}', '${getUsageNameForWara(appCol.usagePage, appCol.usage)}']`);
  sb.push('');

  const reportSections = groupByReportSections(appCol);
  for (const section of reportSections) {
    const rn = getReportSectionName(section.reportType);
    sb.push(`    [[applicationCollection.${rn}]]`);
    if (section.reportId > 0) sb.push(`    id = ${section.reportId}`);
    if (section.usageRelation !== undefined) {
      sb.push(`    usageRelation = ['${getPageName(section.usageRelationPage)}', '${getUsageNameForWara(section.usageRelationPage, section.usageRelation)}']`);
    }
    sb.push('');
    emitReportContent(section.items, sb, 'applicationCollection', rn, '        ');
  }
}

function groupByReportSections(appCol: TreeNode): ReportSection[] {
  const sections: ReportSection[] = [];
  for (const child of appCol.children) {
    if (child.nodeType === NodeKind.Collection &&
        child.collType === CollectionType.Physical &&
        child.usagePage === 0x20) {
      const subGroups = new Map<string, ReportSection>();
      const orderedTypes: string[] = [];
      for (const inner of child.children) {
        const rt = getReportTypeForNode(inner);
        if (!subGroups.has(rt)) {
          subGroups.set(rt, { reportType: rt, usageRelation: child.usage, usageRelationPage: child.usagePage, reportId: getReportIdForNode(inner), items: [] });
          orderedTypes.push(rt);
        }
        subGroups.get(rt)!.items.push(inner);
      }
      for (const rt of orderedTypes) sections.push(subGroups.get(rt)!);
    } else {
      const rt = getReportTypeForNode(child);
      const rid = getReportIdForNode(child);
      const last = sections.length > 0 ? sections[sections.length - 1] : null;
      const isLL = child.nodeType === NodeKind.Collection && child.collType === CollectionType.Logical;
      if (!last || last.reportType !== rt || last.usageRelation !== undefined || last.reportId !== rid || isLL) {
        sections.push({ reportType: rt, reportId: rid, usageRelationPage: 0, items: [] });
      }
      sections[sections.length - 1].items.push(child);
    }
  }
  return sections;
}

function getReportTypeForNode(node: TreeNode): string {
  if (node.nodeType === NodeKind.DataItem && node.mainTag !== undefined) {
    switch (node.mainTag) {
      case MainItemTag.Input: return 'input';
      case MainItemTag.Output: return 'output';
      case MainItemTag.Feature: return 'feature';
    }
  } else if (node.nodeType === NodeKind.Collection) {
    const fd = findFirstDataItem(node);
    if (fd && fd.mainTag !== undefined) {
      switch (fd.mainTag) {
        case MainItemTag.Input: return 'input';
        case MainItemTag.Output: return 'output';
        case MainItemTag.Feature: return 'feature';
      }
    }
  }
  return 'input';
}

function findFirstDataItem(node: TreeNode): TreeNode | null {
  for (const c of node.children) {
    if (c.nodeType === NodeKind.DataItem) return c;
    const f = findFirstDataItem(c);
    if (f) return f;
  }
  return null;
}

function getReportIdForNode(node: TreeNode): number {
  if (node.nodeType === NodeKind.DataItem) return node.reportId;
  const fd = findFirstDataItem(node);
  return fd?.reportId ?? 0;
}

function emitReportContent(items: TreeNode[], sb: string[], basePath: string, reportSection: string, indent: string): void {
  for (const item of items) {
    if (item.nodeType === NodeKind.Collection) {
      emitNestedCollection(item, sb, basePath, reportSection, indent);
    } else if (item.nodeType === NodeKind.DataItem) {
      emitDataItem(item, sb, basePath, reportSection, indent, '');
    }
  }
}

function emitNestedCollection(col: TreeNode, sb: string[], basePath: string, reportSection: string, indent: string): void {
  const cn = getCollTypeName(col.collType!);
  const fp = `${basePath}.${reportSection}.${cn}`;
  sb.push(`${indent}[[${fp}]]`);
  sb.push(`${indent}usage = ['${getPageName(col.usagePage)}', '${getUsageNameForWara(col.usagePage, col.usage)}']`);
  sb.push('');
  const ci = indent + '    ';
  for (const c of col.children) {
    if (c.nodeType === NodeKind.DataItem) {
      emitDataItem(c, sb, basePath, reportSection, ci, cn);
    } else if (c.nodeType === NodeKind.Collection) {
      const icn = getCollTypeName(c.collType!);
      const ip = `${fp}.${icn}`;
      sb.push(`${ci}[[${ip}]]`);
      sb.push(`${ci}usage = ['${getPageName(c.usagePage)}', '${getUsageNameForWara(c.usagePage, c.usage)}']`);
      sb.push('');
      const ici = ci + '    ';
      for (const ic of c.children) {
        if (ic.nodeType === NodeKind.DataItem) {
          emitDataItem(ic, sb, basePath, reportSection, ici, `${cn}.${icn}`);
        }
      }
    }
  }
}

function emitDataItem(item: TreeNode, sb: string[], basePath: string, reportSection: string, indent: string, collectionSuffix: string): void {
  const flags = item.flags;
  const isConst = !!(flags & MAIN_FLAG_CONSTANT);
  const isVar = !!(flags & MAIN_FLAG_VARIABLE);
  const itemType = (isConst && !isVar) ? 'paddingItem' : isVar ? 'variableItem' : 'arrayItem';
  let pb = `${basePath}.${reportSection}`;
  if (collectionSuffix) pb += `.${collectionSuffix}`;
  sb.push(`${indent}[[${pb}.${itemType}]]`);
  if (isConst && !isVar) {
    sb.push(`${indent}sizeInBits = ${item.reportSize * item.reportCount}`);
  } else if (isVar) {
    emitVariableItem(item, sb, indent);
  } else {
    emitArrayItem(item, sb, indent);
  }
  sb.push('');
}

function emitVariableItem(item: TreeNode, sb: string[], indent: string): void {
  const flags = item.flags;
  const isRel = !!(flags & MAIN_FLAG_RELATIVE);
  const pn = getPageName(item.usagePage);
  let isUT = false;
  if (item.usages.length > 0) {
    const uid = item.usages[item.usages.length - 1];
    const mod = uid & 0xF000;
    if (mod === 0x1000 || mod === 0x2000 || mod === 0x3000) {
      const baseId = uid & 0x0FFF;
      sb.push(`${indent}usageTransform = ['${pn}', '${getUsageName(item.usagePage, baseId)}', '${getUsageName(item.usagePage, mod)}']`);
      isUT = true;
    }
  }
  if (!isUT) {
    if (item.hasUsageRange) {
      sb.push(`${indent}usageRange = ['${pn}', '${getUsageNameForWara(item.usagePage, item.usageMin)}', '${getUsageNameForWara(item.usagePage, item.usageMax)}']`);
    } else if (item.usages.length > 0) {
      sb.push(`${indent}usage = ['${pn}', '${getUsageNameForWara(item.usagePage, item.usages[item.usages.length - 1])}']`);
    }
  }
  const sb_ = item.reportSize;
  const lmin = item.logicalMin, lmax = item.logicalMax;
  const ms = isMaxSignedRange(lmin, lmax, sb_);
  const mu = isMaxUnsignedRange(lmin, lmax, sb_) && !isUT;
  const ci = canInferSize(lmin, lmax, sb_);
  const fe = item.usagePage === 0x59;
  if ((!!(flags & MAIN_FLAG_CONSTANT) || fe) && mu) {
    sb.push(`${indent}sizeInBits = ${sb_}`);
    sb.push(`${indent}logicalValueRange = 'maxUnsignedSizeRange'`);
  } else if (ms || mu) {
    sb.push(`${indent}sizeInBits = ${sb_}`);
    if (ms) sb.push(`${indent}logicalValueRange = 'maxSignedSizeRange'`);
  } else if (ci && item.hasLogical) {
    sb.push(`${indent}logicalValueRange = [${formatInt(lmin)}, ${formatInt(lmax)}]`);
  } else if (!item.hasLogical || (lmin === 0 && lmax === 0)) {
    sb.push(`${indent}sizeInBits = ${sb_}`);
  } else {
    sb.push(`${indent}logicalValueRange = [${formatInt(lmin)}, ${formatInt(lmax)}]`);
    sb.push(`${indent}sizeInBits = ${sb_}`);
  }
  if (item.hasPhysical && (item.physicalMin !== 0 || item.physicalMax !== 0)) {
    sb.push(`${indent}physicalValueRange = [${item.physicalMin}, ${item.physicalMax}]`);
  }
  if (item.hasUnit && item.unit !== 0) {
    const us = getUnitString(item.unit, item.unitExponent);
    if (us) sb.push(`${indent}unit = '${us}'`);
  }
  if (item.unitExponent !== 0 && (!item.hasUnit || item.unit === 0)) {
    let exp = item.unitExponent;
    if (exp > 7) exp -= 16;
    sb.push(`${indent}usageUnitMultiplier = ${Math.pow(10, exp)}`);
  }
  if (item.reportCount > 1) sb.push(`${indent}count = ${item.reportCount}`);

  const rfs: string[] = [];
  if (!!(flags & MAIN_FLAG_CONSTANT)) rfs.push('constant');
  if (isRel) rfs.push('relative');
  if (!!(flags & MAIN_FLAG_WRAP)) rfs.push('wrap');
  if (!!(flags & MAIN_FLAG_NONLINEAR)) rfs.push('nonLinear');
  if (!!(flags & MAIN_FLAG_NO_PREFERRED)) rfs.push('noPreferred');
  if (!!(flags & MAIN_FLAG_NULL_STATE)) rfs.push('nullState');
  if (!!(flags & MAIN_FLAG_VOLATILE)) rfs.push('volatile');
  if (rfs.length > 0) sb.push(`${indent}reportFlags = [${rfs.map(f => "'" + f + "'").join(', ')}]`);
}

function emitArrayItem(item: TreeNode, sb: string[], indent: string): void {
  const pn = getPageName(item.usagePage);
  if (item.hasUsageRange) {
    sb.push(`${indent}usageRange = ['${pn}', '${getUsageNameForWara(item.usagePage, item.usageMin)}', '${getUsageNameForWara(item.usagePage, item.usageMax)}']`);
  }
  if (item.reportCount > 1) sb.push(`${indent}count = ${item.reportCount}`);
}

function isMaxSignedRange(lmin: number, lmax: number, size: number): boolean {
  if (size < 8 || size > 32) return false;
  return lmin === -(1 << (size-1)) && lmax === ((1 << (size-1)) - 1);
}
function isMaxUnsignedRange(lmin: number, lmax: number, size: number): boolean {
  if (size !== 8 && size !== 16 && size !== 32) return false;
  return lmin === 0 && lmax === ((1 << size) - 1);
}
function canInferSize(lmin: number, lmax: number, actual: number): boolean {
  return calculateMinBits(lmin, lmax) === actual;
}
function calculateMinBits(min: number, max: number): number {
  if (min >= 0) {
    let b = 1;
    while ((1 << b) - 1 < max && b < 32) b++;
    return b;
  } else {
    let b = 2;
    while (b < 32) {
      if (-(1 << (b-1)) <= min && ((1 << (b-1)) - 1) >= max) return b;
      b++;
    }
    return 32;
  }
}
function getUnitString(u: number, _e: number): string | null {
  if (u === 0x14) return 'degrees';
  if (u === 0x11) return 'centimeter';
  if (u === 0x13) return 'inch';
  return null;
}
function formatInt(v: number): string {
  if (v < 0) return v.toString();
  const uv = v >>> 0;
  if (uv >= 0xFFF && isNibbleAlignedMax(uv)) return `0x${uv.toString(16).toUpperCase()}`;
  return v.toString();
}
function isNibbleAlignedMax(v: number): boolean {
  let t = v + 1;
  if (t === 0) return true;
  if ((t & (t-1)) !== 0) return false;
  let b = 0;
  while (t > 1) { t >>= 1; b++; }
  return b % 4 === 0;
}
function getCollTypeName(ct: CollectionType): string {
  switch (ct) {
    case CollectionType.Physical: return 'physicalCollection';
    case CollectionType.Logical: return 'logicalCollection';
    case CollectionType.Application: return 'applicationCollection';
    case CollectionType.Report: return 'reportCollection';
    case CollectionType.NamedArray: return 'namedArrayCollection';
    case CollectionType.UsageSwitch: return 'usageSwitchCollection';
    case CollectionType.UsageModifier: return 'usageModifierCollection';
    default: return 'collection';
  }
}
function getReportSectionName(rt: string): string {
  switch (rt) { case 'input': return 'inputReport'; case 'output': return 'outputReport'; case 'feature': return 'featureReport'; default: return 'inputReport'; }
}
function getPageName(pid: number): string { return getUsagePageName(pid); }
function getUsageNameForWara(pid: number, uid: number): string {
  const n = getUsageName(pid, uid);
  if (!n || n.startsWith('0x')) return `0x${uid.toString(16).toUpperCase().padStart(4, '0')}`;
  return n;
}

export function generateWara(items: HidItem[]): string {
  const state = createParserState();
  buildTree(items, state);
  const sb: string[] = [];
  if (state.root.children.length > 0 && state.root.children[0].usagePage === 0x59) {
    sb.push('[[settings]]'); sb.push('packingInBytes = 1'); sb.push('');
  }
  emitTree(state.root, sb);
  return sb.join('\n');
}
