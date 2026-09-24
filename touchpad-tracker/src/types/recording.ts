import { FingerSlot, StylusSlot, TouchpadConfig } from './finger';

export interface RecordedFrame {
  timestamp: number;
  packetType: number;
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
  stylus?: StylusSlot;
}

export interface RecordingFile {
  version: number;
  recordedAt: string;
  config: TouchpadConfig;
  frames: RecordedFrame[];
}