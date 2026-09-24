import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

export type UpdateInfo = Update;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return check();
}

export async function installAndRestart(
  update: UpdateInfo,
  onProgress?: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onProgress);
  await relaunch();
}