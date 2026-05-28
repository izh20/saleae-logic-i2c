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
  // scantime unit is 100us, calculate interval from previous frame
  const delta = prevScantime >= 0 ? (frame.scantime - prevScantime) / 10.0 : 0;
  const deltaStr = delta > 0 ? `+${delta.toFixed(1)}ms` : '-';
  return `${frame.scantime} (${deltaStr})`;
}

function formatFingers(frame: FingerFrame): string {
  const count = frame.fingers.length;
  if (count === 0) return '-';
  const slots = frame.fingers.map(f => {
    const state = f.state || f.touchState || 0;
    return `(${f.id},${state},${f.x},${f.y})`;
  }).join(',');
  return `${count}${slots}`;
}

function formatStylus(frame: FingerFrame): string {
  if (!frame.stylus) return '-';
  const s = frame.stylus;
  return `${s.state || 0} (${s.x}, ${s.y}, ${s.pressure || 0})`;
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
        <span style={{ width: 40 }}>#</span>
        <span style={{ width: 100 }}>Scan (100us)/Δ</span>
        <span style={{ flex: 1 }}>Fingers</span>
        <span style={{ width: 120 }}>Stylus</span>
        <span style={{ width: 40 }}>Pkt</span>
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
              <span style={{ width: 40, color: isActive ? '#6a9955' : '#858585' }}>{index}</span>
              <span style={{ width: 100 }}>{formatTimestamp(frame, prevScantime)}</span>
              <span style={{ flex: 1, color: '#ce9178' }}>{formatFingers(frame)}</span>
              <span style={{ width: 120, color: '#4ecdc4' }}>{formatStylus(frame)}</span>
              <span style={{ width: 40, color: '#808080' }}>{frame.packetType}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FrameListView;