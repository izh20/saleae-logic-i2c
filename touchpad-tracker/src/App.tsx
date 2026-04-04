import React, { useState, useEffect, useRef, useCallback } from 'react';
import TrajectoryView from './components/TrajectoryView';
import PlaybackView from './components/PlaybackView';
import PlaybackControls from './components/PlaybackControls';
import { TouchpadConfig, DEFAULT_CONFIG, FingerFrame } from './types/finger';
import { useRecorder } from './hooks/useRecorder';
import { usePlayer, PlaybackSpeed } from './hooks/usePlayer';
import { parseSaleaeCSV } from './utils/parseSaleaeTXT';

const App: React.FC = () => {
  const [config, setConfig] = useState<TouchpadConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [playbackMode, setPlaybackMode] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [playbackFrame, setPlaybackFrame] = useState<FingerFrame | null>(null);
  const [i2cAddress, setI2cAddress] = useState<string>('0x2C');
  const [showHelp, setShowHelp] = useState(false);

  // Ref to hold the callback for sending frames to TrajectoryView
  const trajectoriesCallbackRef = useRef<(frame: FingerFrame) => void | null>(null);

  // Recorder hook
  const { isRecording, startRecording, stopRecording, addFrame } = useRecorder();

  // Player hook
  const handlePlaybackFrame = useCallback((frame: FingerFrame) => {
    setPlaybackFrame(frame);
  }, []);

  const player = usePlayer(handlePlaybackFrame);

  // Set up the frame callback for TrajectoryView
  const handleTrajectoryViewRef = useCallback((callback: (frame: FingerFrame) => void) => {
    trajectoriesCallbackRef.current = callback;
  }, []);

  // Keep refs in sync with latest values for stable subscription
  const playbackModeRef = useRef(playbackMode);
  const isRecordingRef = useRef(isRecording);
  const addFrameRef = useRef(addFrame);
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { addFrameRef.current = addFrame; }, [addFrame]);

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

  // Handle live frames from UDP - subscribe once, read refs for latest values
  useEffect(() => {
    // Load configuration from main process
    window.electronAPI.getConfig().then((cfg) => {
      setConfig(cfg);
    });

    // Listen for finger frames
    const unsubscribe = window.electronAPI.onFingerFrame((frame) => {
      setConnected(true);

      // In live mode, send frame to TrajectoryView
      if (!playbackModeRef.current && trajectoriesCallbackRef.current) {
        trajectoriesCallbackRef.current(frame);
      }

      // In recording mode, add frame to recording
      if (isRecordingRef.current) {
        addFrameRef.current(frame);
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
  }, []);

  // Save config when it changes
  useEffect(() => {
    window.electronAPI.saveConfig(config);
  }, [config]);

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
        case 'h':
        case 'H':
          setShowHelp(prev => !prev);
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
        // Set first frame for playback
        const frame = player.getCurrentFrame();
        if (frame) {
          setPlaybackFrame(frame);
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

  const handleStylusModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setConfig(prev => ({ ...prev, stylusParseMode: e.target.value as 'tp' | 'mcu' }));
  };

  const handleI2cAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const addr = e.target.value;
    setI2cAddress(addr);
    // Parse and set the address
    const addrNum = addr.startsWith('0x') ? parseInt(addr, 16) : parseInt(addr, 10);
    if (!isNaN(addrNum)) {
      parseSaleaeCSV.setAddresses([addrNum]);
    }
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

        {/* Exit Playback button - shown only in playback mode */}
        {playbackMode && (
          <button
            onClick={() => {
              setPlaybackMode(false);
              setPlaybackFrame(null);
              player.pause();
            }}
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
            Exit
          </button>
        )}

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
          <label style={{ fontSize: 12 }}>
            I2C Addr: <input
              type="text"
              value={i2cAddress}
              onChange={handleI2cAddressChange}
              style={{ width: 60, background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2 }}
            />
          </label>
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
          <label style={{ fontSize: 12 }}>
            Stylus: <select
              value={config.stylusParseMode}
              onChange={handleStylusModeChange}
              style={{ background: '#3c3c3c', color: '#d4d4d4', border: 'none', padding: '2px 4px', borderRadius: 2 }}
            >
              <option value="tp">TP Mode</option>
              <option value="mcu">MCU Mode</option>
            </select>
          </label>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {playbackMode ? (
          <PlaybackView config={config} currentFrame={playbackFrame} onClearRef={player.setClearCallback} onStepModeRef={player.setStepModeCallback} onDirectFrameRef={player.setDirectFrameCallback} />
        ) : (
          <TrajectoryView config={config} onFrameRef={handleTrajectoryViewRef} />
        )}
      </main>

      {/* Playback controls - shown when in playback mode */}
      {playbackMode && (
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
            const isBackward = frame < player.currentFrameIndex;
            player.seek(frame, isBackward);
            setCurrentFrameIndex(frame);
          }}
          onSpeedChange={(speed) => player.setSpeed(speed as PlaybackSpeed)}
        />
      )}

      {/* Help modal */}
      {showHelp && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowHelp(false)}
        >
          <div
            style={{
              backgroundColor: '#2d2d2d',
              borderRadius: 8,
              padding: 24,
              maxWidth: 500,
              color: '#d4d4d4',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.6,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: '#6a9955', fontSize: 16, fontWeight: 'bold', marginBottom: 16 }}>
              Touchpad Tracker Help
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>快捷键</div>
              <table>
                <tbody>
                  <tr><td style={{ paddingRight: 16 }}>H</td><td>显示/隐藏帮助</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>R</td><td>开始/停止录制</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>C</td><td>清除所有轨迹</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>K</td><td>仅清除笔轨迹</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>空格</td><td>播放/暂停（回放模式）</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>←</td><td>逐帧后退（回放模式）</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>→</td><td>逐帧前进（回放模式）</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>手指颜色</div>
              <div><span style={{ color: '#ff6b6b' }}>■</span> 指0 (红色)</div>
              <div><span style={{ color: '#4ecdc4' }}>■</span> 指1 (青色)</div>
              <div><span style={{ color: '#45b7d1' }}>■</span> 指2 (蓝色)</div>
              <div><span style={{ color: '#96ceb4' }}>■</span> 指3 (绿色)</div>
              <div><span style={{ color: '#ffeaa7' }}>■</span> 指4 (黄色)</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>手指状态</div>
              <div>LargeTouch: 大面积按下</div>
              <div>FingerTouch: 手指按下</div>
              <div>FingerRelease: 手指抬起（清除轨迹）</div>
              <div>LargeRelease: 大面积抬起（清除轨迹）</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>笔状态颜色</div>
              <div><span style={{ color: '#ffffff' }}>■ 白色</span> - Tip（接触）</div>
              <div><span style={{ color: '#ff0000' }}>■ 红色</span> - Hover（悬停）</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>笔解析模式</div>
              <div><strong>TP Mode:</strong> 使用字节3的状态值</div>
              <div><strong>MCU Mode:</strong> 根据压力值判断</div>
              <div style={{ fontSize: 12, color: '#808080' }}>pressure &gt;= 100 为 Tip，&lt; 100 为 Hover</div>
            </div>

            <div style={{ color: '#808080', fontSize: 12 }}>
              按 H 或点击外部区域关闭
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
