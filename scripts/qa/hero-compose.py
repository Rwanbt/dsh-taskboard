"""Compose the hero image (desktop + phone) from the captured plugin panels.

Usage:
    python -B scripts/qa/hero-compose.py <desktop.png> <mobile.png> <out.png>

The two inputs are panel-only captures (no host chrome, no personal data). The
composer draws a soft pastel backdrop, the desktop panel with rounded corners
and a shadow, the phone in a slim device frame, and a discreet caption.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CANVAS = (2560, 1440)
BG_TOP = (247, 244, 255)
BG_BOTTOM = (238, 243, 251)
BLOB_A = (226, 219, 250)   # violet
BLOB_B = (214, 233, 249)   # sky
BLOB_C = (222, 242, 232)   # mint
INK = (34, 38, 58)
INK_SOFT = (108, 112, 132)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    for directory in (Path("C:/Windows/Fonts"), Path.home() / "AppData/Local/Microsoft/Windows/Fonts"):
        candidate = directory / name
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    strip = Image.new("RGB", (1, height))
    pixels = strip.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        pixels[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
    return strip.resize((width, height), Image.Resampling.BILINEAR).convert("RGB")


def blob(canvas: Image.Image, center: tuple[int, int], radius: int, colour: tuple[int, int, int], alpha: int) -> None:
    layer = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse((0, 0, radius * 2, radius * 2), fill=colour + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius // 3))
    canvas.alpha_composite(layer, (center[0] - radius, center[1] - radius))


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.size[0] - 1, image.size[1] - 1), radius=radius, fill=255)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def shadow(size: tuple[int, int], radius: int, blur: int, alpha: int = 70) -> Image.Image:
    pad = blur * 3
    layer = Image.new("RGBA", (size[0] + pad * 2, size[1] + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle((pad, pad, pad + size[0], pad + size[1]), radius=radius, fill=(24, 26, 44, alpha))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def fit(image: Image.Image, height: int) -> Image.Image:
    width = round(image.size[0] * height / image.size[1])
    return image.resize((width, height), Image.Resampling.LANCZOS)


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    desktop_path, mobile_path, out_path = (Path(argument) for argument in sys.argv[1:])

    canvas = vertical_gradient(CANVAS, BG_TOP, BG_BOTTOM).convert("RGBA")
    width, height = CANVAS
    blob(canvas, (int(width * 0.18), int(height * 0.14)), 520, BLOB_A, 120)
    blob(canvas, (int(width * 0.86), int(height * 0.22)), 460, BLOB_B, 110)
    blob(canvas, (int(width * 0.55), int(height * 0.96)), 560, BLOB_C, 90)

    # Desktop panel, left.
    desktop = rounded(fit(Image.open(desktop_path).convert("RGB"), 880), 26)
    desktop_shadow = shadow(desktop.size, 26, 34, 90)
    desktop_at = (150, 250)
    canvas.alpha_composite(desktop_shadow, (desktop_at[0] - desktop_shadow.size[0] // 2 + desktop.size[0] // 2,
                                            desktop_at[1] - desktop_shadow.size[1] // 2 + desktop.size[1] // 2))
    canvas.alpha_composite(desktop, desktop_at)

    # Phone, right: slim dark frame around the portrait capture.
    phone_height = 980
    screen = fit(Image.open(mobile_path).convert("RGB"), phone_height)
    bezel = 16
    frame_size = (screen.size[0] + bezel * 2, screen.size[1] + bezel * 2)
    frame = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    frame_draw = ImageDraw.Draw(frame)
    frame_draw.rounded_rectangle((0, 0, frame_size[0] - 1, frame_size[1] - 1), radius=58, fill=(26, 27, 34, 255))
    frame_draw.rounded_rectangle(
        (bezel - 3, bezel - 3, frame_size[0] - bezel + 2, frame_size[1] - bezel + 2),
        radius=46, fill=(12, 13, 18, 255),
    )
    frame.alpha_composite(rounded(screen, 42), (bezel, bezel))
    phone_x = width - frame_size[0] - 210
    phone_y = (height - frame_size[1]) // 2 - 40
    phone_shadow = shadow(frame_size, 58, 44, 110)
    canvas.alpha_composite(phone_shadow, (phone_x - phone_shadow.size[0] // 2 + frame_size[0] // 2,
                                          phone_y - phone_shadow.size[1] // 2 + frame_size[1] // 2))
    canvas.alpha_composite(frame, (phone_x, phone_y))

    # Caption, bottom left.
    draw = ImageDraw.Draw(canvas)
    draw.text((150, height - 168), "DSH Task Board", font=font(64, bold=True), fill=INK)
    draw.text((152, height - 92), "DeepSeek Pastel — desktop et mobile · données fictives",
              font=font(30), fill=INK_SOFT)

    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({CANVAS[0]}x{CANVAS[1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
