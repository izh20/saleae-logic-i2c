# Debug View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent Debug View tab that parses the 32 debug bytes (15-46) from stylus packets as 16 s16 little-endian channels, displays them in a scrollable table with switchable numeric format, and supports both live and playback modes.

**Architecture:** Two parsing layers (UDP path in `main.ts` and CSV path in `parseSaleaeTXT.ts`) gain a `parseDebugChannels` helper that populates a new optional `debugChannels?: number[]` field on `FingerFrame`. A new `DebugView.tsx` component mirrors `FrameListView.tsx` patterns (live frames ref / player frames / scrollable rows) with one row per frame and columns D0..D15.

**Tech Stack:** React 19, TypeScript 4.5, Electron 33, no test framework (manual verification only)

**Critical user constraint:** Per user request, **DO NOT commit or push code**. After all tasks complete, stop and wait for user verification before staging/committing/pushing.

---

## File Structure

```
src/
├── types/
│   └── finger.ts                 # MODIFY: add debugChannels? to FingerFrame
├── main.ts                       # MODIFY: parseStylusFrame reads bytes[15..46]
├── utils/
│   └── parseSaleaeTXT.ts         # MODIFY: parseStylusFrameFromData + frameLen 15→47
├── App.tsx                       # MODIFY: add 'debug' to viewMode union + nav button
└── components/
    └── DebugView.tsx             # NEW: scrollable debug table component

docs:
├── superpowers/
│   ├── specs/2026-06-11-debug-view-design.md  (already created)
│   └── plans/2026-06-11-debug-view-implementation.md  (this file)
└── README.md                     # MODIFY: append Debug View section
```

---

## Task 1: Add `debugChannels` Field to FingerFrame Type

**Files:**
- Modify: `touchpad-tracker/src/types/finger.ts:27-35`

- [ ] **Step 1: Edit `FingerFrame` interface**

In `touchpad-tracker/src/types/finger.ts`, locate the `FingerFrame` interface (lines 27-35) and replace with:

```typescript
// Complete finger frame from HID packet
export interface FingerFrame {
  timestamp: number;
  packetType: 47 | 32;
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
  stylus?: StylusSlot;       // 笔数据 (0-14 字节)
  debugChannels?: number[];  // 调试数据 (15-46 字节，16 个 s16 小端值)
}
```

- [ ] **Step 2: Verify type compiles**

Run: `cd touchpad-tracker && npx tsc --noEmit`
Expected: No errors. Other files reference `FingerFrame` as a structural type; the new optional field is backwards compatible.

- [ ] **Step 3: Stage and verify (do NOT commit yet)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add touchpad-tracker/src/types/finger.ts
git status -s
```

Expected: `M  touchpad-tracker/src/types/finger.ts` shows in status.

**Do not run `git commit`.** Tasks 2-7 will all be staged together after verification.

---

## Task 2: Update `parseStylusFrame` in main.ts (UDP Path)

**Files:**
- Modify: `touchpad-tracker/src/main.ts:113-145`

- [ ] **Step 1: Replace `parseStylusFrame` function**

In `touchpad-tracker/src/main.ts`, replace the entire `parseStylusFrame` function (lines 113-145) with:

```typescript
// Parse bytes[15..46] as 16 s16 little-endian debug values.
// Returns 16 zeros if data is shorter than 47 bytes.
function parseDebugChannels(data: string[]): number[] {
  const channels: number[] = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offset = 15 + i * 2;
    if (offset + 1 >= data.length) break;
    const low = parseHexOrDec(data[offset]);
    const high = parseHexOrDec(data[offset + 1]);
    channels[i] = ((low | (high << 8)) << 16) >> 16;
  }
  return channels;
}

