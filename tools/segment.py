"""Cut garments out of reference images with high-quality edges.

Pipeline (per item):
  1. SAM (facebook/sam-vit-base) with point prompts -> best mask. (HQ-SAM
     was tried for sharper boundaries but its transformers port returns
     masks that ignore the prompt points entirely — see load_sam() — so
     don't retry it; edge quality comes from the ViTMatte pass below, not
     the SAM mask itself.)
  2. Mask cleanup:
     - drop "island" components that contain none of the prompt points
     - fill interior holes smaller than HOLE_MAX_FRACTION of the mask
       (real openings like arm/body gaps are big, accidental speckle isn't)
  3. Anti-aliased alpha: build a trimap (erode -> sure-FG, dilate -> unknown
     band) and run ViTMatte (hustvl/vitmatte-small-composition-1k), which
     predicts a soft alpha matte following the actual image edges.
  4. QC: per-item stats + zoomed edge-comparison debug images.

Usage: list reference images + garments in CONFIG below, then run:
    <venv>/bin/python tools/segment.py [only-these-item-names...]
Outputs cutouts to assets/png/, debug to assets/png/debug/, and updates
assets/png/manifest.json + manifest.js.

Items with "split_lr": True (socks/shoes) are cut as ONE mask, then split
into two connected components (left/right foot on screen) so each foot can
be nudged independently in edit mode, even though players still pick one
wardrobe entry that puts both on at once. Saved as <name>-left.png /
<name>-right.png, with manifest[name] = {"parts": {"left": {...}, "right": {...}}}
instead of the flat {x,y,w,h} box used by single-piece garments.
"""
import json
import os
import sys

import numpy as np
import torch
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "png")
DEBUG_OUT = os.path.join(OUT, "debug")

ERODE_PX = 5        # trimap sure-foreground shrink
DILATE_PX = 7       # trimap unknown-band growth
HOLE_MAX_FRACTION = 0.02  # holes smaller than this fraction of mask area get filled

# Every CONFIG "src" reference image is 1086x1448, but that canvas has huge
# empty margins (even the widest outfit, the lolita dress, only ever uses
# x177-853 / y23-1433) — fitting that whole canvas on a narrow phone screen
# left the doll tiny. The shared canvas the manifest/game actually use is
# CROPPED to this window: every item's recorded x/y is translated by
# -CANVAS_OFFSET, and base-doll.png's own output is cropped to CANVAS_SIZE.
# This crop is baked in here (not just done once by hand) so it can never be
# silently undone by re-running an existing item or regenerating base-doll —
# both would otherwise reset the canvas back to the full, uncropped 1086x1448
# and misplace whatever was just re-cut.
CANVAS_OFFSET = (177, 23)
CANVAS_SIZE = (677, 1411)
MATTE_MARGIN = 64   # context around the garment for ViTMatte

