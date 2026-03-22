# Record/Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recording and playback functionality for finger trajectory data

**Architecture:** Recording captures FingerFrame objects during live UDP reception. Playback reads recorded files (JSON or Saleae TXT) and emits frames at controlled speed. IPC bridges renderer requests to main process for file operations.

**Tech Stack:** React hooks, Electron IPC (dialog, fs), JSON parsing

---

## File Structure

```
src/
├── types/
│   └── recording.ts       # NEW: Recording file types
├── hooks/
│   ├── useRecorder.ts     # NEW: Recording state management
│   └── usePlayer.ts       # NEW: Playback state management
├── components/
│   └── PlaybackControls.tsx  # NEW: Playback UI controls
├── App.tsx                # MODIFY: Add toolbar + playback controls
├── main.ts               # MODIFY: Add IPC handlers for file ops
└── preload.ts            # MODIFY: Add file dialog APIs
```

---

## Task 1: Add Recording Types

**Files:**
- Create: `touchpad-tracker/src/types/recording.ts`

```typescript
export interface RecordedFrame {
  timestamp: number;
  packetType: 47 | 32;
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
}

export interface RecordingFile {
  version: number;
  recordedAt: string;
  config: TouchpadConfig;
  frames: RecordedFrame[];
}
```

- [ ] **Step 1: Create recording types file**

- [ ] **Step 2: Commit**

```bash
git add src/types/recording.ts
git commit -m "feat: add recording types"
```

---

## Task 2: Add IPC Handlers for File Operations

**Files:**
- Modify: `touchpad-tracker/src/main.ts`
- Modify: `touchpad-tracker/src/preload.ts`

Add to main.ts:
```typescript
import { dialog } from 'electron';

// IPC handler for saving recording
ipcMain.handle('save-recording', async (_event, data: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Recording',
    defaultPath: `touchpad-recording-${Date.now()}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePath) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(result.filePath, data, 'utf-8');
    return result.filePath;
  }
  return null;
});

// IPC handler for loading recording
ipcMain.handle('load-recording', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open Recording',
    filters: [
      { name: 'Recording Files', extensions: ['json'] },
      { name: 'Saleae TXT Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(result.filePaths[0], 'utf-8');
    return { path: result.filePaths[0], content };
  }
  return null;
});
```

Add to preload.ts:
```typescript
saveRecording: (data: string): Promise<string | null> => {
  return ipcRenderer.invoke('save-recording', data);
},
loadRecording: (): Promise<{ path: string; content: string } | null> => {
  return ipcRenderer.invoke('load-recording');
},
```

- [ ] **Step 1: Add IPC handlers to main.ts**

- [ ] **Step 2: Add file dialog APIs to preload.ts**

- [ ] **Step 3: Commit**

```bash
git add src/main.ts src/preload.ts
git commit -m "feat: add IPC handlers for file dialogs"
```

---

## Task 3: Create useRecorder Hook

**Files:**
- Create: `touchpad-tracker/src/hooks/useRecorder.ts`

```typescript
import { useState, useCallback, useRef } from 'react';
import { FingerFrame, TouchpadConfig } from '../types/finger';
import { RecordingFile } from '../types/recording';

export interface UseRecorderReturn {
  isRecording: boolean;
  startRecording: (config: TouchpadConfig) => void;
  stopRecording: () => Promise<string | null>;
  addFrame: (frame: FingerFrame) => void;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const framesRef = useRef<FingerFrame[]>([]);
  const configRef = useRef<TouchpadConfig | null>(null);

  const startRecording = useCallback((config: TouchpadConfig) => {
    framesRef.current = [];
    configRef.current = config;
    setIsRecording(true);
  }, []);

  const addFrame = useCallback((frame: FingerFrame) => {
    if (isRecording) {
      framesRef.current.push(frame);
    }
  }, [isRecording]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    setIsRecording(false);
    const recording: RecordingFile = {
      version: 1,
      recordedAt: new Date().toISOString(),
      config: configRef.current!,
      frames: framesRef.current,
    };
    const json = JSON.stringify(recording, null, 2);
    const filePath = await window.electronAPI.saveRecording(json);
    return filePath;
  }, []);

  return { isRecording, startRecording, stopRecording, addFrame };
}
```

- [ ] **Step 1: Create useRecorder hook**

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useRecorder.ts
git commit -m "feat: add useRecorder hook"
```

