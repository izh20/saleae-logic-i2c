import React, { useState, useEffect, useRef, useCallback } from 'react';
import TrajectoryView from './components/TrajectoryView';
import PlaybackControls from './components/PlaybackControls';
import { TouchpadConfig, DEFAULT_CONFIG, FingerFrame } from './types/finger';
import { useRecorder } from './hooks/useRecorder';
import { usePlayer, PlaybackSpeed } from './hooks/usePlayer';

const App: React.FC = () => {
  const [config, setConfig] = useState<TouchpadConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [playbackMode, setPlaybackMode] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);

  // Ref to hold the callback for sending frames to TrajectoryView
  const trajectoriesCallbackRef = useRef<(frame: FingerFrame) => void | null>(null);

  // Recorder hook
  const { isRecording, startRecording, stopRecording, addFrame } = useRecorder();

  // Player hook
  const handlePlaybackFrame = useCallback((frame: FingerFrame) => {
    if (trajectoriesCallbackRef.current) {
      trajectoriesCallbackRef.current(frame);
    }
  }, []);

  const player = usePlayer(handlePlaybackFrame);

  // Set up the frame callback for TrajectoryView
  const handleTrajectoryViewRef = useCallback((callback: (frame: FingerFrame) => void) => {
    trajectoriesCallbackRef.current = callback;
  }, []);

  // Handle REC button click
  const handleRecClick = () => {
    if (isRecording) {
      handleStopRecording();
    } else {
      if (playbackMode) {
        setPlaybackMode(false);
        player.pause();
      }
      startRecording(config);
    }
  };

  // Handle PLAY button click
  const handlePlayClick = () => {
    if (playbackMode) {
      if (player.isPlaying) {
        player.pause();
      } else {
        player.play();
      }
    }
  };

  // Handle live frames from UDP
  useEffect(() => {
    // Load configuration from main process
    window.electronAPI.getConfig().then((cfg) => {
      setConfig(cfg);
      console.log('Config loaded:', cfg);
    });

    // Listen for first finger frame to indicate connection
    const unsubscribe = window.electronAPI.onFingerFrame((frame) => {
      console.log('Renderer received finger frame:', frame);
      setConnected(true);

      // In live mode, send frame to TrajectoryView
      if (!playbackMode && trajectoriesCallbackRef.current) {
        trajectoriesCallbackRef.current(frame);
      }

      // In recording mode, add frame to recording
      if (isRecording) {
        addFrame(frame);
      }
    });

    // Set connected to true after 1 second if we haven't received data yet
    const timeout = setTimeout(() => {
      setConnected(true);
    }, 1000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [playbackMode, isRecording, addFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'r':
        case 'R':
          handleRecClick();
          break;
        case ' ':
          if (playbackMode) {
            e.preventDefault();
            handlePlayClick();
          }
          break;
        case 'ArrowLeft':
          if (playbackMode) {
            e.preventDefault();
            player.stepBackward();
          }
          break;
        case 'ArrowRight':
          if (playbackMode) {
            e.preventDefault();
            player.stepForward();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playbackMode, handleRecClick, handlePlayClick, player]);

  // Handle open file (load recording)
  const handleOpenFile = async () => {
    const result = await window.electronAPI.loadRecording();
    if (result) {
      const loaded = player.loadRecording(result.content);
      if (loaded) {
        setPlaybackMode(true);
        setTotalFrames(player.totalFrames);
        setCurrentFrameIndex(0);
        // Send first frame
        const frame = player.getCurrentFrame();
        if (frame && trajectoriesCallbackRef.current) {
          trajectoriesCallbackRef.current(frame);
        }
      }
    }
  };

  // Handle stop recording
  const handleStopRecording = async () => {
    const filePath = await stopRecording();
    if (filePath) {
      console.log('Recording saved to:', filePath);
    }
  };

  // Handle REC button click - moved above useEffect

  const handleMaxXChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const maxX = parseInt(e.target.value) || 1920;
    setConfig(prev => ({ ...prev, maxX }));
  };

  const handleMaxYChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const maxY = parseInt(e.target.value) || 1080;
    setConfig(prev => ({ ...prev, maxY }));
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
        color: '#d4d4d4',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '12px 20px',
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          Touchpad Tracker
        </h1>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? '#6a9955' : '#f14c4c',
          }}
        />
        <span style={{ fontSize: 12, color: '#858585' }}>
          {connected ? 'UDP Connected' : 'Waiting for data...'}
        </span>

        {/* Recording indicator dot */}
        {isRecording && (
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#f14c4c',
            marginRight: 4,
          }} />
        )}

        {/* REC button */}
        <button
          onClick={handleRecClick}
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            border: 'none',
            background: isRecording ? '#f14c4c' : '#3c3c3c',
            color: isRecording ? '#fff' : '#d4d4d4',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          REC
        </button>

        {/* PLAY button */}
        <button
          onClick={handlePlayClick}
          disabled={!playbackMode}
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            border: 'none',
            background: playbackMode ? '#3c3c3c' : '#2d2d2d',
            color: playbackMode ? '#d4d4d4' : '#5a5a5a',
            cursor: playbackMode ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          PLAY
        </button>

        {/* Recording/Playback status */}
        {isRecording && (
          <span style={{ fontSize: 12, color: '#f14c4c' }}>
            Recording...
          </span>
        )}
        {playbackMode && (
          <span style={{ fontSize: 12, color: '#6a9955' }}>
            Playback Mode
          </span>
        )}

        {/* Resolution config */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleOpenFile}
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
            Open File
          </button>
          <label style={{ fontSize: 12 }}>
            Max X: <input
              type="number"
              value={config.maxX}
              onChange={handleMaxXChange}
              style={{ width: 60, background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Max Y: <input
              type="number"
              value={config.maxY}
              onChange={handleMaxYChange}
              style={{ width: 60, background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2 }}
            />
          </label>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <TrajectoryView config={config} onFrameRef={handleTrajectoryViewRef} />
      </main>

      {/* Playback controls - shown when in playback mode */}
      {playbackMode && (
        <>
          <button
            onClick={() => {
              setPlaybackMode(false);
              player.pause();
            }}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 12px',
              borderRadius: 4,
              border: 'none',
              background: '#3c3c3c',
              color: '#d4d4d4',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Exit Playback
          </button>
          <PlaybackControls
          isPlaying={player.isPlaying}
          currentFrame={player.currentFrameIndex}
          totalFrames={player.totalFrames}
          speed={player.speed}
          onPlay={player.play}
          onPause={player.pause}
          onStepForward={player.stepForward}
          onStepBackward={player.stepBackward}
          onSeek={(frame) => {
            player.seek(frame);
            setCurrentFrameIndex(frame);
          }}
          onSpeedChange={(speed) => player.setSpeed(speed as PlaybackSpeed)}
          />
        </>
      )}
    </div>
  );
};

export default App;
