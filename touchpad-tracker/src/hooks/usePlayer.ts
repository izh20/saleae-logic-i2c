import { useState, useCallback, useRef, useEffect } from 'react';
import { FingerFrame } from '../types/finger';
import { RecordingFile } from '../types/recording';

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

  const loadRecording = useCallback((content: string): boolean => {
    try {
      const data = JSON.parse(content);
      if (data.frames && Array.isArray(data.frames)) {
        framesRef.current = data.frames;
        setTotalFrames(data.frames.length);
        setCurrentFrameIndex(0);
        setIsLoaded(true);
        lastScantimeRef.current = 0;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const seek = useCallback((index: number) => {
    if (index >= 0 && index < framesRef.current.length) {
      setCurrentFrameIndex(index);
      onFrame(framesRef.current[index]);
    }
  }, [onFrame]);

  const stepForward = useCallback(() => {
    const nextIndex = Math.min(currentFrameIndex + 1, totalFrames - 1);
    seek(nextIndex);
  }, [currentFrameIndex, totalFrames, seek]);

  const stepBackward = useCallback(() => {
    const prevIndex = Math.max(currentFrameIndex - 1, 0);
    seek(prevIndex);
  }, [currentFrameIndex, seek]);

  const play = useCallback(() => {
    if (framesRef.current.length === 0) return;
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
  };
}