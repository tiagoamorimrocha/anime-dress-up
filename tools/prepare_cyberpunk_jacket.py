"""Build the cyberpunk-jacket wardrobe layer from its ImageGen source.

The generated source is a pose-preserving edit of ``base-doll.png``.  This
script isolates only the registered jacket pixels, crops them, and writes the
transparent game asset plus repeatable mask/edge QA images.

Run with the bundled Codex Python (Pillow + NumPy):
    <python> tools/prepare_cyberpunk_jacket.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "references" / "cyberpunk-jacket-source.png"
BASE = ROOT / "base-doll.png"
OUT = ROOT / "assets" / "png" / "cyberpunk-jacket.png"
DEBUG = ROOT / "assets" / "png" / "debug"

CANVAS_OFFSET = (177, 23)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    base = Image.open(BASE).convert("RGB")

    if source.size != (1086, 1448):
        raise ValueError(f"unexpected cyberpunk jacket source size: {source.size}")
    if base.size != source.size:
        raise ValueError(f"source/base size mismatch: {source.size} vs {base.size}")

    source_rgb = np.asarray(source).astype(np.int16)
    base_rgb = np.asarray(base).astype(np.int16)
    channel_diff = np.abs(source_rgb - base_rgb)
    signal = channel_diff.max(axis=2) * 0.68 + channel_diff.mean(axis=2) * 0.32

    # Trace the visible garment as separate pieces. Keeping the open-front gap
    # out of the mask is important because ImageGen softly repainted parts of
    # the otherwise unchanged bodysuit.
    silhouette = Image.new("L", base.size)
    silhouette_draw = ImageDraw.Draw(silhouette)
    pieces = [
        # Raised left sleeve and luminous cuff.
        [(386, 290), (451, 324), (439, 376), (411, 523),
         (373, 541), (320, 487), (303, 428), (334, 355)],
        # Left collar and cropped front panel.
        [(426, 243), (494, 269), (496, 337), (469, 397),
         (468, 575), (386, 557), (392, 421), (411, 346)],
        # Right collar and cropped front panel.
        [(575, 282), (643, 239), (662, 322), (634, 383),
         (650, 559), (615, 579), (564, 568), (566, 382)],
        # Lowered right sleeve and luminous cuff.
        [(623, 329), (690, 350), (716, 420), (738, 529),
         (765, 612), (755, 693), (712, 724), (678, 665),
         (650, 550), (631, 486)],
    ]
    for piece in pieces:
        silhouette_draw.polygon(piece, fill=255)
    silhouette_arr = np.asarray(silhouette) > 0

    # Preserve fine neon piping and translucent holographic panels while
    # pushing the opaque shell and cuffs to full alpha.
    alpha = np.clip((signal - 4.5) * 28.0, 0, 255)
    alpha[signal < 5.0] = 0
    alpha[~silhouette_arr] = 0

    def skin(rgb: np.ndarray) -> np.ndarray:
        return (
            (rgb[..., 0] > 188)
            & (rgb[..., 1] > 138)
            & (rgb[..., 0] - rgb[..., 1] > 20)
            & (rgb[..., 0] - rgb[..., 2] > 23)
            & (rgb[..., 1] - rgb[..., 2] > 5)
        )

    # Small antialiasing changes on the visible hands must not become part of
    # the jacket. Real sleeve pixels differ strongly and are not skin in the
    # generated source, so this guard leaves them intact.
    skin_overlap = skin(source_rgb) & skin(base_rgb)
    alpha[skin_overlap] = np.minimum(
        alpha[skin_overlap],
        np.clip((signal[skin_overlap] - 8.0) * 17.0, 0, 255),
    )

    # The edit repaints exposed skin enough for a numeric difference to see
    # it. In the face/neck and hand zones, reject pixels that still classify
    # as skin in the generated source; the jacket remains untouched.
    skin_guard = Image.new("L", base.size)
    guard_draw = ImageDraw.Draw(skin_guard)
    guard_draw.polygon(
        [(390, 188), (601, 180), (628, 345), (550, 383),
         (453, 362), (386, 303)],
        fill=255,
    )
    guard_draw.polygon(
        [(686, 671), (790, 665), (809, 778), (713, 795)],
        fill=255,
    )
    alpha[(np.asarray(skin_guard) > 0) & skin(source_rgb)] = 0

    alpha_image = Image.fromarray(alpha.astype(np.uint8), "L")
    closed = alpha_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    alpha_image = ImageChops.multiply(
        closed.filter(ImageFilter.GaussianBlur(0.35)), silhouette
    )

    # Hard safety cutouts protect the face, hands, and intentionally open
    # center. They are applied last so morphology cannot grow pixels back in.
    exclusions = Image.new("L", base.size)
    exclusion_draw = ImageDraw.Draw(exclusions)
    exclusion_draw.ellipse((427, 64, 612, 333), fill=255)
    exclusion_draw.polygon(
        [(397, 195), (472, 201), (474, 296), (445, 322), (403, 294)],
        fill=255,
    )
    exclusion_draw.polygon(
        [(700, 700), (796, 684), (811, 783), (714, 797)],
        fill=255,
    )
    exclusion_draw.polygon(
        [(451, 316), (580, 316), (562, 590), (395, 590)],
        fill=255,
    )
    exclusion_draw.rectangle((380, 576, 649, 730), fill=255)
    alpha_image = ImageChops.multiply(alpha_image, ImageChops.invert(exclusions))
    # Jacket pixels are overwhelmingly strong changes; low-opacity remnants
    # are base redraw noise. Re-threshold, then restore a tiny antialiased edge.
    alpha_image = alpha_image.point(lambda value: 255 if value >= 64 else 0)
    alpha_image = alpha_image.filter(ImageFilter.GaussianBlur(0.35))
    alpha_image = ImageChops.multiply(alpha_image, silhouette)
    alpha_image = ImageChops.multiply(alpha_image, ImageChops.invert(exclusions))
    alpha = np.asarray(alpha_image)

    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError("cyberpunk jacket mask is empty")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    rgba = source.convert("RGBA")
    rgba.putalpha(alpha_image)
    cutout = rgba.crop((x0, y0, x1, y1))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    cutout.save(OUT)
    alpha_image.save(DEBUG / "cyberpunk-jacket_mask.png")

    checks = []
    for color in ((255, 232, 242, 255), (49, 35, 66, 255)):
        check = Image.new("RGBA", cutout.size, color)
        check.alpha_composite(cutout)
        checks.append(check.convert("RGB"))
    edges = Image.new("RGB", (cutout.width * 2, cutout.height))
    edges.paste(checks[0], (0, 0))
    edges.paste(checks[1], (cutout.width, 0))
    edges.save(DEBUG / "cyberpunk-jacket_edges.png")

    px = x0 - CANVAS_OFFSET[0]
    py = y0 - CANVAS_OFFSET[1]
    print(
        f"cyberpunk-jacket: bbox x {x0}-{x1 - 1} y {y0}-{y1 - 1}; "
        f"manifest x={px} y={py} w={x1 - x0} h={y1 - y0}"
    )


if __name__ == "__main__":
    main()
