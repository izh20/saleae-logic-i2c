import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  FingerFrame,
  FingerSlot,
  FingerTrajectory,
  TouchState,
  StylusState,
  FINGER_COLORS,
  STYLUS_COLOR,
  STYLUS_HOVER_COLOR,
  TouchpadConfig,
  StylusSlot,
} from '../types/finger';

// Frame diff for undo/redo
interface FrameDiff {
  // finger release 事件：删除的轨迹（恢复时原样放回）
  deletedFingerTrajectories: Map<number, FingerTrajectory>;
  // finger touch 事件：追加了点的 fingerId 列表（撤销时 pop 最后一个点）
  appendedFingerIds: number[];
  // stylus touch/hover 事件：追加前的点数量（撤销时截断到该数量）
  stylusPointsBefore: number;
  // stylus release 事件：删除前的完整 stylus 轨迹（恢复时原样放回）
  deletedStylusTrajectory: { x: number; y: number; state: StylusState }[] | null;
}

// Snapshot for fast seek
interface Snapshot {
  index: number;
  trajectories: Map<number, FingerTrajectory>;
  stylusTrajectory: { x: number; y: number; state: StylusState }[];
  undoStack: FrameDiff[];
}

interface PlaybackViewProps {
  config: TouchpadConfig;
  currentFrame: FingerFrame | null;
  onClearRef?: (callback: () => void) => void;
  onStepModeRef?: (callback: (isStepMode: boolean) => void) => void;
  onDirectFrameRef?: (callback: (frame: FingerFrame) => void) => void;
  onUndoFrameRef?: (callback: () => void) => void;
  onFrameIndexRef?: (callback: (index: number) => void) => void;
}

