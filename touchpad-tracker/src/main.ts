import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import dgram from 'node:dgram';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { HID, devices as hidDevices } from 'node-hid';
import { FingerFrame, StylusState, StylusSlot, DEFAULT_CONFIG, TouchpadConfig } from './types/finger';
import { tryParseFingerFrame } from './hid/coordinateParser';

// Initialize electron-store for config persistence
const store = new Store<{ config: TouchpadConfig }>({
  defaults: {
    config: DEFAULT_CONFIG,
  },
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let udpServer: dgram.Socket | null = null;

// Configuration
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 50000;

// Debug mode: set to true to enable console logging
const DEBUG = false;

// Parse hex string to number
function parseHexOrDec(val: string): number {
  if (val.startsWith('0x') || val.startsWith('0X')) {
    return parseInt(val, 16);
  }
  return parseInt(val, 10);
}

// Parse I2C data array to finger frame
// 自动嗅探：按 header 字节匹配内置 CoordinateFormat（tp47/tp32/tp2a/tp34）。
// stylus 头 [0x2F, 0x00, 0x08] 不在内置 format 中，由 parseStylusFrame 单独处理。
function parseFingerFrame(data: string[], timestamp: number): FingerFrame | null {
  const bytes = data.map(parseHexOrDec);
  const result = tryParseFingerFrame(bytes, timestamp);
  return result ? result.frame : null;
}

// Parse bytes[15..46] as 16 s16 little-endian debug values.
// Returns 16 zeros if data is shorter than 47 bytes.
function parseDebugChannels(data: string[]): number[] {
  const channels: number[] = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offset = 15 + i * 2;
    if (offset + 1 >= data.length) break;
    const low = parseHexOrDec(data[offset]);
    const high = parseHexOrDec(data[offset + 1]);
    channels[i] = ((low | (high << 8)) << 16) >> 16;
  }
  return channels;
}

// Parse I2C data array to stylus frame
function parseStylusFrame(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 15) return null;

  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for stylus packet header (0x2F 0x00 0x08)
  const isStylus = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x08;
  if (!isStylus) return null;

  // Stylus packet: bytes 0-14 are stylus data, bytes 15-46 are debug channels
  const stylus: StylusSlot = {
    stylusId: parseHexOrDec(data[4]),
    state: parseHexOrDec(data[3]) as StylusState,
    x: parseHexOrDec(data[5]) | (parseHexOrDec(data[6]) << 8),
    y: parseHexOrDec(data[7]) | (parseHexOrDec(data[8]) << 8),
    tipPressure: parseHexOrDec(data[9]) | (parseHexOrDec(data[10]) << 8),
    xTilt: (parseHexOrDec(data[11]) | (parseHexOrDec(data[12]) << 8)) << 16 >> 16,
    yTilt: (parseHexOrDec(data[13]) | (parseHexOrDec(data[14]) << 8)) << 16 >> 16,
  };

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
    debugChannels: parseDebugChannels(data),
  };
}

// Start UDP server to receive I2C data
function startUdpServer() {
  udpServer = dgram.createSocket('udp4');

  udpServer.on('error', (err) => {
    console.error('UDP Server error:', err);
    udpServer?.close();
  });

  udpServer.on('message', (msg, _rinfo) => {
    try {
      const message = JSON.parse(msg.toString());
      if (DEBUG) console.log('UDP received:', message.type, message.data);

      if (message.type === 'TX' && message.data) {
        const dataArray = message.data.data || [];
        if (DEBUG) console.log('TX data array:', dataArray);
        const timestamp = Date.now();

        // Always forward the raw TX bytes to a parallel IPC channel for the
        // generic Report Data Parser (HID Analysis). This channel carries
        // every report ID, not just finger / stylus. For the new Live Sequence
        // subTab (HID-over-I²C protocol analyzer), we also forward the I²C
        // direction and (for 2-byte writes) the register address being selected.
        const i2cAddressNum = parseHexOrDec(message.data.addr || '0');
        const rwRaw = (message.data.rw || '').toString().trim().toUpperCase();
        const isRead = rwRaw === 'R' || rwRaw === 'READ';
        const parsedBytes = dataArray.map(d => parseHexOrDec(d));
        const register = !isRead && parsedBytes.length === 2
          ? (parsedBytes[0] | (parsedBytes[1] << 8)) & 0xFFFF
          : null;
        if (mainWindow) {
          mainWindow.webContents.send('i2c-raw-frame', {
            timestamp,
            i2cAddress: i2cAddressNum,
            isRead,
            source: 'udp',
            register,
            rawBytes: parsedBytes,
          });
        }

        // Try to parse as finger frame first, then as stylus frame
        let frame = parseFingerFrame(dataArray, timestamp);
        if (!frame) {
          frame = parseStylusFrame(dataArray, timestamp);
        }

        if (frame) {
          if (DEBUG) console.log('Parsed frame:', frame);
          // Populate raw bytes for HID analysis (parse hex strings to numbers)
          frame.rawBytes = dataArray.map(d => parseHexOrDec(d));
          if (mainWindow) {
            mainWindow.webContents.send('finger-frame', frame);
          }
        }
      }
    } catch (e) {
      console.error('UDP parse error:', e);
      // Ignore non-JSON messages
    }
  });

  udpServer.on('listening', () => {
    const address = udpServer?.address();
    console.log(`UDP Server listening on ${address?.address}:${address?.port}`);
  });

  udpServer.bind(UDP_PORT, UDP_HOST);
}

// IPC handler for config
ipcMain.handle('get-config', () => {
  return store.get('config');
});

