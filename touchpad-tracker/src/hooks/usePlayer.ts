import { useState, useCallback, useRef, useEffect } from 'react';
import { FingerFrame } from '../types/finger';
import { RecordingFile } from '../types/recording';
import { parseSaleaeCSV } from '../utils/parseSaleaeTXT';

export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export interface UsePlayerReturn {
  isPlaying: boolean;
  currentFrameIndex: number;
  totalFrames: number;
  speed: PlaybackSpeed;
  isLoaded: boolean;
  loadRecording: (content: string) => boolean;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  seek: (index: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  getCurrentFrame: () => FingerFrame | null;
  rebuildTrajectories: () => void;
  setClearCallback: (callback: () => void) => void;
  setStepModeCallback: (callback: (isStepMode: boolean) => void) => void;
}

export function usePlayer(onFrame: (frame: FingerFrame) => void): UsePlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [isLoaded, setIsLoaded] = useState(false);

  const framesRef = useRef<FingerFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const lastScantimeRef = useRef<number>(0);
  const clearCallbackRef = useRef<(() => void) | null>(null);
  const stepModeCallbackRef = useRef<((isStepMode: boolean) => void) | null>(null);

  // Rebuild trajectories by replaying all frames from 0 to target index
  const rebuildTrajectories = useCallback((targetIndex: number) => {
    const frames = framesRef.current;
    if (frames.length === 0 || targetIndex < 0) return;

    // Clear trajectories first
    if (clearCallbackRef.current) {
      clearCallbackRef.current();
    }

    // Replay all frames from 0 to target index to rebuild trajectories
    for (let i = 0; i <= targetIndex; i++) {
      onFrame(frames[i]);
    }
  }, [onFrame]);

  const setClearCallback = useCallback((callback: () => void) => {
    clearCallbackRef.current = callback;
  }, []);

  const setStepModeCallback = useCallback((callback: (isStepMode: boolean) => void) => {
    stepModeCallbackRef.current = callback;
  }, []);

  const loadRecording = useCallback((content: string): boolean => {
    // Debug: check content format
    console.log('loadRecording called, content length:', content.length);
    console.log('First 100 chars:', content.substring(0, 100));

    try {
      // Try to parse as our JSON format first
      const data = JSON.parse(content);
      if (data.frames && Array.isArray(data.frames)) {
        console.log('Parsed as JSON, frames:', data.frames.length);
        framesRef.current = data.frames;
        setTotalFrames(data.frames.length);
        setCurrentFrameIndex(0);
        setIsLoaded(true);
        lastScantimeRef.current = 0;
        return true;
      }
    } catch {
      // Not JSON, try Saleae CSV format
    }

    // Try to parse as Saleae CSV format
    try {
      const frames = parseSaleaeCSV(content);
      console.log('Parsed as CSV, frames:', frames.length);
      if (frames.length > 0) {
        framesRef.current = frames;
        setTotalFrames(frames.length);
        setCurrentFrameIndex(0);
        setIsLoaded(true);
        lastScantimeRef.current = 0;
        return true;
      }
    } catch (e) {
      console.error('CSV parse error:', e);
      return false;
    }

    console.log('Failed to parse recording');
    return false;
  }, []);

  const seek = useCallback((index: number, isBackward?: boolean) => {
    if (index >= 0 && index < framesRef.current.length) {
      // If going backward, rebuild trajectories from 0 to index
      if (isBackward && index < currentFrameIndex) {
        rebuildTrajectories(index);
      }
      setCurrentFrameIndex(index);
      onFrame(framesRef.current[index]);
    }
  }, [onFrame, currentFrameIndex, rebuildTrajectories]);

  const stepForward = useCallback(() => {
    const nextIndex = Math.min(currentFrameIndex + 1, totalFrames - 1);
    seek(nextIndex);
  }, [currentFrameIndex, totalFrames, seek]);

  const stepBackward = useCallback(() => {
    const prevIndex = Math.max(currentFrameIndex - 1, 0);
    seek(prevIndex, true);
  }, [currentFrameIndex, seek]);

  const play = useCallback(() => {
    if (framesRef.current.length === 0) return;
    // Reset lastScantimeRef to avoid delta=0 issue when resuming
    lastScantimeRef.current = 0;
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const setSpeed = useCallback((newSpeed: PlaybackSpeed) => {
    setSpeedState(newSpeed);
  }, []);

  const getCurrentFrame = useCallback((): FingerFrame | null => {
    return framesRef.current[currentFrameIndex] || null;
  }, [currentFrameIndex]);

  // Playback loop
  useEffect(() => {
    if (isPlaying && framesRef.current.length > 0) {
      const advanceFrame = () => {
        setCurrentFrameIndex(prev => {
          const next = prev + 1;
          if (next >= framesRef.current.length) {
            setIsPlaying(false);
            return prev;
          }
          onFrame(framesRef.current[next]);
          return next;
        });
      };

      // Calculate interval based on speed and scantime
      const frame = framesRef.current[currentFrameIndex];
      if (frame) {
        let interval: number;
        if (lastScantimeRef.current > 0) {
          let delta = frame.scantime - lastScantimeRef.current;
          if (delta < 0) delta += 65536;
          interval = delta / 10 / speed; // delta in 100us, convert to ms
        } else {
          interval = 1000 / speed; // fallback: 1 second
        }
        lastScantimeRef.current = frame.scantime;
        intervalRef.current = window.setTimeout(advanceFrame, Math.max(interval, 1));
      }

      return () => {
        if (intervalRef.current) {
          clearTimeout(intervalRef.current);
        }
      };
    }
  }, [isPlaying, currentFrameIndex, speed, onFrame]);

  return {
    isPlaying,
    currentFrameIndex,
    totalFrames,
    speed,
    isLoaded,
    loadRecording,
    play,
    pause,
    stepForward,
    stepBackward,
    seek,
    setSpeed,
    getCurrentFrame,
    rebuildTrajectories,
    setClearCallback,
    setStepModeCallback,
  };
}