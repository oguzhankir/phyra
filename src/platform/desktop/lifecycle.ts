import { getCurrentWindow } from '@tauri-apps/api/window';
export async function subscribeCloseRequested(
  callback: (event: { preventDefault: () => void }, close: () => Promise<void>) => Promise<void>,
): Promise<() => void> {
  const window = getCurrentWindow();
  return window.onCloseRequested((event) => callback(event, () => window.destroy()));
}
