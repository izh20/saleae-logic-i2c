import { useState, useCallback, useRef } from 'react';
import { FingerFrame, TouchpadConfig } from '../types/finger';
import { RecordingFile } from '../types/recording';

export interface UseRecorderReturn {
  isRecording: boolean;
  startRecording: (config: TouchpadConfig) => void;
  stopRecording: () => Promise<string | null>;
  addFrame: (frame: FingerFrame) => void;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const framesRef = useRef<FingerFrame[]>([]);
  const configRef = useRef<TouchpadConfig | null>(null);

  const startRecording = useCallback((config: TouchpadConfig) => {
    framesRef.current = [];
    configRef.current = config;
    setIsRecording(true);
  }, []);

  const addFrame = useCallback((frame: FingerFrame) => {
    if (isRecording) {
      framesRef.current.push(frame);
    }
  }, [isRecording]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    setIsRecording(false);
    const recording: RecordingFile = {
      version: 1,
      recordedAt: new Date().toISOString(),
      config: configRef.current!,
      frames: framesRef.current,
    };
    const json = JSON.stringify(recording, null, 2);
    const filePath = await window.electronAPI.saveRecording(json);
    return filePath;
  }, []);

  return { isRecording, startRecording, stopRecording, addFrame };
}