const PlaybackView: React.FC<PlaybackViewProps> = ({ config, currentFrame, onClearRef, onStepModeRef, onDirectFrameRef, onUndoFrameRef, onFrameIndexRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoriesRef = useRef<Map<number, FingerTrajectory>>(new Map());
  const stylusTrajectoryRef = useRef<{ x: number; y: number; state: StylusState }[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Undo stack for O(1) frame undo
  const undoStackRef = useRef<FrameDiff[]>([]);
  // Snapshots for fast seek (every 200 frames)
  const SNAPSHOT_INTERVAL = 200;
  const snapshotsRef = useRef<Snapshot[]>([]);
  // Current frame index (set by usePlayer)
  const currentFrameIndexRef = useRef<number>(0);


  // Step mode state - in step mode, only show current frame points
  const [isStepMode, setIsStepMode] = useState(false);

  // Stats state for display
  const [frameRate, setFrameRate] = useState(0);
  const [fingerCount, setFingerCount] = useState(0);
  const [scantime, setScantime] = useState(0);
  const [keyState, setKeyState] = useState(0);
  const [activeFingers, setActiveFingers] = useState<FingerSlot[]>([]);
  const [stylusData, setStylusData] = useState<StylusSlot | null>(null);

  const lastScantimeRef = useRef<number>(0);

  // Draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with dark background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { maxX, maxY } = config;

    // Draw trajectories for each finger
    trajectoriesRef.current.forEach((trajectory, fingerId) => {
      if (trajectory.points.length === 0) return;

      const color = FINGER_COLORS[fingerId % FINGER_COLORS.length];

      // Draw all points and connecting lines
      for (let i = 0; i < trajectory.points.length; i++) {
        const pt = trajectory.points[i];
        const x = (pt.x / maxX) * canvas.width;
        const y = (pt.y / maxY) * canvas.height;

        // Draw line from previous point to current point
        if (i > 0) {
          const prevPt = trajectory.points[i - 1];
          const prevX = (prevPt.x / maxX) * canvas.width;
          const prevY = (prevPt.y / maxY) * canvas.height;

          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = pt.state === TouchState.LargeTouch ? 1 : 1;
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }

        // Draw point as circle
        const radius = pt.state === TouchState.LargeTouch ? 4 : 2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        if (pt.state === TouchState.LargeTouch) {
          // LargeTouch: hollow (outline only)
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          // FingerTouch: solid (filled)
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    });

    // Draw stylus trajectory
    const stylusTrajectory = stylusTrajectoryRef.current;
    console.log('[PlaybackView] draw - stylusTrajectory.length:', stylusTrajectory.length);
    if (stylusTrajectory.length > 0) {
      console.log('[PlaybackView] drawing stylus trajectory with', stylusTrajectory.length, 'points');
      for (let i = 0; i < stylusTrajectory.length; i++) {
        const pt = stylusTrajectory[i];
        // Skip release break markers
        if (pt.state === StylusState.Release) continue;

        const x = (pt.x / maxX) * canvas.width;
        const y = (pt.y / maxY) * canvas.height;

        // Draw line from previous point (skip if previous is a break marker)
        if (i > 0) {
          const prevPt = stylusTrajectory[i - 1];
          if (prevPt.state !== StylusState.Release) {
            const prevX = (prevPt.x / maxX) * canvas.width;
            const prevY = (prevPt.y / maxY) * canvas.height;

            const ptColor = pt.state === StylusState.Tip ? STYLUS_COLOR : STYLUS_HOVER_COLOR;
            ctx.beginPath();
            ctx.strokeStyle = ptColor;
            ctx.lineWidth = 0.5;
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
        }

        // Draw point as circle
        const radius = pt.state === StylusState.Tip ? 1.5 : 0.5;
        const ptColor = pt.state === StylusState.Tip ? STYLUS_COLOR : STYLUS_HOVER_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = ptColor;
        ctx.fill();
      }
    }
  }, [config]);

  // Find nearest snapshot at or before the given index
  const findNearestSnapshot = useCallback((index: number): Snapshot | null => {
    const snapshots = snapshotsRef.current;
    if (snapshots.length === 0) return null;
    // Binary search for the nearest snapshot at or before index
    let left = 0;
    let right = snapshots.length - 1;
    let result: Snapshot | null = null;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (snapshots[mid].index <= index) {
        result = snapshots[mid];
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return result;
  }, []);

  // Take a snapshot of current trajectories
  const takeSnapshot = useCallback((index: number) => {
    const snapshots = snapshotsRef.current;
    // Only take snapshot if interval reached
    if (snapshots.length > 0 && index - snapshots[snapshots.length - 1].index < SNAPSHOT_INTERVAL) {
      return;
    }
    // Deep copy trajectories
    const trajectoriesCopy = new Map<number, FingerTrajectory>();
    trajectoriesRef.current.forEach((traj, id) => {
      trajectoriesCopy.set(id, { ...traj, points: [...traj.points] });
    });
    const stylusCopy = [...stylusTrajectoryRef.current];
    const snapshot: Snapshot = {
      index,
      trajectories: trajectoriesCopy,
      stylusTrajectory: stylusCopy,
      undoStack: [...undoStackRef.current],
    };
    snapshots.push(snapshot);
    console.log('[PlaybackView] takeSnapshot at', index, 'total snapshots:', snapshots.length);
  }, []);

  // Restore a snapshot
  const restoreSnapshot = useCallback((snapshot: Snapshot) => {
    // Deep copy from snapshot
    trajectoriesRef.current.clear();
    snapshot.trajectories.forEach((traj, id) => {
      trajectoriesRef.current.set(id, { ...traj, points: [...traj.points] });
    });
    stylusTrajectoryRef.current = [...snapshot.stylusTrajectory];
    undoStackRef.current = [...snapshot.undoStack];
    console.log('[PlaybackView] restoreSnapshot at', snapshot.index, 'undoStack length:', undoStackRef.current.length);
    draw();
  }, [draw]);

  // Undo one frame - O(1) operation
  const undoFrame = useCallback(() => {
    const diff = undoStackRef.current.pop();
    if (!diff) {
      console.log('[PlaybackView] undoFrame - nothing to undo');
      return;
    }
    console.log('[PlaybackView] undoFrame - undoing', diff.appendedFingerIds.length, 'fingers, stylusPointsBefore:', diff.stylusPointsBefore);
    const trajectories = trajectoriesRef.current;
    const stylusTrajectory = stylusTrajectoryRef.current;

    // Restore deleted finger trajectories
    diff.deletedFingerTrajectories.forEach((traj, fingerId) => {
      trajectories.set(fingerId, { ...traj, points: [...traj.points] });
    });

    // Pop appended finger points
    for (const fingerId of diff.appendedFingerIds) {
      const traj = trajectories.get(fingerId);
      if (traj) {
        traj.points.pop();
        if (traj.points.length === 0) {
          trajectories.delete(fingerId);
        }
      }
    }

    // Restore stylus trajectory
    if (diff.deletedStylusTrajectory !== null) {
      // Was a release, restore full trajectory
      stylusTrajectoryRef.current = [...diff.deletedStylusTrajectory];
    } else if (diff.stylusPointsBefore !== undefined) {
      // Was touch/hover, truncate to previous size
      stylusTrajectory.length = diff.stylusPointsBefore;
    }

    // Update current frame index
    currentFrameIndexRef.current -= 1;

    draw();
  }, [draw]);

  // Handle finger frame update - exposed via ref
  const handleFrame = useCallback((frame: FingerFrame) => {
    console.log('[PlaybackView] handleFrame called, slots:', frame.slots.length, 'stylus:', !!frame.stylus);
    const trajectories = trajectoriesRef.current;
    const stylusTrajectory = stylusTrajectoryRef.current;

    // Build diff for undo
    const diff: FrameDiff = {
      deletedFingerTrajectories: new Map(),
      appendedFingerIds: [],
      stylusPointsBefore: stylusTrajectory.length,
      deletedStylusTrajectory: null,
    };

    // In step mode, clear trajectories first and only show current frame points
    if (isStepMode) {
      trajectories.clear();
      stylusTrajectory.length = 0;
    }

    // Calculate frame rate from scantime
    const currentScantime = frame.scantime;
    if (lastScantimeRef.current > 0) {
      let delta = currentScantime - lastScantimeRef.current;
      if (delta < 0) delta += 65536;
      // Filter unrealistic deltas (min 1ms = 10 units, max 500Hz = 2000 units)
      if (delta > 0 && delta < 2000) {
        const intervalMs = delta / 10;
        setFrameRate(Math.round(1000 / intervalMs));
      }
    }
    lastScantimeRef.current = currentScantime;

    // Filter active fingers (valid coordinates and touch state)
    const active = frame.slots.filter(slot =>
      !(slot.x === 0 && slot.y === 0) &&
      (slot.state === TouchState.FingerTouch || slot.state === TouchState.LargeTouch)
    );

    // Determine effective stylus state based on parse mode
    let effectiveStylusState = frame.stylus?.state ?? StylusState.Release;
    if (config.stylusParseMode === 'mcu' && frame.stylus) {
      effectiveStylusState = frame.stylus.tipPressure >= 100 ? StylusState.Tip : StylusState.Hover;
    }

    // Update display state - show if there are active fingers or stylus
    const hasStylus = frame.stylus && (effectiveStylusState === StylusState.Hover || effectiveStylusState === StylusState.Tip);
    if (active.length > 0 || hasStylus) {
      setFingerCount(active.length);
      setScantime(frame.scantime);
      setKeyState(frame.keyState ?? 0);
      setActiveFingers(active);
      setStylusData(frame.stylus && hasStylus ? frame.stylus : null);
    } else {
      // No active fingers or stylus, clear display
      setFingerCount(0);
      setFrameRate(0);
      setScantime(0);
      setKeyState(0);
      setActiveFingers([]);
      setStylusData(null);
    }

    // Process finger slots
    for (const slot of frame.slots) {
      const { fingerId, state, x, y } = slot;

      if (x === 0 && y === 0) continue;

      // Finger release clears that finger's trajectory
      if (state === TouchState.FingerRelease || state === TouchState.LargeRelease) {
        // Save deleted trajectory to diff
        const existing = trajectories.get(fingerId);
        if (existing) {
          diff.deletedFingerTrajectories.set(fingerId, { ...existing, points: [...existing.points] });
        }
        trajectories.delete(fingerId);
      } else if (state === TouchState.FingerTouch || state === TouchState.LargeTouch) {
        let trajectory = trajectories.get(fingerId);
        if (!trajectory) {
          trajectory = { fingerId, points: [] };
          trajectories.set(fingerId, trajectory);
        }
        trajectory.points.push({ x, y, state });
        diff.appendedFingerIds.push(fingerId);
      }
    }

    // Process stylus data
    if (frame.stylus) {
      const { state, x, y, tipPressure } = frame.stylus;

      // Determine effective state based on parse mode
      let effectiveState = state;
      if (config.stylusParseMode === 'mcu') {
        effectiveState = tipPressure >= 100 ? StylusState.Tip : StylusState.Hover;
      }

      if (effectiveState === StylusState.Release) {
        // Insert break marker to prevent connecting lines across release
        if (stylusTrajectory.length > 0 && stylusTrajectory[stylusTrajectory.length - 1].state !== StylusState.Release) {
          stylusTrajectory.push({ x: 0, y: 0, state: StylusState.Release });
        }
      } else if (x !== 0 || y !== 0) {
        stylusTrajectory.push({ x, y, state: effectiveState });
      }
    }

    // Push diff to undo stack
    undoStackRef.current.push(diff);

    // Take snapshot periodically
    const currentIndex = currentFrameIndexRef.current;
    takeSnapshot(currentIndex);

    draw();
  }, [draw, isStepMode, config.stylusParseMode, takeSnapshot]);

  // Clear trajectories function
  const clearTrajectories = useCallback(() => {
    trajectoriesRef.current.clear();
    stylusTrajectoryRef.current = [];
    undoStackRef.current = [];
    snapshotsRef.current = [];
    draw();
  }, [draw]);

  // Register clear callback if provided
  useEffect(() => {
    if (onClearRef) {
      onClearRef(clearTrajectories);
    }
  }, [onClearRef, clearTrajectories]);

  // Register step mode callback if provided
  useEffect(() => {
    if (onStepModeRef) {
      onStepModeRef((mode: boolean) => setIsStepMode(mode));
    }
  }, [onStepModeRef]);

  // Register direct frame handler for rebuild - bypasses state for synchronous updates
  useEffect(() => {
    if (onDirectFrameRef) {
      onDirectFrameRef(handleFrame);
    }
  }, [onDirectFrameRef, handleFrame]);

  // Register frame index callback for usePlayer to update current index
  useEffect(() => {
    if (onFrameIndexRef) {
      onFrameIndexRef((index: number) => {
        currentFrameIndexRef.current = index;
      });
    }
  }, [onFrameIndexRef]);

  // Register undo frame callback for usePlayer
  useEffect(() => {
    if (onUndoFrameRef) {
      onUndoFrameRef(undoFrame);
    }
  }, [onUndoFrameRef, undoFrame]);

  // Set up canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        draw();
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [draw]);

  // C key to clear all trajectories
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        trajectoriesRef.current.clear();
        stylusTrajectoryRef.current = [];
        draw();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draw]);

  // Get stylus state name
  const getStylusStateName = (state: StylusState): string => {
    switch (state) {
      case StylusState.Release: return 'release';
      case StylusState.Hover: return 'hover';
      case StylusState.Tip: return 'tip';
      default: return 'unknown';
    }
  };

  const stateNames = ['LargeRelease', 'FingerRelease', 'LargeTouch', 'FingerTouch'];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', background: '#1e1e1e' }}
      />
      {/* Key Down indicator */}
      {keyState === 1 && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            right: 10,
            background: '#f14c4c',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'monospace',
          }}
        >
          KEY DOWN
        </div>
      )}
      {/* Top status bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          color: '#d4d4d4',
          fontSize: 11,
          fontFamily: 'monospace',
          background: 'rgba(30,30,30,0.95)',
          padding: '6px 12px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          borderBottom: '1px solid #3c3c3c',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: '#6a9955', fontWeight: 600 }}>
          PLAYBACK
        </div>
        <div style={{ color: '#6a9955' }}>{frameRate} Hz</div>
        <div>Fingers: {fingerCount}</div>
        <div>ScanTime: {scantime}</div>
        <div>Key: {keyState}</div>
        {activeFingers.map((slot) => (
          <div key={slot.fingerId} style={{ color: FINGER_COLORS[slot.fingerId % FINGER_COLORS.length] }}>
            F{slot.fingerId}: X={slot.x} Y={slot.y}
          </div>
        ))}
        {stylusData && (
          <div style={{ color: STYLUS_COLOR }}>
            Stylus: {getStylusStateName(stylusData.state)} X={stylusData.x} Y={stylusData.y} P={stylusData.tipPressure} TiltX={stylusData.xTilt} TiltY={stylusData.yTilt}
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          Max X: {config.maxX}, Max Y: {config.maxY}
        </div>
      </div>
    </div>
  );
};

export default PlaybackView;
