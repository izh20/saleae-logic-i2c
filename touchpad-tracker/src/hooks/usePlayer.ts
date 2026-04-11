import { useState, useCallback, useRef, useEffect } from 'react';
import { FingerFrame } from '../types/finger';
import { RecordingFile } from '../types/recording';
import { parseSaleaeCSV } from '../utils/parseSaleaeTXT';

export type PlaybackSpeed = number;

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
  rebuildTrajectories: (targetIndex: number) => void;
  setClearCallback: (callback: () => void) => void;
  setStepModeCallback: (callback: (isStepMode: boolean) => void) => void;
  setDirectFrameCallback: (callback: (frame: FingerFrame) => void) => void;
  setUndoFrameCallback: (callback: () => void) => void;
  setFrameIndexCallback: (callback: (index: number) => void) => void;
}

export function usePlayer(onFrame: (frame: FingerFrame) => void): UsePlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(60);
  const [isLoaded, setIsLoaded] = useState(false);

  const framesRef = useRef<FingerFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const lastScantimeRef = useRef<number>(0);
  const clearCallbackRef = useRef<(() => void) | null>(null);
  const stepModeCallbackRef = useRef<((isStepMode: boolean) => void) | null>(null);
  const directFrameCallbackRef = useRef<((frame: FingerFrame) => void) | null>(null);
  const undoFrameCallbackRef = useRef<(() => void) | null>(null);
  const frameIndexCallbackRef = useRef<((index: number) => void) | null>(null);

  // Rebuild trajectories by replaying all frames from 0 to target index
  const rebuildTrajectories = useCallback((targetIndex: number) => {
    const frames = framesRef.current;
    if (frames.length === 0 || targetIndex < 0) return;

    // Clear trajectories first
    if (clearCallbackRef.current) {
      clearCallbackRef.current();
    }

    // Use direct callback if available for synchronous updates
    const frameHandler = directFrameCallbackRef.current || onFrame;

    // Replay all frames from 0 to target index to rebuild trajectories
    for (let i = 0; i <= targetIndex; i++) {
      frameHandler(frames[i]);
    }
  }, [onFrame]);

  const setClearCallback = useCallback((callback: () => void) => {
    clearCallbackRef.current = callback;
  }, []);

  const setStepModeCallback = useCallback((callback: (isStepMode: boolean) => void) => {
    stepModeCallbackRef.current = callback;
  }, []);

  const setDirectFrameCallback = useCallback((callback: (frame: FingerFrame) => void) => {
    directFrameCallbackRef.current = callback;
  }, []);

  const setUndoFrameCallback = useCallback((callback: () => void) => {
    undoFrameCallbackRef.current = callback;
  }, []);

  const setFrameIndexCallback = useCallback((callback: (index: number) => void) => {
    frameIndexCallbackRef.current = callback;
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
    const maxIndex = framesRef.current.length - 1;
    console.log('[usePlayer] seek called:', { index, isBackward, currentFrameIndex, maxIndex });
    if (index < 0) index = 0;
    if (index > maxIndex) index = maxIndex;
    if (framesRef.current.length > 0) {
      const step = currentFrameIndex - index;

      // If going backward by 1 step, use O(1) undo
      if (isBackward && step === 1 && undoFrameCallbackRef.current) {
        console.log('[usePlayer] using undoFrame for single step backward');
        undoFrameCallbackRef.current();
        if (frameIndexCallbackRef.current) {
          frameIndexCallbackRef.current(index);
        }
        setCurrentFrameIndex(index);
        onFrame(framesRef.current[index]);
        return;
      }

      // If going backward by more than 1 step, rebuild trajectories
      if (isBackward && step > 1) {
        console.log('[usePlayer] rebuildTrajectories from 0 to', index);
        rebuildTrajectories(index);
      }

      // Forward step: process frame through direct callback
      if (!isBackward) {
        if (frameIndexCallbackRef.current) {
          frameIndexCallbackRef.current(index);
        }
        if (directFrameCallbackRef.current) {
          directFrameCallbackRef.current(framesRef.current[index]);
        }
      }

      // Update frame index
      if (frameIndexCallbackRef.current) {
        frameIndexCallbackRef.current(index);
      }
      setCurrentFrameIndex(index);
      onFrame(framesRef.current[index]);
    }
  }, [onFrame, currentFrameIndex, rebuildTrajectories]);

  const stepForward = useCallback(() => {
    const nextIndex = currentFrameIndex + 1;
    console.log('[usePlayer] stepForward:', { currentFrameIndex, nextIndex });
    seek(nextIndex);
  }, [currentFrameIndex, seek]);

  const stepBackward = useCallback(() => {
    const prevIndex = currentFrameIndex - 1;
    console.log('[usePlayer] stepBackward:', { currentFrameIndex, prevIndex });
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
          // Update frame index in PlaybackView before processing frame
          if (frameIndexCallbackRef.current) {
            frameIndexCallbackRef.current(next);
          }
          // Process frame through direct callback (builds trajectory + diff)
          if (directFrameCallbackRef.current) {
            directFrameCallbackRef.current(framesRef.current[next]);
          }
          onFrame(framesRef.current[next]);
          return next;
        });
      };

      // Calculate interval based on Hz
      const interval = 1000 / speed; // Hz to interval in ms
      intervalRef.current = window.setTimeout(advanceFrame, Math.max(interval, 1));

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
    setDirectFrameCallback,
    setUndoFrameCallback,
    setFrameIndexCallback,
  };
}