import { FingerFrame, TouchpadConfig } from './finger';

export interface ElectronAPI {
  saveText?: (data: string, defaultName: string) => Promise<string | null>;
  saveText?: (data: string, defaultName: string) => Promise<string | null>;
  onFingerFrame: (callback: (frame: FingerFrame) => void) => () => void;
  getConfig: () => Promise<TouchpadConfig>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
