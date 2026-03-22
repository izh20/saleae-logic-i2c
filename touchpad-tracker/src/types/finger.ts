// Touchpad configuration
export interface TouchpadConfig {
  maxX: number;
  maxY: number;
}

// Default configuration
export const DEFAULT_CONFIG: TouchpadConfig = {
  maxX: 3000,
  maxY: 2000,
};

// Finger slot data structure
export interface FingerSlot {
  fingerId: number;
  state: number; // 0-3
  x: number;
  y: number;
  length?: number;   // 47-byte format only
  width?: number;    // 47-byte format only
  pressure?: number; // 47-byte format only
}

// Complete finger frame from HID packet
export interface FingerFrame {
  timestamp: number;
  packetType: 47 | 32;
  slots: FingerSlot[];
  fingerCount: number;
  scantime: number;
  keyState?: number;
}

// Point for trajectory rendering with touch state
export interface TrajectoryPoint {
  x: number;
  y: number;
  state: number; // 0-3, TouchState
}

// Finger trajectory history
export interface FingerTrajectory {
  fingerId: number;
  points: TrajectoryPoint[];
}

// State machine for touch detection
export enum TouchState {
  LargeRelease = 0,    // 大面积抬起
  FingerRelease = 1,   // 手指抬起
  LargeTouch = 2,      // 大面积按下
  FingerTouch = 3,     // 手指按下
}

// Finger colors for visualization
export const FINGER_COLORS = [
  '#ff6b6b', // Finger 0 - Red
  '#4ecdc4', // Finger 1 - Teal
  '#45b7d1', // Finger 2 - Blue
  '#96ceb4', // Finger 3 - Sage
  '#ffeaa7', // Finger 4 - Yellow
];

// Line width based on touch state
export const getLineWidth = (state: TouchState): number => {
  return state === TouchState.LargeTouch ? 4 : 2;
};
