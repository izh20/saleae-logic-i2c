// Touchpad configuration
export interface TouchpadConfig {
  maxX: number;
  maxY: number;
  stylusParseMode: 'tp' | 'mcu';  // 'tp': use byte3 state, 'mcu': derive from pressure
}

// Default configuration
export const DEFAULT_CONFIG: TouchpadConfig = {
  maxX: 4000,
  maxY: 3000,
  stylusParseMode: 'tp',
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
  stylus?: StylusSlot;    // 笔数据
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

// Stylus state machine
export enum StylusState {
  Release = 0x00,    // 释放
  Hover = 0x20,       // 悬停
  Tip = 0x21,         // 接触
}

// Stylus slot data structure
export interface StylusSlot {
  stylusId: number;      // 固定 0x80
  state: StylusState;    // 0x20/0x21/0x00
  x: number;             // 16-bit 坐标
  y: number;             // 16-bit 坐标
  tipPressure: number;   // 16-bit 压力
  xTilt: number;         // 16-bit X倾斜
  yTilt: number;         // 16-bit Y倾斜
}

// Finger colors for visualization
export const FINGER_COLORS = [
  '#ff6b6b', // Finger 0 - Red
  '#4ecdc4', // Finger 1 - Teal
  '#45b7d1', // Finger 2 - Blue
  '#96ceb4', // Finger 3 - Sage
  '#ffeaa7', // Finger 4 - Yellow
];

// Stylus colors for visualization
export const STYLUS_COLOR = '#ffffff';      // White - Tip (contact)
export const STYLUS_HOVER_COLOR = '#ff0000'; // Red - Hover

// Line width based on touch state
export const getLineWidth = (state: TouchState): number => {
  return state === TouchState.LargeTouch ? 4 : 2;
};
