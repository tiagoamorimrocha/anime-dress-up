"""Ingest pre-cut garment layers (e.g. Photoshop "Layers to Files" exports)
into the game — no SAM/ViTMatte needed, the alpha is already clean.

This is the preferred path over tools/segment.py whenever the art comes as
one transparent PNG per garment: Photoshop's hand-cut masks have none of the
segmentation failure modes documented in CONTRIBUTING.md (ballooning masks,
vanishing thin straps, skin leaks, union/subtract juggling).

Requirements on the exports:
  - every layer PNG has the SAME pixel size as the source image it was cut
    from (Photoshop's File > Export > Layers to Files does this by default —
    do NOT enable "Trim Layers", that throws away the shared positioning)
  - the source canvas either matches the shared 1086x1448 pose canvas, or
    has a known alignment onto it (see ALIGNMENTS below)

Usage:
    <venv>/bin/python tools/ingest_layers.py --align chinese \\
        references/chinese_0000_top.png:chinese-top \\
        references/chinese_0001_skirt.png:chinese-skirt

Each positional arg is <layer-file>:<item-id>. The item id becomes the
manifest key and assets/png/<item-id>.png — list it in WARDROBE in
png-app.js if it's a new item. An existing manifest "adjust" is preserved,
same as segment.py re-runs.

To add a new alignment (a new PSD generated at a different size/pose):
derive scale + translate exactly like the cross-canvas alignment in
CONTRIBUTING.md — whole-body SAM bbox in both the new source and the
ROOT-level (uncropped 1086x1448) base-doll.png, then
scale = target_bbox_height / source_bbox_height, translate matching top-y
and horizontal center — and add the numbers to ALIGNMENTS.
"""
import argparse
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "png")

# Must match tools/segment.py — the shared pose canvas is the full 1086x1448
# reference canvas cropped to its used content bounds.
CANVAS_OFFSET = (177, 23)
CANVAS_SIZE = (677, 1411)
TARGET_SIZE = (1086, 1448)  # uncropped pose canvas the alignment maps onto

# Known source-canvas -> pose-canvas transforms (uniform scale, then paste
# at (dx, dy)). "identity" is for art already generated on the pose canvas.
ALIGNMENTS = {
    "identity": {"scale": 1.0, "dx": 0.0, "dy": 0.0},
    # chinese.png (1024x1536): derived 2026-07-08 from whole-body SAM bboxes
    # (target base-doll.png bbox y 103-1419, source bbox y 29-1509).
    "chinese": {"scale": 0.8891891891891892, "dx": 92.23378378378379, "dy": 77.2135135135135},
}


def ingest(layer_path, item_id, align, manifest):
    src = Image.open(os.path.join(ROOT, layer_path)).convert("RGBA")

    if align["scale"] != 1.0:
        new_size = (round(src.width * align["scale"]), round(src.height * align["scale"]))
        src = src.resize(new_size, Image.LANCZOS)
    canvas = Image.new("RGBA", TARGET_SIZE, (0, 0, 0, 0))
    canvas.paste(src, (round(align["dx"]), round(align["dy"])), src)

    bbox = canvas.split()[-1].getbbox()  # (x0, y0, x1, y1) of nonzero alpha
    if bbox is None:
        raise SystemExit(f"{layer_path}: layer is fully transparent")
    x0, y0, x1, y1 = bbox
    canvas.crop(bbox).save(f"{OUT}/{item_id}.png")

    old_adjust = manifest.get(item_id, {}).get("adjust")
    entry = {
        "x": x0 - CANVAS_OFFSET[0], "y": y0 - CANVAS_OFFSET[1],
        "w": x1 - x0, "h": y1 - y0,
    }
    if old_adjust:
        entry["adjust"] = old_adjust
    manifest[item_id] = entry
    print(f"{item_id}: {layer_path} -> assets/png/{item_id}.png | "
          f"x {entry['x']} y {entry['y']} w {entry['w']} h {entry['h']}"
          + (" | kept adjust" if old_adjust else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("layers", nargs="+", metavar="FILE:ITEM-ID",
                    help="layer PNG path (relative to repo root) and target item id")
    ap.add_argument("--align", default="identity", choices=sorted(ALIGNMENTS),
                    help="source-canvas alignment to apply (default: identity)")
    args = ap.parse_args()

    manifest_path = os.path.join(OUT, "manifest.json")
    with open(manifest_path) as f:
        manifest = json.load(f)
    manifest["canvas"] = {"width": CANVAS_SIZE[0], "height": CANVAS_SIZE[1]}

    for spec in args.layers:
        layer_path, _, item_id = spec.rpartition(":")
        if not layer_path or not item_id:
            raise SystemExit(f"bad arg {spec!r} — expected <layer-file>:<item-id>")
        ingest(layer_path, item_id, ALIGNMENTS[args.align], manifest)

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    # plain <script> version — fetch() of local JSON is blocked over file://
    with open(os.path.join(OUT, "manifest.js"), "w") as f:
        f.write(f"window.DOLL_MANIFEST = {json.dumps(manifest, indent=2)};\n")
    print("manifest updated")


if __name__ == "__main__":
    main()
