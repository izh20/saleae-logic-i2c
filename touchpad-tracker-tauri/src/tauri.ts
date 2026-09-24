import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { load, Store } from '@tauri-apps/plugin-store';
import { parseStylusFrame, tryParseFingerFrame } from './hid/coordinateParser';
import { DEFAULT_CONFIG, FingerFrame, TouchpadConfig } from './types/finger';
import {
  ElectronAPI,
  HIDDescriptorsResult,
  HIDDeviceInfo,
  HIDOpenResult,
  HIDReadFeatureResult,
  HIDWriteResult,
  I2cRawFrame,
} from './types/electron';

type Subscriber<T> = (value: T) => void;

const fingerSubscribers = new Set<Subscriber<FingerFrame>>();
const rawSubscribers = new Set<Subscriber<I2cRawFrame>>();
let configStore: Store;
let rawUnlisten: UnlistenFn | null = null;

function subscribe<T>(subscribers: Set<Subscriber<T>>, callback: Subscriber<T>): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function dispatchRawFrame(rawFrame: I2cRawFrame): void {
  rawSubscribers.forEach(callback => callback(rawFrame));

  const parsed = tryParseFingerFrame(rawFrame.rawBytes, rawFrame.timestamp);
  const frame = parsed?.frame ?? parseStylusFrame(rawFrame.rawBytes, rawFrame.timestamp);
  if (!frame) return;

  frame.rawBytes = rawFrame.rawBytes;
  fingerSubscribers.forEach(callback => callback(frame));
}

async function initializeStore(): Promise<void> {
  configStore = await load('config.json', { autoSave: false, defaults: {} });
  const existing = await configStore.get<TouchpadConfig>('config');
  if (existing) return;

  let imported: TouchpadConfig | null = null;
  try {
    imported = await invoke<TouchpadConfig | null>('import_electron_config');
  } catch (error) {
    console.warn('Electron config import unavailable:', error);
  }

  await configStore.set('config', imported ?? DEFAULT_CONFIG);
  await configStore.save();
}

async function saveText(data: string, defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Text files', extensions: ['md', 'json', 'txt'] }],
  });
  if (!path) return null;
  await writeTextFile(path, data);
  return path;
}

const api: ElectronAPI = {
  onFingerFrame: callback => subscribe(fingerSubscribers, callback),
  onI2cRawFrame: callback => subscribe(rawSubscribers, callback),
  getConfig: async () => (await configStore.get<TouchpadConfig>('config')) ?? DEFAULT_CONFIG,
  saveConfig: async config => {
    await configStore.set('config', config);
    await configStore.save();
  },
  saveText,
  saveRecording: data => saveText(data, `touchpad-recording-${Date.now()}.json`),
  loadRecording: async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Recording files', extensions: ['json', 'txt', 'csv'] }],
    });
    if (!path) return null;
    return { path, content: await readTextFile(path) };
  },
  hidList: () => invoke<HIDDeviceInfo[]>('hid_list'),
  hidOpen: path => invoke<HIDOpenResult>('hid_open', { path }),
  hidClose: () => invoke<{ success: boolean; error?: string }>('hid_close'),
  hidWrite: (reportId, data) => invoke<HIDWriteResult>('hid_write', { reportId, data }),
  hidReadFeature: reportId => invoke<HIDReadFeatureResult>('hid_read_feature', { reportId }),
  hidDescriptors: () => invoke<HIDDescriptorsResult>('hid_descriptors'),
};

export async function installTauriApi(): Promise<void> {
  await initializeStore();
  window.electronAPI = api;
  rawUnlisten = await listen<I2cRawFrame>('raw-frame', event => dispatchRawFrame(event.payload));
}

export function disposeTauriApi(): void {
  rawUnlisten?.();
  rawUnlisten = null;
  fingerSubscribers.clear();
  rawSubscribers.clear();
}
