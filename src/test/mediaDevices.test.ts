import { describe, it, expect } from "vitest";
import { pickDefaultDevice } from "@/lib/mediaDevices";

/** Minimal MediaDeviceInfo-shaped fixture for the picker. */
const dev = (deviceId: string, label = ""): MediaDeviceInfo =>
  ({ deviceId, label, kind: "audioinput", groupId: "" } as MediaDeviceInfo);

describe("pickDefaultDevice", () => {
  it("returns null when no devices are labeled yet (permission not granted)", () => {
    expect(pickDefaultDevice([dev("a"), dev("b")], ["default"])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultDevice([], ["default"])).toBeNull();
  });

  it("prefers the OS 'default' pseudo-device when present", () => {
    const devices = [dev("hw-1", "Built-in Mic"), dev("default", "Default - AirPods")];
    expect(pickDefaultDevice(devices, ["default", "hw-1"])).toBe("default");
  });

  it("falls back to the next preferred id (e.g. the camera's own mic)", () => {
    const devices = [dev("hw-1", "Built-in Mic"), dev("cam-mic", "Logitech Webcam")];
    // No OS 'default' entry, so the camera-matched mic wins.
    expect(pickDefaultDevice(devices, ["default", "cam-mic"])).toBe("cam-mic");
  });

  it("falls back to the first labeled device when no preferred id matches", () => {
    const devices = [dev("hw-1", "Built-in Mic"), dev("hw-2", "USB Mic")];
    expect(pickDefaultDevice(devices, ["default", "nonexistent"])).toBe("hw-1");
  });

  it("skips null/undefined preferred ids without matching them", () => {
    const devices = [dev("hw-1", "Built-in Mic"), dev("hw-2", "USB Mic")];
    expect(pickDefaultDevice(devices, [null, undefined, "hw-2"])).toBe("hw-2");
  });

  it("ignores unlabeled entries when choosing the fallback", () => {
    // First device is unlabeled (a stale/placeholder entry); the picker should
    // skip it and default to the first *labeled* device.
    const devices = [dev("ghost", ""), dev("hw-2", "USB Mic")];
    expect(pickDefaultDevice(devices, [])).toBe("hw-2");
  });
});