CONFIG = [
    {
        "src": "381ad53f-4cc3-48d8-a619-c2b1c9a1ca0c.png",  # school uniform
        "items": {
            "uniform-top": {"points": [(489, 489), (601, 407), (560, 509), (657, 438), (500, 350)]},
            "uniform-skirt": {"points": [(509, 631), (570, 713), (631, 652), (458, 692), (600, 720)]},
            "blonde-hair": {"points": [(530, 80), (505, 40), (620, 230), (450, 190), (560, 120), (480, 250)]},
            "leg-warmers": {"points": [(430, 1190), (445, 1240), (545, 1200), (555, 1250)], "split_lr": True},
            "loafers": {"points": [(420, 1330), (440, 1360), (525, 1330), (545, 1350)], "split_lr": True},
        },
    },
    {
        "src": "539ca2ab-a64e-4080-9c19-98adb4cd22a6.png",  # gothic lolita
        "items": {
            "lolita-dress": {"points": [(505, 460), (455, 710), (310, 760), (700, 790), (545, 900),
                                        (365, 420), (700, 570), (530, 320), (545, 550)],
                             "neg": [(533, 262), (540, 235), (543, 252), (505, 255), (578, 255), (660, 435), (425, 180), (455, 255), (432, 232)]},
            "frilly-socks": {"points": [(435, 1215), (560, 1220), (450, 1260), (565, 1265)],
                             "neg": [(445, 1145), (560, 1150), (460, 1345), (560, 1350)], "split_lr": True},
            "mary-janes": {"points": [(455, 1355), (565, 1355), (435, 1395), (580, 1395)], "split_lr": True},
            "red-buns": {"points": [(380, 105), (650, 100), (505, 80), (485, 190), (585, 190), (520, 35)]},
        },
    },
    {
        "src": "cb22790e-55c3-4ad0-bee4-37d0aba37e9c.png",  # punk outfit
        "items": {
            "punk-top": {"points": [(520, 445), (550, 480), (505, 420)]},
            "punk-jacket": {"points": [(355, 425), (705, 505), (445, 455), (645, 435), (660, 340),
                                       (395, 550), (620, 565), (765, 690)],
                            "neg": [(520, 470), (535, 430), (520, 530), (500, 690), (450, 250), (555, 250), (545, 230), (590, 235), (600, 255)],
                            "subtract": ["punk-top"]},
            "punk-skirt": {"points": [(455, 655), (585, 645), (505, 730), (435, 700), (600, 850), (605, 900)],
                           "neg": [(555, 860), (650, 700)]},
            "punk-buns": {"points": [(435, 105), (660, 115), (545, 75), (505, 200), (600, 200),
                                     (670, 155), (685, 235), (515, 35)]},
        },
    },
    {
        "src": "purple-stars.png",  # goth-punk star jacket outfit
        "items": {
            # small helper: SAM missed a shadowed fold in the sleeve, leaving
            # a bay-shaped gap open to the exterior background. Adding points
            # there to the main jacket call destabilized SAM's mask choice
            # entirely (it picked a much bigger "whole subject" candidate
            # instead) — so patch it as an independent small mask unioned in
            # afterwards, never fed to the jacket's own SAM call.
            "star-jacket-sleeve-patch": {"points": [(349, 414), (329, 419), (369, 404)]},
            "star-jacket": {"points": [(340, 350), (300, 450), (650, 410), (755, 460), (690, 550),
                                        (680, 650), (700, 330), (592, 370), (600, 420), (300, 500)],
                            "neg": [(460, 410), (460, 460), (460, 500), (500, 320), (460, 650), (750, 250)],
                            "union": ["star-jacket-sleeve-patch"]},
            "star-skirt": {"points": [(430, 600), (550, 600), (470, 650), (350, 700), (580, 710),
                                       (480, 740), (455, 548)],
                           "neg": [(460, 480), (460, 850), (600, 850), (300, 600), (650, 600)]},
            "thigh-strap": {"points": [(520, 825), (600, 820), (565, 840), (568, 868), (620, 900),
                                        (642, 950), (635, 975)],
                            "neg": [(500, 900), (480, 780), (420, 900), (680, 850)]},
        },
    },
    {
        "src": "goth-top.png",  # same character/pose, jacket off, top fully visible
        "items": {
            "goth-top": {"points": [(480, 330), (480, 400), (480, 470), (420, 390), (545, 390), (480, 510)],
                         "neg": [(390, 320), (610, 320), (500, 290), (480, 545), (650, 350), (350, 420)]},
            "goth-hair": {"points": [(480, 170), (400, 150), (645, 110), (480, 50), (650, 230),
                                      (685, 320), (660, 400)],
                          "neg": [(430, 250), (600, 260), (600, 330), (500, 300)]},
        },
    },
    {
        "src": "black-goth.png",  # black gothic outfit (checkerboard "transparent" bg baked into RGB)
        "items": {
            # the "jacket" is two disconnected pieces: a full sleeve on the
            # raised arm and a buckled detached sleeve on the hanging arm —
            # segment the raised-arm sleeve independently and union it in
            # (same pattern as star-jacket-sleeve-patch).
            "goth-jacket-arm": {"points": [(330, 340), (310, 400), (340, 450), (370, 280)],
                                "neg": [(415, 235), (480, 400), (430, 200), (450, 330)]},
            "goth-jacket": {"points": [(655, 440), (640, 540), (670, 600), (700, 660), (720, 700)],
                            "neg": [(630, 380), (760, 760), (560, 650), (560, 480)],
                            "union": ["goth-jacket-arm"]},
            # corset top + studded choker. The ~5px harness straps crossing
            # the chest are below SAM's resolution (positive points on them
            # don't bring them into any candidate mask) and ViTMatte zeroes
            # them anyway — dropped. The choker is segmented as a helper band
            # (thick enough to survive the trimap erosion once unioned) since
            # the main call loses it in matting. SAM also insists on bundling
            # the raised arm's sleeve into this mask no matter how many
            # negatives sit on it — so let it, and punch the independently-
            # segmented sleeve back out of the final alpha.
            "black-top-choker": {"points": [(520, 270), (540, 265), (560, 275), (505, 285), (555, 290), (505, 330)],
                                 "neg": [(520, 240), (560, 245), (480, 250), (540, 310), (460, 300), (450, 320),
                                         (610, 300), (500, 225), (500, 250), (475, 260), (490, 240)]},
            "black-top": {"points": [(480, 400), (540, 430), (460, 450), (520, 470), (500, 380), (560, 400)],
                          "neg": [(450, 340), (555, 335), (490, 530), (470, 560), (350, 400), (640, 460),
                                  (500, 220), (620, 320), (500, 250), (490, 240)],
                          "union": ["black-top-choker"],
                          "subtract": ["goth-jacket-arm"]},
            "goth-skirt": {"points": [(430, 545), (400, 620), (540, 640), (320, 680), (450, 720),
                                      (290, 820), (280, 950), (300, 1050), (640, 850),
                                      (340, 880), (330, 960), (660, 920), (615, 940), (625, 990)],
                           "neg": [(450, 900), (520, 1000), (500, 830), (480, 500), (700, 660),
                                   (450, 1250), (590, 1250), (140, 900), (100, 1000), (180, 1100)]},
            "goth-boots": {"points": [(450, 1250), (445, 1330), (460, 1390), (455, 1165),
                                      (590, 1250), (580, 1320), (600, 1390), (585, 1170)],
                           "neg": [(450, 1120), (570, 1120)], "split_lr": True},
        },
    },
    {
        # turquoise-goth-lolita.png (1024x1536) was generated at a different
        # canvas size/pose than the shared 1086x1448 pose canvas every other
        # outfit uses. "turquoise-aligned.png" is a one-time pre-processed
        # copy: uniformly scaled + translated (matched on head-to-feet span
        # and horizontal center, via a SAM whole-body mask) so it lines up
        # with base-doll.png like every other source image. Re-derive it from
        # turquoise-goth-lolita.png if it's ever lost — see project memory.
        "src": "turquoise-aligned.png",
        "items": {
            "turquoise-top": {"points": [(500, 420), (560, 430), (520, 460), (480, 400), (500, 320), (540, 310), (560, 330)],
                              "neg": [(500, 270), (650, 330), (420, 380), (450, 340), (650, 410), (500, 560)]},
            # the "jacket" here is the two puffy sleeves: one on the raised
            # arm (disconnected, mostly separate from the torso), one on the
            # hanging arm. Same union pattern as goth-jacket/goth-jacket-arm.
            "turquoise-jacket-arm": {"points": [(450, 340), (470, 380), (430, 400), (445, 460), (455, 490)],
                                     "neg": [(350, 300), (500, 270), (500, 420), (250, 300)]},
            "turquoise-jacket": {"points": [(640, 460), (650, 530), (645, 600), (650, 670), (600, 690), (700, 690)],
                                 "neg": [(620, 390), (740, 450), (580, 380), (560, 420), (500, 320)],
                                 "union": ["turquoise-jacket-arm"]},
            "turquoise-skirt": {"points": [(450, 620), (600, 620), (400, 700), (650, 700), (500, 750),
                                           (320, 850), (300, 900), (650, 850), (630, 950)],
                                "neg": [(460, 800), (560, 800), (500, 500), (150, 700), (900, 700),
                                        (500, 420), (560, 430), (480, 400), (500, 320), (450, 340), (650, 460)]},
            "turquoise-boots": {"points": [(480, 1250), (475, 1330), (490, 1390), (485, 1180),
                                           (620, 1250), (615, 1330), (630, 1390), (625, 1180)],
                                "neg": [(480, 1140), (620, 1140)], "split_lr": True},
            "turquoise-garter": {"points": [(480, 790), (560, 788), (520, 820), (470, 835), (555, 838), (525, 870), (528, 895)],
                                 "neg": [(450, 810), (610, 810), (500, 910), (410, 820), (650, 820), (500, 770)]},
        },
    },
    {
        "src": "base-doll.png",
        "items": {
            "base-doll": {
                "points": [(500, 180), (500, 450), (470, 900), (520, 1250), (390, 420), (690, 600), (430, 1380)],
                "full_canvas": True,  # keep whole canvas so it can be the base layer
            },
        },
    },
]

