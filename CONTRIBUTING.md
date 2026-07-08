# Adding new outfits / hair

This is the accumulated, hard-won process for cutting a new wardrobe item
(top, skirt, jacket, hair, shoes, accessory...) out of a reference image and
wiring it into anime mode. It exists so a fresh session — human or Claude —
doesn't have to rediscover the same failure modes by trial and error.

If you only read one section, read **"Tricky cases"** — that's where almost
all the actual time goes.

## Setup

The Python pipeline (`tools/segment.py`) runs from `.venv` (gitignored, not
committed). If it's missing — a fresh clone, or it got deleted — recreate it:

```
python3 -m venv .venv
.venv/bin/pip install torch transformers pillow numpy scipy
```

First run downloads two model checkpoints from Hugging Face
(`facebook/sam-vit-base` + `hustvl/vitmatte-small-composition-1k`, a few
hundred MB total) — needs network the first time, then they're cached.

Run the whole pipeline, or just specific items by name:

```
.venv/bin/python tools/segment.py                      # every item in CONFIG
.venv/bin/python tools/segment.py turquoise-top turquoise-skirt   # just these
```

Preview the game with `python3 tools/dev_server.py 8437` (or the
`Claude_Preview` tool's `dress-up` config in `.claude/launch.json`) — this
dev server sends no-cache headers and handles the manifest-save endpoint
used by edit mode.

## Does the reference image match the shared pose canvas?

Every item's `{x, y, w, h}` in `assets/png/manifest.json` is a position on
one shared canvas (currently 677×1411 — see `manifest.json`'s `canvas` key).
Everything lines up on the doll *only* because every reference image was
generated in the same standing pose at the same canvas size as
`assets/png/base-doll.png`.

Check with:
```python
from PIL import Image
Image.open("your-new-reference.png").size
```

**If it matches** the canvas size in `manifest.json`: use it directly as a
new `CONFIG` group's `"src"`.

**If it doesn't match** (different generation size/crop): you need to
pre-align it before cutting anything from it. See "Cross-canvas alignment"
below — don't skip this, items cut from an unaligned image will be
positioned wrong on the doll in a way that isn't fixable by nudging later.

## Step-by-step: cutting a new item

1. **Pick coordinates using the grid-overlay technique.** This is the
   single most important habit — guessing coordinates from looking at the
   full image wastes many iterations. For the region you're about to cut:
   ```python
   from PIL import Image, ImageDraw
   img = Image.open("reference.png").convert("RGB")
   x0, y0, x1, y1 = 300, 200, 700, 900        # a generous crop around the item
   crop = img.crop((x0, y0, x1, y1))
   d = ImageDraw.Draw(crop)
   step = 50
   for gx in range(0, crop.width, step):
       d.line([(gx, 0), (gx, crop.height)], fill=(255, 0, 255), width=1)
       d.text((gx + 2, 2), str(x0 + gx), fill=(255, 0, 255))   # ABSOLUTE coord
   for gy in range(0, crop.height, step):
       d.line([(0, gy), (crop.width, gy)], fill=(255, 0, 255), width=1)
       d.text((2, gy + 2), str(y0 + gy), fill=(255, 0, 255))   # ABSOLUTE coord
   crop.save("/tmp/grid_check.png")
   ```
   View the saved image and read off coordinates directly — the axis labels
   are already in the full image's coordinate space (not crop-local), which
   is exactly what `CONFIG` needs. **This is the #1 source of bad cuts**:
   mixing up crop-local vs. absolute coordinates, or eyeballing without a
   grid at all.

2. **Add a `CONFIG` entry** in `tools/segment.py` (or add items to an
   existing group if reusing a `"src"` already there):
   ```python
   {
       "src": "your-reference.png",
       "items": {
           "new-item-name": {
               "points": [(x1, y1), (x2, y2), ...],   # 4-8 points spread across the garment
               "neg": [(x, y), ...],                   # optional: keep SAM off skin/background/other garments
           },
       },
   },
   ```

3. **Run it**: `.venv/bin/python tools/segment.py new-item-name`

4. **Read the terminal line.** It reports SAM confidence, islands/holes
   cleaned, soft-edge %, and the bbox — e.g.:
   ```
   new-item-name: sam=0.912 | islands removed=2 (340px) | holes filled=1 (85px) | soft-edge px=1203 (8.1% of alpha) | bbox x 240-410 y 300-620
   ```
   A bbox that's implausibly large for what should be a small/localized
   garment is the first sign SAM picked the wrong candidate mask (see
   "SAM balloons" below).

5. **Check the debug images** in `assets/png/debug/`:
   - `<name>_mask.png` — the source image tinted red where SAM's mask is,
     with your prompt points drawn as green dots. Confirms points landed
     where you meant and the mask covers what you expect.
   - `<name>_edges.png` — zoomed crops along the boundary, binary mask vs.
     matted alpha side by side. Confirms ViTMatte's edge is following the
     real garment edge, not fraying or eating into it.

6. **Always also look at `assets/png/<name>.png` directly, composited over
   a solid color** — don't trust the debug images alone, a hole in a dark
   garment is invisible under the red mask tint:
   ```python
   from PIL import Image
   img = Image.open(f"assets/png/{name}.png").convert("RGBA")
   bg = Image.new("RGBA", img.size, (255, 0, 255, 255))
   bg.alpha_composite(img)
   bg.convert("RGB").save(f"assets/png/debug/check-{name}.png")
   ```

7. **Iterate** on points/`neg` until it's clean — see "Tricky cases" below
   for the specific failure patterns and their fixes.

8. **Wire it into the game** — add an entry to the right category in
   `WARDROBE` in `png-app.js`:
   ```js
   { id: "new-item-name", name: "Display Name" },
   ```
   `id` must match the manifest key / png filename exactly. Category ids
   are `hair`, `top`, `dress`, `skirt`, `jacket`, `socks`, `shoes`,
   `accessory`.

9. **Test it live** — see "Verifying before you call it done" below.

## Tricky cases (read this before you spend an hour guessing)

**SAM balloons to a "whole subject" mask instead of the garment.**
Scattered or too-sparse points can cause SAM to jump to a much bigger
candidate (whole torso, whole body, whole background silhouette) instead of
the intended region. Fix: tighter point clusters actually on the garment,
plus negative points on adjacent regions it shouldn't include. If it keeps
happening no matter what points you try (seen with hair against a
low-contrast/vignette background), stop trying to segment it directly — see
"Hair-via-subtraction" below.

**A garment is two disconnected pieces** (e.g. a jacket's two sleeves don't
touch each other in the pose). Segment each piece as its own small item,
then `"union"` the helper into the main item:
```python
"jacket-sleeve": {"points": [...], "neg": [...]},
"jacket": {"points": [...], "neg": [...], "union": ["jacket-sleeve"]},
```
Union happens on the pre-matte binary mask (real fabric belongs in the
erosion/trimap computation). **Never** add the helper's points directly into
the main item's own point list instead of using `union` — that has
repeatedly destabilized SAM into picking a totally different, larger
candidate mask.

**One garment overlaps another that's cut separately** (e.g. a top peeking
out under an open jacket, or SAM insists on bundling a sleeve into a torso
mask no matter how many negatives you add). Use `"subtract"`:
```python
"top": {"points": [...], "neg": [...], "subtract": ["jacket-sleeve"]},
```
Subtract happens on the **final alpha**, not the pre-matte binary mask —
punching the hole before ViTMatte runs feeds it a fake synthetic edge to
matte, producing a translucent haze instead of a clean cut.

**A `union`/`subtract` helper needs its own real points + negatives.** Three
bare points with no negatives let SAM wander to a totally different,
larger, low-confidence (~0.75) candidate that can bleed into unrelated
regions once unioned/subtracted. Always check the helper's own printed bbox
— if it looks implausibly large for what should be a small patch, add
negatives before trusting it.

**Thin details (straps, harnesses, chokers <5px wide) vanish.** They're
below SAM's effective resolution and ViTMatte matting can zero them even if
SAM's own mask includes them. Cut a dedicated helper region that's thick
enough to survive the trimap erosion (e.g. widen the point cluster to grab
a broader band), then `union` it into the main item.

**Stray floating alpha fragments** (e.g. a wisp of hair bridged into a
cutout pre-matte, then severed into a disconnected fleck post-matte) are
handled automatically — `clean_alpha_specks()` drops any disconnected alpha
component with no prompt point in it, same rule `clean_mask()` applies to
the binary mask. Just check the `NOTE ... dropped N stray alpha speck(s)`
line — if the pixel count is suspiciously large, something real might have
been dropped; view `check-<name>.png` to confirm.

**Fake-transparency checkerboards baked into the RGB background.** Some
reference images have a checkerboard pattern painted into the actual pixel
data (not real alpha) to *represent* transparency. SAM handles this fine in
general, but a prompt point landing on the checkerboard can grab a huge
background blob — double-check trailing/edge points against the grid
overlay near these images.

**Splitting a two-foot item (`"split_lr": True`) into independent
left/right pieces.** `split_left_right()` erodes the combined silhouette
until it separates into two solid "cores," then grows each core back out by
nearest-seed assignment (a distance-transform Voronoi split) — this follows
the real curved boundary between overlapping feet, unlike a straight
geometric cut. If erosion can't find 2 cores before eroding away entirely,
it deliberately falls back to ONE unsplit piece rather than fabricate a bad
cut — check the terminal WARNING/NOTE after any split attempt.
**`mary-janes` is confirmed permanently unsplittable** — the back shoe's toe
is genuinely fully hidden behind the front shoe with no visible seam in the
source art, so no point/negative combination gives SAM a clean single-shoe
boundary. This is a hard limit of that specific reference image, not a
tuning problem — don't retry it.

**Cross-canvas alignment** (reference image generated at a different
size/crop than the shared pose canvas): get a whole-body SAM mask + bbox in
both images, compute `scale = target_bbox_height / source_bbox_height`,
compute a translate that matches top-y and horizontal-center, then
flatten the source onto its own background, resize by `scale`, and paste
onto a blank target-sized canvas at the translated offset. Save this as a
new file (e.g. `foo-aligned.png`) and use *that* as the `CONFIG` `"src"` —
keep the original raw reference too, with a comment on how to re-derive the
aligned copy if it's ever lost.
**Caveat, learned the hard way**: matching on the *whole-body* bbox aligns
torso/limbs well, but can leave a residual head-position error, since
head-to-body proportions rarely match the doll's exactly (a real case: hair
ended up sitting ~45-70px too low, exposing the doll's bald crown). After
aligning, proactively composite just the hair cutout onto `base-doll.png`
alone (no other layers) and eyeball the crown — clothing drapes forgivingly
over a few px of misalignment, hair against a bald dome does not. If it's
off, it's usually cheaper to hand-tune that one item's `x`/`y` in
`manifest.json` than to re-derive the whole-image alignment.

**Hair that SAM refuses to isolate directly** (every point/negative
configuration balloons to a "whole body" mask — seen with a low-contrast
vignette background). Work around it instead of fighting SAM further:
compute `remainder = whole-body-mask & ~dilate(garment-masks) & ~dilate(face-mask)`,
then filter `remainder`'s connected components by position/size heuristics
(y-centroid, size thresholds), plus one small targeted SAM call for any
strand/twintail the heuristic misses. This has to be done as a one-off
script (not through `CONFIG`/`main()`) — note that in a comment near the
item, since re-deriving it means re-running the manual pipeline, not
`segment.py <item-name>`.

**Skin-tone patches leaking into a hair (or similar) mask.** `fill_holes()`
can mistake real visible-skin gaps *between* hair locks for accidental holes
and patch them with hair. Repeated targeted SAM re-tries for each patch tend
to miss fragments (ragged mask edges). Far more robust: compute a direct RGB
threshold skin mask —
```python
skin = (r > 190) & (r.astype(int) - b > 12) & (r.astype(int) - g > 5) & (g > 150)
```
restricted to inside the hair mask, dilate ~2px, and subtract it from the
final alpha in one pass.

**Pose mismatches that no nudge can fix.** If the reference character's pose
doesn't match the doll's fixed pose in a *non-rigid* way (e.g. reference has
crossed legs, doll has straight parallel legs), a single `x`/`y` adjust
can't fix it — the correction needed changes continuously along the limb
(near-zero at the hip, large at the ankle), which is a shear, not a
translation. A rigid shift will just trade which part is misaligned for
another, or disconnect the item from the body entirely. Concrete example:
`turquoise-garter` + `turquoise-boots` were cut from a crossed-leg reference
and leave a bare-skin gap on one leg when worn together — verified this is
a real pose mismatch (thigh-height content lines up with the doll almost
exactly; ankle-height content is ~100px off) before concluding a positional
fix isn't possible. Real options, in order of effort: leave it (usually
mostly hidden under a skirt), re-cut tighter to just the front/visible leg
and accept the back leg showing bare, or regenerate reference art in the
doll's actual pose and re-cut from that.

