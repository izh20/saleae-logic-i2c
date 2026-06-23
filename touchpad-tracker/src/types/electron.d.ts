import { FingerFrame, TouchpadConfig } from './finger';

export interface I2cRawFrame {
  timestamp: number;
  i2cAddress: number;
  isRead: boolean;
  register: number | null;
  rawBytes: number[];
}

export interface ElectronAPI {
  saveText?: (data: string, defaultName: string) => Promise<string | null>;
  saveText?: (data: string, defaultName: string) => Promise<string | null>;
  onFingerFrame: (callback: (frame: FingerFrame) => void) => () => void;
  onI2cRawFrame?: (callback: (frame: I2cRawFrame) => void) => () => void;
  getConfig: () => Promise<TouchpadConfig>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
