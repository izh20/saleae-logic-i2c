import { contextBridge, ipcRenderer } from 'electron';
import { FingerFrame, TouchpadConfig, DEFAULT_CONFIG } from './types/finger';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Listen for finger frame updates from main process
  onFingerFrame: (callback: (frame: FingerFrame) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: FingerFrame) => {
      callback(frame);
    };
    ipcRenderer.on('finger-frame', listener);
    return () => {
      ipcRenderer.removeListener('finger-frame', listener);
    };
  },

  // Listen for raw I²C TX frames (every report ID). Used by HID Analysis
  // Report Data Parser to parse arbitrary reports, not just finger / stylus,
  // and by the Live Sequence subTab to drive incremental HID-over-I²C
  // protocol analysis.
  onI2cRawFrame: (callback: (frame: { timestamp: number; i2cAddress: number; isRead: boolean; register: number | null; rawBytes: number[]; source: 'udp' | 'hid' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: { timestamp: number; i2cAddress: number; isRead: boolean; register: number | null; rawBytes: number[]; source: 'udp' | 'hid' }) => {
      callback(frame);
    };
    ipcRenderer.on('i2c-raw-frame', listener);
    return () => {
      ipcRenderer.removeListener('i2c-raw-frame', listener);
    };
  },

  // Get touchpad configuration
  getConfig: (): Promise<TouchpadConfig> => {
    return ipcRenderer.invoke('get-config');
  },

  // Save touchpad configuration
  saveConfig: (config: TouchpadConfig): Promise<void> => {
    return ipcRenderer.invoke('save-config', config);
  },

  // Save recording to file
  saveRecording: (data: string): Promise<string | null> => {
    return ipcRenderer.invoke('save-recording', data);
  },

  // Load recording from file
  loadRecording: (): Promise<{ path: string; content: string } | null> => {
    return ipcRenderer.invoke('load-recording');
  },

  // Save text content to file
  saveText: (data: string, defaultName: string): Promise<string | null> => {
    return ipcRenderer.invoke('save-text', data, defaultName);
  },

  // ── HID I²C Device API ──
  hidList: (): Promise<any[]> => {
    return ipcRenderer.invoke('hid-list');
  },
  hidOpen: (path: string): Promise<{ success: boolean; error?: string; hidDesc?: number[]; reportDesc?: number[] }> => {
    return ipcRenderer.invoke('hid-open', path);
  },
  hidClose: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('hid-close');
  },
  hidWrite: (reportId: number, data: number[]): Promise<{ success: boolean; error?: string; sentBytes: number }> => {
    return ipcRenderer.invoke('hid-write', reportId, data);
  },
  hidReadFeature: (reportId: number): Promise<{ data?: number[]; error?: string }> => {
    return ipcRenderer.invoke('hid-read-feature', reportId);
  },
  hidDescriptors: (): Promise<{ hidDesc: number[]; reportDesc: number[] }> => {
    return ipcRenderer.invoke('hid-descriptors');
  },
});
