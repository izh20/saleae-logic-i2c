import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { HidI2cDescriptor, ReportField } from '../hid/types';
import { parseHexString, formatFieldValue } from '../hid/HidDescriptorFormatter';
import { parseDescriptor, generateMarkdown as generateDescMarkdown } from '../hid/HidI2cDescriptorParser';
import { parseDescriptor as parseReportDescriptor, formatCommentedHex } from '../hid/HidDescriptorParser';
import { analyzeReportItems, generateReportSummary } from '../hid/ReportAnalyzer';
import {
  parseTransactions, analyzeSequence, generateSequenceMarkdown, AnalysisResult,
  LiveHidAnalyzer, I2cTransaction, HidI2cEvent, liveSequenceEventsToResult,
} from '../hid/HidI2cSequenceAnalyzer';
import { parseAllFrames } from '../hid/ReportBatchParser';
import { parseSingleFrame } from '../hid/HidReportDataParser';
// (FingerFrame is consumed via the type declaration file; no runtime import needed here)
import { generateWara } from '../hid/WaraGenerator';
import { WaraToDescriptorGenerator } from '../hid/WaraToDescriptorGenerator';

type SubTab = 'powerOn' | 'deviceDesc' | 'reportDesc' | 'reportDataParser' | 'liveSequence';

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

// ── Persistence helpers (renderer-side localStorage) ──
// Each HID Analysis input field is auto-saved to localStorage so the user
// can resume work after closing/reopening the app without re-pasting.
// localStorage is keyed by a stable 'hid-analysis:<tab>:<field>' namespace.

const STORAGE_PREFIX = 'hid-analysis:';

function loadStoredString(key: string, defaultValue: string): string {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + key);
    return v === null ? defaultValue : v;
  } catch {
    return defaultValue;
  }
}

function loadStoredBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + key);
    if (v === null) return defaultValue;
    return v === 'true' || v === '1';
  } catch {
    return defaultValue;
  }
}

function saveStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    /* quota exceeded or storage disabled — silently ignore */
  }
}

function saveStoredBool(key: string, value: boolean): void {
  saveStoredString(key, value ? 'true' : 'false');
}

// Simple resizable split pane
const ResizableSplit: React.FC<{
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  children: [React.ReactNode, React.ReactNode];
  style?: React.CSSProperties;
}> = ({ direction, defaultSize, children, style }) => {
  const [size, setSize] = useState(defaultSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const startSize = size;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = (direction === 'horizontal' ? ev.clientX : ev.clientY) - startPos;
      setSize(Math.max(30, startSize + delta));
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const isHoriz = direction === 'horizontal';

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden', ...style, height: '100%' }}>
      <div style={{ flex: `0 0 ${size}px`, overflow: 'auto' }}>{children[0]}</div>
      <div
        onMouseDown={handleMouseDown}
        style={{
          flex: '0 0 5px',
          cursor: 'col-resize',
          background: '#3c3c3c',
          backgroundImage: 'linear-gradient(180deg, transparent 40%, #6a9955 40%, #6a9955 60%, transparent 60%)',
          backgroundSize: '100% 20px',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          userSelect: 'none',
        }}
      />
      <div style={{ flex: '1 1 0', overflow: 'auto' }}>{children[1]}</div>
    </div>
  );
};

// Module-level refs for live data (FrameListView pattern: store in ref, counter triggers render)
const liveFramesRef = { current: [] as LiveFrameEntry[] };
const liveRawInputRef = { current: '' };

interface LiveFrameEntry {
  reportId: number;
  rawHex: string;
  fields: Record<string, { value: number; bitSize: number }>;
}

const RawDataView = React.memo<{
  isListening: boolean;
  reportDataInput: string;
  setReportDataInput: (v: string) => void;
  tick: number;
}>(({ isListening, reportDataInput, setReportDataInput, tick }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Auto-scroll to bottom while listening (live stream appends to the textarea).
  useEffect(() => {
    if (isListening && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [isListening, tick]);
  const value = isListening ? liveRawInputRef.current : reportDataInput;
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={e => setReportDataInput(e.target.value)}
      placeholder="Paste report data bytes (one frame per line)..."
      style={{ width:'100%', height:'100%', background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none', boxSizing:'border-box' }}
    />
  );
});

const ROW_H = 22;
const BUFFER = 10;

const Row = React.memo<{ f: LiveFrameEntry; i: number; names: string[] }>(({ f, i, names }) => (
  <tr style={{ background: i % 2 === 0 ? '#1e1e1e' : '#252526' }}>
    <td style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, color:'#858585', whiteSpace:'nowrap' }}>{i}</td>
    <td style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, color:'#ce9178', whiteSpace:'nowrap' }}>0x{f.reportId.toString(16).toUpperCase().padStart(2,'0')}</td>
    {names.map(n => (
      <td key={n} style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, textAlign:'right', color:'#d4d4d4', whiteSpace:'nowrap' }}>
        {f.fields[n] !== undefined ? formatFieldValue(f.fields[n].value, f.fields[n].bitSize) : ''}
      </td>
    ))}
  </tr>
));