os.makedirs(OUT, exist_ok=True)
os.makedirs(DEBUG_OUT, exist_ok=True)


def load_sam():
    # NOTE: tried HQ-SAM (syscv-community/sam-hq-vit-base) here — the
    # transformers port (tested 4.57.6, July 2026) returns masks that don't
    # even contain the prompt points, so we stay on plain SAM. Edge quality
    # comes from the ViTMatte pass, not the SAM mask.
    from transformers import SamModel, SamProcessor
    return (SamModel.from_pretrained("facebook/sam-vit-base"),
            SamProcessor.from_pretrained("facebook/sam-vit-base"), "sam-vit-base")


def best_sam_mask(sam, sam_proc, image, points, neg_points=()):
    all_pts = [list(p) for p in points] + [list(p) for p in neg_points]
    labels = [1] * len(points) + [0] * len(neg_points)
    inputs = sam_proc(image, input_points=[all_pts],
                      input_labels=[labels], return_tensors="pt")
    with torch.no_grad():
        outputs = sam(**inputs)
    masks = sam_proc.image_processor.post_process_masks(
        outputs.pred_masks.cpu(), inputs["original_sizes"].cpu(),
        inputs["reshaped_input_sizes"].cpu())[0][0]
    scores = outputs.iou_scores[0, 0].cpu().numpy()
    best = int(scores.argmax())
    return masks[best].numpy().astype(bool), float(scores[best])


