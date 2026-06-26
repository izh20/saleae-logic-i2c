import { FingerFrame, TouchpadConfig } from './finger';

export type I2cRawSource = 'udp' | 'hid';

export interface I2cRawFrame {
  timestamp: number;
  i2cAddress: number;
  isRead: boolean;
  register: number | null;
  rawBytes: number[];
  source: I2cRawSource;
}

export interface HIDDeviceInfo {
  vendorId: number;
  productId: number;
  path: string;
  serialNumber: string;
  release: number;
  manufacturer: string;
  product: string;
  interface: number;
  usagePage: number;
  usage: number;
}

export interface HIDOpenResult {
  success: boolean;
  error?: string;
  hidDesc?: number[];
  reportDesc?: number[];
}

export interface HIDWriteResult {
  success: boolean;
  error?: string;
  sentBytes: number;
}

export interface HIDReadFeatureResult {
  data?: number[];
  error?: string;
}

export interface HIDDescriptorsResult {
  hidDesc: number[];
  reportDesc: number[];
}

export interface ElectronAPI {
  saveText?: (data: string, defaultName: string) => Promise<string | null>;
  onFingerFrame: (callback: (frame: FingerFrame) => void) => () => void;
  onI2cRawFrame?: (callback: (frame: I2cRawFrame) => void) => () => void;
  getConfig: () => Promise<TouchpadConfig>;
  saveConfig?: (config: TouchpadConfig) => Promise<void>;
  saveRecording?: (data: string) => Promise<string | null>;
  loadRecording?: () => Promise<{ path: string; content: string } | null>;

  // HID I²C Device API
  hidList?: () => Promise<HIDDeviceInfo[]>;
  hidOpen?: (path: string) => Promise<HIDOpenResult>;
  hidClose?: () => Promise<{ success: boolean; error?: string }>;
  hidWrite?: (reportId: number, data: number[]) => Promise<HIDWriteResult>;
  hidReadFeature?: (reportId: number) => Promise<HIDReadFeatureResult>;
  hidDescriptors?: () => Promise<HIDDescriptorsResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
