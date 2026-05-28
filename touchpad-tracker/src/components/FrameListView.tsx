import React from 'react';
import { FingerFrame, StylusState } from '../types/finger';

interface FrameListViewProps {
  frames: FingerFrame[];
  currentFrameIndex: number;
  isLiveMode?: boolean;
  liveFramesRef?: React.MutableRefObject<FingerFrame[]> | null;
  liveFrameCount?: number;
  onStart?: () => void;
  onStop?: () => void;
  onClear?: () => void;
  onSelectFrame?: (index: number) => void;
}

function formatTimestamp(frame: FingerFrame, prevScantime: number): string {
  // scantime unit is 100us, support u32
  const delta = prevScantime >= 0 ? (frame.scantime - prevScantime) / 10.0 : 0;
  const deltaStr = delta > 0 ? `+${delta.toFixed(1)}ms` : '-';
  return `${frame.scantime.toString().padStart(10)} (${deltaStr})`;
}

const TOUCH_STATE_NAMES = ['tip release', 'release', 'tip', 'finger'];

function formatFingers(frame: FingerFrame): string {
  const count = frame.fingerCount;
  if (count === 0) return '-';
  const activeSlots = frame.slots.filter(s => s.state >= 0).slice(0, count);
  if (activeSlots.length === 0) return count + '';
  const slots = activeSlots.map(f => {
    const stateName = TOUCH_STATE_NAMES[f.state] || f.state;
    const extras = [f.length, f.width, f.pressure].filter(v => v !== undefined).map(v => v).join(',');
    return `(${f.fingerId},${stateName},${f.x},${f.y}${extras ? ',' + extras : ''})`;
  }).join(',');
  return `${count} ${slots}`;
}

const STYLUS_STATE_NAMES: Record<number, string> = {
  0x00: 'release',
  0x20: 'hover',
  0x21: 'tip',
};

function formatStylus(frame: FingerFrame): string {
  if (!frame.stylus) return '-';
  const s = frame.stylus;
  const stateName = STYLUS_STATE_NAMES[s.state] ?? `0x${s.state.toString(16)}`;
  return `${stateName} (${s.x},${s.y},${s.tipPressure},${s.xTilt},${s.yTilt})`;
}

const ROW_HEIGHT = 28;

const FrameListView: React.FC<FrameListViewProps> = ({
  frames,
  currentFrameIndex,
  isLiveMode = false,
  liveFramesRef,
  liveFrameCount = 0,
  onStart,
  onStop,
  onClear,
  onSelectFrame,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const prevFramesLengthRef = React.useRef(0);

  // Use liveFramesRef directly if available (live mode), otherwise use frames prop
  const displayFrames = isLiveMode && liveFramesRef ? liveFramesRef.current : frames;
  const displayLength = isLiveMode && liveFramesRef ? liveFramesRef.current.length : frames.length;

  // Debug: log when frames change
  React.useEffect(() => {
    console.log('[FrameListView] frames updated:', prevFramesLengthRef.current, '->', displayLength, 'liveFrameCount:', liveFrameCount, 'isLiveMode:', isLiveMode);
    prevFramesLengthRef.current = displayLength;
  }, [displayLength, liveFrameCount, isLiveMode]);

  // Auto-scroll to bottom when new frames arrive in live mode
  React.useEffect(() => {
    if (isLiveMode && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [liveFrameCount, isLiveMode]);

  // Force re-render when liveFrameCount changes in live mode
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    if (isLiveMode && liveFrameCount > 0) {
      forceUpdate(n => n + 1);
    }
  }, [liveFrameCount, isLiveMode]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px',
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onStart}
          style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}
        >
          Start
        </button>
        <button
          onClick={onStop}
          style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}
        >
          Stop
        </button>
        <button
          onClick={onClear}
          style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#3c3c3c', color: '#d4d4d4', cursor: 'pointer', fontSize: 12 }}
        >
          Clear
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#858585', alignSelf: 'center' }}>
          {displayLength} frames
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          padding: '0 8px',
          height: ROW_HEIGHT,
          alignItems: 'center',
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          color: '#858585',
          fontSize: 12,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        <span style={{ width: 70 }}>#</span>
        <span style={{ width: 120 }}>Scan(100μs)/Δ</span>
        <span style={{ flex: 1 }}>Fingers(id,state,x,y,l,w,p)</span>
        <span style={{ width: 250 }}>Stylus(state,x,y,p,tx,ty)</span>
        <span style={{ width: 30 }}>Pkt</span>
      </div>

      {/* Scrollable frame list */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {displayFrames.map((frame, index) => {
          const isActive = index === currentFrameIndex;
          const prevScantime = index > 0 ? displayFrames[index - 1].scantime : -1;
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                height: ROW_HEIGHT,
                background: isActive ? '#264f78' : index % 2 === 0 ? '#1e1e1e' : '#252526',
                color: isActive ? '#ffffff' : '#d4d4d4',
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: !isLiveMode && onSelectFrame ? 'pointer' : 'default',
                borderBottom: '1px solid #3c3c3c',
                boxSizing: 'border-box',
              }}
              onClick={() => !isLiveMode && onSelectFrame?.(index)}
            >
              <span style={{ width: 70, color: isActive ? '#6a9955' : '#858585' }}>{index}</span>
              <span style={{ width: 120 }}>{formatTimestamp(frame, prevScantime)}</span>
              <span style={{ flex: 1, color: '#ce9178' }}>{formatFingers(frame)}</span>
              <span style={{ width: 250, color: '#4ecdc4' }}>{formatStylus(frame)}</span>
              <span style={{ width: 30, color: '#808080' }}>{frame.packetType}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FrameListView;