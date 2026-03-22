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

  // Get touchpad configuration
  getConfig: (): Promise<TouchpadConfig> => {
    return ipcRenderer.invoke('get-config').then(() => DEFAULT_CONFIG);
  },
});
