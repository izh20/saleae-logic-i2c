import React, { useState, useCallback, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { HidI2cDescriptor, ReportField } from '../hid/types';
import { parseHexString } from '../hid/HidDescriptorFormatter';
import { parseDescriptor, generateMarkdown as generateDescMarkdown } from '../hid/HidI2cDescriptorParser';
import { parseDescriptor as parseReportDescriptor, formatCommentedHex } from '../hid/HidDescriptorParser';
import { analyzeReportItems, generateReportSummary } from '../hid/ReportAnalyzer';
import {
  parseTransactions, analyzeSequence, generateSequenceMarkdown, AnalysisResult,
} from '../hid/HidI2cSequenceAnalyzer';
import { parseAllFrames } from '../hid/ReportBatchParser';
import { generateWara } from '../hid/WaraGenerator';
import { WaraToDescriptorGenerator } from '../hid/WaraToDescriptorGenerator';

type SubTab = 'powerOn' | 'deviceDesc' | 'reportDesc' | 'reportDataParser';

function wrapHtml(body: string): string {
  return `<style>
  body{background:#1e1e1e;color:#d4d4d4;font-family:-apple-system,system-ui,sans-serif;font-size:13px;padding:12px;margin:0}
  table{border-collapse:collapse;width:100%;margin:8px 0;overflow-x:auto;display:block}
  th,td{border:1px solid #3c3c3c;padding:4px 8px;text-align:left;font-family:monospace;font-size:12px;white-space:nowrap}
  th{background:#252526;color:#6a9955;font-weight:bold}
  tr:nth-child(even){background:#252526} tr:nth-child(odd){background:#1e1e1e}
  h1{color:#569cd6;font-size:16px} h2{color:#569cd6;font-size:14px;margin-top:16px}
  h3{color:#ce9178;font-size:13px;margin-top:12px}
  code{background:#3c3c3c;padding:1px 4px;border-radius:2px}
  pre{background:#252526;padding:8px;border-radius:4px;overflow-x:auto}
  .warning{color:#f14c4c} .ok{color:#6a9955}
</style>${body}`;
}

const SAMPLE_DESC = '1E 00 00 01 67 07 00 00 00 00 03 00 00 00 04 00 00 00 05 00 00 00 16 04 8F 03 00 00 00 00';

const SEQ_SAMPLE = `write to 0x2C ack data: 0x20 0x00

read to 0x2C ack data: 0x1E 0x00 0x00 0x01 0xB4 0x04 0x02 0x00 0x03 0x00 0x2D 0x00 0x04 0x00 0x00 0x00 0x05 0x00 0x06 0x00 0xF3 0x04 0x55 0x33 0x10 0x00 0x00 0x00 0x00 0x00

write to 0x2C ack data: 0x05 0x00 0x00 0x08

write to 0x2C ack data: 0x05 0x00 0x00 0x01

read to 0x2C ack data: 0x00 0x00

write to 0x2C ack data: 0x02 0x00

read to 0x2C ack data: 0x05 0x01 0x09 0x02 0xA1 0x01 0x85 0x01 0x09 0x01 0xA1 0x00 0x05 0x09 0x19 0x01 0x29 0x02 0x15 0x00 0x25 0x01 0x75 0x01 0x95 0x02 0x81 0x02 0x95 0x06 0x81 0x03 0x05 0x01 0x09 0x30 0x09 0x31 0x15 0x81 0x25 0x7F 0x75 0x08 0x95 0x02 0x81 0x06 0x75 0x08 0x95 0x05 0x81 0x03 0xC0

write to 0x2C ack data: 0x05 0x00 0x33 0x02 0x06 0x00

read to 0x2C ack data: 0x05 0x00 0x03 0x00 0x00`;

// Sample from test-report-descriptor.txt — multi-touch digitizer + mouse
// Report ID 1 = Mouse (tested below), Report ID 4 = 5-finger touch digitizer
const REPORT_DATA_DESC_SAMPLE = '05 01 09 02 A1 01 85 01 09 01 A1 00 05 09 19 01 29 02 15 00 25 01 75 01 95 02 81 02 95 06 81 03 05 01 09 30 09 31 09 38 15 81 25 7F 75 08 95 03 81 06 05 0C 0A 38 02 95 01 81 06 75 08 95 03 81 03 C0 C0 05 0D 09 05 A1 01 85 04 05 0D 09 22 A1 02 15 00 25 01 09 47 09 42 95 02 75 01 81 02 75 01 95 02 81 03 95 01 75 04 25 0F 09 51 81 02 05 01 15 00 26 98 0C 75 10 55 0E 65 13 09 30 35 00 46 A7 01 95 01 81 02 46 02 01 26 AC 07 09 31 81 02 05 0D 55 0F 65 11 25 FF 45 FF 75 08 09 48 95 01 81 02 09 49 95 01 81 02 05 0D 09 30 55 0E 15 00 25 FF 75 08 95 01 81 02 C0 05 0D 09 22 A1 02 15 00 25 01 09 47 09 42 95 02 75 01 81 02 75 01 95 02 81 03 95 01 75 04 25 0F 09 51 81 02 05 01 15 00 26 98 0C 75 10 55 0E 65 13 09 30 35 00 46 A7 01 95 01 81 02 46 02 01 26 AC 07 09 31 81 02 05 0D 55 0F 65 11 25 FF 45 FF 75 08 09 48 95 01 81 02 09 49 95 01 81 02 05 0D 09 30 55 0E 15 00 25 FF 75 08 95 01 81 02 C0 05 0D 09 22 A1 02 15 00 25 01 09 47 09 42 95 02 75 01 81 02 75 01 95 02 81 03 95 01 75 04 25 0F 09 51 81 02 05 01 15 00 26 98 0C 75 10 55 0E 65 13 09 30 35 00 46 A7 01 95 01 81 02 46 02 01 26 AC 07 09 31 81 02 05 0D 55 0F 65 11 25 FF 45 FF 75 08 09 48 95 01 81 02 09 49 95 01 81 02 05 0D 09 30 55 0E 15 00 25 FF 75 08 95 01 81 02 C0 05 0D 09 22 A1 02 15 00 25 01 09 47 09 42 95 02 75 01 81 02 75 01 95 02 81 03 95 01 75 04 25 0F 09 51 81 02 05 01 15 00 26 98 0C 75 10 55 0E 65 13 09 30 35 00 46 A7 01 95 01 81 02 46 02 01 26 AC 07 09 31 81 02 05 0D 55 0F 65 11 25 FF 45 FF 75 08 09 48 95 01 81 02 09 49 95 01 81 02 05 0D 09 30 55 0E 15 00 25 FF 75 08 95 01 81 02 C0 05 0D 09 22 A1 02 15 00 25 01 09 47 09 42 95 02 75 01 81 02 75 01 95 02 81 03 95 01 75 04 25 0F 09 51 81 02 05 01 15 00 26 98 0C 75 10 55 0E 65 13 09 30 35 00 46 A7 01 95 01 81 02 46 02 01 26 AC 07 09 31 81 02 05 0D 55 0F 65 11 25 FF 45 FF 75 08 09 48 95 01 81 02 09 49 95 01 81 02 05 0D 09 30 55 0E 15 00 25 FF 75 08 95 01 81 02 C0 05 0D 55 0C 66 01 10 47 FF FF 00 00 27 FF FF 00 00 75 10 95 01 09 56 81 02 09 54 25 7F 95 01 75 08 81 02 05 09 09 01 25 01 75 01 95 01 81 02 95 07 81 03 05 0D 85 02 09 55 09 59 75 04 95 02 25 0F B1 02 85 07 09 60 75 01 95 01 15 00 25 01 B1 02 95 0F B1 03 06 00 FF 06 00 FF 85 06 09 C5 15 00 26 FF 00 75 08 96 00 01 B1 02 85 0D 09 C4 15 00 26 FF 00 75 08 95 04 B1 02 85 0C 09 C6 96 E0 02 75 08 B1 02 85 0B 09 C7 95 42 75 08 B1 02 C0 05 0D 09 0E A1 01 85 03 09 22 A1 00 09 52 15 00 25 0A 75 08 95 02 B1 02 C0 09 22 A1 00 85 05 09 57 09 58 15 00 75 01 95 02 25 03 B1 02 95 0E B1 03 C0 C0 06 00 FF 09 01 A1 01 85 0E 09 01 19 00 29 FF 15 00 25 FF 95 40 75 08 91 02 09 01 19 00 29 FF 15 00 25 FF 95 40 81 02 C0';
// Sample Report ID 1 (Mouse) frames matching the descriptor:
// Button1/2(2b)+Pad(6b) | X(s8) | Y(s8) | Wheel(s8) | AC_Pan(s8) | Pad×3
const REPORT_DATA_SAMPLE =
  `01 01 32 E2 00 00 00 00 00
01 00 00 00 00 00 00 00 00
01 03 FF 00 00 00 00 00 00
01 01 50 10 00 00 00 00 00
01 00 00 00 00 00 00 00 00`;

interface HidAnalysisViewProps {
  i2cAddress?: number;
}

const HidAnalysisView: React.FC<HidAnalysisViewProps> = ({ i2cAddress = 0x2C }) => {
  const [subTab, setSubTab] = useState<SubTab>('powerOn');

  // Tab 1: Power-On Sequence
  const [seqInput, setSeqInput] = useState('');
  const [seqAddr, setSeqAddr] = useState(i2cAddress.toString(16));
  const [seqReg, setSeqReg] = useState('0x01');
  const [seqHtml, setSeqHtml] = useState('');
  const [seqResult, setSeqResult] = useState<AnalysisResult | null>(null);

  // Tab 2: Device Descriptor
  const [descHex, setDescHex] = useState('');
  const [descHtml, setDescHtml] = useState('');

  // Tab 3: Report Descriptor
  const [reportDescHex, setReportDescHex] = useState('');
  const [reportDescHtml, setReportDescHtml] = useState('');
  const [reportFields, setReportFields] = useState<ReportField[]>([]);
  const [commentMode, setCommentMode] = useState(true);
  const [waraText, setWaraText] = useState('');
  const [showWaraEditor, setShowWaraEditor] = useState(false);
  const waraTextRef = useRef("");
  const reportDescHexRef = useRef("");
  const commentModeRef = useRef(true);
  useEffect(() => { waraTextRef.current = waraText; }, [waraText]);
  useEffect(() => { reportDescHexRef.current = reportDescHex; }, [reportDescHex]);
  useEffect(() => { commentModeRef.current = commentMode; }, [commentMode]);

  // Tab 4: Report Data Parser
  const [reportDataInput, setReportDataInput] = useState('');
  const [reportDataDescHex, setReportDataDescHex] = useState('');
  const [reportDataHtml, setReportDataHtml] = useState('');
  const [hasLenPrefix, setHasLenPrefix] = useState(false);
  const [reportDataAddrFilter, setReportDataAddrFilter] = useState('');
  const [reportDataDescStatus, setReportDataDescStatus] = useState('');

  // === Handlers ===

  const handleAnalyzeSeq = useCallback(() => {
    try {
      const addr = parseInt(seqAddr, 16);
      const reg = parseInt(seqReg, 16);
      const txns = parseTransactions(seqInput, addr);
      const result = analyzeSequence(txns, addr, reg);
      setSeqResult(result);

      if (result.reportDescriptorBytes.length > 0) {
        setReportDescHex(formatCommentedHex(result.reportDescriptorBytes));
        setReportFields(result.reportFields);
      }

      const md = generateSequenceMarkdown(result);
      const html = marked.parse(md) as string;
      setSeqHtml(wrapHtml(html));
    } catch (err) {
      console.error('Analyze sequence error:', err);
      setSeqHtml(wrapHtml(`<span class="warning">Analysis error: ${err}</span>`));
    }
  }, [seqInput, seqAddr, seqReg]);

  const handleParseDesc = useCallback(() => {
    const bytes = parseHexString(descHex);
    const desc = parseDescriptor(bytes);
    if (desc) {
      setDescHtml(wrapHtml(marked.parse(generateDescMarkdown(desc)) as string));
    } else {
      setDescHtml(wrapHtml('<span class="warning">Need 30 bytes of HID I2C descriptor.</span>'));
    }
  }, [descHex]);

  const handleParseReport = useCallback(() => {
    const bytes = parseHexString(reportDescHex);
    if (bytes.length === 0) {
      setReportDescHtml(wrapHtml('<span class="warning">No valid hex bytes.</span>'));
      return;
    }
    const items = parseReportDescriptor(bytes);
    const fields = analyzeReportItems(items);
    setReportFields(fields);
    let md = `## Report Descriptor\n\n**${items.length} items**, **${fields.length} fields**\n\n`;
    md += '### Items\n```\n' + formatCommentedHex(bytes) + '\n```\n\n';
    md += generateReportSummary(fields);
    setReportDescHtml(wrapHtml(marked.parse(md) as string));
  }, [reportDescHex]);

  const handleLoadDescriptor = useCallback(() => {
    try {
      const descBytes = parseHexString(reportDataDescHex);
      if (descBytes.length === 0) {
        setReportDataDescStatus('❌ No valid hex bytes');
        setReportDataHtml(wrapHtml('<span class="warning">Paste a report descriptor or click "Copy Desc from Tab 3".</span>'));
        return;
      }
      const items = parseReportDescriptor(descBytes);
      const fields = analyzeReportItems(items);
      setReportFields(fields);
      setReportDataDescStatus(`✅ Loaded (${descBytes.length} bytes, ${fields.length} fields)`);
    } catch (err) {
      console.error('Load descriptor error:', err);
      setReportDataDescStatus('❌ Load failed');
      setReportDataHtml(wrapHtml(`<span class="warning">Descriptor parse error: ${err}</span>`));
    }
  }, [reportDataDescHex]);

  const handleParseData = useCallback(() => {
    try {
      // First check descriptor is loaded
      const descBytes = parseHexString(reportDataDescHex);
      if (descBytes.length === 0) {
        setReportDataHtml(wrapHtml('<span class="warning">Please load Report Descriptor first.</span>'));
        return;
      }
      // Re-parse descriptor each time (in case fields changed)
      const items = parseReportDescriptor(descBytes);
      const fields = analyzeReportItems(items);

      const lines = reportDataInput.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) {
        setReportDataHtml(wrapHtml(`<span class="warning">No report data found. Paste report data bytes (one frame per line) into the lower textarea, or click "Load Sample" to load test data.</span>`));
        return;
      }

      // Parse optional address filter
      let addrFilter: number | null = null;
      const addrText = reportDataAddrFilter.trim();
      if (addrText) {
        const parsed = addrText.startsWith('0x') ? parseInt(addrText, 16) : parseInt(addrText, 16);
        if (!isNaN(parsed)) addrFilter = parsed;
      }

      const { groups, skipped } = parseAllFrames(lines, fields, hasLenPrefix, addrFilter);

      let total = 0;
      for (const [, frames] of groups) { total += frames.length; }

      let md = `## Report Data Analysis\n\n`;
      md += `**${total} frames** parsed from ${lines.length} lines`;

      if (groups.size > 0) {
        const ids = [...groups.keys()].sort((a, b) => a - b);
        md += ` (${groups.size} Report IDs: ${ids.map(id => `0x${id.toString(16).toUpperCase()}`).join(', ')})`;
      }
      if (skipped > 0) md += ` (filtered ${skipped} frames)`;
      md += `\n\n`;

      if (total === 0) {
        const msg = skipped > 0
          ? `⚠️ No matching frames found (filtered ${skipped} frames, address mismatch 0x${addrFilter?.toString(16).toUpperCase() || '??'})`
          : '⚠️ No valid data frames parsed';
        setReportDataHtml(wrapHtml(`<span class="warning">${msg}</span>`));
        return;
      }

      // Show field table for ALL frames of each Report ID
      for (const [rid, frames] of groups) {
        if (frames.length === 0) continue;
        md += `### Report ID ${rid.toString(16).toUpperCase().padStart(2, '0')}  (${frames.length} frames)\n\n`;

        // Build dynamic columns from the first frame's field names
        const fieldNames = Object.keys(frames[0].fields);
        if (fieldNames.length === 0) {
          md += '⚠️ No fields matched.\n\n';
          continue;
        }

        // Header row
        md += '| # |';
        for (const name of fieldNames) md += ` ${name} |`;
        md += '\n|---|';
        for (const _ of fieldNames) md += '---|';
        md += '\n';

        // Data rows
        for (let fi = 0; fi < frames.length; fi++) {
          const f = frames[fi];
          md += `| ${fi} |`;
          for (const name of fieldNames) {
            const val = f.fields[name];
            md += ` ${val !== undefined ? val : ''} |`;
          }
          md += '\n';
        }
        md += '\n';
      }

      setReportDataHtml(wrapHtml(marked.parse(md) as string));
    } catch (err) {
      console.error('Parse report data error:', err);
      setReportDataHtml(wrapHtml(`<span class="warning">Parse error: ${err}</span>`));
    }
  }, [reportDataDescHex, reportDataInput, hasLenPrefix, reportDataAddrFilter]);

  const handleToggleComment = useCallback(() => {
    if (!reportDescHex.trim()) return;
    try {
      const rawHex = reportDescHex.replace(/\/\/.*$/gm, '').replace(/0x/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
      const bytes = parseHexString(rawHex);
      if (bytes.length === 0) return;
      const newMode = !commentMode;
      setCommentMode(newMode);
      setReportDescHex(newMode ? formatCommentedHex(bytes) : bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    } catch { /* ignore */ }
  }, [reportDescHex, commentMode]);

  /** Desc → .wara: parse hex descriptor and show .wara in editor + result pane */
  const handleDescToWara = useCallback(() => {
    try {
      const hex = reportDescHexRef.current;
      const rawHex = hex.replace(/\/\/.*$/gm, "").replace(/0x/g, "").replace(/,/g, "").replace(/\s+/g, " ").trim();
      const bytes = parseHexString(rawHex);
      if (bytes.length === 0) {
        setWaraText("");
        setShowWaraEditor(true);
        setReportDescHtml(wrapHtml("<span class=\"warning\">No valid hex bytes to export.</span>"));
        return;
      }
      const items = parseReportDescriptor(bytes);
      const wara = generateWara(items);
      setWaraText(wara);
      setShowWaraEditor(true);
      setReportDescHtml(wrapHtml(`<h2>Exported .wara (TOML)</h2><pre style="white-space:pre-wrap;word-wrap:break-word;font-size:11px">${wara.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`));
    } catch (err) {
      setWaraText(`# Error: ${err}`);
      setShowWaraEditor(true);
      setReportDescHtml(wrapHtml(`<span class="warning">Export error: ${err}</span>`));
    }
  }, []);

  /** .wara → Desc: parse .wara TOML and generate hex descriptor */
  const handleWaraToDesc = useCallback(() => {
    try {
      const wt = waraTextRef.current;
      if (!wt.trim()) {
        setReportDescHtml(wrapHtml("<span class=\"warning\">No .wara content. Click Desc → .wara first or paste .wara TOML.</span>"));
        return;
      }
      const gen = new WaraToDescriptorGenerator();
      const result = gen.generate(wt);
      const hexStr = result.bytes.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
      setReportDescHex(commentModeRef.current ? formatCommentedHex(result.bytes) : hexStr);
      setShowWaraEditor(false);
      setReportDescHtml(wrapHtml(`<h2>Generated Descriptor (${result.bytes.length} bytes)</h2><pre style="font-size:11px">${result.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`));
    } catch (err) {
      setReportDescHtml(wrapHtml(`<span class="warning">.wara → Descriptor error: ${err}</span>`));
    }
  }, []);

  const copyFromTab3 = useCallback(() => {
    setReportDataDescHex(reportDescHex);
    setReportDataDescStatus('');
    setReportDataHtml('');
  }, [reportDescHex]);

  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden' }}>
      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:0, padding:'0 8px', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
        {(['powerOn','deviceDesc','reportDesc','reportDataParser'] as SubTab[]).map(key => (
          <button key={key} onClick={() => setSubTab(key)}
            style={{
              padding:'8px 16px', border:'none', cursor:'pointer', fontSize:12,
              background: subTab===key ? '#1e1e1e' : 'transparent',
              color: subTab===key ? '#d4d4d4' : '#858585',
              borderBottom: subTab===key ? '2px solid #6a9955' : '2px solid transparent',
              fontWeight: subTab===key ? 600 : 400,
            }}>
            {{powerOn:'Power-On Seq',deviceDesc:'Device Desc',reportDesc:'Report Desc',reportDataParser:'Report Data Parser'}[key]}
          </button>
        ))}
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* TAB 1: Power-On Sequence */}
        {subTab === 'powerOn' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <label style={{ fontSize:12, color:'#d4d4d4' }}>I2C Addr: <input value={seqAddr} onChange={e=>setSeqAddr(e.target.value)} style={{ width:50, background:'#3c3c3c', color:'#d4d4d4', border:'none', padding:'2px 4px', borderRadius:2, fontSize:12 }} /></label>
              <label style={{ fontSize:12, color:'#d4d4d4' }}>Desc Reg: <input value={seqReg} onChange={e=>setSeqReg(e.target.value)} style={{ width:50, background:'#3c3c3c', color:'#d4d4d4', border:'none', padding:'2px 4px', borderRadius:2, fontSize:12 }} /></label>
              <button onClick={handleAnalyzeSeq} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Analyze</button>
              <button onClick={()=>{setSeqInput(SEQ_SAMPLE);setSeqHtml('');setSeqResult(null);}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Sample</button>
              <button onClick={()=>{setSeqInput('');setSeqHtml('');setSeqResult(null);}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear</button>
            </div>
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              <textarea value={seqInput} onChange={e=>setSeqInput(e.target.value)} placeholder="Paste Saleae CSV export or I2C log..."
                style={{ flex:1, background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none' }} />
              <div style={{ flex:1, overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: seqHtml }} />
            </div>
          </div>
        )}

        {/* TAB 2: Device Descriptor */}
        {subTab === 'deviceDesc' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <button onClick={handleParseDesc} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Parse</button>
              <button onClick={()=>setDescHex(SAMPLE_DESC)} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Sample</button>
              <button onClick={()=>{setDescHex('');setDescHtml('');}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear</button>
            </div>
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              <textarea value={descHex} onChange={e=>setDescHex(e.target.value)} placeholder="Paste 30 hex bytes..."
                style={{ flex:1, background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none' }} />
              <div style={{ flex:1, overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: descHtml }} />
            </div>
          </div>
        )}

        {/* TAB 3: Report Descriptor */}
        {subTab === 'reportDesc' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <button onClick={handleParseReport} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Parse & Analyze</button>
              <button onClick={handleToggleComment} style={{ padding:'4px 12px', borderRadius:4, border:'none', background: commentMode?'#264f78':'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Comment: {commentMode ? 'ON' : 'OFF'}</button>
              <span style={{ width:1, height:20, background:'#3c3c3c' }} />
              <button onClick={handleDescToWara} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Desc → .wara</button>
              <button onClick={handleWaraToDesc} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>.wara → Desc</button>
              <button onClick={()=>{setReportDescHex('');setReportDescHtml('');setReportFields([]);setWaraText('');setShowWaraEditor(false);}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear All</button>
              <span style={{ fontSize:11, color:'#808080', marginLeft:'auto' }}>{reportFields.length>0 ? `${reportFields.length} fields` : ''}</span>
            </div>
            {showWaraEditor && (
              <div style={{ padding:'0 8px', background:'#1e1e1e', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
                <textarea value={waraText} onChange={e=>setWaraText(e.target.value)}
                  placeholder="Paste .wara (TOML) content here..."
                  style={{ width:'100%', height:140, background:'#252526', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:6, fontFamily:'monospace', fontSize:11, resize:'vertical', tabSize:4 }}
                />
              </div>
            )}
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              <textarea value={reportDescHex} onChange={e=>setReportDescHex(e.target.value)} placeholder="Paste HID Report Descriptor hex..."
                style={{ flex:1, background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none' }} />
              <div style={{ flex:1, overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: reportDescHtml }} />
            </div>
          </div>
        )}

        {/* TAB 4: Report Data Parser */}
        {subTab === 'reportDataParser' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <button onClick={handleLoadDescriptor} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Descriptor</button>
              <span style={{ fontSize:11, color:'#6a9955' }}>{reportDataDescStatus}</span>
              <span style={{ flex:1 }} />
              <label style={{ fontSize:12, color:'#d4d4d4' }}>Addr: <input value={reportDataAddrFilter} onChange={e=>setReportDataAddrFilter(e.target.value)} placeholder="e.g. 0x2C"
                style={{ width:60, background:'#3c3c3c', color:'#d4d4d4', border:'none', padding:'2px 4px', borderRadius:2, fontSize:12 }} /></label>
              <label style={{ fontSize:12, color:'#d4d4d4', display:'flex', alignItems:'center', gap:4 }}>
                <input type="checkbox" checked={hasLenPrefix} onChange={e=>setHasLenPrefix(e.target.checked)} />
                2-byte len prefix
              </label>
              <button onClick={copyFromTab3} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Copy Desc from Tab 3</button>
              <button onClick={()=>{setReportDataDescHex(REPORT_DATA_DESC_SAMPLE);setReportDataInput(REPORT_DATA_SAMPLE);setHasLenPrefix(false);setReportDataAddrFilter('');setReportDataHtml('');setReportDataDescStatus('');}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Sample</button>
            </div>
            <div style={{ padding:'4px 8px', background:'#1e1e1e', borderBottom:'1px solid #3c3c3c' }}>
              <textarea value={reportDataDescHex} onChange={e=>setReportDataDescHex(e.target.value)} placeholder="Report Descriptor hex..."
                style={{ width:'100%', height:50, background:'#252526', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:4, fontFamily:'monospace', fontSize:12, resize:'vertical' }} />
            </div>
            <div style={{ padding:'4px 8px', display:'flex', gap:8, alignItems:'center', background:'#1e1e1e', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <button onClick={handleParseData} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Parse Report Data</button>
              <button onClick={()=>{setReportDataInput('');setReportDataHtml('');}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear</button>
            </div>
            <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
              <textarea value={reportDataInput} onChange={e=>setReportDataInput(e.target.value)} placeholder="Paste report data bytes (one frame per line)..."
                style={{ flex:1, background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none' }} />
              <div style={{ flex:1, overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: reportDataHtml }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HidAnalysisView;
