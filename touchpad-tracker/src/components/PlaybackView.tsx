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

interface PlaybackViewProps {
  config: TouchpadConfig;
  currentFrame: FingerFrame | null;
  onClearRef?: (callback: () => void) => void;
  onStepModeRef?: (callback: (isStepMode: boolean) => void) => void;
  onDirectFrameRef?: (callback: (frame: FingerFrame) => void) => void;
}

const PlaybackView: React.FC<PlaybackViewProps> = ({ config, currentFrame, onClearRef, onStepModeRef, onDirectFrameRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoriesRef = useRef<Map<number, FingerTrajectory>>(new Map());
  const stylusTrajectoryRef = useRef<{ x: number; y: number; state: StylusState }[]>([]);
  const animationFrameRef = useRef<number | null>(null);

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

  // Handle finger frame update - exposed via ref
  const handleFrame = useCallback((frame: FingerFrame) => {
    const trajectories = trajectoriesRef.current;
    const stylusTrajectory = stylusTrajectoryRef.current;

    // Debug: log stylus data
    if (frame.stylus) {
      console.log('[PlaybackView] handleFrame - stylus:', frame.stylus);
    }

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
        trajectories.delete(fingerId);
      } else if (state === TouchState.FingerTouch || state === TouchState.LargeTouch) {
        let trajectory = trajectories.get(fingerId);
        if (!trajectory) {
          trajectory = { fingerId, points: [] };
          trajectories.set(fingerId, trajectory);
        }
        trajectory.points.push({ x, y, state });
      }
    }

    // Process stylus data - no longer clearing on release
    if (frame.stylus) {
      const { state, x, y, tipPressure } = frame.stylus;

      // Determine effective state based on parse mode
      let effectiveState = state;
      if (config.stylusParseMode === 'mcu') {
        effectiveState = tipPressure >= 100 ? StylusState.Tip : StylusState.Hover;
      }

      if (x !== 0 || y !== 0) {
        if (effectiveState === StylusState.Hover || effectiveState === StylusState.Tip) {
          stylusTrajectory.push({ x, y, state: effectiveState });
        }
      }
    }

    draw();
  }, [draw, isStepMode, config.stylusParseMode]);

  // Clear trajectories function
  const clearTrajectories = useCallback(() => {
    trajectoriesRef.current.clear();
    stylusTrajectoryRef.current = [];
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
