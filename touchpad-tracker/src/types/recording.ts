import { FingerSlot, TouchpadConfig } from './finger';

export interface RecordedFrame {
  timestamp: number;
  packetType: 47 | 32;
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
}

export interface RecordingFile {
  version: number;
  recordedAt: string;
  config: TouchpadConfig;
  frames: RecordedFrame[];
}