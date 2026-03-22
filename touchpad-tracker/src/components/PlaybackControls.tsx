import React from 'react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSeek: (frame: number) => void;
  onSpeedChange: (speed: number) => void;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
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
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const frame = Math.round(ratio * (totalFrames - 1));
    onSeek(frame);
  };

  const progress = totalFrames > 0 ? (currentFrame / (totalFrames - 1)) * 100 : 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: '#252526',
        borderTop: '1px solid #3c3c3c',
      }}
    >
      {/* Play/Pause button */}
      <button
        onClick={isPlaying ? onPause : onPlay}
        style={{
          width: 36,
          height: 36,
          borderRadius: 4,
          border: 'none',
          background: '#3c3c3c',
          color: '#d4d4d4',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Step backward button */}
      <button
        onClick={onStepBackward}
        disabled={currentFrame <= 0}
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          border: 'none',
          background: currentFrame <= 0 ? '#2d2d2d' : '#3c3c3c',
          color: currentFrame <= 0 ? '#5a5a5a' : '#d4d4d4',
          cursor: currentFrame <= 0 ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
        }}
      >
        ◀◀
      </button>

      {/* Step forward button */}
      <button
        onClick={onStepForward}
        disabled={currentFrame >= totalFrames - 1}
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          border: 'none',
          background: currentFrame >= totalFrames - 1 ? '#2d2d2d' : '#3c3c3c',
          color: currentFrame >= totalFrames - 1 ? '#5a5a5a' : '#d4d4d4',
          cursor: currentFrame >= totalFrames - 1 ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
        }}
      >
        ▶▶
      </button>

      {/* Progress bar */}
      <div
        onClick={handleProgressClick}
        style={{
          flex: 1,
          height: 8,
          background: '#3c3c3c',
          borderRadius: 4,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: '#6a9955',
            borderRadius: 4,
            transition: 'width 0.05s linear',
          }}
        />
      </div>

      {/* Frame counter */}
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#d4d4d4',
          minWidth: 100,
          textAlign: 'right',
        }}
      >
        {currentFrame} / {totalFrames}
      </div>

      {/* Speed input (Hz) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          min={10}
          max={500}
          value={speed}
          onChange={(e) => onSpeedChange(Math.max(10, Math.min(500, parseInt(e.target.value) || 10)))}
          style={{
            width: 60,
            background: '#3c3c3c',
            color: '#d4d4d4',
            border: 'none',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        />
        <span style={{ fontSize: 11, color: '#858585' }}>Hz</span>
      </div>
    </div>
  );
};

export default PlaybackControls;
