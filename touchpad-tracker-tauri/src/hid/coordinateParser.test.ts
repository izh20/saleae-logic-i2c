import { describe, expect, it } from 'vitest';
import { parseStylusFrame } from './coordinateParser';

describe('parseStylusFrame', () => {
  it('parses coordinates, pressure, signed tilt, and debug channels', () => {
    const packet = new Array(47).fill(0);
    packet.splice(0, 15,
      0x2f, 0x00, 0x08, 0x03, 0x07,
      0x34, 0x12, 0x78, 0x56, 0xbc, 0x00,
      0xff, 0xff, 0x00, 0x80,
    );
    packet[15] = 0xfe;
    packet[16] = 0xff;

    const frame = parseStylusFrame(packet, 1234);

    expect(frame?.timestamp).toBe(1234);
    expect(frame?.stylus).toEqual({
      stylusId: 7,
      state: 3,
      x: 0x1234,
      y: 0x5678,
      tipPressure: 0x00bc,
      xTilt: -1,
      yTilt: -32768,
    });
    expect(frame?.debugChannels?.[0]).toBe(-2);
  });

  it('rejects non-stylus and truncated packets', () => {
    expect(parseStylusFrame([0x2f, 0x00, 0x08], 0)).toBeNull();
    expect(parseStylusFrame(new Array(47).fill(0), 0)).toBeNull();
  });
});