const LiveFrameTable = React.memo<{ tick: number }>(({ tick }) => {
  const frames = liveFramesRef.current;
  const latest = frames.length > 0 ? frames[frames.length - 1] : null;
  const fieldNames = latest ? Object.keys(latest.fields) : [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewH, setViewH] = useState(300);
  const [scrollTop, setScrollTop] = useState(0);
  const totalH = frames.length * ROW_H;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [tick]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
      setViewH(scrollRef.current.clientHeight);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
    el.addEventListener('scroll', handleScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => { el.removeEventListener('scroll', handleScroll); ro.disconnect(); };
  }, [handleScroll]);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx = Math.min(frames.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);
  const visibleRows = frames.slice(startIdx, endIdx);
  // container fills viewport even when few rows exist
  const containerH = Math.max(totalH, viewH);

  return (
    <div style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: '#6a9955', padding: '8px 8px 0 8px', flexShrink: 0 }}>Live: {frames.length} frames</div>
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', padding: '0' }}>
        {frames.length > 0 && (
          <div style={{ height: containerH, position: 'relative' }}>
            <table style={{ borderCollapse: 'collapse', position: 'absolute', top: startIdx * ROW_H, left: 0 }}>
              <thead>
                <tr style={{ background: '#252526' }}>
                  <th style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, textAlign:'left', color:'#6a9955', position:'sticky', top:0, background:'#252526', zIndex:1, whiteSpace:'nowrap' }}>#</th>
                  <th style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, textAlign:'left', color:'#6a9955', position:'sticky', top:0, background:'#252526', zIndex:1, whiteSpace:'nowrap' }}>Report ID</th>
                  {fieldNames.map(n => <th key={n} style={{ border:'1px solid #3c3c3c', padding:'2px 6px', fontSize:11, textAlign:'right', color:'#6a9955', position:'sticky', top:0, background:'#252526', zIndex:1, whiteSpace:'nowrap' }}>{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((f, i) => <Row key={startIdx + i} f={f} i={startIdx + i} names={fieldNames} />)}
              </tbody>
            </table>
          </div>
        )}
        {frames.length === 0 && <div style={{ fontSize: 12, color: '#858585', padding: 8 }}>Waiting for data...</div>}
      </div>
    </div>
  );
});

interface HidAnalysisViewProps {
  i2cAddress?: number;
}