def clean_mask(mask, points):
    """Drop islands that contain no prompt point; fill small interior holes."""
    stats = {}

    labels, n = ndimage.label(mask)
    keep = {labels[y, x] for (x, y) in points if 0 <= y < mask.shape[0] and 0 <= x < mask.shape[1]}
    keep.discard(0)
    cleaned = np.isin(labels, list(keep))
    removed = int(n - len(keep))
    stats["islands_removed"] = removed
    stats["islands_px"] = int(mask.sum() - cleaned.sum())

    cleaned, stats["holes_filled"], stats["holes_px"] = fill_holes(cleaned, HOLE_MAX_FRACTION)
    return cleaned, stats


def clean_alpha_specks(alpha, points):
    """Drop disconnected components of the FINAL alpha that contain no prompt
    point (same rule clean_mask applies to the binary mask). Matting a mask
    whose edge grazes other elements (e.g. hair strands falling over a choker)
    can leave floating opaque fragments that were bridged to the mask pre-matte
    but disconnected by it. Anything real is either connected to the garment
    or has its own prompt point; the NOTE line reports how much was dropped so
    an over-eager removal shows up in the run output."""
    labels, n = ndimage.label(alpha > 0)
    keep = {labels[y, x] for (x, y) in points if 0 <= y < alpha.shape[0] and 0 <= x < alpha.shape[1]}
    keep.discard(0)
    drop = ~np.isin(labels, list(keep) + [0])
    dropped_px = int(drop.sum())
    alpha[drop] = 0
    return alpha, int(n - len(keep)), dropped_px


