import React, { useState, useRef, useEffect } from 'react';
import { FingerFrame } from '../types/finger';

type DebugFormat = 'dec-s16' | 'dec-u16' | 'hex' | 'bin';

const FORMAT_OPTIONS: { value: DebugFormat; label: string }[] = [
  { value: 'dec-s16', label: 'Dec (s16)' },
  { value: 'dec-u16', label: 'Dec (u16)' },
  { value: 'hex', label: 'Hex' },
  { value: 'bin', label: 'Binary' },
];

const STYLUS_STATE_NAMES: Record<number, string> = {
  0x00: 'release',
  0x20: 'hover',
  0x21: 'tip',
};

function formatChannelValue(value: number, format: DebugFormat): string {
  switch (format) {
    case 'dec-s16':
      return value.toString();
    case 'dec-u16': {
      const u = value & 0xFFFF;
      return u.toString();
    }
    case 'hex': {
      const u = value & 0xFFFF;
      return '0x' + u.toString(16).toUpperCase().padStart(4, '0');
    }
    case 'bin': {
      const u = value & 0xFFFF;
      return u.toString(2).padStart(16, '0');
    }
  }
}

function formatTimestamp(frame: FingerFrame, prevScantime: number): string {
  const delta = prevScantime >= 0 ? (frame.scantime - prevScantime) / 10.0 : 0;
  const deltaStr = delta > 0 ? `+${delta.toFixed(1)}ms` : '-';
  return `${frame.scantime.toString().padStart(10)} (${deltaStr})`;
}

function formatStylusState(frame: FingerFrame): string {
  if (!frame.stylus) return '-';
  return STYLUS_STATE_NAMES[frame.stylus.state] ?? `0x${frame.stylus.state.toString(16)}`;
}

const ROW_HEIGHT = 28;
const MAX_DEBUG_FRAMES = 200;
const CHANNEL_COUNT = 16;
const CHANNEL_COL_WIDTH = 70;
const STYLUS_COL_WIDTH = 100;
const SCAN_COL_WIDTH = 120;
const ROW_NUM_COL_WIDTH = 60;

interface DebugViewProps {
  frames: FingerFrame[];
  currentFrameIndex: number;
  isLiveMode?: boolean;
  liveFramesRef?: React.MutableRefObject<FingerFrame[]> | null;
  liveFrameCount?: number;
  onPause?: () => void;
  onResume?: () => void;
  onClear?: () => void;
  isPaused?: boolean;
  onSelectFrame?: (index: number) => void;
}

const DebugView: React.FC<DebugViewProps> = ({
  frames,
  currentFrameIndex,
  isLiveMode = false,
  liveFramesRef,
  liveFrameCount = 0,
  onPause,
  onResume,
  onClear,
  isPaused = false,
  onSelectFrame,
}) => {
  const [format, setFormat] = useState<DebugFormat>('dec-s16');
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve source frames
  const sourceFrames = isLiveMode && liveFramesRef ? liveFramesRef.current : frames;

  // Trim to last MAX_DEBUG_FRAMES
  const displayFrames = sourceFrames.length > MAX_DEBUG_FRAMES
    ? sourceFrames.slice(sourceFrames.length - MAX_DEBUG_FRAMES)
    : sourceFrames;

  // Force re-render in live mode
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (isLiveMode && liveFrameCount > 0) {
      forceUpdate(n => n + 1);
    }
  }, [liveFrameCount, isLiveMode]);

  // Auto-scroll to bottom in live mode
  useEffect(() => {
    if (isLiveMode && !isPaused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [liveFrameCount, isLiveMode, isPaused]);

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
          alignItems: 'center',
        }}
      >
        <label style={{ fontSize: 12, color: '#d4d4d4' }}>
          Format:{' '}
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as DebugFormat)}
            style={{
              background: '#3c3c3c',
              color: '#d4d4d4',
              border: 'none',
              padding: '2px 6px',
              borderRadius: 2,
              fontSize: 12,
            }}
          >
            {FORMAT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        {isLiveMode && (
          <>
            <button
              onClick={isPaused ? onResume : onPause}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                background: '#3c3c3c',
                color: '#d4d4d4',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={onClear}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                background: '#3c3c3c',
                color: '#d4d4d4',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Clear
            </button>
          </>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#858585' }}>
          {displayFrames.length} frames
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
        <span style={{ width: ROW_NUM_COL_WIDTH }}>#</span>
        <span style={{ width: SCAN_COL_WIDTH }}>Scan(100μs)/Δ</span>
        <span style={{ width: STYLUS_COL_WIDTH }}>Stylus</span>
        {Array.from({ length: CHANNEL_COUNT }, (_, i) => (
          <span
            key={i}
            style={{
              width: CHANNEL_COL_WIDTH,
              textAlign: 'right',
              paddingRight: 8,
            }}
          >
            D{i}
          </span>
        ))}
      </div>

      {/* Scrollable frame list */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
        }}
      >
        {displayFrames.map((frame, localIndex) => {
          // Compute actual index in source frames
          const sourceIndex = sourceFrames.length - displayFrames.length + localIndex;
          const isActive = sourceIndex === currentFrameIndex;
          const prevScantime = localIndex > 0 ? displayFrames[localIndex - 1].scantime : -1;
          const hasDebug = !!frame.debugChannels;
          const channels = frame.debugChannels;

          return (
            <div
              key={sourceIndex}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                height: ROW_HEIGHT,
                background: isActive ? '#264f78' : localIndex % 2 === 0 ? '#1e1e1e' : '#252526',
                color: isActive ? '#ffffff' : '#d4d4d4',
                fontSize: 12,
                fontFamily: 'monospace',
                cursor: !isLiveMode && onSelectFrame ? 'pointer' : 'default',
                borderBottom: '1px solid #3c3c3c',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
              }}
              onClick={() => !isLiveMode && onSelectFrame?.(sourceIndex)}
            >
              <span style={{ width: ROW_NUM_COL_WIDTH, textAlign: 'left', color: isActive ? '#6a9955' : '#858585' }}>
                {String(sourceIndex).padStart(5, '0')}
              </span>
              <span style={{ width: SCAN_COL_WIDTH }}>{formatTimestamp(frame, prevScantime)}</span>
              <span style={{ width: STYLUS_COL_WIDTH, color: '#4ecdc4' }}>{formatStylusState(frame)}</span>
              {Array.from({ length: CHANNEL_COUNT }, (_, i) => {
                let display: string;
                let color: string;
                if (!hasDebug || channels![i] === undefined) {
                  display = '—';
                  color = '#5a5a5a';
                } else {
                  display = formatChannelValue(channels![i], format);
                  color = isActive ? '#ffffff' : '#ce9178';
                }
                return (
                  <span
                    key={i}
                    style={{
                      width: CHANNEL_COL_WIDTH,
                      textAlign: 'right',
                      paddingRight: 8,
                      color,
                    }}
                  >
                    {display}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DebugView;
