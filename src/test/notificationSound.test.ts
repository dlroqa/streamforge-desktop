import { describe, it, expect } from "vitest";
import { evaluateChime } from "@/lib/notificationSound";

const m = (mine: boolean) => ({ mine });

describe("evaluateChime", () => {
  it("never chimes on first observation (mount/reconnect), records baseline", () => {
    const r = evaluateChime(null, [m(false), m(true)]);
    expect(r).toEqual({ chime: false, nextSeen: 2 });
  });

  it("chimes when a new incoming (guest) message arrives", () => {
    const r = evaluateChime(1, [m(true), m(false)]);
    expect(r).toEqual({ chime: true, nextSeen: 2 });
  });

  it("does NOT chime when the only new message is our own", () => {
    const r = evaluateChime(1, [m(false), m(true)]);
    expect(r).toEqual({ chime: false, nextSeen: 2 });
  });

  it("chimes if any of several new messages is incoming", () => {
    const r = evaluateChime(1, [m(true), m(true), m(false)]);
    expect(r).toEqual({ chime: true, nextSeen: 3 });
  });

  it("does not chime when nothing changed", () => {
    const r = evaluateChime(2, [m(false), m(true)]);
    expect(r).toEqual({ chime: false, nextSeen: 2 });
  });

  it("resyncs silently when the feed shrank/reset", () => {
    const r = evaluateChime(3, [m(false)]);
    expect(r).toEqual({ chime: false, nextSeen: 1 });
  });

  it("handles an emptied feed", () => {
    expect(evaluateChime(2, [])).toEqual({ chime: false, nextSeen: 0 });
  });
});