def fill_holes(binary, max_fraction):
    """Fill interior holes (background regions that don't touch the image
    border) up to max_fraction of the shape's own area. Returns
    (filled_binary, count_filled, pixels_filled)."""
    inv_labels, n_inv = ndimage.label(~binary)
    if n_inv == 0:
        return binary, 0, 0
    border = set(np.unique(np.concatenate([
        inv_labels[0, :], inv_labels[-1, :], inv_labels[:, 0], inv_labels[:, -1]])))
    hole_max = max_fraction * binary.sum()
    filled = binary.copy()
    sizes = ndimage.sum_labels(np.ones_like(inv_labels), inv_labels, index=np.arange(1, n_inv + 1))
    count = px = 0
    for lbl in range(1, n_inv + 1):
        if lbl in border:
            continue  # touches image edge -> genuine background
        if sizes[lbl - 1] <= hole_max:
            filled[inv_labels == lbl] = True
            count += 1
            px += int(sizes[lbl - 1])
    return filled, count, px


def matte_alpha(vitmatte, vm_proc, image, mask):
    """Anti-aliased alpha from ViTMatte on a crop around the garment."""
    fg = ndimage.binary_erosion(mask, iterations=ERODE_PX)
    unknown = ndimage.binary_dilation(mask, iterations=DILATE_PX)
    trimap = np.zeros(mask.shape, dtype=np.uint8)
    trimap[unknown] = 128
    trimap[fg] = 255

    ys, xs = np.where(unknown)
    H, W = mask.shape
    x0 = max(0, xs.min() - MATTE_MARGIN); x1 = min(W, xs.max() + MATTE_MARGIN)
    y0 = max(0, ys.min() - MATTE_MARGIN); y1 = min(H, ys.max() + MATTE_MARGIN)

    img_crop = image.crop((x0, y0, x1, y1))
    tri_crop = Image.fromarray(trimap[y0:y1, x0:x1], mode="L")
    inputs = vm_proc(images=img_crop, trimaps=tri_crop, return_tensors="pt")
    with torch.no_grad():
        alphas = vitmatte(**inputs).alphas
    a = alphas[0, 0, : (y1 - y0), : (x1 - x0)].numpy()  # crop the /32 padding

    alpha = np.zeros(mask.shape, dtype=np.uint8)
    alpha[y0:y1, x0:x1] = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    alpha[~unknown] = 0          # hard-zero anything outside the trimap band
    alpha[fg] = 255              # sure-foreground is >=ERODE_PX inside the object,
                                  # nowhere near a real edge — if ViTMatte still
                                  # zeroed it (seen around high-contrast decorative
                                  # prints like stars), that's a matting artifact,
                                  # not a real hole, so force it back to opaque
    alpha[alpha < 5] = 0         # kill faint halo speckle
    return alpha