// Parse I2C data array to stylus frame
function parseStylusFrame(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 15) return null;

  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for stylus packet header (0x2F 0x00 0x08)
  const isStylus = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x08;
  if (!isStylus) return null;

  // Stylus packet: bytes 0-14 are stylus data, bytes 15-46 are debug channels
  const stylus: StylusSlot = {
    stylusId: parseHexOrDec(data[4]),
    state: parseHexOrDec(data[3]) as StylusState,
    x: parseHexOrDec(data[5]) | (parseHexOrDec(data[6]) << 8),
    y: parseHexOrDec(data[7]) | (parseHexOrDec(data[8]) << 8),
    tipPressure: parseHexOrDec(data[9]) | (parseHexOrDec(data[10]) << 8),
    xTilt: (parseHexOrDec(data[11]) | (parseHexOrDec(data[12]) << 8)) << 16 >> 16,
    yTilt: (parseHexOrDec(data[13]) | (parseHexOrDec(data[14]) << 8)) << 16 >> 16,
  };

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
    debugChannels: parseDebugChannels(data),
  };
}
```

- [ ] **Step 2: Verify type compiles**

Run: `cd touchpad-tracker && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Stage (do NOT commit)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add touchpad-tracker/src/main.ts
git status -s
```

---

## Task 3: Update `parseSaleaeTXT.ts` (CSV Path)

**Files:**
- Modify: `touchpad-tracker/src/utils/parseSaleaeTXT.ts:111-141` (parseStylusFrameFromData)
- Modify: `touchpad-tracker/src/utils/parseSaleaeTXT.ts:222-241` (frameLen in parseSaleaeCSVInternal)

- [ ] **Step 1: Add `parseDebugChannels` helper and update `parseStylusFrameFromData`**

In `touchpad-tracker/src/utils/parseSaleaeTXT.ts`, replace the `parseStylusFrameFromData` function (lines 110-141) with:

```typescript
// Parse bytes[15..46] as 16 s16 little-endian debug values.
// Returns 16 zeros if data is shorter than 47 bytes.
function parseDebugChannels(data: string[]): number[] {
  const channels: number[] = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offset = 15 + i * 2;
    if (offset + 1 >= data.length) break;
    const low = parseHexOrDec(data[offset]);
    const high = parseHexOrDec(data[offset + 1]);
    channels[i] = ((low | (high << 8)) << 16) >> 16;
  }
  return channels;
}

