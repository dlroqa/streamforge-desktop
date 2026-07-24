#!/usr/bin/env python3
"""Regenerate build/icon.png: the desktop app icon with rounded corners.

The source artwork (public/android-chrome-512x512.png) is a full-bleed square,
which renders as a hard-edged black tile in the macOS Dock / Windows taskbar /
Ubuntu dock while every neighbouring icon is a rounded square. This masks it to
a 22.37% corner radius -- the macOS icon-grid value -- so it sits correctly
alongside them.

Only the desktop icon is rounded. The web favicons under public/ are left alone;
browsers and mobile launchers apply their own masking.

Run after changing the source artwork:  python3 scripts/round-icon.py
Requires Pillow.
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "android-chrome-512x512.png"
OUT = ROOT / "build" / "icon.png"
RADIUS_PCT = 0.2237
SUPERSAMPLE = 8


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size

    # PIL's rounded_rectangle is hard-edged, so draw the mask at 8x and
    # downsample -- that is what yields a clean anti-aliased curve rather than
    # visible stair-stepping along the corners.
    mask = Image.new("L", (w * SUPERSAMPLE, h * SUPERSAMPLE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, w * SUPERSAMPLE - 1, h * SUPERSAMPLE - 1),
        radius=int(min(w, h) * SUPERSAMPLE * RADIUS_PCT),
        fill=255,
    )
    mask = mask.resize((w, h), Image.LANCZOS)

    # Combine with any existing alpha instead of replacing it.
    out = img.copy()
    out.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (w, h), 0), mask))
    out.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({w}x{h}, radius {RADIUS_PCT*100:.2f}%)")


if __name__ == "__main__":
    main()