const HidAnalysisView: React.FC<HidAnalysisViewProps> = ({ i2cAddress = 0x2C }) => {
  const [subTab, setSubTab] = useState<SubTab>('powerOn');

  // Tab 1: Power-On Sequence
  const [seqInput, setSeqInput] = useState(() => loadStoredString('tab1:seqInput', ''));
  const [seqAddr, setSeqAddr] = useState(() => loadStoredString('tab1:seqAddr', i2cAddress.toString(16)));
  const [seqReg, setSeqReg] = useState(() => loadStoredString('tab1:seqReg', '0x01'));
  const [seqHtml, setSeqHtml] = useState('');
  const [seqResult, setSeqResult] = useState<AnalysisResult | null>(null);

  // Tab 2: Device Descriptor
  const [descHex, setDescHex] = useState(() => loadStoredString('tab2:descHex', ''));
  const [descHtml, setDescHtml] = useState('');

  // Tab 3: Report Descriptor
  const [reportDescHex, setReportDescHex] = useState(() => loadStoredString('tab3:reportDescHex', ''));
  const [reportDescHtml, setReportDescHtml] = useState('');
  const [reportFields, setReportFields] = useState<ReportField[]>([]);
  const [liveRawInput, setLiveRawInput] = useState('');
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
  const [reportDataInput, setReportDataInput] = useState(() => loadStoredString('tab4:reportDataInput', ''));
  const [reportDataDescHex, setReportDataDescHex] = useState(() => loadStoredString('tab4:reportDataDescHex', ''));
  const [reportDataHtml, setReportDataHtml] = useState('');
  const [hasLenPrefix, setHasLenPrefix] = useState(() => loadStoredBool('tab4:hasLenPrefix', false));
  const [reportDataAddrFilter, setReportDataAddrFilter] = useState(() => loadStoredString('tab4:reportDataAddrFilter', ''));
  const [reportDataDescStatus, setReportDataDescStatus] = useState('');

  // Per-tab Save MD refs
  const tab1MdRef = useRef('');
  const tab2MdRef = useRef('');
  const tab3MdRef = useRef('');

  const handleSaveMd = (which: number) => {
    let md = '';
    let name = '';
    if (which === 1) { md = tab1MdRef.current; name = 'power-on-seq'; }
    else if (which === 2) { md = tab2MdRef.current; name = 'device-desc'; }
    else if (which === 3) { md = tab3MdRef.current; name = 'report-desc'; }
    if (md) window.electronAPI.saveText?.(md, name + '-' + Date.now() + '.md');
  };

  // Tab 5: Live Sequence
  const [liveSeqHidDescHex, setLiveSeqHidDescHex] = useState(() => loadStoredString('tab5:liveSeqHidDescHex', ''));
  const [liveSeqReportDescHex, setLiveSeqReportDescHex] = useState(() => loadStoredString('tab5:liveSeqReportDescHex', ''));
  const [liveSeqAddr, setLiveSeqAddr] = useState(() => loadStoredString('tab5:liveSeqAddr', '0x5D'));
  const [liveSeqReg, setLiveSeqReg] = useState(() => loadStoredString('tab5:liveSeqReg', '0x0001'));
  const [liveSeqStatus, setLiveSeqStatus] = useState('');
  const [liveSeqListening, setLiveSeqListening] = useState(false);
  const [liveSeqTick, setLiveSeqTick] = useState(0);
  const liveSeqAnalyzerRef = useRef<LiveHidAnalyzer | null>(null);
  const liveSeqUnsubscribeRef = useRef<(() => void) | null>(null);
  const liveSeqStartTimeRef = useRef<number>(0);

  // ── Persistence: auto-save each input field to localStorage on change.
  // localStorage writes are synchronous and cheap (sub-millisecond) so we
  // do them on every state change without debouncing.
  useEffect(() => { saveStoredString('tab1:seqInput', seqInput); }, [seqInput]);
  useEffect(() => { saveStoredString('tab1:seqAddr', seqAddr); }, [seqAddr]);
  useEffect(() => { saveStoredString('tab1:seqReg', seqReg); }, [seqReg]);
  useEffect(() => { saveStoredString('tab2:descHex', descHex); }, [descHex]);
  useEffect(() => { saveStoredString('tab3:reportDescHex', reportDescHex); }, [reportDescHex]);
  useEffect(() => { saveStoredString('tab4:reportDataInput', reportDataInput); }, [reportDataInput]);
  useEffect(() => { saveStoredString('tab4:reportDataDescHex', reportDataDescHex); }, [reportDataDescHex]);
  useEffect(() => { saveStoredBool('tab4:hasLenPrefix', hasLenPrefix); }, [hasLenPrefix]);
  useEffect(() => { saveStoredString('tab4:reportDataAddrFilter', reportDataAddrFilter); }, [reportDataAddrFilter]);
  useEffect(() => { saveStoredString('tab5:liveSeqHidDescHex', liveSeqHidDescHex); }, [liveSeqHidDescHex]);
  useEffect(() => { saveStoredString('tab5:liveSeqReportDescHex', liveSeqReportDescHex); }, [liveSeqReportDescHex]);
  useEffect(() => { saveStoredString('tab5:liveSeqAddr', liveSeqAddr); }, [liveSeqAddr]);
  useEffect(() => { saveStoredString('tab5:liveSeqReg', liveSeqReg); }, [liveSeqReg]);

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
      tab1MdRef.current = md;
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
      const md = generateDescMarkdown(desc);
      tab2MdRef.current = md;
      setDescHtml(wrapHtml(marked.parse(md) as string));
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
    tab3MdRef.current = md;
    setReportDescHtml(wrapHtml(marked.parse(md) as string));
  }, [reportDescHex]);



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






  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'#1e1e1e', overflow:'hidden' }}>
      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:0, padding:'0 8px', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
        {(['powerOn','deviceDesc','reportDesc','reportDataParser','liveSequence'] as SubTab[]).map(key => (
          <button key={key} onClick={() => setSubTab(key)}
            style={{
              padding:'8px 16px', border:'none', cursor:'pointer', fontSize:12,
              background: subTab===key ? '#1e1e1e' : 'transparent',
              color: subTab===key ? '#d4d4d4' : '#858585',
              borderBottom: subTab===key ? '2px solid #6a9955' : '2px solid transparent',
              fontWeight: subTab===key ? 600 : 400,
            }}>
            {{powerOn:'Power-On Seq',deviceDesc:'Device Desc',reportDesc:'Report Desc',reportDataParser:'Report Data',liveSequence:'Live Sequence'}[key]}
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
              <button onClick={()=>handleSaveMd(1)} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Save MD</button>
            </div>
            <ResizableSplit direction="horizontal" defaultSize={400}>
              <textarea value={seqInput} onChange={e=>setSeqInput(e.target.value)} placeholder="Paste Saleae CSV export or I2C log..."
                style={{ width:'100%', height:'100%', background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none', boxSizing:'border-box' }} />
              <div style={{ height:'100%', overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: seqHtml }} />
            </ResizableSplit>
          </div>
        )}

        {/* TAB 2: Device Descriptor */}
        {subTab === 'deviceDesc' && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
              <button onClick={handleParseDesc} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Parse</button>
              <button onClick={()=>setDescHex(SAMPLE_DESC)} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Sample</button>
              <button onClick={()=>{setDescHex('');setDescHtml('');}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear</button>
              <button onClick={()=>handleSaveMd(2)} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Save MD</button>
            </div>
            <ResizableSplit direction="horizontal" defaultSize={400}>
              <textarea value={descHex} onChange={e=>setDescHex(e.target.value)} placeholder="Paste 30 hex bytes..."
                style={{ width:'100%', height:'100%', background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none', boxSizing:'border-box' }} />
              <div style={{ height:'100%', overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: descHtml }} />
            </ResizableSplit>
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
              <button onClick={()=>handleSaveMd(3)} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Save MD</button>
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
            <ResizableSplit direction="horizontal" defaultSize={400}>
              <textarea value={reportDescHex} onChange={e=>setReportDescHex(e.target.value)} placeholder="Paste HID Report Descriptor hex..."
                style={{ width:'100%', height:'100%', background:'#1e1e1e', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:8, fontFamily:'monospace', fontSize:12, resize:'none', boxSizing:'border-box' }} />
              <div style={{ height:'100%', overflow:'auto', border:'1px solid #3c3c3c' }} dangerouslySetInnerHTML={{ __html: reportDescHtml }} />
            </ResizableSplit>
          </div>
        )}

        {/* TAB 4: Report Data Parser */}
        {subTab === 'reportDataParser' && (
          <ReportDataParserTab
            reportDataDescHex={reportDataDescHex}
            setReportDataDescHex={setReportDataDescHex}
            reportDataHtml={reportDataHtml}
            setReportDataHtml={setReportDataHtml}
            hasLenPrefix={hasLenPrefix}
            setHasLenPrefix={setHasLenPrefix}
            reportDataAddrFilter={reportDataAddrFilter}
            setReportDataAddrFilter={setReportDataAddrFilter}
            reportDataDescStatus={reportDataDescStatus}
            setReportDataDescStatus={setReportDataDescStatus}
            reportDataInput={reportDataInput}
            setReportDataInput={setReportDataInput}
          />
        )}

        {/* TAB 5: Live Sequence — incremental HID-over-I²C analyzer */}
        {subTab === 'liveSequence' && (
          <LiveSequenceTab
            liveSeqHidDescHex={liveSeqHidDescHex}
            setLiveSeqHidDescHex={setLiveSeqHidDescHex}
            liveSeqReportDescHex={liveSeqReportDescHex}
            setLiveSeqReportDescHex={setLiveSeqReportDescHex}
            liveSeqAddr={liveSeqAddr}
            setLiveSeqAddr={setLiveSeqAddr}
            liveSeqReg={liveSeqReg}
            setLiveSeqReg={setLiveSeqReg}
            liveSeqStatus={liveSeqStatus}
            setLiveSeqStatus={setLiveSeqStatus}
            liveSeqListening={liveSeqListening}
            setLiveSeqListening={setLiveSeqListening}
            liveSeqTick={liveSeqTick}
            setLiveSeqTick={setLiveSeqTick}
            liveSeqAnalyzerRef={liveSeqAnalyzerRef}
            liveSeqUnsubscribeRef={liveSeqUnsubscribeRef}
            liveSeqStartTimeRef={liveSeqStartTimeRef}
          />
        )}
      </div>
    </div>
  );
};

export default HidAnalysisView;

// ── Separate Tab 4 component with its own tick state ──
const ReportDataParserTab: React.FC<{
  reportDataDescHex: string;
  setReportDataDescHex: (v: string) => void;
  reportDataHtml: string;
  setReportDataHtml: (v: string) => void;
  hasLenPrefix: boolean;
  setHasLenPrefix: (v: boolean) => void;
  reportDataAddrFilter: string;
  setReportDataAddrFilter: (v: string) => void;
  reportDataDescStatus: string;
  setReportDataDescStatus: (v: string) => void;
  reportDataInput: string;
  setReportDataInput: (v: string) => void;
}> = ({
  reportDataDescHex, setReportDataDescHex, reportDataHtml, setReportDataHtml,
  hasLenPrefix, setHasLenPrefix, reportDataAddrFilter, setReportDataAddrFilter,
  reportDataDescStatus, setReportDataDescStatus, reportDataInput, setReportDataInput,
}) => {
  const [liveTick, setLiveTick] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const liveFrameCountRef = useRef(0);
  const listeningFieldsRef = useRef<ReportField[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const tabMdRef = useRef('');
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null; }
    };
  }, []);
  const handleSaveMd4 = useCallback(() => {
    const md = tabMdRef.current;
    if (!md) return;
    window.electronAPI.saveText?.(md, 'report-data-parser-' + Date.now() + '.md');
  }, []);

  const handleStartListening = useCallback(() => {
    const descBytes = parseHexString(reportDataDescHex);
    if (descBytes.length === 0) { setReportDataHtml(wrapHtml('<span class="warning">Load a descriptor first.</span>')); return; }
    const items = parseReportDescriptor(descBytes);
    const fields = analyzeReportItems(items);
    listeningFieldsRef.current = fields;
    liveFrameCountRef.current = 0;
    liveFramesRef.current = [];
    liveRawInputRef.current = '';

    // Parse addr filter (UI input) once at listen-start so a mid-listen
    // edit doesn't change filtering semantics partway through.
    const addrFilter = reportDataAddrFilter.trim()
      ? (reportDataAddrFilter.startsWith('0x') || reportDataAddrFilter.startsWith('0X')
          ? parseInt(reportDataAddrFilter, 16)
          : parseInt(reportDataAddrFilter, 10))
      : null;

    const MAX_FRAMES = 10000; const MAX_RAW_CHARS = 50000;
    const pendingRaw: string[] = []; const pendingFrames: LiveFrameEntry[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pendingRaw.length > 0) {
        const rawChunk = pendingRaw.join(''); pendingRaw.length = 0;
        liveRawInputRef.current += rawChunk;
        if (liveRawInputRef.current.length > MAX_RAW_CHARS) liveRawInputRef.current = liveRawInputRef.current.slice(-MAX_RAW_CHARS / 2);
      }
      if (pendingFrames.length > 0) {
        const chunk = pendingFrames.splice(0, pendingFrames.length);
        liveFramesRef.current.push(...chunk);
        if (liveFramesRef.current.length > MAX_FRAMES) liveFramesRef.current = liveFramesRef.current.slice(-MAX_FRAMES);
      }
      // Build markdown from live frames for Save MD
      const all = liveFramesRef.current;
      if (all.length > 0) {
        const names = Object.keys(all[0].fields);
        let m = '# Report Data Parser (Live)\n\n';
        m += '**' + all.length + ' frames**\n\n';
        m += '| # |';
        for (const n of names) m += ' ' + n + ' |';
        m += '\n|---|';
        for (const _ of names) m += '---|';
        m += '\n';
        for (let fi = Math.max(0, all.length - 500); fi < all.length; fi++) {
          const f = all[fi];
          m += '| ' + fi + ' |';
          for (const n of names) {
            const fld = f.fields[n];
            m += ' ' + (fld !== undefined ? formatFieldValue(fld.value, fld.bitSize) : '') + ' |';
          }
          m += '\n';
        }
        tabMdRef.current = m;
      }
      setLiveTick(function(t) { return t + 1; });
    }
    function scheduleFlush() { if (!flushTimer) flushTimer = setTimeout(flush, 200); }
    setIsListening(true);

    // Subscribe to the parallel raw I²C channel so we see every report ID,
    // not just finger / stylus. The fingerprint of "this is a valid report"
    // is decided by parseSingleFrame against the loaded descriptor fields.
    const unsub = window.electronAPI.onI2cRawFrame?.((rawFrame) => {
      if (!rawFrame.rawBytes || rawFrame.rawBytes.length === 0) return;
      // HID-origin frames have no real I²C address; skip the addr filter for them.
      if (rawFrame.source !== 'hid' && addrFilter !== null && rawFrame.i2cAddress !== addrFilter) return;
      const rawHex = rawFrame.rawBytes.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      const fields2 = listeningFieldsRef.current; if (fields2.length === 0) return;
      // hasLenPrefix state controls the 2-byte HID-I²C length prefix
      // assumption, matching the static Parse Report Data path.
      const parsed = parseSingleFrame(rawFrame.rawBytes, fields2, hasLenPrefix, liveFrameCountRef.current);
      if (parsed) {
        liveFrameCountRef.current++;
        pendingRaw.push(rawHex + '\n');
        pendingFrames.push({ reportId: parsed.reportId, fields: parsed.fields, rawHex: rawHex });
        scheduleFlush();
      }
    });
    unsubscribeRef.current = unsub || null;
  }, [reportDataDescHex, reportDataAddrFilter, hasLenPrefix, setReportDataHtml]);

  const handleStopListening = useCallback(() => {
    setIsListening(false);
    if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null; }
  }, []);

  const handleParseData = useCallback(() => {
    try {
      const descBytes = parseHexString(reportDataDescHex);
      if (descBytes.length === 0) { setReportDataHtml(wrapHtml('<span class="warning">Please load Report Descriptor first.</span>')); return; }
      const items = parseReportDescriptor(descBytes);
      const f = analyzeReportItems(items);
      const lines = reportDataInput.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) {
        setReportDataHtml(wrapHtml('<span class="warning">No report data to parse.</span>'));
        return;
      }
      const { groups, skipped } = parseAllFrames(lines, f, hasLenPrefix, null);
      let total = 0; for (const [, frs] of groups) total += frs.length;
      let md = '## Report Data Analysis\n\n';
      md += `**${total} frames** parsed from ${lines.length} lines`;
      if (groups.size > 0) { const ids = [...groups.keys()].sort((a, b) => a - b); md += ` (${groups.size} Report IDs: ${ids.map(id => '0x' + id.toString(16).toUpperCase()).join(', ')})`; }
      md += '\n\n';
      for (const [rid, frs] of groups) {
        if (frs.length === 0) continue;
        const names = Object.keys(frs[0].fields);
        md += `### Report ID ${rid.toString(16).toUpperCase().padStart(2, '0')}  (${frs.length} frames)\n\n`;
        md += '| # |'; for (const n of names) md += ' ' + n + ' |'; md += '\n|---|'; for (const _ of names) md += '---|'; md += '\n';
        for (let fi = 0; fi < frs.length; fi++) { const f2 = frs[fi]; md += `| ${fi} |`; for (const n of names) { const f = f2.fields[n]; md += ' ' + (f !== undefined ? formatFieldValue(f.value, f.bitSize) : '') + ' |'; } md += '\n'; }
        md += '\n';
      }
      tabMdRef.current = md;
      setReportDataHtml(wrapHtml(marked.parse(md) as string));
    } catch (err) { setReportDataHtml(wrapHtml('<span class="warning">Parse error: ' + err + '</span>')); }
  }, [reportDataDescHex, reportDataInput, hasLenPrefix, setReportDataHtml]);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'8px', display:'flex', gap:8, alignItems:'center', background:'#252526', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
        <button onClick={() => { try { const b = parseHexString(reportDataDescHex); if (b.length === 0) { setReportDataDescStatus('No valid hex'); return; } const it = parseReportDescriptor(b); const f = analyzeReportItems(it); listeningFieldsRef.current = f; setReportDataDescStatus("Loaded (" + b.length + "B, " + f.length + " fields)"); } catch (e) { setReportDataDescStatus('Parse failed'); } }} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Descriptor</button>
        <span style={{ fontSize:11, color:'#6a9955' }}>{reportDataDescStatus}</span>
        <span style={{ flex:1 }} />
        <label style={{ fontSize:12, color:'#d4d4d4' }}>Addr: <input value={reportDataAddrFilter} onChange={e=>setReportDataAddrFilter(e.target.value)} placeholder="e.g. 0x2C" style={{ width:60, background:'#3c3c3c', color:'#d4d4d4', border:'none', padding:'2px 4px', borderRadius:2, fontSize:12 }} /></label>
        <label style={{ fontSize:12, color:'#d4d4d4', display:'flex', alignItems:'center', gap:4 }}>
          <input type="checkbox" checked={hasLenPrefix} onChange={e=>setHasLenPrefix(e.target.checked)} />
          2-byte len prefix
        </label>
        <button onClick={()=>{setReportDataDescHex(REPORT_DATA_DESC_SAMPLE);setReportDataInput(REPORT_DATA_SAMPLE);setHasLenPrefix(false);setReportDataAddrFilter('');setReportDataHtml('');}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Load Sample</button>
        <button onClick={isListening ? handleStopListening : handleStartListening} style={{ padding:'4px 12px', borderRadius:4, border:'none', background: isListening ? '#f14c4c' : '#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>{isListening ? 'Stop Listening' : 'Start Listening'}</button>
      </div>
      <div style={{ padding:'4px 8px', background:'#1e1e1e', borderBottom:'1px solid #3c3c3c' }}>
        <textarea value={reportDataDescHex} onChange={e=>setReportDataDescHex(e.target.value)} placeholder="Report Descriptor hex..."
          style={{ width:'100%', height:50, background:'#252526', color:'#d4d4d4', border:'1px solid #3c3c3c', padding:4, fontFamily:'monospace', fontSize:12, resize:'vertical' }} />
      </div>
      <div style={{ padding:'4px 8px', display:'flex', gap:8, alignItems:'center', background:'#1e1e1e', borderBottom:'1px solid #3c3c3c', flexShrink:0 }}>
        <button onClick={handleParseData} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#6a9955', color:'#fff', cursor:'pointer', fontSize:12 }}>Parse Report Data</button>
        <button onClick={()=>{if(isListening){liveRawInputRef.current='';liveFramesRef.current=[];setLiveTick(function(t){return t+1})}else{setReportDataInput('');setReportDataHtml('');}}} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Clear</button>
        <button onClick={handleSaveMd4} style={{ padding:'4px 12px', borderRadius:4, border:'none', background:'#3c3c3c', color:'#d4d4d4', cursor:'pointer', fontSize:12 }}>Save MD</button>
      </div>
      <ResizableSplit direction="horizontal" defaultSize={400}>
        <RawDataView isListening={isListening} reportDataInput={reportDataInput} setReportDataInput={setReportDataInput} tick={liveTick} />
        {isListening
          ? <LiveFrameTable tick={liveTick} />
          : <div style={{ height:'100%', overflow:'auto' }} dangerouslySetInnerHTML={{ __html: reportDataHtml }} />}
      </ResizableSplit>
    </div>
  );
};

// ── Tab 5: Live Sequence — incremental HID-over-I²C analyzer ──

interface LiveSequenceTabProps {
  liveSeqHidDescHex: string;
  setLiveSeqHidDescHex: (v: string) => void;
  liveSeqReportDescHex: string;
  setLiveSeqReportDescHex: (v: string) => void;
  liveSeqAddr: string;
  setLiveSeqAddr: (v: string) => void;
  liveSeqReg: string;
  setLiveSeqReg: (v: string) => void;
  liveSeqStatus: string;
  setLiveSeqStatus: (v: string) => void;
  liveSeqListening: boolean;
  setLiveSeqListening: (v: boolean) => void;
  liveSeqTick: number;
  setLiveSeqTick: React.Dispatch<React.SetStateAction<number>>;
  liveSeqAnalyzerRef: React.MutableRefObject<LiveHidAnalyzer | null>;
  liveSeqUnsubscribeRef: React.MutableRefObject<(() => void) | null>;
  liveSeqStartTimeRef: React.MutableRefObject<number>;
}

const LiveSequenceTab: React.FC<LiveSequenceTabProps> = ({
  liveSeqHidDescHex, setLiveSeqHidDescHex,
  liveSeqReportDescHex, setLiveSeqReportDescHex,
  liveSeqAddr, setLiveSeqAddr,
  liveSeqReg, setLiveSeqReg,
  liveSeqStatus, setLiveSeqStatus,
  liveSeqListening, setLiveSeqListening,
  liveSeqTick, setLiveSeqTick,
  liveSeqAnalyzerRef, liveSeqUnsubscribeRef, liveSeqStartTimeRef,
}) => {
  const handleLoadHidDesc = useCallback(() => {
    try {
      const bytes = parseHexString(liveSeqHidDescHex);
      if (bytes.length < 30) {
        setLiveSeqStatus('Need 30 bytes of HID descriptor');
        return;
      }
      const desc = parseDescriptor(bytes);
      if (!desc) {
        setLiveSeqStatus('Parse failed');
        return;
      }
      setLiveSeqStatus(`Loaded VID=0x${desc.vendorId.toString(16).toUpperCase()}, PID=0x${desc.productId.toString(16).toUpperCase()}, MaxInput=${desc.maxInputLength}B`);
    } catch {
      setLiveSeqStatus('Parse failed');
    }
  }, [liveSeqHidDescHex]);

  const handleLoadReportDesc = useCallback(() => {
    try {
      const bytes = parseHexString(liveSeqReportDescHex);
      if (bytes.length === 0) {
        setLiveSeqStatus('Need valid hex bytes');
        return;
      }
      const items = parseReportDescriptor(bytes);
      const fields = analyzeReportItems(items);
      setLiveSeqStatus(`Loaded (${bytes.length}B, ${fields.length} fields)`);
    } catch {
      setLiveSeqStatus('Parse failed');
    }
  }, [liveSeqReportDescHex]);

  const handleStartListening = useCallback(() => {
    let addr: number;
    let reg: number;
    try {
      const hidBytes = parseHexString(liveSeqHidDescHex);
      const reportBytes = parseHexString(liveSeqReportDescHex);
      addr = parseInt(liveSeqAddr, 16);
      reg = parseInt(liveSeqReg, 16);
      if (hidBytes.length < 30) { setLiveSeqStatus('Load HID descriptor first'); return; }
      if (reportBytes.length === 0) { setLiveSeqStatus('Load Report descriptor first'); return; }
      if (isNaN(addr) || isNaN(reg)) { setLiveSeqStatus('Bad addr/reg'); return; }
      const hidDesc = parseDescriptor(hidBytes);
      if (!hidDesc) { setLiveSeqStatus('HID descriptor parse failed'); return; }
      const items = parseReportDescriptor(reportBytes);
      const fields = analyzeReportItems(items);

      const analyzer = new LiveHidAnalyzer(addr, reg);
      analyzer.loadDescriptor(hidDesc, fields);
      liveSeqAnalyzerRef.current = analyzer;
      liveSeqStartTimeRef.current = Date.now();

      const unsub = window.electronAPI.onI2cRawFrame?.((rawFrame) => {
        if (rawFrame.source !== 'hid' && rawFrame.i2cAddress !== addr) return;
        const txn: I2cTransaction = {
          lineNumber: 0,
          timestamp: rawFrame.timestamp / 1000,
          timeMs: rawFrame.timestamp - liveSeqStartTimeRef.current,
          address: rawFrame.i2cAddress,
          isRead: rawFrame.isRead,
          data: rawFrame.rawBytes,
          rawLine: undefined,
        };
        analyzer.pushTransaction(txn);
        setLiveSeqTick(t => t + 1);
        setLiveSeqStatus(`Listening: ${analyzer.getEventCount()} events captured`);
      });
      liveSeqUnsubscribeRef.current = unsub || null;
      setLiveSeqListening(true);
      setLiveSeqStatus(`Listening: 0 events captured`);
    } catch (e) {
      setLiveSeqStatus(`Start failed: ${e}`);
    }
  }, [liveSeqHidDescHex, liveSeqReportDescHex, liveSeqAddr, liveSeqReg]);

  const handleStopListening = useCallback(() => {
    setLiveSeqListening(false);
    if (liveSeqUnsubscribeRef.current) { liveSeqUnsubscribeRef.current(); liveSeqUnsubscribeRef.current = null; }
    const analyzer = liveSeqAnalyzerRef.current;
    if (analyzer) {
      setLiveSeqStatus(`Stopped: ${analyzer.getEventCount()} events captured`);
    }
  }, []);

  const handleClear = useCallback(() => {
    if (liveSeqUnsubscribeRef.current) { liveSeqUnsubscribeRef.current(); liveSeqUnsubscribeRef.current = null; }
    liveSeqAnalyzerRef.current = null;
    setLiveSeqListening(false);
    setLiveSeqStatus('Cleared');
    setLiveSeqTick(t => t + 1);
  }, []);

  const handleSaveMd = useCallback(() => {
    const analyzer = liveSeqAnalyzerRef.current;
    if (!analyzer || analyzer.getEventCount() === 0) {
      setLiveSeqStatus('Nothing to save — no events captured');
      return;
    }
    const events = analyzer.getEvents();
    const hidDesc = analyzer.getHidDescriptor();
    // We don't have direct access to reportDescriptorBytes from the analyzer,
    // but generateSequenceMarkdown doesn't strictly need it (it uses
    // reportFields for field-level decoding in the summary).
    const result = liveSequenceEventsToResult(
      events,
      hidDesc,
      [],  // reportDescriptorBytes not retained by analyzer
      [],  // reportFields not retained by analyzer either
    );
    const md = generateSequenceMarkdown(result);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    window.electronAPI.saveText?.(md, `live-sequence-${ts}.md`);
    setLiveSeqStatus(`Saved MD: ${events.length} events`);
  }, []);

  const handleSaveJson = useCallback(() => {
    const analyzer = liveSeqAnalyzerRef.current;
    if (!analyzer || analyzer.getEventCount() === 0) {
      setLiveSeqStatus('Nothing to save — no events captured');
      return;
    }
    const events = analyzer.getEvents();
    const payload = {
      version: 1,
      recordedAt: new Date().toISOString(),
      deviceAddress: parseInt(liveSeqAddr, 16),
      hidDescRegister: parseInt(liveSeqReg, 16),
      hidDescriptor: analyzer.getHidDescriptor(),
      eventCount: events.length,
      events: events.map(e => ({
        order: e.order,
        timestamp: e.timestamp,
        timeMs: e.timeMs,
        direction: e.direction,
        eventType: e.eventType,
        reportId: e.reportId,
        description: e.description.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''),
        rawHex: e.rawData.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      })),
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    window.electronAPI.saveText?.(JSON.stringify(payload, null, 2), `live-sequence-${ts}.json`);
    setLiveSeqStatus(`Saved JSON: ${events.length} events`);
  }, [liveSeqAddr, liveSeqReg]);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const liveSeqScrollRef = useRef<HTMLDivElement>(null);
  const liveSeqInnerRef = useRef<HTMLDivElement>(null);

  // ResizeObserver to keep viewH in sync (needed for virtual scroll).
  useEffect(() => {
    const el = liveSeqScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Always auto-scroll to the bottom on each new tick so the user sees
  // the latest events in real time. Scroll up manually to inspect history;
  // new data will keep jumping to the tail — this is the default mode.
  useEffect(() => {
    const el = liveSeqScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveSeqTick]);

  const handleLiveSeqScroll = useCallback(() => {
    const el = liveSeqScrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  const analyzer = liveSeqAnalyzerRef.current;
  const allEvents: HidI2cEvent[] = analyzer ? analyzer.getEvents() : [];
  const totalRows = allEvents.length;

  // Virtualized row window: only render rows in [startIdx, endIdx) plus a
  // small buffer. With totalRows in the millions this still renders fast.
  const bufferRows = 20;
  const rowHeight = 22; // px; must match the actual <tr> height below
  const totalHeight = totalRows * rowHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
  const endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewH) / rowHeight) + bufferRows);
  const visibleEvents = useMemo(() => allEvents.slice(startIdx, endIdx), [allEvents, startIdx, endIdx]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Descriptor input panel */}
      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, background: '#252526', borderBottom: '1px solid #3c3c3c', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#d4d4d4' }}>HID Device Desc (30B):</label>
          <button onClick={handleLoadHidDesc} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}>Load</button>
          <label style={{ fontSize: 12, color: '#d4d4d4' }}>Addr:</label>
          <input value={liveSeqAddr} onChange={e => setLiveSeqAddr(e.target.value)} style={{ width: 60, background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2, fontSize: 12 }} />
          <label style={{ fontSize: 12, color: '#d4d4d4' }}>Desc Reg:</label>
          <input value={liveSeqReg} onChange={e => setLiveSeqReg(e.target.value)} style={{ width: 60, background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2, fontSize: 12 }} />
        </div>
        <textarea
          value={liveSeqHidDescHex}
          onChange={e => setLiveSeqHidDescHex(e.target.value)}
          placeholder="Paste 30 bytes of HID Device Descriptor (e.g. 1E 00 00 01 27 C6 ...)"
          style={{ width: '100%', height: 36, background: '#252526', color: '#d4d4d4', border: '1px solid #3c3c3c', padding: 4, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#d4d4d4' }}>HID Report Desc:</label>
          <button onClick={handleLoadReportDesc} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}>Load</button>
        </div>
        <textarea
          value={liveSeqReportDescHex}
          onChange={e => setLiveSeqReportDescHex(e.target.value)}
          placeholder="Paste HID Report Descriptor hex (e.g. 05 01 09 02 A1 01 ...)"
          style={{ width: '100%', height: 50, background: '#252526', color: '#d4d4d4', border: '1px solid #3c3c3c', padding: 4, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        />
      </div>

      {/* Listen controls */}
      <div style={{ padding: '8px', display: 'flex', gap: 8, alignItems: 'center', background: '#1e1e1e', borderBottom: '1px solid #3c3c3c', flexShrink: 0 }}>
        <button
          onClick={liveSeqListening ? handleStopListening : handleStartListening}
          style={{ padding: '4px 14px', borderRadius: 4, border: 'none', background: liveSeqListening ? '#f14c4c' : '#6a9955', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          {liveSeqListening ? 'Stop Listening' : 'Start Listening'}
        </button>
        <button onClick={handleClear} style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}>Clear</button>
        <button onClick={handleSaveMd} style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}>Save MD</button>
        <button onClick={handleSaveJson} style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}>Save JSON</button>
        <span style={{ fontSize: 11, color: '#6a9955' }}>{liveSeqStatus}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: liveSeqListening ? '#6a9955' : '#858585' }}>
          {liveSeqListening ? '● LIVE' : '○ idle'}
        </span>
      </div>

      {/* Events table — virtualized: only render rows in the viewport (plus
          a 20-row buffer above + below). 1M events still renders in
          O(viewport) = ~50 rows. The full count is shown in the header so
          the user always knows how much data is captured. */}
      <div ref={liveSeqScrollRef} onScroll={handleLiveSeqScroll} style={{ flex: 1, overflow: 'auto', background: '#1e1e1e' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#252526', display: 'flex', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #3c3c3c', fontSize: 11, color: '#858585' }}>
          <span style={{ color: '#6a9955', fontWeight: 600 }}>Total: {totalRows} events</span>
          <span style={{ marginLeft: 12 }}>
            {totalRows > 0 ? `Showing rows ${startIdx + 1}-${endIdx}` : '(empty)'}
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 11, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 60 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>#</th>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>Time (s)</th>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>Direction</th>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>Event Type</th>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>ReportID</th>
              <th style={{ border: '1px solid #3c3c3c', padding: '4px 8px', textAlign: 'left', color: '#6a9955' }}>Description</th>
            </tr>
          </thead>
        </table>
        {/* Scrollable body — the inner spacer gives the scrollbar the
            correct total height; the table body is positioned absolutely
            within it so the header stays visible. */}
        <div ref={liveSeqInnerRef} style={{ position: 'relative', height: totalHeight }}>
          <table style={{ position: 'absolute', top: startIdx * rowHeight, left: 0, right: 0, borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 11, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 60 }} />
              <col />
            </colgroup>
            <tbody>
              {visibleEvents.map((evt) => (
                <tr key={evt.order} style={{ background: evt.order % 2 === 0 ? '#1e1e1e' : '#252526', height: rowHeight }}>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: '#858585' }}>{evt.order}</td>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: '#d4d4d4' }}>{evt.timestamp.toFixed(3)}</td>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: evt.direction.includes('←') ? '#ce9178' : '#569cd6' }}>{evt.direction}</td>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: '#d4d4d4', fontWeight: 600 }}>{evt.eventType}</td>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: '#ce9178' }}>{evt.reportId || '-'}</td>
                  <td style={{ border: '1px solid #3c3c3c', padding: '2px 6px', color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dangerouslySetInnerHTML={{ __html: evt.description }} />
                </tr>
              ))}
            </tbody>
          </table>
          {totalRows === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#858585', fontStyle: 'italic' }}>
              {liveSeqListening ? 'Waiting for I²C frames...' : 'Load descriptors and click Start Listening to begin.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
