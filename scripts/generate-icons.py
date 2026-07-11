from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def square_crop_with_padding(image: Image.Image, padding_ratio: float = 0.035) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("source image has no visible pixels")

    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    side = max(width, height)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    padding = max(1, round(side * padding_ratio))
    half = side / 2 + padding
    crop_box = (
        round(center_x - half),
        round(center_y - half),
        round(center_x + half),
        round(center_y + half),
    )

    canvas = Image.new("RGBA", (crop_box[2] - crop_box[0], crop_box[3] - crop_box[1]))
    source_crop = image.crop(crop_box)
    canvas.alpha_composite(source_crop)
    return canvas


def save_resized(image: Image.Image, size: int, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate app and tray icons from a transparent PNG")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    icon = square_crop_with_padding(source)
    output = args.output
    output.mkdir(parents=True, exist_ok=True)

    master = icon.resize((1024, 1024), Image.Resampling.LANCZOS)
    master.save(output / "app.png", optimize=True)
    save_resized(icon, 256, output / "app-256.png")
    save_resized(icon, 32, output / "tray.png")
    save_resized(icon, 64, output / "tray@2x.png")
    master.save(output / "app.ico", format="ICO", sizes=[(size, size) for size in ICO_SIZES])

    print(f"Generated icons in {output}")


if __name__ == "__main__":
    main()
