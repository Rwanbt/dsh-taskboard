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
INK = (34, 38, 58)
INK_SOFT = (108, 112, 132)


def palette_for(desktop: Image.Image) -> dict[str, object]:
    """Pick the backdrop from the capture itself: dark panels get a dark stage."""
    sample = desktop.convert("L").resize((64, 64))
    pixels = sample.get_flattened_data() if hasattr(sample, "get_flattened_data") else sample.getdata()
    mean = sum(pixels) / (64 * 64) / 255
    if mean < 0.5:
        return {
            "dark": True,
            "bg_top": (26, 26, 36),
            "bg_bottom": (14, 15, 21),
            "blob_a": (58, 48, 96),
            "blob_b": (34, 62, 90),
            "blob_c": (30, 70, 62),
            "ink": (243, 240, 252),
            "ink_soft": (170, 168, 190),
            "frame": (8, 9, 13),
            "frame_edge": (38, 39, 48),
            "shadow_alpha": 130,
        }
    return {
        "dark": False,
        "bg_top": (247, 244, 255),
        "bg_bottom": (238, 243, 251),
        "blob_a": (226, 219, 250),
        "blob_b": (214, 233, 249),
        "blob_c": (222, 242, 232),
        "ink": INK,
        "ink_soft": INK_SOFT,
        "frame": (26, 27, 34),
        "frame_edge": (12, 13, 18),
        "shadow_alpha": 90,
    }


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

    desktop_source = Image.open(desktop_path).convert("RGB")
    tones = palette_for(desktop_source)

    canvas = vertical_gradient(CANVAS, tones["bg_top"], tones["bg_bottom"]).convert("RGBA")
    width, height = CANVAS
    blob(canvas, (int(width * 0.18), int(height * 0.14)), 520, tones["blob_a"], 150)
    blob(canvas, (int(width * 0.86), int(height * 0.22)), 460, tones["blob_b"], 140)
    blob(canvas, (int(width * 0.55), int(height * 0.96)), 560, tones["blob_c"], 120)

    # Desktop panel, left.
    desktop = rounded(fit(desktop_source, 880), 26)
    desktop_shadow = shadow(desktop.size, 26, 34, tones["shadow_alpha"])
    desktop_at = (150, 250)
    canvas.alpha_composite(desktop_shadow, (desktop_at[0] - desktop_shadow.size[0] // 2 + desktop.size[0] // 2,
                                            desktop_at[1] - desktop_shadow.size[1] // 2 + desktop.size[1] // 2))
    canvas.alpha_composite(desktop, desktop_at)

    # Phone, right: slim frame around the portrait capture.
    phone_height = 980
    screen = fit(Image.open(mobile_path).convert("RGB"), phone_height)
    bezel = 16
    frame_size = (screen.size[0] + bezel * 2, screen.size[1] + bezel * 2)
    frame = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    frame_draw = ImageDraw.Draw(frame)
    frame_draw.rounded_rectangle((0, 0, frame_size[0] - 1, frame_size[1] - 1), radius=58, fill=tones["frame"])
    frame_draw.rounded_rectangle(
        (bezel - 3, bezel - 3, frame_size[0] - bezel + 2, frame_size[1] - bezel + 2),
        radius=46, fill=tones["frame_edge"],
    )
    frame.alpha_composite(rounded(screen, 42), (bezel, bezel))
    phone_x = width - frame_size[0] - 210
    phone_y = (height - frame_size[1]) // 2 - 40
    phone_shadow = shadow(frame_size, 58, 44, 120)
    canvas.alpha_composite(phone_shadow, (phone_x - phone_shadow.size[0] // 2 + frame_size[0] // 2,
                                          phone_y - phone_shadow.size[1] // 2 + frame_size[1] // 2))
    canvas.alpha_composite(frame, (phone_x, phone_y))

    # Caption, bottom left.
    draw = ImageDraw.Draw(canvas)
    draw.text((150, height - 168), "DSH Task Board", font=font(64, bold=True), fill=tones["ink"])
    draw.text((152, height - 92), "DeepSeek Pastel — desktop et mobile · données fictives",
              font=font(30), fill=tones["ink_soft"])

    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({CANVAS[0]}x{CANVAS[1]}) · {'dark' if tones['dark'] else 'light'} backdrop")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