// Parse stylus frame from data (15 bytes stylus + 32 bytes debug = 47 bytes total)
function parseStylusFrameFromData(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 15) return null;

  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for stylus packet header
  const isStylus = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x08;
  if (!isStylus) return null;

  const stylus: StylusSlot = {
    stylusId: parseHexOrDec(data[4]),
    state: parseHexOrDec(data[3]) as StylusState,
    x: parseHexOrDec(data[5]) | (parseHexOrDec(data[6]) << 8),
    y: parseHexOrDec(data[7]) | (parseHexOrDec(data[8]) << 8),
    tipPressure: parseHexOrDec(data[9]) | (parseHexOrDec(data[10]) << 8),
    xTilt: (parseHexOrDec(data[11]) | (parseHexOrDec(data[12]) << 8)) << 16 >> 16,
    yTilt: (parseHexOrDec(data[13]) | (parseHexOrDec(data[14]) << 8)) << 16 >> 16,
  };

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
    debugChannels: parseDebugChannels(data),
  };
}
```

- [ ] **Step 2: Update `frameLen` in `parseSaleaeCSVInternal` from 15 to 47**

In the same file, locate the stylus frame detection block (around line 222-241) and change:

```typescript
    if (isStylus) {
      // Stylus packet only has 15 bytes valid
      const frameLen = 15;
      const endIdx = i + frameLen;
```

to:

```typescript
    if (isStylus) {
      // Stylus packet: 15 bytes stylus data + 32 bytes debug channels = 47 bytes total
      const frameLen = 47;
      const endIdx = i + frameLen;
```

- [ ] **Step 3: Verify type compiles**

Run: `cd touchpad-tracker && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Stage (do NOT commit)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add touchpad-tracker/src/utils/parseSaleaeTXT.ts
git status -s
```

---

## Task 4: Create DebugView Component

**Files:**
- Create: `touchpad-tracker/src/components/DebugView.tsx`

- [ ] **Step 1: Create new component file**

Create `touchpad-tracker/src/components/DebugView.tsx` with this content:

```typescript
import React, { useState, useRef, useEffect } from 'react';
import { FingerFrame, StylusState } from '../types/finger';

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
// 60 (row#) + 120 (scan) + 100 (stylus) + 16*70 (channels) = 1400px
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
```

- [ ] **Step 2: Verify type compiles**

Run: `cd touchpad-tracker && npx tsc --noEmit`
Expected: No errors. (`DebugView` is not imported by any file yet, so unused-export warnings may appear depending on tsconfig; ignore them or verify there's no `noUnusedLocals` setting.)

- [ ] **Step 3: Stage (do NOT commit)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add touchpad-tracker/src/components/DebugView.tsx
git status -s
```

---

## Task 5: Integrate Debug Tab into App.tsx

**Files:**
- Modify: `touchpad-tracker/src/App.tsx`

This task has 4 sub-steps. Apply them in order.

- [ ] **Step 1: Extend `ViewMode` type and add debug pause state**

In `touchpad-tracker/src/App.tsx`, locate the `ViewMode` type (around line 12) and replace:

```typescript
  type ViewMode = 'live' | 'playback' | 'frameList';
```

with:

```typescript
  type ViewMode = 'live' | 'playback' | 'frameList' | 'debug';
```

Then locate the `isFrameListPausedRef` declaration (around line 34) and add immediately after it:

```typescript
  // Debug view pause state (independent from frameList pause)
  const isDebugPausedRef = useRef(false);
```

- [ ] **Step 2: Update the `useEffect` that tracks `prevViewModeRef`**

Locate the `useEffect` that handles `prevViewModeRef` and `isFrameListActiveRef` (around lines 62-69). Replace its body so it also tracks debug active state:

```typescript
  useEffect(() => {
    // Track previous mode for back button (frameList and debug both have back behavior)
    if (viewMode !== 'frameList' && viewMode !== 'debug') {
      prevViewModeRef.current = viewMode;
    }
    // Sync frame list active state
    isFrameListActiveRef.current = viewMode === 'frameList';
  }, [viewMode]);
```

(No change needed to the dependency list.)

- [ ] **Step 3: Add Debug nav button + Back button, and render DebugView**

Apply these four sub-edits in order. They are designed to be made in a single coherent edit to `App.tsx`; the order below is for clarity.

**3a. Add refs for debug state.** Locate the existing `isFrameListActiveRef` declaration (around line 33) and add the debug refs immediately after it:

```typescript
  const isDebugActiveRef = useRef(false);
```

**3b. Update the `useEffect` that tracks `prevViewModeRef`** (from Step 2) to also sync debug active state. The new body should be:

```typescript
  useEffect(() => {
    // Track previous mode for back button (frameList and debug both have back behavior)
    if (viewMode !== 'frameList' && viewMode !== 'debug') {
      prevViewModeRef.current = viewMode;
    }
    // Sync frame list active state
    isFrameListActiveRef.current = viewMode === 'frameList';
    // Sync debug active state
    isDebugActiveRef.current = viewMode === 'debug';
  }, [viewMode]);
```

(No change to the dependency list.)

**3c. Add Debug nav button.** In the header `<header>` section, locate the existing Frame List button block (around lines 366-381). Add the Debug button immediately after the Frame List button:

```tsx
        {/* Debug button - available in both live and playback modes (not in frameList) */}
        {viewMode !== 'debug' && viewMode !== 'frameList' && (
          <button
            onClick={() => setViewMode('debug')}
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
            Debug
          </button>
        )}
```

**3d. Extend the existing Back button to cover debug mode.** Locate the existing Back button JSX (around lines 384-399):

```tsx
        {/* Back button - returns to previous mode (live or playback) */}
        {viewMode === 'frameList' && (
```

Replace the single-line condition with `(viewMode === 'frameList' || viewMode === 'debug')` so the Back button appears in both modes. The full block becomes:

```tsx
        {/* Back button - returns to previous mode (live or playback) for frameList and debug */}
        {(viewMode === 'frameList' || viewMode === 'debug') && (
          <button
            onClick={() => setViewMode(prevViewModeRef.current)}
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
            ← Back
          </button>
        )}
```

**3e. Render DebugView in main content.** Locate the main content `<main>` block (around lines 454-479). Add a new branch for `viewMode === 'debug'` immediately after the `frameList` branch:

```tsx
        {viewMode === 'debug' && (
          <DebugView
            frames={isDebugActiveRef.current ? liveFramesRef.current : player.getFrames()}
            currentFrameIndex={isDebugActiveRef.current ? liveFramesRef.current.length - 1 : player.currentFrameIndex}
            isLiveMode={isDebugActiveRef.current}
            liveFramesRef={isDebugActiveRef.current ? liveFramesRef : null}
            liveFrameCount={liveFrameCount}
            isPaused={isDebugPausedRef.current}
            onPause={() => { isDebugPausedRef.current = true; }}
            onResume={() => { isDebugPausedRef.current = false; }}
            onClear={() => { liveFramesRef.current = []; setLiveFrameCount(0); }}
            onSelectFrame={prevViewModeRef.current === 'playback' ? (index) => {
              const isBackward = index < player.currentFrameIndex;
              setViewMode('playback');
              player.seek(index, isBackward);
            } : undefined}
          />
        )}
```

- [ ] **Step 4: Add `DebugView` import**

At the top of `App.tsx`, locate the existing import of `FrameListView` (around line 5):

```typescript
import FrameListView from './components/FrameListView';
```

Add a new import line immediately after:

```typescript
import DebugView from './components/DebugView';
```

- [ ] **Step 5: Verify type compiles**

Run: `cd touchpad-tracker && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Stage (do NOT commit)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add touchpad-tracker/src/App.tsx
git status -s
```

---

## Task 6: Build Project

**Files:** (no source changes; verification only)

- [ ] **Step 1: Run the production build**

Run: `cd touchpad-tracker && npm run build`
Expected: Build completes successfully. Some deprecation warnings from electron-forge are acceptable; no TypeScript or Vite errors.

If the build fails, stop and report the error before continuing.

- [ ] **Step 2: Verify build output exists**

Run: `ls -la /Users/zhouheng/claude/saleae-logic-proc/touchpad-tracker/out/make/`
Expected: A directory exists for the current platform (e.g., `darwin/` or `zip/`).

---

## Task 7: Manual Verification (Pre-Upload Gate)

**Per user constraint, do NOT commit. Stop here and report results to user.**

- [ ] **Step 1: Type check**

Run: `cd /Users/zhouheng/claude/saleae-logic-proc/touchpad-tracker && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Build**

Run: `cd /Users/zhouheng/claude/saleae-logic-proc/touchpad-tracker && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Sanity-check the parser on a synthetic 47-byte stylus frame**

This is a manual smoke test, not a unit test. Open a Node REPL or create a one-off script:

```bash
cd /Users/zhouheng/claude/saleae-logic-proc/touchpad-tracker
node -e "
const { parseSaleaeCSV } = require('./src/utils/parseSaleaeTXT');
" 2>&1 || true
```

If the above doesn't work (the source is TypeScript), instead inspect the rendered DOM/parser logic by reading the file. Confirm visually that:
- `parseDebugChannels` returns a 16-element array
- The shift pattern `((low | (high << 8)) << 16) >> 16` matches the existing xTilt/yTilt pattern in `main.ts:132-133`

- [ ] **Step 4: Inspect the staged diff**

Run:
```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git status -s
git diff --staged --stat
```

Expected: 4 files staged, all from `touchpad-tracker/src/`:
- `touchpad-tracker/src/types/finger.ts`
- `touchpad-tracker/src/main.ts`
- `touchpad-tracker/src/utils/parseSaleaeTXT.ts`
- `touchpad-tracker/src/App.tsx`
- `touchpad-tracker/src/components/DebugView.tsx` (new)

- [ ] **Step 5: Report results to user and STOP**

Do **NOT** run `git commit` or `git push`. Report:
- The list of staged files
- The build result
- The type-check result
- Any observations from the diff

Wait for the user to review and explicitly authorize commit/push.

---

## Task 8: Update README.md (Optional Documentation)

**Files:**
- Modify: `README.md` (append a "Debug View" section near the existing 功能说明 or 笔轨迹显示 section)

- [ ] **Step 1: Append a Debug View section to README.md**

Locate the "笔轨迹显示" section in `README.md` (around line 76-85). Immediately after it, add a new section:

```markdown
### Debug 调试视图

- 顶部导航新增 `Debug` 按钮，切换到独立调试数据视图
- **数据来源**：笔数据包（0x2F 0x00 0x08）后 32 字节（bytes 15-46）解析为 16 个 s16 小端通道
- **格式切换**：支持 `Dec (s16)` / `Dec (u16)` / `Hex` / `Binary` 四种显示格式
- **历史保留**：最近 200 帧可滚动查看
- **Live 模式**：实时累计数据，支持 Pause/Resume/Clear
- **Playback 模式**：支持点击行跳转至对应帧
- **返回**：Debug 视图通过 `← Back` 按钮返回上一个视图（live 或 playback）
```

- [ ] **Step 2: Stage (do NOT commit)**

```bash
cd /Users/zhouheng/claude/saleae-logic-proc
git add README.md
git status -s
```

This task is optional polish. The user may defer it to a follow-up commit.

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add `debugChannels?` to `FingerFrame` type |
| 2 | Update `parseStylusFrame` in `main.ts` |
| 3 | Update `parseSaleaeTXT.ts` (helper + frameLen 15→47) |
| 4 | Create `DebugView.tsx` component |
| 5 | Integrate Debug tab into `App.tsx` |
| 6 | Build project |
| 7 | Manual verification (no commit) |
| 8 | (Optional) Update README.md |

**Stop at Task 7 Step 5 and wait for user authorization before commit/push.**