// IPC handler for saving config
ipcMain.handle('save-config', (_event, config: TouchpadConfig) => {
  store.set('config', config);
});

// IPC handler for saving text content
ipcMain.handle('save-text', async (_event, data: string, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Save Text File",
    defaultPath: defaultName || "export-" + Date.now() + ".md",
    filters: [
      { name: "Markdown Files", extensions: ["md"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (!result.canceled && result.filePath) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(result.filePath, data, 'utf-8');
    return result.filePath;
  }
  return null;
});

// IPC handler for saving recording
ipcMain.handle('save-recording', async (_event, data: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Recording',
    defaultPath: `touchpad-recording-${Date.now()}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePath) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(result.filePath, data, 'utf-8');
    return result.filePath;
  }
  return null;
});

// IPC handler for loading recording
ipcMain.handle('load-recording', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open Recording',
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Recording Files', extensions: ['json'] },
      { name: 'Saleae Export Files', extensions: ['txt', 'csv'] }
    ],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(result.filePaths[0], 'utf-8');
    return { path: result.filePaths[0], content };
  }
  return null;
});

// ── HID I²C Device handlers ──
// Used by the HID I²C Device subTab. Maintains a single HID instance at a
// time. All bytes going in or out are also forwarded through the existing
// 'i2c-raw-frame' IPC channel (with source='hid') so the Live Sequence
// tab can analyze them with the same pipeline as UDP traffic.

let currentHID: HID | null = null;
let currentHIDInfo: {
  vendorId: number; productId: number; path: string;
  serialNumber: string; release: number;
  manufacturer: string; product: string; interface: number;
  usagePage: number; usage: number;
} | null = null;

ipcMain.handle('hid-list', () => {
  try {
    return hidDevices();
  } catch (e) {
    console.error('hid-list error:', e);
    return [];
  }
});

ipcMain.handle('hid-open', (_event, devicePath: string) => {
  try {
    if (currentHID) {
      try { currentHID.close(); } catch { /* ignore */ }
      currentHID = null;
      currentHIDInfo = null;
    }
    const info = hidDevices().find(d => d.path === devicePath);
    if (!info) return { success: false, error: 'Device not found' };
    currentHID = new HID(devicePath);
    currentHIDInfo = { ...info };

    // Forward device-pushed input reports to the i2c-raw-frame channel so
    // the Live Sequence tab sees them as a normal Input Report event.
    currentHID.on('data', (buf: Buffer) => {
      if (!mainWindow) return;
      const data = Array.from(buf);
      // Wrap in HID-I²C length-prefix format so the existing
      // processSingleTransaction can decode it as Input Report.
      const len = data.length;
      const wrapped = [len & 0xFF, (len >> 8) & 0xFF, ...data];
      mainWindow.webContents.send('i2c-raw-frame', {
        timestamp: Date.now(),
        i2cAddress: 0,
        isRead: true,
        register: null,
        rawBytes: wrapped,
        source: 'hid',
      });
    });

    // Try to auto-fetch the HID descriptor (feature report 0, 30 bytes).
    let hidDesc: number[] | undefined;
    try {
      const buf = currentHID.getFeatureReport(0, 31);
      if (buf && buf.length >= 30) hidDesc = Array.from(buf).slice(0, 30);
    } catch { /* device may not support feature report 0 — ignore */ }

    return { success: true, hidDesc, reportDesc: undefined };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('hid-close', () => {
  try {
    if (currentHID) {
      currentHID.close();
      currentHID = null;
      currentHIDInfo = null;
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('hid-write', (_event, reportId: number, data: number[]) => {
  if (!currentHID) return { success: false, error: 'Not connected', sentBytes: 0 };
  try {
    // node-hid expects the reportId prepended for write().
    currentHID.write([reportId, ...data]);

    // Forward to i2c-raw-frame so the Live Sequence tab can analyze it.
    if (mainWindow) {
      const len = data.length + 1;  // +1 for reportId byte
      const wrapped = [len & 0xFF, (len >> 8) & 0xFF, reportId, ...data];
      mainWindow.webContents.send('i2c-raw-frame', {
        timestamp: Date.now(),
        i2cAddress: 0,
        isRead: false,
        // For 2-byte write (register select), expose the register so the
        // existing Send Command decoder can match it.
        register: data.length >= 2 ? (data[0] | (data[1] << 8)) & 0xFFFF : null,
        rawBytes: wrapped,
        source: 'hid',
      });
    }
    return { success: true, sentBytes: data.length + 1 };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e), sentBytes: 0 };
  }
});

ipcMain.handle('hid-read-feature', (_event, reportId: number) => {
  if (!currentHID) return { data: undefined, error: 'Not connected' };
  try {
    const buf = currentHID.getFeatureReport(reportId, 256);
    return { data: Array.from(buf), error: undefined };
  } catch (e: any) {
    return { data: undefined, error: String(e?.message ?? e) };
  }
});

ipcMain.handle('hid-descriptors', () => {
  if (!currentHID) return { hidDesc: [], reportDesc: [] };
  let hidDesc: number[] = [];
  try {
    const buf = currentHID.getFeatureReport(0, 31);
    if (buf && buf.length >= 30) hidDesc = Array.from(buf).slice(0, 30);
  } catch { /* ignore */ }
  return { hidDesc, reportDesc: [] };
});

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Touchpad Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    console.log('Loading from dev server:', MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => {
      console.log('Successfully loaded from dev server');
    }).catch((err) => {
      console.error('Failed to load from dev server:', err);
      // Fallback to file
      mainWindow?.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      );
    });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools (disabled by default for performance)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start UDP server after window is created
  startUdpServer();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (udpServer) {
    udpServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
