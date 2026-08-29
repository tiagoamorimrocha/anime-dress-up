"""Build the wedding-dress layer from its AI-generated reference artwork.

The first ImageGen pass produced ``references/wedding-dress-source.png`` in
the same pose as the base doll.  A second, semantic extraction pass supplied
``references/wedding-dress-mask.png``.  That extraction was automatically
reframed, so this script maps its silhouette back onto the registered source
and uses the original source pixels for the final layer.

Run with the bundled Codex Python (Pillow + NumPy):
    <python> tools/prepare_wedding_dress.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "references" / "wedding-dress-source.png"
SEMANTIC_MASK = ROOT / "references" / "wedding-dress-mask.png"
BASE = ROOT / "base-doll.png"
OUT = ROOT / "assets" / "png" / "wedding-dress.png"
DEBUG = ROOT / "assets" / "png" / "debug"

# Registration recovered by matching the isolated dress's warm-color and
# luminance features against the dress in SOURCE.  The generated source is
# also two pixels higher than the established base-doll registration.
MASK_SCALE = 0.804
MASK_X = 100
MASK_Y = 212
SOURCE_SHIFT_Y = 2

CANVAS_OFFSET = (177, 23)
CANVAS_SIZE = (677, 1411)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    base = Image.open(BASE).convert("RGB")
    semantic = Image.open(SEMANTIC_MASK).convert("L")

    if source.size != (1086, 1449):
        raise ValueError(f"unexpected wedding source size: {source.size}")
    if base.size != (1086, 1448) or semantic.size != base.size:
        raise ValueError("base doll and semantic mask must be 1086 x 1448")

    # Map the AI-isolated silhouette back to the dressed-doll source canvas.
    mapped = Image.new("L", source.size)
    resized = semantic.resize(
        (round(semantic.width * MASK_SCALE), round(semantic.height * MASK_SCALE)),
        Image.Resampling.LANCZOS,
    )
    # A tiny blur removes threshold stair-steps while retaining lace scallops.
    resized = resized.filter(ImageFilter.GaussianBlur(0.35))
    mapped.paste(resized, (MASK_X, MASK_Y))

    # Align the source to the game's fixed reference pose.  Pixels outside the
    # matte do not matter, so transparent black is preferable to baked backdrop.
    aligned_rgb = Image.new("RGB", base.size)
    aligned_rgb.paste(source.crop((0, 0, source.width, base.height - SOURCE_SHIFT_Y)),
                      (0, SOURCE_SHIFT_Y))
    aligned_alpha = Image.new("L", base.size)
    aligned_alpha.paste(mapped.crop((0, 0, mapped.width, base.height - SOURCE_SHIFT_Y)),
                        (0, SOURCE_SHIFT_Y))

    # The semantic silhouette intentionally enclosed translucent straps and
    # the open center beneath the train.  Remove unchanged skin from those
    # areas, but retain tulle/lace strokes wherever the dressed source differs
    # from the base.  This avoids baking doll skin into the clothing layer.
    source_rgb = np.asarray(aligned_rgb).astype(np.int16)
    base_rgb = np.asarray(base).astype(np.int16)
    skin_source = (
        (source_rgb[..., 0] > 190)
        & (source_rgb[..., 1] > 145)
        & (source_rgb[..., 0] - source_rgb[..., 1] > 22)
        & (source_rgb[..., 0] - source_rgb[..., 2] > 26)
        & (source_rgb[..., 1] - source_rgb[..., 2] > 7)
    )
    skin_base = (
        (base_rgb[..., 0] > 190)
        & (base_rgb[..., 1] > 145)
        & (base_rgb[..., 0] - base_rgb[..., 1] > 22)
        & (base_rgb[..., 0] - base_rgb[..., 2] > 26)
        & (base_rgb[..., 1] - base_rgb[..., 2] > 7)
    )
    skin_overlap = skin_source & skin_base
    difference = np.abs(source_rgb - base_rgb).mean(axis=2)
    tulle_detail = np.clip((difference - 2.5) * (255.0 / 14.0), 0, 255)
    alpha = np.asarray(aligned_alpha).copy()
    rows = np.arange(alpha.shape[0])[:, None]
    sheer_regions = (rows < 470) | (rows > 1130)
    refine_skin = skin_overlap & sheer_regions
    alpha[refine_skin] = np.minimum(alpha[refine_skin], tulle_detail[refine_skin])
    cols = np.arange(alpha.shape[1])[None, :]
    straps = (
        ((cols > 350) & (cols < 465) & (rows > 325) & (rows < 455))
        | ((cols > 570) & (cols < 690) & (rows > 335) & (rows < 470))
    )
    # Skin visible through the off-shoulder tulle must stay transparent in
    # the wardrobe layer.  Cap those pixels at a sheer alpha while the white
    # tulle folds (which do not classify as skin) retain their full detail.
    sheer_skin = skin_source & straps
    alpha[sheer_skin] = np.minimum(alpha[sheer_skin], 88)
    # Below the front hem these are true openings for the doll's legs, not
    # translucent cloth.  Expand by two pixels to remove the generated skin
    # outline as well as the interior fill.
    lower_skin = np.asarray(
        Image.fromarray((skin_overlap * 255).astype(np.uint8), "L").filter(
            ImageFilter.MaxFilter(5)
        )
    ) > 0
    alpha[lower_skin & (rows > 1130)] = 0
    aligned_alpha = Image.fromarray(alpha.astype(np.uint8), "L")

    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError("wedding-dress mask is empty")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    rgba = aligned_rgb.convert("RGBA")
    rgba.putalpha(aligned_alpha)
    cutout = rgba.crop((x0, y0, x1, y1))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    cutout.save(OUT)

    # Full-canvas matte plus a side-by-side light/dark edge check.  Keeping
    # these in the pipeline's standard *_mask / *_edges naming means normal
    # debug cleanup rules continue to apply.
    aligned_alpha.save(DEBUG / "wedding-dress_mask.png")
    checks = []
    for name, color in (("light", (255, 232, 242, 255)),
                        ("dark", (49, 35, 66, 255))):
        check = Image.new("RGBA", cutout.size, color)
        check.alpha_composite(cutout)
        checks.append(check.convert("RGB"))
    edges = Image.new("RGB", (cutout.width * 2, cutout.height))
    edges.paste(checks[0], (0, 0))
    edges.paste(checks[1], (cutout.width, 0))
    edges.save(DEBUG / "wedding-dress_edges.png")

    px = x0 - CANVAS_OFFSET[0]
    py = y0 - CANVAS_OFFSET[1]

    for stale in ("wedding-dress_light.png", "wedding-dress_dark.png",
                  "wedding-dress_preview.png"):
        (DEBUG / stale).unlink(missing_ok=True)

    print(
        f"wedding-dress: bbox x {x0}-{x1 - 1} y {y0}-{y1 - 1}; "
        f"manifest x={px} y={py} w={x1 - x0} h={y1 - y0}"
    )


if __name__ == "__main__":
    main()
