import React, { useState, useEffect } from 'react';
import TrajectoryView from './components/TrajectoryView';
import { TouchpadConfig, DEFAULT_CONFIG } from './types/finger';

const App: React.FC = () => {
  const [config, setConfig] = useState<TouchpadConfig>(DEFAULT_CONFIG);
  const [connected, setConnected] = useState(false);

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

        {/* Resolution config */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
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
        <TrajectoryView config={config} />
      </main>
    </div>
  );
};

export default App;
