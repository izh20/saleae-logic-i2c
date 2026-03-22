import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  FingerFrame,
  FingerTrajectory,
  TouchState,
  FINGER_COLORS,
  TouchpadConfig,
} from '../types/finger';

interface TrajectoryViewProps {
  config: TouchpadConfig;
  onFrameRef?: (callback: (frame: FingerFrame) => void) => void;
}

const TrajectoryView: React.FC<TrajectoryViewProps> = ({ config, onFrameRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoriesRef = useRef<Map<number, FingerTrajectory>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  // Stats state for display - batch all state updates
  const [stats, setStats] = useState({
    frameRate: 0,
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    activeFingers: [] as FingerSlot[],
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
  }, [config]);

  // Handle finger frame update
  const handleFingerFrame = useCallback((frame: FingerFrame) => {
    const trajectories = trajectoriesRef.current;

    // Calculate frame rate from scantime (units of 100us, range 0-65535)
    const currentScantime = frame.scantime;
    let frameRate = 0;
    if (lastScantimeRef.current > 0) {
      let delta = currentScantime - lastScantimeRef.current;
      if (delta < 0) delta += 65536;
      if (delta > 0) {
        const intervalMs = delta / 10;
        frameRate = Math.round(1000 / intervalMs);
      }
    }
    lastScantimeRef.current = currentScantime;

    // Process finger slots first
    for (const slot of frame.slots) {
      const { fingerId, state, x, y } = slot;
      if (x === 0 && y === 0) continue;

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

    // Filter active fingers for display
    const active = frame.slots.filter(slot =>
      !(slot.x === 0 && slot.y === 0) &&
      (slot.state === TouchState.FingerTouch || slot.state === TouchState.LargeTouch)
    );

    // Batch update state and draw immediately
    setStats({
      frameRate,
      fingerCount: active.length,
      scantime: active.length > 0 ? frame.scantime : 0,
      keyState: active.length > 0 ? (frame.keyState ?? 0) : 0,
      activeFingers: active,
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
            top: 10,
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
      {/* Top-left info panel */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          color: '#d4d4d4',
          fontSize: 11,
          fontFamily: 'monospace',
          background: 'rgba(30,30,30,0.9)',
          padding: '8px 12px',
          borderRadius: 4,
          lineHeight: 1.6,
        }}
      >
        <div style={{ color: '#6a9955', fontWeight: 600, marginBottom: 4 }}>
          {stats.frameRate} Hz
        </div>
        <div>Finger Count: {stats.fingerCount}</div>
        <div>ScanTime: {stats.scantime}</div>
        <div>Key State: {stats.keyState}</div>
        <div style={{ marginTop: 4, borderTop: '1px solid #3c3c3c', paddingTop: 4 }}>
          {stats.activeFingers.length === 0 ? (
            <div style={{ color: '#858585' }}>No active fingers</div>
          ) : (
            stats.activeFingers.map((slot) => (
              <div key={slot.fingerId} style={{ color: FINGER_COLORS[slot.fingerId % FINGER_COLORS.length] }}>
                Finger {slot.fingerId}: X={slot.x} Y={slot.y} [{stateNames[slot.state]}]
              </div>
            ))
          )}
        </div>
      </div>
      {/* Bottom-left info panel */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          color: '#d4d4d4',
          fontSize: 12,
          fontFamily: 'monospace',
        }}
      >
        <div>Max X: {config.maxX}, Max Y: {config.maxY}</div>
      </div>
    </div>
  );
};

export default TrajectoryView;
