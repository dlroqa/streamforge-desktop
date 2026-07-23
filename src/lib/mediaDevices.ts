/**
 * Pick a sensible default input device from an enumerated list.
 *
 * Only devices with a non-empty `label` are considered — an unlabeled list
 * means media permission hasn't been granted yet, so there's no reliable
 * default to choose. Preferred device ids are tried in order (e.g. the OS
 * "default" pseudo-device, then a mic that shares the program camera's
 * hardware); the first labeled device is the final fallback.
 *
 * Returns the chosen deviceId, or null when nothing can be picked.
 */
export function pickDefaultDevice(
  devices: MediaDeviceInfo[],
  preferredIds: Array<string | null | undefined> = [],
): string | null {
  const labeled = devices.filter(d => d.label);
  if (!labeled.length) return null;
  for (const id of preferredIds) {
    if (!id) continue;
    const match = labeled.find(d => d.deviceId === id);
    if (match) return match.deviceId;
  }
  return labeled[0].deviceId;
}
