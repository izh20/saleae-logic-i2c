import { beforeEach, describe, expect, it, vi } from 'vitest';

const { check, relaunch, downloadAndInstall } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  downloadAndInstall: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

import { checkForUpdate, installAndRestart } from './index';

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the update result from Tauri', async () => {
    const update = { version: '0.1.3' };
    check.mockResolvedValue(update);

    await expect(checkForUpdate()).resolves.toBe(update);
  });

  it('relaunches only after a successful install', async () => {
    const update = { downloadAndInstall };
    downloadAndInstall.mockResolvedValue(undefined);
    relaunch.mockResolvedValue(undefined);

    await installAndRestart(update as never);

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(downloadAndInstall.mock.invocationCallOrder[0]).toBeLessThan(relaunch.mock.invocationCallOrder[0]);
  });

  it('does not relaunch when installation fails', async () => {
    const update = { downloadAndInstall };
    downloadAndInstall.mockRejectedValue(new Error('signature mismatch'));

    await expect(installAndRestart(update as never)).rejects.toThrow('signature mismatch');
    expect(relaunch).not.toHaveBeenCalled();
  });
});