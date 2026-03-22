import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  FingerFrame,
  FingerTrajectory,
  TouchState,
  FINGER_COLORS,
  TouchpadConfig,
} from '../types/finger';

interface PlaybackViewProps {
  config: TouchpadConfig;
  currentFrame: FingerFrame | null;
}

const PlaybackView: React.FC<PlaybackViewProps> = ({ config, currentFrame }) => {
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
      let segmentStart = 0;
      let currentState = trajectory.points[0].state;

      for (let i = 1; i <= trajectory.points.length; i++) {
        const pt = trajectory.points[i];
        const sameState = pt && pt.state === currentState;

        if (i === trajectory.points.length || !sameState) {
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

  // Handle finger frame update - exposed via ref
  const handleFrame = useCallback((frame: FingerFrame) => {
    const trajectories = trajectoriesRef.current;

    // Calculate frame rate from scantime
    const currentScantime = frame.scantime;
    if (lastScantimeRef.current > 0) {
      let delta = currentScantime - lastScantimeRef.current;
      if (delta < 0) delta += 65536;
      if (delta > 0) {
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

    // Update display state - only show if there are active fingers
    if (active.length > 0) {
      setFingerCount(active.length);
      setScantime(frame.scantime);
      setKeyState(frame.keyState ?? 0);
      setActiveFingers(active);
    } else {
      // No active fingers, clear display
      setFingerCount(0);
      setScantime(0);
      setKeyState(0);
      setActiveFingers([]);
    }

    // Process finger slots
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

    draw();
  }, [draw]);

  // Expose handleFrame via a ref-like mechanism
  useEffect(() => {
    if (currentFrame) {
      handleFrame(currentFrame);
    }
  }, [currentFrame, handleFrame]);

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
          PLAYBACK
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

export default PlaybackView;