def edge_debug(image, binary_mask, alpha, name):
    """Zoomed side-by-side crops (binary vs matte) along the boundary."""
    edge = binary_mask ^ ndimage.binary_erosion(binary_mask, iterations=1)
    ys, xs = np.where(edge)
    if len(ys) == 0:
        return
    rgb = np.array(image.convert("RGB"))
    idx = [len(ys) // 6, len(ys) // 2, (5 * len(ys)) // 6]
    panels = []
    for i in idx:
        cy, cx = ys[i], xs[i]
        y0 = np.clip(cy - 60, 0, rgb.shape[0] - 120); x0 = np.clip(cx - 60, 0, rgb.shape[1] - 120)
        window = (slice(y0, y0 + 120), slice(x0, x0 + 120))
        for m in (binary_mask[window] * 255, alpha[window]):
            over = rgb[window].astype(np.float64)
            a = (m / 255.0)[..., None]
            comp = over * a + np.array([255.0, 255.0, 255.0]) * (1 - a)  # over white
            panels.append(np.kron(comp.astype(np.uint8), np.ones((4, 4, 1), dtype=np.uint8)))
    row_h = panels[0].shape[0]
    grid = np.full((row_h * 3 + 20, panels[0].shape[1] * 2 + 10, 3), 200, dtype=np.uint8)
    for i in range(3):
        grid[i * (row_h + 10): i * (row_h + 10) + row_h, : panels[0].shape[1]] = panels[2 * i]
        grid[i * (row_h + 10): i * (row_h + 10) + row_h, panels[0].shape[1] + 10:] = panels[2 * i + 1]
    Image.fromarray(grid).save(f"{DEBUG_OUT}/{name}_edges.png")


def split_left_right(alpha, name):
    """Split a two-foot alpha mask into left/right pieces (by screen x, not
    anatomical side), following the natural boundary between them even when
    they touch or overlap (e.g. a front shoe's toe crossing over the back
    one) — a straight geometric cut bleeds into the wrong shoe there.

    Method: erode the combined silhouette until it separates into two solid
    "cores" (one per foot), then grow each core back out to the original
    silhouette by nearest-seed assignment (a distance-transform Voronoi
    split). The resulting boundary curves along whichever foot each pixel
    is actually closer to, instead of a straight line.
    """
    fg = alpha > 8
    total = fg.sum()
    min_seed_size = max(30, int(0.03 * total))

    for it in range(1, 60):
        eroded = ndimage.binary_erosion(fg, iterations=it)
        labels, n = ndimage.label(eroded)
        if n == 0:
            break
        sizes = ndimage.sum_labels(np.ones_like(labels), labels, index=np.arange(1, n + 1))
        significant = [i + 1 for i, s in enumerate(sizes) if s >= min_seed_size]
        if len(significant) >= 2:
            significant = sorted(significant, key=lambda lbl: -sizes[lbl - 1])[:2]
            break
    else:
        print(f"  WARNING {name}: erosion never separated into 2 cores — keeping as one piece")
        return None
    if n == 0 or len(significant) < 2:
        print(f"  WARNING {name}: eroded away before separating into 2 cores — keeping as one piece")
        return None

    centroids = ndimage.center_of_mass(np.ones_like(labels), labels, index=significant)
    order = sorted(range(2), key=lambda i: centroids[i][1])  # left-to-right by x
    seed = np.zeros(labels.shape, dtype=np.int32)
    for new_lbl, i in enumerate(order, start=1):
        seed[labels == significant[i]] = new_lbl

    _, (iy, ix) = ndimage.distance_transform_edt(seed == 0, return_indices=True)
    nearest = seed[iy, ix]
    left = np.where(fg & (nearest == 1), alpha, 0)
    right = np.where(fg & (nearest == 2), alpha, 0)

    a_size, b_size = int((left > 0).sum()), int((right > 0).sum())
    if min(a_size, b_size) < 0.15 * max(a_size, b_size):
        print(f"  NOTE {name}: split uneven ({a_size}px vs {b_size}px) — check debug image")
    print(f"  NOTE {name}: split via erosion+nearest-seed (radius {it}px)")
    return [left, right]


def point_debug(image, mask, points, name):
    tint = np.array(image.convert("RGB"), dtype=np.float64)
    tint[mask] = tint[mask] * 0.4 + np.array([255, 0, 0]) * 0.6
    dbg = Image.fromarray(tint.astype(np.uint8))
    d = ImageDraw.Draw(dbg)
    for (x, y) in points:
        d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=(0, 255, 0), outline=(0, 0, 0))
    dbg.resize((dbg.width // 2, dbg.height // 2)).save(f"{DEBUG_OUT}/{name}_mask.png")


def main():
    only = set(sys.argv[1:])
    sam, sam_proc, sam_name = load_sam()
    from transformers import VitMatteForImageMatting, VitMatteImageProcessor
    vitmatte = VitMatteForImageMatting.from_pretrained("hustvl/vitmatte-small-composition-1k")
    vm_proc = VitMatteImageProcessor.from_pretrained("hustvl/vitmatte-small-composition-1k")
    print(f"models: {sam_name} + vitmatte-small")

    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    # fixed constant, NOT derived from whatever source image happens to be
    # loaded below — every "src" is the same native 1086x1448 reference
    # canvas; CANVAS_SIZE is that canvas cropped to its used content bounds
    manifest["canvas"] = {"width": CANVAS_SIZE[0], "height": CANVAS_SIZE[1]}

    for group in CONFIG:
        wanted = {n: s for n, s in group["items"].items() if not only or n in only}
        if not wanted:
            continue
        image = Image.open(os.path.join(ROOT, group["src"])).convert("RGB")

        mask_cache = {}

        def cleaned_mask_of(item_name):
            if item_name not in mask_cache:
                s = group["items"][item_name]
                m, sc = best_sam_mask(sam, sam_proc, image, s["points"], s.get("neg", ()))
                m, st = clean_mask(m, s["points"])
                mask_cache[item_name] = (m, sc, st)
            return mask_cache[item_name]

        def save_crop(a, out_name, old_adjust):
            pys, pxs = np.where(a > 8)
            px0, px1, py0, py1 = int(pxs.min()), int(pxs.max()), int(pys.min()), int(pys.max())
            rgba = np.array(image.convert("RGBA"))
            rgba[..., 3] = a
            Image.fromarray(rgba).crop((px0, py0, px1 + 1, py1 + 1)).save(f"{OUT}/{out_name}.png")
            entry = {
                "x": px0 - CANVAS_OFFSET[0], "y": py0 - CANVAS_OFFSET[1],
                "w": px1 - px0 + 1, "h": py1 - py0 + 1,
            }
            if old_adjust:
                entry["adjust"] = old_adjust
            return entry

        for name, spec in wanted.items():
            mask, score, stats = cleaned_mask_of(name)
            # merge in small independently-segmented patches (e.g. a fold
            # SAM missed) — done on the binary mask, before matting, since
            # this fabric genuinely belongs in the trimap/erosion computation
            for other in spec.get("union", []):
                mask = mask | cleaned_mask_of(other)[0]
            alpha = matte_alpha(vitmatte, vm_proc, image, mask)

            # deterministically carve out garments that were cut separately
            # (e.g. the crop top peeking through an open jacket). Done on the
            # final alpha, not the pre-matte binary mask — punching the hole
            # before ViTMatte runs feeds it a fake, non-photographic edge to
            # matte, which produced a translucent haze instead of a clean cut.
            for other in spec.get("subtract", []):
                other_mask = cleaned_mask_of(other)[0]
                alpha = np.where(ndimage.binary_dilation(other_mask, iterations=2), 0, alpha)

            all_points = list(spec["points"])
            for other in spec.get("union", []):
                all_points += group["items"][other]["points"]
            alpha, specks, speck_px = clean_alpha_specks(alpha, all_points)
            if specks:
                print(f"  NOTE {name}: dropped {specks} stray alpha speck(s), {speck_px}px")

            soft = int(((alpha > 0) & (alpha < 255)).sum())
            nonzero = int((alpha > 0).sum())
            ys, xs = np.where(alpha > 8)
            x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())

            split_result = split_left_right(alpha, name) if spec.get("split_lr") else None
            if split_result is not None:
                alpha_left, alpha_right = split_result
                old_parts = manifest.get(name, {}).get("parts", {})
                manifest[name] = {"parts": {
                    "left": save_crop(alpha_left, f"{name}-left", old_parts.get("left", {}).get("adjust")),
                    "right": save_crop(alpha_right, f"{name}-right", old_parts.get("right", {}).get("adjust")),
                }}
                save_crop(alpha, name, None)  # combined image, wardrobe thumbnail only — not in manifest

            elif spec.get("full_canvas"):
                rgba = np.array(image.convert("RGBA"))
                rgba[..., 3] = alpha
                ox, oy = CANVAS_OFFSET
                cw, ch = CANVAS_SIZE
                Image.fromarray(rgba).crop((ox, oy, ox + cw, oy + ch)).save(f"{OUT}/{name}.png")
            else:
                old_adjust = manifest.get(name, {}).get("adjust")
                manifest[name] = save_crop(alpha, name, old_adjust)

            point_debug(image, mask, spec["points"], name)
            edge_debug(image, mask, alpha, name)
            print(f"{name}: sam={score:.3f} | islands removed={stats['islands_removed']} "
                  f"({stats['islands_px']}px) | holes filled={stats['holes_filled']} "
                  f"({stats['holes_px']}px) | soft-edge px={soft} ({100.0 * soft / max(nonzero, 1):.1f}% of alpha) "
                  f"| bbox x {x0}-{x1} y {y0}-{y1}" + (" | split L/R" if split_result else ""))

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    # plain <script> version — fetch() of local JSON is blocked over file://
    with open(os.path.join(OUT, "manifest.js"), "w") as f:
        f.write(f"window.DOLL_MANIFEST = {json.dumps(manifest, indent=2)};\n")
    print("manifest updated")


if __name__ == "__main__":
    main()
