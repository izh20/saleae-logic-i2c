import React, { useState, useEffect, useRef, useCallback } from 'react';
import TrajectoryView from './components/TrajectoryView';
import PlaybackView from './components/PlaybackView';
import PlaybackControls from './components/PlaybackControls';
import FrameListView from './components/FrameListView';
import DebugView from './components/DebugView';
import HidAnalysisView from './components/HidAnalysisView';
import { TouchpadConfig, DEFAULT_CONFIG, FingerFrame } from './types/finger';
import { useRecorder } from './hooks/useRecorder';
import { usePlayer, PlaybackSpeed } from './hooks/usePlayer';
import { parseSaleaeCSV } from './utils/parseSaleaeTXT';

const App: React.FC = () => {
  type ViewMode = 'live' | 'playback' | 'frameList' | 'debug' | 'hidAnalysis';

  const [config, setConfig] = useState<TouchpadConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [playbackFrame, setPlaybackFrame] = useState<FingerFrame | null>(null);
  const [i2cAddress, setI2cAddress] = useState<string>('0x2C');
  const [showHelp, setShowHelp] = useState(false);
  // Force re-render for live frame list
  const [liveFrameCount, setLiveFrameCount] = useState(0);
  // Frame list accumulation state
  const [isFrameListActive, setIsFrameListActive] = useState(false);

  // Ref to hold the callback for sending frames to TrajectoryView
  const trajectoriesCallbackRef = useRef<(frame: FingerFrame) => void | null>(null);

  // Live frames storage for real-time mode (max 10000 frames to prevent memory leak)
  const MAX_LIVE_FRAMES = 20000;
  const liveFramesRef = useRef<FingerFrame[]>([]);
  const isFrameListActiveRef = useRef(false);
  const isFrameListPausedRef = useRef(false);
  const isDebugActiveRef = useRef(false);
  const isDebugPausedRef = useRef(false);
  const isHidAnalysisActiveRef = useRef(false);
  // Track previous view mode to return to when exiting frameList
  const prevViewModeRef = useRef<ViewMode>('live');

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
  const viewModeRef = useRef(viewMode);
  const isRecordingRef = useRef(isRecording);
  const addFrameRef = useRef(addFrame);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  useEffect(() => { addFrameRef.current = addFrame; }, [addFrame]);
  useEffect(() => {
    // Track previous mode for back button (frameList, debug, hidAnalysis have back behavior)
    if (viewMode !== 'frameList' && viewMode !== 'debug' && viewMode !== 'hidAnalysis') {
      prevViewModeRef.current = viewMode;
    }
    // Sync active refs
    isFrameListActiveRef.current = viewMode === 'frameList';
    isDebugActiveRef.current = viewMode === 'debug';
    isHidAnalysisActiveRef.current = viewMode === 'hidAnalysis';
  }, [viewMode]);

  // Handle REC button click
  const handleRecClick = () => {
    if (isRecording) {
      handleStopRecording();
    } else {
      if (viewMode !== 'live') {
        setViewMode('live');
        player.pause();
      }
      startRecording(config);
    }
  };

  // Handle PLAY button click
  const handlePlayClick = () => {
    if (viewMode === 'playback') {
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
      if (viewModeRef.current === 'live' && trajectoriesCallbackRef.current) {
        trajectoriesCallbackRef.current(frame);
      }
      // Accumulate for frame list / debug view when active and not paused
      const isAccumulating =
        (isFrameListActiveRef.current && !isFrameListPausedRef.current) ||
        (isDebugActiveRef.current && !isDebugPausedRef.current);
      if (isAccumulating) {
        liveFramesRef.current.push(frame);
        if (liveFramesRef.current.length > MAX_LIVE_FRAMES) {
          liveFramesRef.current.shift();
        }
        const count = liveFramesRef.current.length;
        console.log('[Accumulate] push frame, count now:', count,
          'frameList:', isFrameListActiveRef.current, '/', isFrameListPausedRef.current,
          'debug:', isDebugActiveRef.current, '/', isDebugPausedRef.current);
        setLiveFrameCount(c => c + 1);
      } else {
        console.log('[Accumulate] skipped',
          'frameList:', isFrameListActiveRef.current, '/', isFrameListPausedRef.current,
          'debug:', isDebugActiveRef.current, '/', isDebugPausedRef.current);
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
          if (viewMode === 'playback') {
            e.preventDefault();
            handlePlayClick();
          }
          break;
        case 'ArrowLeft':
          if (viewMode === 'playback') {
            e.preventDefault();
            player.stepBackward();
          }
          break;
        case 'ArrowRight':
          if (viewMode === 'playback') {
            e.preventDefault();
            player.stepForward();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, handleRecClick, handlePlayClick, player]);

  // Handle open file (load recording)
  const handleOpenFile = async () => {
    const result = await window.electronAPI.loadRecording();
    if (result) {
      const loaded = player.loadRecording(result.content);
      if (loaded) {
        setViewMode('playback');
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

        {/* REC button + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isRecording && (
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f14c4c' }} />
          )}
          <button
            onClick={handleRecClick}
            style={{
              width: 36, height: 36, borderRadius: 4, border: 'none',
              background: isRecording ? '#f14c4c' : '#3c3c3c',
              color: isRecording ? '#fff' : '#d4d4d4',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 600,
            }}
          >
            REC
          </button>
          {isRecording && (
            <span style={{ fontSize: 12, color: '#f14c4c' }}>Recording...</span>
          )}
          {viewMode === 'playback' && (
            <span style={{ fontSize: 12, color: '#6a9955' }}>Playback Mode</span>
          )}
        </div>

        {/* Navigation tabs - always visible */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {[
            { key: 'live', label: 'Live' },
            { key: 'playback', label: 'Playback' },
            { key: 'frameList', label: 'Frame List' },
            { key: 'debug', label: 'Debug' },
            { key: 'hidAnalysis', label: 'HID Analysis' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                if (tab.key === viewMode) return;
                if (tab.key === 'playback') {
                  if (!player.isLoaded) {
                    handleOpenFile();
                    return;
                  }
                  handlePlayClick();
                }
                setViewMode(tab.key);
              }}
              style={{
                padding: '5px 14px',
                borderRadius: 4,
                border: 'none',
                background: viewMode === tab.key ? '#264f78' : '#3c3c3c',
                color: viewMode === tab.key ? '#ffffff' : '#d4d4d4',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: viewMode === tab.key ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

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
        {viewMode === 'playback' && (
          <PlaybackView config={config} currentFrame={playbackFrame} onClearRef={player.setClearCallback} onStepModeRef={player.setStepModeCallback} onDirectFrameRef={player.setDirectFrameCallback} onUndoFrameRef={player.setUndoFrameCallback} onFrameIndexRef={player.setFrameIndexCallback} />
        )}
        {viewMode === 'frameList' && (
          <FrameListView
            frames={isFrameListActiveRef.current ? liveFramesRef.current : player.getFrames()}
            currentFrameIndex={isFrameListActiveRef.current ? liveFramesRef.current.length - 1 : player.currentFrameIndex}
            isLiveMode={isFrameListActiveRef.current}
            liveFramesRef={isFrameListActiveRef.current ? liveFramesRef : null}
            liveFrameCount={liveFrameCount}
            onStart={() => { isFrameListPausedRef.current = false; }}
            onStop={() => { isFrameListPausedRef.current = true; }}
            onClear={() => { liveFramesRef.current = []; setLiveFrameCount(0); }}
            onSelectFrame={prevViewModeRef.current === 'playback' ? (index) => {
              const isBackward = index < player.currentFrameIndex;
              setViewMode('playback');
              player.seek(index, isBackward);
            } : undefined}
          />
        )}
        {viewMode === 'debug' && (
          <DebugView
            frames={isDebugActiveRef.current ? liveFramesRef.current : player.getFrames()}
            currentFrameIndex={isDebugActiveRef.current ? liveFramesRef.current.length - 1 : player.currentFrameIndex}
            isLiveMode={isDebugActiveRef.current}
            liveFramesRef={isDebugActiveRef.current ? liveFramesRef : null}
            liveFrameCount={liveFrameCount}
            isPaused={isDebugPausedRef.current}
            onPause={() => { isDebugPausedRef.current = true; }}
            onResume={() => { isDebugPausedRef.current = false; }}
            onClear={() => { liveFramesRef.current = []; setLiveFrameCount(0); }}
            onSelectFrame={prevViewModeRef.current === 'playback' ? (index) => {
              const isBackward = index < player.currentFrameIndex;
              setViewMode('playback');
              player.seek(index, isBackward);
            } : undefined}
          />
        )}
        {viewMode === 'hidAnalysis' && (
          <HidAnalysisView
            i2cAddress={i2cAddress.startsWith('0x') ? parseInt(i2cAddress, 16) : parseInt(i2cAddress, 10)}
          />
        )}
        {viewMode === 'live' && (
          <TrajectoryView config={config} onFrameRef={handleTrajectoryViewRef} />
        )}
      </main>

      {/* Playback controls - shown when not in live mode */}
      {viewMode !== 'live' && viewMode !== 'hidAnalysis' && viewMode !== 'frameList' && viewMode !== 'debug' && (
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
              maxWidth: 760,
              maxHeight: '85vh',
              overflowY: 'auto',
              color: '#d4d4d4',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.6,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: '#6a9955', fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
              Touchpad Tracker Help
            </div>
            <div style={{ color: '#858585', fontSize: 12, marginBottom: 16 }}>
              Saleae Logic Pro 16 → I²C → HID 触摸板协议分析工具
            </div>

            {/* ── 快捷键 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>快捷键</div>
              <table>
                <tbody>
                  <tr><td style={{ paddingRight: 16 }}>H</td><td>显示/隐藏帮助</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>R</td><td>开始/停止录制</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>C</td><td>清除所有轨迹（手指 + 笔）</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>K</td><td>仅清除笔轨迹（Live 模式）</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>Space</td><td>播放/暂停（Playback 模式）</td></tr>
                  <tr><td style={{ paddingRight: 16 }}>← / →</td><td>逐帧后退/前进（Playback 模式）</td></tr>
                </tbody>
              </table>
            </div>

            {/* ── 五种工作模式 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>五种工作模式</div>
              <table style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#6a9955', whiteSpace: 'nowrap' }}>Live</td>
                    <td>UDP 50000 实时流；Canvas 绘制手指/笔轨迹；状态栏显示 Hz/手指数/坐标/笔参数</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#6a9955', whiteSpace: 'nowrap' }}>Playback</td>
                    <td>JSON / Saleae CSV 回放；O(1) 单帧撤销 + 200 帧快照；进度条跳转；10–500 Hz 可调</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#6a9955', whiteSpace: 'nowrap' }}>Frame List</td>
                    <td>实时累加（≤20000 帧）或回放帧表；点选行跳转到该帧</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#6a9955', whiteSpace: 'nowrap' }}>Debug</td>
                    <td>解析笔包 bytes[15..46] 为 16 个 s16 小端通道；Dec/Hex/Bin 切换</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#6a9955', whiteSpace: 'nowrap' }}>HID Analysis</td>
                    <td>5 个子 Tab：Power-On Seq / Device Desc / Report Desc / Report Data / Live Sequence</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── 触摸板协议 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>触摸板数据包格式</div>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr style={{ color: '#858585', fontSize: 11 }}>
                    <th style={{ textAlign: 'left', paddingRight: 8 }}>帧头</th>
                    <th style={{ textAlign: 'left', paddingRight: 8 }}>长度</th>
                    <th style={{ textAlign: 'left' }}>含义</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={{ paddingRight: 8 }}>0x2F 0x00 0x04</td><td style={{ paddingRight: 8 }}>47B</td><td>完整手指包：5×8B 槽位（id/state/X/Y/L/W/P）+ scantime/fingerCount/keyState</td></tr>
                  <tr><td style={{ paddingRight: 8 }}>0x20 0x00 0x04</td><td style={{ paddingRight: 8 }}>32B</td><td>简化手指包：5×5B 槽位（仅 id/state/X/Y）</td></tr>
                  <tr><td style={{ paddingRight: 8 }}>0x2F 0x00 0x08</td><td style={{ paddingRight: 8 }}>47B</td><td>笔包：state/Id/X/Y/Pressure/TiltX/TiltY + 16 通道调试数据</td></tr>
                </tbody>
              </table>
            </div>

            {/* ── 手指颜色 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>手指颜色 / 状态</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <span><span style={{ color: '#ff6b6b' }}>■</span> F0 红</span>
                <span><span style={{ color: '#4ecdc4' }}>■</span> F1 青</span>
                <span><span style={{ color: '#45b7d1' }}>■</span> F2 蓝</span>
                <span><span style={{ color: '#96ceb4' }}>■</span> F3 绿</span>
                <span><span style={{ color: '#ffeaa7' }}>■</span> F4 黄</span>
              </div>
              <div style={{ fontSize: 12, color: '#bbbbbb' }}>
                state=3 FingerTouch 细线实心2px ｜ state=2 LargeTouch 细线空心4px
                <br />state=1 FingerRelease / state=0 LargeRelease → 清除该 fingerId 轨迹
              </div>
            </div>

            {/* ── 笔状态 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>笔状态 / 解析模式</div>
              <div>
                <span style={{ color: '#ffffff' }}>■ 白色</span> Tip（接触） ｜
                <span style={{ color: '#ff6b6b' }}>■ 红</span> Hover（悬停） ｜
                <span style={{ color: '#808080' }}>■ 灰</span> Release（断点标记）
              </div>
              <div style={{ fontSize: 12, color: '#bbbbbb', marginTop: 4 }}>
                <strong>TP Mode:</strong> 直接使用字节3状态值（0x20=Hover, 0x21=Tip）
                <br /><strong>MCU Mode:</strong> pressure ≥ 100 为 Tip，&lt; 100 为 Hover
              </div>
            </div>

            {/* ── HID Analysis 子 Tab ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>HID Analysis · 5 个子 Tab</div>
              <table style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#ce9178', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Power-On Seq</td>
                    <td>
                      粘贴 I²C 日志（自动识别 Saleae CSV / 时间戳方括号 / <code style={{ background:'#3c3c3c', padding:'0 4px' }}>W: hex hex</code> / <code style={{ background:'#3c3c3c', padding:'0 4px' }}>write to 0xNN ack data: ...</code> / 裸 hex），
                      解码 RESET / GET_REPORT / SET_REPORT / SET_POWER 等 opcode，含字段级 payload 还原。
                      完成后字段表自动联动到 Report Desc。
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#ce9178', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Device Desc</td>
                    <td>30 字节 HID-I²C 设备描述符按字段解码：VID/PID、ReportDescRegister、InputRegister、CommandRegister 等；含 ✅/⚠️ 校验。</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#ce9178', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Report Desc</td>
                    <td>
                      解析 Report Descriptor → 展开为字段表（Usage 名、bitOffset/bitSize、Logical/Physical Range）。
                      <br />
                      <span style={{ color: '#6a9955' }}>Comment ON/OFF</span> 切换带注释的 hex 视图。
                      <br />
                      <span style={{ color: '#6a9955' }}>Desc → .wara</span> 把描述符导出为 Waratah TOML 文本格式；
                      <span style={{ color: '#6a9955' }}>.wara → Desc</span> 重新生成字节描述符。
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#ce9178', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Report Data</td>
                    <td>
                      加载 Report Descriptor 后可粘贴 report data 静态解析（按 Report ID 分组），
                      或点 <span style={{ color: '#6a9955' }}>Start Listening</span> 订阅实时 UDP 帧持续解析。
                      支持 2 字节长度前缀开关；实时模式使用虚拟滚动，5 万帧不卡。
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 12, color: '#ce9178', whiteSpace: 'nowrap', verticalAlign: 'top' }}>Live Sequence</td>
                    <td>
                      按 Power-On Seq 同样的逻辑实时分析 HID-over-I²C 协议流量。适合调试<span style={{ color: '#6a9955' }}>任何标准 HID-I²C 设备</span>（vendor 测试、通用 I²C 调试）。
                      触摸板本身不按标准 HID-I²C 走，此 Tab 适合分析其他设备。
                      用户手动输入 HID Device Desc (30B) + HID Report Desc + Addr + Desc Reg，
                      点 <span style={{ color: '#6a9955' }}>Start Listening</span> 订阅 i2c-raw-frame IPC。
                      实时显示 9 种 eventType：Read HID Descriptor / Send Command（opcode 全解码）
                      / Get Report Response（字段级 payload）/ Input Report / Output Report 等。
                      表格上限 200 条 FIFO 截断。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── 顶部工具栏 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>顶部工具栏</div>
              <div>
                <span style={{ color: '#6a9955' }}>I2C Addr</span> 切换 Saleae CSV 解析的目标 I²C 地址（默认 0x2C；支持 0x15、0x5D）。
                <br />
                <span style={{ color: '#6a9955' }}>Open File</span> 打开 .json（应用录制）或 Saleae 导出的 .csv/.txt。
                <br />
                <span style={{ color: '#6a9955' }}>Max X / Max Y</span> 触摸板坐标上限（默认 4000×3000），用于 Canvas 归一化。
                <br />
                <span style={{ color: '#6a9955' }}>Stylus</span> TP Mode / MCU Mode 切换。
              </div>
            </div>

            {/* ── 保存 ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 8 }}>导出 / 保存</div>
              <div>
                <span style={{ color: '#6a9955' }}>REC</span> → 录制为 .json（含 <code style={{ background: '#3c3c3c', padding: '0 4px', borderRadius: 2 }}>debugChannels</code>）。
                <br />
                每个 HID Analysis 子 Tab 顶栏的 <span style={{ color: '#6a9955' }}>Save MD</span> 按钮导出该次分析的 Markdown 报告。
              </div>
            </div>

            <div style={{ color: '#808080', fontSize: 12 }}>
              按 H 或点击外部区域关闭 ｜ Saleae 通道：SCL=0, SDA=1 ｜ UDP 端口：50000
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