## Manifest reference

`assets/png/manifest.json` (mirrored verbatim into `manifest.js` as
`window.DOLL_MANIFEST = {...}` since `fetch()` of local JSON is blocked over
`file://`):

- `"canvas": {"width": ..., "height": ...}` — the shared canvas size every
  position below is relative to.
- Flat item: `"item-name": {"x": .., "y": .., "w": .., "h": ..}`.
- Split item (`split_lr`): `"item-name": {"parts": {"left": {...}, "right": {...}}}`,
  with actual files `item-name-left.png` / `item-name-right.png`, plus a
  combined `item-name.png` kept only for the wardrobe thumbnail (never
  referenced by the manifest itself).
- Either shape can carry an `"adjust": {"dx": 0, "dy": 0, "rot": 0, "scale": 1}` —
  written by anime mode's edit mode (🔧 in the header; drag/nudge/rotate/scale
  buttons, 💾 saves to disk via the dev server's `/save-manifest` endpoint, or
  falls back to downloading `manifest.js`). `segment.py` preserves an
  existing `adjust` when an item is re-cut.

## Verifying before you call it done

1. `assets/png/debug/check-<name>.png` (composited over magenta) — no holes,
   no bleed from an adjacent garment.
2. Terminal bbox is plausible for what the item actually is.
3. Load it in the running app (`preview_start` the `dress-up` config, or
   `python3 tools/dev_server.py 8437`) and actually select it — set
   `localStorage.setItem('dressup-png-outfit-v1', JSON.stringify({...}))`
   then reload if you want to jump straight to a specific combo instead of
   clicking through the UI.
4. Check it standing alone on the bald doll (all other categories `"none"`)
   — this is what catches misalignment against `base-doll.png` (e.g. a bald
   patch showing through hair) that's easy to miss once other layers are
   covering the gap.
5. Check it combined with whatever it's realistically worn with (e.g. boots
   + the accessory that covers the same legs) — some problems only show up
   in combination.
6. Check edit mode (🔧) selects it with a sensible outline and nudges it as
   expected.
7. Clean up scratch/debug files you made outside the standard
   `assets/png/debug/*_mask.png` / `*_edges.png` pattern (grid overlays,
   one-off check composites, etc.) once the item is confirmed working —
   don't leave them lying around in `assets/png/debug/`.

## Deploying

The site is static — after committing changes, bump the cache-busting
version before pushing so the iOS home-screen app (which stays suspended
between opens instead of re-fetching) picks up the change:
```
python3 tools/bump_version.py
git add -A && git commit -m "..." && git push
```
GitHub Pages serves straight from `main` — no build step, no CI.
