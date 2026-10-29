// Low-data mode for places with slow or expensive internet. "Auto" turns it on when the browser
// reports a very slow connection (2G, under 0.5 Mbps) or the phone's data saver; staff can also force
// it on or off in Settings → Appearance. While on, VitaLink drops heavy visual effects, refreshes
// less often, doesn't download pages in advance, and video calls start at a low resolution.
import { useEffect, useState } from 'react';

export type DataSaverPreference = 'auto' | 'on' | 'off';
export type ConnectionQuality = 'good' | 'slow' | 'unknown';

const KEY = 'vitalink-data-saver';
const CHANGE_EVENT = 'vitalink:data-saver';

interface NetworkInformationLike extends EventTarget {
  saveData?: boolean;
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number;
}

const connection = (): NetworkInformationLike | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformationLike }).connection;

/** What the browser says about the connection (Chrome, Edge and Android; others report "unknown"). */
export function connectionQuality(): ConnectionQuality {
  const info = connection();
  if (!info) return 'unknown';
  // 3G is common and usable, so it isn't treated as slow; browsers also tend to under-report it.
  if (info.saveData || info.effectiveType === 'slow-2g' || info.effectiveType === '2g') return 'slow';
  if (typeof info.downlink === 'number' && info.downlink > 0 && info.downlink < 0.5) return 'slow';
  return 'good';
}

export function getDataSaverPreference(): DataSaverPreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function setDataSaverPreference(value: DataSaverPreference) {
  try { localStorage.setItem(KEY, value); } catch { /* storage blocked: applies for this visit only */ }
  applyDataSaver();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function isLowData(): boolean {
  const preference = getDataSaverPreference();
  return preference === 'on' || (preference === 'auto' && connectionQuality() === 'slow');
}

/** Lets CSS drop heavy effects (`html[data-low-data]`); call once at start-up. */
export function applyDataSaver() {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-low-data', isLowData());
}

/** Calls `listener` whenever low-data mode may have changed (setting or connection). */
export function onDataSaverChange(listener: () => void) {
  const info = connection();
  const run = () => { applyDataSaver(); listener(); };
  window.addEventListener(CHANGE_EVENT, run);
  info?.addEventListener('change', run);
  return () => { window.removeEventListener(CHANGE_EVENT, run); info?.removeEventListener('change', run); };
}

export function useLowData(): boolean {
  const [low, setLow] = useState(isLowData);
  useEffect(() => onDataSaverChange(() => setLow(isLowData())), []);
  return low;
}

/** How often to refresh data in the background: slower on low data, paused while the tab is hidden. */
export function refreshInterval(normalMs: number) {
  return isLowData() ? normalMs * 3 : normalMs;
}
