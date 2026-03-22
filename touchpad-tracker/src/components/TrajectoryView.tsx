import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  FingerFrame,
  FingerTrajectory,
  TouchState,
  FINGER_COLORS,
  getLineWidth,
  TouchpadConfig,
} from '../types/finger';

interface TrajectoryViewProps {
  config: TouchpadConfig;
}

const TrajectoryView: React.FC<TrajectoryViewProps> = ({ config }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoriesRef = useRef<Map<number, FingerTrajectory>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  // Stats state for display
  const [frameRate, setFrameRate] = useState(0);
  const [fingerCount, setFingerCount] = useState(0);
  const [scantime, setScantime] = useState(0);
  const [keyState, setKeyState] = useState(0);
  const [activeFingers, setActiveFingers] = useState<FingerSlot[]>([]);

  const lastScantimeRef = useRef<number>(0);
  const lastFrameRef = useRef<FingerFrame | null>(null);

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

      // Draw line segments grouped by state
      // Group points by state to use different line widths
      let segmentStart = 0;
      let currentState = trajectory.points[0].state;

      for (let i = 1; i <= trajectory.points.length; i++) {
        const pt = trajectory.points[i];
        const sameState = pt && pt.state === currentState;

        if (i === trajectory.points.length || !sameState) {
          // Draw segment from segmentStart to i-1
          const lineWidth = currentState === TouchState.LargeTouch ? 8 : 2;
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const startPt = trajectory.points[segmentStart];
          ctx.moveTo(
            (startPt.x / maxX) * canvas.width,
            (startPt.y / maxY) * canvas.height
          );

          for (let j = segmentStart + 1; j < i; j++) {
            const p = trajectory.points[j];
            ctx.lineTo(
              (p.x / maxX) * canvas.width,
              (p.y / maxY) * canvas.height
            );
          }
          ctx.stroke();

          if (i < trajectory.points.length) {
            segmentStart = i;
            currentState = pt.state;
          }
        }
      }

      // Draw end point as circle
      const lastPt = trajectory.points[trajectory.points.length - 1];
      const lastX = (lastPt.x / maxX) * canvas.width;
      const lastY = (lastPt.y / maxY) * canvas.height;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }, [config]);

  // Handle finger frame update
  const handleFingerFrame = useCallback((frame: FingerFrame) => {
    const trajectories = trajectoriesRef.current;

    // Calculate frame rate from scantime (units of 100us, range 0-65535)
    const currentScantime = frame.scantime;
    if (lastScantimeRef.current > 0) {
      let delta = currentScantime - lastScantimeRef.current;
      // Handle overflow (scantime wraps from 65535 to 0)
      if (delta < 0) {
        delta += 65536;
      }
      // scantime is in 100us units, so interval_ms = delta * 100 / 1000 = delta / 10
      if (delta > 0) {
        const intervalMs = delta / 10;
        setFrameRate(Math.round(1000 / intervalMs));
      }
    }
    lastScantimeRef.current = currentScantime;
    lastFrameRef.current = frame;

    // Update display state
    setFingerCount(frame.fingerCount);
    setScantime(frame.scantime);
    setKeyState(frame.keyState ?? 0);
    setActiveFingers(frame.slots.filter(slot => !(slot.x === 0 && slot.y === 0)));

    // Process finger slots
    for (const slot of frame.slots) {
      const { fingerId, state, x, y } = slot;

      // Skip if coordinates are invalid (0,0 is typically a placeholder)
      if (x === 0 && y === 0) continue;

      if (state === TouchState.FingerRelease || state === TouchState.LargeRelease) {
        // Clear trajectory on release
        trajectories.delete(fingerId);
      } else if (state === TouchState.FingerTouch || state === TouchState.LargeTouch) {
        // Add point to trajectory
        let trajectory = trajectories.get(fingerId);
        if (!trajectory) {
          trajectory = { fingerId, points: [] };
          trajectories.set(fingerId, trajectory);
        }
        trajectory.points.push({ x, y, state });

        // Limit trajectory length
        if (trajectory.points.length > 1000) {
          trajectory.points = trajectory.points.slice(-500);
        }
      }
    }

    // Schedule draw using requestAnimationFrame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      draw();
    });
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

    // Subscribe to finger frames
    const unsubscribe = window.electronAPI.onFingerFrame(handleFingerFrame);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      unsubscribe();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw, handleFingerFrame]);

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
          {frameRate} Hz
        </div>
        <div>Finger Count: {fingerCount}</div>
        <div>ScanTime: {scantime}</div>
        <div>Key State: {keyState}</div>
        <div style={{ marginTop: 4, borderTop: '1px solid #3c3c3c', paddingTop: 4 }}>
          {activeFingers.length === 0 ? (
            <div style={{ color: '#858585' }}>No active fingers</div>
          ) : (
            activeFingers.map((slot) => (
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
