import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import dgram from 'node:dgram';
import started from 'electron-squirrel-startup';
import { FingerFrame, FingerSlot, TouchState, StylusState, StylusSlot, DEFAULT_CONFIG } from './types/finger';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let udpServer: dgram.Socket | null = null;

// Configuration
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 50000;

// Parse hex string to number
function parseHexOrDec(val: string): number {
  if (val.startsWith('0x') || val.startsWith('0X')) {
    return parseInt(val, 16);
  }
  return parseInt(val, 10);
}

// Parse I2C data array to finger frame
function parseFingerFrame(data: string[], timestamp: number): FingerFrame | null {
  if (data.length < 3) return null;

  // Parse first 3 bytes for header
  const byte0 = parseHexOrDec(data[0]);
  const byte1 = parseHexOrDec(data[1]);
  const byte2 = parseHexOrDec(data[2]);

  // Check for finger packet header
  const is47Byte = byte0 === 0x2F && byte1 === 0x00 && byte2 === 0x04;
  const is32Byte = byte0 === 0x20 && byte1 === 0x00 && byte2 === 0x04;

  if (!is47Byte && !is32Byte) return null;

  const packetType: 47 | 32 = is47Byte ? 47 : 32;
  const slotSize = packetType === 47 ? 8 : 5;
  const dataLen = is47Byte ? 47 : 32;

  if (data.length < dataLen) return null;

  const slots: FingerSlot[] = [];

  // Parse 5 finger slots starting at byte 3
  for (let i = 0; i < 5; i++) {
    const offset = 3 + i * slotSize;
    if (offset >= dataLen) break;

    const fingerStatus = parseHexOrDec(data[offset]);
    const fingerId = (fingerStatus >> 4) & 0x0F;
    const state = fingerStatus & 0x0F;

    const xLow = parseHexOrDec(data[offset + 1]);
    const xHigh = parseHexOrDec(data[offset + 2]);
    const yLow = parseHexOrDec(data[offset + 3]);
    const yHigh = parseHexOrDec(data[offset + 4]);

    const x = xLow | (xHigh << 8);
    const y = yLow | (yHigh << 8);

    const slot: FingerSlot = {
      fingerId,
      state,
      x,
      y,
    };

    // Add extra fields for 47-byte format
    if (packetType === 47 && offset + 7 < dataLen) {
      slot.length = parseHexOrDec(data[offset + 5]);
      slot.width = parseHexOrDec(data[offset + 6]);
      slot.pressure = parseHexOrDec(data[offset + 7]);
    }

    slots.push(slot);
  }

  // Parse packet metadata
  const metaOffset = packetType === 47 ? 43 : 28;
  const scantimeLow = parseHexOrDec(data[metaOffset]);
  const scantimeHigh = parseHexOrDec(data[metaOffset + 1]);
  const scantime = scantimeLow | (scantimeHigh << 8);
  const fingerCount = parseHexOrDec(data[metaOffset + 2]);
  const keyState = parseHexOrDec(data[metaOffset + 3]);

  return {
    timestamp,
    packetType,
    slots,
    fingerCount,
    scantime,
    keyState,
  };
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

  // Stylus packet only has 15 bytes valid (0-14)
  const stylus: StylusSlot = {
    stylusId: parseHexOrDec(data[4]),
    state: parseHexOrDec(data[3]) as StylusState,
    x: parseHexOrDec(data[5]) | (parseHexOrDec(data[6]) << 8),
    y: parseHexOrDec(data[7]) | (parseHexOrDec(data[8]) << 8),
    tipPressure: parseHexOrDec(data[9]) | (parseHexOrDec(data[10]) << 8),
    xTilt: parseHexOrDec(data[11]) | (parseHexOrDec(data[12]) << 8),
    yTilt: parseHexOrDec(data[13]) | (parseHexOrDec(data[14]) << 8),
  };

  return {
    timestamp,
    packetType: 47,
    slots: [],
    fingerCount: 0,
    scantime: 0,
    keyState: 0,
    stylus,
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
      console.log('UDP received:', message.type, message.data);

      if (message.type === 'TX' && message.data) {
        const dataArray = message.data.data || [];
        console.log('TX data array:', dataArray);
        const timestamp = Date.now();

        // Try to parse as finger frame first, then as stylus frame
        let frame = parseFingerFrame(dataArray, timestamp);
        if (!frame) {
          frame = parseStylusFrame(dataArray, timestamp);
        }

        if (frame) {
          console.log('Parsed frame:', frame);
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
  return DEFAULT_CONFIG;
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

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

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
