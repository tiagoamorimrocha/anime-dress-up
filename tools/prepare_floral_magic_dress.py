"""Build the floral-magic-dress layer from its ImageGen source.

ImageGen edited ``base-doll.png`` without changing the pose or canvas, so the
garment can be isolated from the registered base by measuring pixel changes.
The extraction is deliberately constrained to the dress silhouette: tiny
ImageGen redraw differences elsewhere on the doll never enter the final layer.

Run with the bundled Codex Python (Pillow + NumPy):
    <python> tools/prepare_floral_magic_dress.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "references" / "floral-magic-dress-source.png"
BASE = ROOT / "base-doll.png"
OUT = ROOT / "assets" / "png" / "floral-magic-dress.png"
DEBUG = ROOT / "assets" / "png" / "debug"

CANVAS_OFFSET = (177, 23)
CANVAS_SIZE = (677, 1411)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    base = Image.open(BASE).convert("RGB")

    if source.size != (1086, 1449):
        raise ValueError(f"unexpected floral dress source size: {source.size}")
    if base.size != (1086, 1448):
        raise ValueError(f"unexpected base doll size: {base.size}")

    # The generated edit contains one extra row at the top. Dropping it gives
    # the lowest background/skin error against the fixed wardrobe reference.
    aligned = source.crop((0, 1, source.width, source.height))
    source_rgb = np.asarray(aligned).astype(np.int16)
    base_rgb = np.asarray(base).astype(np.int16)
    channel_diff = np.abs(source_rgb - base_rgb)
    signal = channel_diff.max(axis=2) * 0.68 + channel_diff.mean(axis=2) * 0.32

    # Keep only the region a sleeveless tea-length dress can occupy. The
    # generous outline retains projecting petals and blossoms while excluding
    # the face, arms, hands, lower legs, and feet.
    silhouette = Image.new("L", base.size)
    ImageDraw.Draw(silhouette).polygon(
        [
            (387, 334), (684, 334), (690, 500), (748, 620),
            (862, 995), (848, 1168), (551, 1193), (219, 1168),
            (204, 1010), (302, 714), (383, 510),
        ],
        fill=255,
    )
    silhouette_arr = np.asarray(silhouette) > 0

    # Map difference strength to opacity. A soft threshold keeps translucent
    # tulle and fine gold vines; strong flower edges reach full opacity.
    alpha = np.clip((signal - 4.8) * 27.0, 0, 255)
    alpha[signal < 5.2] = 0
    alpha[~silhouette_arr] = 0

    # The edit is exceptionally well registered, but antialiased limb
    # outlines still differ enough to survive a numeric threshold. Exclude
    # the two exposed arm paths and everything below the tea-length hem.
    exclusions = Image.new("L", base.size)
    exclusion_draw = ImageDraw.Draw(exclusions)
    exclusion_draw.polygon(
        [(321, 320), (423, 316), (431, 360), (404, 449),
         (345, 463), (313, 426)],
        fill=255,
    )
    exclusion_draw.polygon(
        [(654, 326), (706, 338), (708, 504), (746, 642),
         (792, 719), (789, 783), (718, 763), (680, 655), (646, 500)],
        fill=255,
    )
    exclusion_draw.rectangle((0, 1167, base.width, base.height), fill=255)
    alpha[np.asarray(exclusions) > 0] = 0

    # ImageGen may redraw a skin edge by a few color values. When both source
    # and base still classify as skin, require a stronger change before that
    # pixel can become part of the garment.
    def skin(rgb: np.ndarray) -> np.ndarray:
        return (
            (rgb[..., 0] > 188)
            & (rgb[..., 1] > 138)
            & (rgb[..., 0] - rgb[..., 1] > 20)
            & (rgb[..., 0] - rgb[..., 2] > 23)
            & (rgb[..., 1] - rgb[..., 2] > 5)
        )

    skin_overlap = skin(source_rgb) & skin(base_rgb)
    alpha[skin_overlap] = np.minimum(
        alpha[skin_overlap],
        np.clip((signal[skin_overlap] - 7.0) * 18.0, 0, 255),
    )

    alpha_image = Image.fromarray(alpha.astype(np.uint8), "L")
    # Close pinholes inside painted flowers, then feather only the outermost
    # edge. Multiplying by the original silhouette keeps the safety boundary.
    closed = alpha_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    alpha_image = ImageChops.multiply(closed.filter(ImageFilter.GaussianBlur(0.35)), silhouette)
    # Closing can grow a neighboring garment pixel back across an exclusion
    # boundary, so enforce the limb guard once more after all morphology.
    alpha_image = ImageChops.multiply(alpha_image, ImageChops.invert(exclusions))
    alpha = np.asarray(alpha_image)

    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError("floral magic dress mask is empty")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    rgba = aligned.convert("RGBA")
    rgba.putalpha(alpha_image)
    cutout = rgba.crop((x0, y0, x1, y1))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    cutout.save(OUT)
    alpha_image.save(DEBUG / "floral-magic-dress_mask.png")

    checks = []
    for color in ((255, 232, 242, 255), (49, 35, 66, 255)):
        check = Image.new("RGBA", cutout.size, color)
        check.alpha_composite(cutout)
        checks.append(check.convert("RGB"))
    edges = Image.new("RGB", (cutout.width * 2, cutout.height))
    edges.paste(checks[0], (0, 0))
    edges.paste(checks[1], (cutout.width, 0))
    edges.save(DEBUG / "floral-magic-dress_edges.png")

    px = x0 - CANVAS_OFFSET[0]
    py = y0 - CANVAS_OFFSET[1]
    print(
        f"floral-magic-dress: bbox x {x0}-{x1 - 1} y {y0}-{y1 - 1}; "
        f"manifest x={px} y={py} w={x1 - x0} h={y1 - y0}"
    )


if __name__ == "__main__":
    main()
