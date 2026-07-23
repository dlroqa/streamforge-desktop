/**
 * Lightweight local activity log for the account panel. Records notable studio
 * events (going live, recording) with timestamps in localStorage. Purely
 * client-side and best-effort.
 */
export interface ActivityEntry {
  label: string;
  at: number; // epoch ms
}

const KEY = 'studio-activity-log';
const MAX = 20;
export const ACTIVITY_EVENT = 'studio-activity';

export function logActivity(label: string): void {
  try {
    const next = [{ label, at: Date.now() }, ...getActivities()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
  } catch {
    /* storage unavailable — activity logging is non-critical */
  }
}

export function getActivities(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ActivityEntry[]) : [];
    return Array.isArray(parsed) ? parsed.filter(e => e && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}
