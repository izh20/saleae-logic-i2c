// HID Usage Pages lookup table
// Covers the most common usage pages for touchpad/pen digitizer analysis.

interface UsagePageDef {
  id: number;
  name: string;
  usages: Record<number, string>;
}

const PAGES: UsagePageDef[] = [
  {
    id: 0x01, name: 'Generic Desktop',
    usages: {
      0x01: 'Pointer', 0x02: 'Mouse', 0x04: 'Joystick',
      0x05: 'Game Pad', 0x06: 'Keyboard', 0x07: 'Keypad',
      0x08: 'Multi-axis Controller',
      0x30: 'X', 0x31: 'Y', 0x32: 'Z',
      0x33: 'Rx', 0x34: 'Ry', 0x35: 'Rz',
      0x36: 'Slider', 0x37: 'Dial', 0x38: 'Wheel',
      0x39: 'Hat Switch', 0x3A: 'Counted Buffer',
      0x3B: 'Byte Count', 0x3C: 'Motion Wakeup',
      0x3D: 'Start', 0x3E: 'Selection',
      0x40: 'Vx', 0x41: 'Vy', 0x42: 'Vz',
      0x43: 'Vbrx', 0x44: 'Vbry', 0x45: 'Vbrz', 0x46: 'Vno',
      0x80: 'System Control', 0x81: 'System Power Down',
      0x82: 'System Sleep', 0x83: 'System Wake Up',
      0x84: 'System Context Menu', 0x85: 'System Main Menu',
      0x86: 'System App Menu', 0x87: 'System Menu Help',
      0x88: 'System Menu Exit', 0x89: 'System Menu Select',
      0x8A: 'System Menu Right', 0x8B: 'System Menu Left',
      0x8C: 'System Menu Up', 0x8D: 'System Menu Down',
    },
  },
  {
    id: 0x0D, name: 'Digitizers',
    usages: {
      0x01: 'Digitizer', 0x02: 'Pen', 0x03: 'Light Pen',
      0x04: 'Touch Screen', 0x05: 'Touch Pad',
      0x20: 'Stylus', 0x21: 'Puck', 0x22: 'Finger',
      0x23: 'Device Settings', 0x30: 'Tip Pressure',
      0x31: 'Barrel Pressure', 0x32: 'In Range',
      0x33: 'Touch', 0x34: 'Untouch', 0x35: 'Tap',
      0x36: 'Quality', 0x37: 'Data Valid',
      0x38: 'Transducer Index', 0x39: 'Tablet Function Keys',
      0x3B: 'Battery Strength', 0x3C: 'Invert',
      0x3D: 'X Tilt', 0x3E: 'Y Tilt',
      0x3F: 'Azimuth', 0x40: 'Altitude', 0x41: 'Twist',
      0x42: 'Tip Switch', 0x43: 'Secondary Tip Switch',
      0x44: 'Barrel Switch', 0x45: 'Eraser',
      0x46: 'Tablet Pick', 0x47: 'Confidence',
      0x48: 'Width', 0x49: 'Height',
      0x51: 'Contact Identifier', 0x52: 'Device Mode',
      0x53: 'Device Identifier', 0x54: 'Contact Count',
      0x55: 'Contact Count Maximum', 0x56: 'Scan Time',
      0x57: 'Surface Switch', 0x58: 'Button', 0x59: 'Pad Type',
      0x5A: 'Secondary Barrel Switch',
      0x5B: 'Transducer Serial Number', 0x5C: 'Preferred Color',
    },
  },
  {
    id: 0x09, name: 'Button',
    usages: {
      0x01: 'Button 1', 0x02: 'Button 2', 0x03: 'Button 3',
      0x04: 'Button 4', 0x05: 'Button 5', 0x06: 'Button 6',
      0x07: 'Button 7', 0x08: 'Button 8', 0x09: 'Button 9',
      0x0A: 'Button 10', 0x0B: 'Button 11', 0x0C: 'Button 12',
      0x0D: 'Button 13', 0x0E: 'Button 14', 0x0F: 'Button 15',
      0x10: 'Button 16',
    },
  },
  {
    id: 0x0C, name: 'Consumer',
    usages: {
      0x01: 'Consumer Control', 0x02: 'Numeric Key Pad',
      0x03: 'Programmable Buttons', 0x30: 'Power',
      0x31: 'Reset', 0x32: 'Sleep', 0x40: 'Menu',
      0x41: 'Menu Pick', 0x42: 'Menu Up', 0x43: 'Menu Down',
      0x44: 'Menu Left', 0x45: 'Menu Right', 0x46: 'Menu Escape',
      0x47: 'Menu Value Increase', 0x48: 'Menu Value Decrease',
      0xB0: 'Play', 0xB1: 'Pause', 0xB2: 'Record',
      0xB3: 'Fast Forward', 0xB4: 'Rewind', 0xB7: 'Stop',
      0xCD: 'Play/Pause', 0xE0: 'Volume', 0xE1: 'Balance',
      0xE2: 'Mute', 0xF0: 'Volume Increment',
      0xF1: 'Volume Decrement',
    },
  },
  {
    id: 0x0F, name: 'Vendor-defined (Touch Digitizer)',
    usages: { 0x01: 'Vendor Usage 1', 0x02: 'Vendor Usage 2' },
  },
];

const pageById: Map<number, UsagePageDef> = new Map();
for (const p of PAGES) { pageById.set(p.id, p); }

export function getUsagePageName(pageId: number): string {
  const page = pageById.get(pageId);
  return page ? page.name : `0x${pageId.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function getUsageName(pageId: number, usageId: number): string {
  if (usageId === 0) return '';
  const page = pageById.get(pageId);
  if (page) {
    const name = page.usages[usageId];
    if (name) return name;
  }
  return `0x${usageId.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function getUsageFullName(pageId: number, usageId: number): string {
  const pageName = getUsagePageName(pageId);
  const usageName = getUsageName(pageId, usageId);
  return `${pageName} / ${usageName}`;
}

export function getCollectionTypeName(type: number): string {
  switch (type) {
    case 0x00: return 'Physical';
    case 0x01: return 'Application';
    case 0x02: return 'Logical';
    case 0x03: return 'Report';
    case 0x04: return 'Named Array';
    case 0x05: return 'Usage Switch';
    case 0x06: return 'Usage Modifier';
    default: return `Vendor(0x${type.toString(16).padStart(2, '0')})`;
  }
}

/**
 * Reverse lookup: find a Usage ID by page ID and usage name.
 * Used by WaraToDescriptorGenerator.
 */
export function TryGetUsageId(pageId: number, name: string): number | null {
  const page = pageById.get(pageId);
  if (!page) return null;
  for (const [id, usageName] of Object.entries(page.usages)) {
    if (usageName.toLowerCase() === name.toLowerCase()) return parseInt(id);
  }
  return null;
}

/**
 * Get a page name for Wara output (short, without "Vendor-defined" prefix).
 */
export function GetUsageNameForWara(pageId: number): string {
  const page = pageById.get(pageId);
  if (!page) return `0x${pageId.toString(16).toUpperCase().padStart(4, '0')}`;
  // Strip "Vendor-defined " prefix for Wara format
  return page.name.replace(/^Vendor-defined \(/, '').replace(/\)$/, '');
}
