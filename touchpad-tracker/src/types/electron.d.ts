import { FingerFrame, TouchpadConfig } from './finger';

export interface ElectronAPI {
  onFingerFrame: (callback: (frame: FingerFrame) => void) => () => void;
  getConfig: () => Promise<TouchpadConfig>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
