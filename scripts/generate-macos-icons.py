from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops


ICONSET_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}


def foreground_mask(source: Image.Image) -> Image.Image:
    red, green, blue, alpha = source.convert("RGBA").split()
    brightness = ImageChops.lighter(red, ImageChops.lighter(green, blue))
    colored_foreground = brightness.point(
        lambda value: 0 if value <= 64 else min(255, (value - 64) * 5)
    )
    return ImageChops.multiply(colored_foreground, alpha)


def save_template(mask: Image.Image, destination: Path, scale: int) -> None:
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("source image has no foreground for a template image")

    cropped = mask.crop(bbox)
    target_width = 22 * scale
    target_height = 16 * scale
    padding = scale
    ratio = min(
        (target_width - 2 * padding) / cropped.width,
        (target_height - 2 * padding) / cropped.height,
    )
    resized = cropped.resize(
        (max(1, round(cropped.width * ratio)), max(1, round(cropped.height * ratio))),
        Image.Resampling.LANCZOS,
    )
    alpha = Image.new("L", (target_width, target_height))
    alpha.paste(
        resized,
        ((target_width - resized.width) // 2, (target_height - resized.height) // 2),
    )
    template = Image.new("RGBA", alpha.size, (0, 0, 0, 0))
    template.putalpha(alpha)
    template.save(destination, optimize=True)


def save_icns(source: Image.Image, destination: Path) -> None:
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        raise RuntimeError("iconutil is required to generate app.icns on macOS")

    with tempfile.TemporaryDirectory(prefix="moyu-kanpan-icon-") as temp_root:
        iconset = Path(temp_root) / "app.iconset"
        iconset.mkdir()
        for filename, size in ICONSET_SIZES.items():
            source.resize((size, size), Image.Resampling.LANCZOS).save(
                iconset / filename,
                optimize=True,
            )
        subprocess.run(
            [iconutil, "--convert", "icns", "--output", str(destination), str(iconset)],
            check=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate macOS app and menu-bar template icons from app.png"
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    if source.size != (1024, 1024):
        raise ValueError("macOS app icon source must be 1024x1024")

    args.output.mkdir(parents=True, exist_ok=True)
    save_icns(source, args.output / "app.icns")
    mask = foreground_mask(source)
    save_template(mask, args.output / "trayTemplate.png", 1)
    save_template(mask, args.output / "trayTemplate@2x.png", 2)
    print(f"Generated macOS icons in {args.output}")


if __name__ == "__main__":
    main()