---

## Task 4: Create usePlayer Hook

**Files:**
- Create: `touchpad-tracker/src/hooks/usePlayer.ts`

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import { FingerFrame } from '../types/finger';
import { RecordingFile } from '../types/recording';

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export interface UsePlayerReturn {
  isPlaying: boolean;
  currentFrameIndex: number;
  totalFrames: number;
  speed: PlaybackSpeed;
  isLoaded: boolean;
  loadRecording: (content: string) => boolean;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  seek: (index: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  getCurrentFrame: () => FingerFrame | null;
}

export function usePlayer(onFrame: (frame: FingerFrame) => void): UsePlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [isLoaded, setIsLoaded] = useState(false);

  const framesRef = useRef<FingerFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const lastScantimeRef = useRef<number>(0);

  const loadRecording = useCallback((content: string): boolean => {
    try {
      const data = JSON.parse(content);
      if (data.frames && Array.isArray(data.frames)) {
        framesRef.current = data.frames;
        setTotalFrames(data.frames.length);
        setCurrentFrameIndex(0);
        setIsLoaded(true);
        lastScantimeRef.current = 0;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const seek = useCallback((index: number) => {
    if (index >= 0 && index < framesRef.current.length) {
      setCurrentFrameIndex(index);
      onFrame(framesRef.current[index]);
    }
  }, [onFrame]);

  const stepForward = useCallback(() => {
    const nextIndex = Math.min(currentFrameIndex + 1, totalFrames - 1);
    seek(nextIndex);
  }, [currentFrameIndex, totalFrames, seek]);

  const stepBackward = useCallback(() => {
    const prevIndex = Math.max(currentFrameIndex - 1, 0);
    seek(prevIndex);
  }, [currentFrameIndex, seek]);

  const play = useCallback(() => {
    if (framesRef.current.length === 0) return;
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const setSpeed = useCallback((newSpeed: PlaybackSpeed) => {
    setSpeedState(newSpeed);
  }, []);

  const getCurrentFrame = useCallback((): FingerFrame | null => {
    return framesRef.current[currentFrameIndex] || null;
  }, [currentFrameIndex]);

  // Playback loop
  useEffect(() => {
    if (isPlaying && framesRef.current.length > 0) {
      const advanceFrame = () => {
        setCurrentFrameIndex(prev => {
          const next = prev + 1;
          if (next >= framesRef.current.length) {
            setIsPlaying(false);
            return prev;
          }
          onFrame(framesRef.current[next]);
          return next;
        });
      };

      // Calculate interval based on speed and scantime
      const frame = framesRef.current[currentFrameIndex];
      if (frame) {
        let interval: number;
        if (lastScantimeRef.current > 0) {
          let delta = frame.scantime - lastScantimeRef.current;
          if (delta < 0) delta += 65536;
          interval = delta / 10 / speed; // delta in 100us, convert to ms
        } else {
          interval = 1000 / speed; // fallback: 1 second
        }
        lastScantimeRef.current = frame.scantime;
        intervalRef.current = window.setTimeout(advanceFrame, Math.max(interval, 1));
      }

      return () => {
        if (intervalRef.current) {
          clearTimeout(intervalRef.current);
        }
      };
    }
  }, [isPlaying, currentFrameIndex, speed, onFrame]);

  return {
    isPlaying,
    currentFrameIndex,
    totalFrames,
    speed,
    isLoaded,
    loadRecording,
    play,
    pause,
    stepForward,
    stepBackward,
    seek,
    setSpeed,
    getCurrentFrame,
  };
}
```

- [ ] **Step 1: Create usePlayer hook**

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePlayer.ts
git commit -m "feat: add usePlayer hook"
```

---

## Task 5: Create PlaybackControls Component

**Files:**
- Create: `touchpad-tracker/src/components/PlaybackControls.tsx`

```typescript
import React from 'react';
import { PlaybackSpeed } from '../hooks/usePlayer';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  speed: PlaybackSpeed;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
}

const SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  currentFrame,
  totalFrames,
  speed,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onSeek,
  onSpeedChange,
}) => {
  const progress = totalFrames > 0 ? (currentFrame / (totalFrames - 1)) * 100 : 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 16px',
      background: '#252526',
      borderTop: '1px solid #3c3c3c',
    }}>
      {/* Step backward */}
      <button onClick={onStepBackward} style={buttonStyle}>◀◀</button>

      {/* Play/Pause */}
      <button onClick={isPlaying ? onPause : onPlay} style={buttonStyle}>
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Step forward */}
      <button onClick={onStepForward} style={buttonStyle}>▶▶</button>

      {/* Progress bar */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40 }}>
          {currentFrame}
        </span>
        <div
          style={{
            flex: 1,
            height: 4,
            background: '#3c3c3c',
            borderRadius: 2,
            cursor: 'pointer',
            position: 'relative',
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const index = Math.floor(percent * totalFrames);
            onSeek(Math.max(0, Math.min(index, totalFrames - 1)));
          }}
        >
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: '#6a9955',
            borderRadius: 2,
          }} />
        </div>
        <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40 }}>
          {totalFrames}
        </span>
      </div>

      {/* Speed selector */}
      <select
        value={speed}
        onChange={(e) => onSpeedChange(parseFloat(e.target.value) as PlaybackSpeed)}
        style={{
          background: '#3c3c3c',
          color: '#d4d4d4',
          border: 'none',
          padding: '2px 6px',
          borderRadius: 2,
          fontSize: 11,
        }}
      >
        {SPEEDS.map(s => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
};

const buttonStyle: React.CSSProperties = {
  background: '#3c3c3c',
  border: 'none',
  color: '#d4d4d4',
  padding: '4px 10px',
  borderRadius: 2,
  cursor: 'pointer',
  fontSize: 12,
};
```

- [ ] **Step 1: Create PlaybackControls component**

- [ ] **Step 2: Commit**

```bash
git add src/components/PlaybackControls.tsx
git commit -m "feat: add PlaybackControls component"
```

---

## Task 6: Integrate into App.tsx

**Files:**
- Modify: `touchpad-tracker/src/App.tsx`

Add state and integrate hooks:
```typescript
// Add to App.tsx
const [isRecording, setIsRecording] = useState(false);
const [isPlaying, setIsPlaying] = useState(false);
const [playbackMode, setPlaybackMode] = useState(false);
const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
const [totalFrames, setTotalFrames] = useState(0);
const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);

// Handler for when player emits a frame
const handlePlaybackFrame = useCallback((frame: FingerFrame) => {
  // Send to TrajectoryView via ref or callback
  trajectoriesCallbackRef.current(frame);
}, []);

// Open file handler
const handleOpenFile = async () => {
  const result = await window.electronAPI.loadRecording();
  if (result) {
    const loaded = player.loadRecording(result.content);
    if (loaded) {
      setPlaybackMode(true);
      setTotalFrames(player.totalFrames);
    }
  }
};
```

Update header with REC/PLAY buttons and add PlaybackControls below main.

- [ ] **Step 1: Update App.tsx with recording/playback state and handlers**

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate record/playback into App"
```

---

## Task 7: Implement Saleae TXT File Parser

**Files:**
- Create: `touchpad-tracker/src/utils/parseSaleaeTXT.ts`

Saleae Logic exports TXT with format:
```
{timestamp} {address} {data0} {data1} ...
```

Need to extract I2C TX frames where address matches 0x2C and data starts with 0x2F or 0x20.

- [ ] **Step 1: Create TXT parser utility**

- [ ] **Step 2: Integrate into file loading flow**

- [ ] **Step 3: Commit**

---

## Task 8: Add Keyboard Shortcuts

Add global keyboard listener in App.tsx for:
- R: Toggle recording
- Space: Play/Pause
- Left/Right arrows: Step frame

- [ ] **Step 1: Add keyboard event listener**

- [ ] **Step 2: Commit**

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Recording types |
| 2 | IPC handlers for file dialogs |
| 3 | useRecorder hook |
| 4 | usePlayer hook |
| 5 | PlaybackControls component |
| 6 | Integrate into App |
| 7 | Saleae TXT parser |
| 8 | Keyboard shortcuts |
