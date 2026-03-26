import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  FingerFrame,
  FingerTrajectory,
  TouchState,
  StylusState,
  FINGER_COLORS,
  STYLUS_COLOR,
  STYLUS_HOVER_COLOR,
  TouchpadConfig,
  StylusSlot,
} from '../types/finger';

interface TrajectoryViewProps {
  config: TouchpadConfig;
  onFrameRef?: (callback: (frame: FingerFrame) => void) => void;
}

const TrajectoryView: React.FC<TrajectoryViewProps> = ({ config, onFrameRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoriesRef = useRef<Map<number, FingerTrajectory>>(new Map());
  const stylusTrajectoryRef = useRef<{ x: number; y: number; state: StylusState }[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Stats state for display - batch all state updates
  const [stats, setStats] = useState({
    frameRate: 0,
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    activeFingers: [] as FingerSlot[],
    stylus: null as StylusSlot | null,
  });

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
        ctx.fillStyle = color;
        ctx.fill();
      }
    });

    // Draw stylus trajectory
    const stylusTrajectory = stylusTrajectoryRef.current;
    if (stylusTrajectory.length > 0) {
      for (let i = 0; i < stylusTrajectory.length; i++) {
        const pt = stylusTrajectory[i];
        const x = (pt.x / maxX) * canvas.width;
        const y = (pt.y / maxY) * canvas.height;

        // Draw line from previous point to current point
        if (i > 0) {
          const prevPt = stylusTrajectory[i - 1];
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

  // Handle finger frame update
  const handleFingerFrame = useCallback((frame: FingerFrame) => {
    const trajectories = trajectoriesRef.current;
    const stylusTrajectory = stylusTrajectoryRef.current;

    // Calculate frame rate from scantime (units of 100us, range 0-65535)
    const currentScantime = frame.scantime;
    let frameRate = 0;
    if (lastScantimeRef.current > 0) {
      let delta = currentScantime - lastScantimeRef.current;
      if (delta < 0) delta += 65536;
      // Filter unrealistic deltas (min 1ms = 10 units, max 500Hz = 2000 units)
      if (delta > 0 && delta < 2000) {
        const intervalMs = delta / 10;
        frameRate = Math.round(1000 / intervalMs);
      }
    }
    lastScantimeRef.current = currentScantime;

    // Process finger slots first
    for (const slot of frame.slots) {
      const { fingerId, state, x, y } = slot;
      if (x === 0 && y === 0) continue;

      // Finger release clears that finger's trajectory
      if (state === TouchState.FingerRelease || state === TouchState.LargeRelease) {
        trajectories.delete(fingerId);
      } else if (state === TouchState.FingerTouch || state === TouchState.LargeTouch) {
        let trajectory = trajectories.get(fingerId);
        if (!trajectory) {
          trajectory = { fingerId, points: [] };
          trajectories.set(fingerId, trajectory);
        }
        trajectory.points.push({ x, y, state });
        if (trajectory.points.length > 1000) {
          trajectory.points = trajectory.points.slice(-500);
        }
      }
    }

    // Process stylus data - no longer clearing on release
    if (frame.stylus) {
      const { state, x, y, tipPressure } = frame.stylus;

      // Determine effective state based on parse mode
      let effectiveState = state;
      if (config.stylusParseMode === 'mcu') {
        // MCU mode: pressure >= 100 is tip, otherwise hover
        effectiveState = tipPressure >= 100 ? StylusState.Tip : StylusState.Hover;
      }

      if (x !== 0 || y !== 0) {
        if (effectiveState === StylusState.Hover || effectiveState === StylusState.Tip) {
          stylusTrajectory.push({ x, y, state: effectiveState });
          if (stylusTrajectory.length > 1000) {
            stylusTrajectory.splice(0, 500);
          }
        }
      }
    }

    // Filter active fingers for display
    const active = frame.slots.filter(slot =>
      !(slot.x === 0 && slot.y === 0) &&
      (slot.state === TouchState.FingerTouch || slot.state === TouchState.LargeTouch)
    );

    // Determine effective stylus state for display
    let effectiveStylusState = frame.stylus?.state ?? StylusState.Release;
    if (config.stylusParseMode === 'mcu' && frame.stylus) {
      effectiveStylusState = frame.stylus.tipPressure >= 100 ? StylusState.Tip : StylusState.Hover;
    }

    // Batch update state and draw immediately
    setStats({
      frameRate: active.length > 0 || frame.stylus ? frameRate : 0,
      fingerCount: active.length,
      scantime: active.length > 0 || frame.stylus ? frame.scantime : 0,
      keyState: active.length > 0 || frame.stylus ? (frame.keyState ?? 0) : 0,
      activeFingers: active,
      stylus: frame.stylus && (effectiveStylusState === StylusState.Hover || effectiveStylusState === StylusState.Tip) ? frame.stylus : null,
    });

    // Draw immediately for lowest latency
    draw();
  }, [draw]);

  // Set up canvas size and subscriptions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size to match container
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

    // If onFrameRef is provided, use it instead of direct subscription
    if (onFrameRef) {
      onFrameRef(handleFingerFrame);
    } else {
      // Subscribe to finger frames directly
      const unsubscribe = window.electronAPI.onFingerFrame(handleFingerFrame);
      return () => {
        window.removeEventListener('resize', resizeCanvas);
        unsubscribe();
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw, handleFingerFrame, onFrameRef]);

  // C key to clear all trajectories, K key to clear only stylus trajectory
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        trajectoriesRef.current.clear();
        stylusTrajectoryRef.current = [];
        draw();
      } else if (e.key === 'k' || e.key === 'K') {
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
      {stats.keyState === 1 && (
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
          {stats.frameRate} Hz
        </div>
        <div>Fingers: {stats.fingerCount}</div>
        <div>ScanTime: {stats.scantime}</div>
        <div>Key: {stats.keyState}</div>
        {stats.activeFingers.map((slot) => (
          <div key={slot.fingerId} style={{ color: FINGER_COLORS[slot.fingerId % FINGER_COLORS.length] }}>
            F{slot.fingerId}: X={slot.x} Y={slot.y}
          </div>
        ))}
        {stats.stylus && (
          <div style={{ color: STYLUS_COLOR }}>
            Stylus: {getStylusStateName(stats.stylus.state)} X={stats.stylus.x} Y={stats.stylus.y} P={stats.stylus.tipPressure} TiltX={stats.stylus.xTilt} TiltY={stats.stylus.yTilt}
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          Max X: {config.maxX}, Max Y: {config.maxY}
        </div>
      </div>
    </div>
  );
};

export default TrajectoryView;
