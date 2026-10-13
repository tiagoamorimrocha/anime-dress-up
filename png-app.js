/* ============================================================
   Dress Up! — PNG (anime) mode.
   The doll is base-doll.png; every item is a transparent cutout
   made by tools/segment.py from a reference generated in the SAME
   pose/canvas. Item positions come from assets/png/manifest.json,
   so adding an item = run the script, then list it in WARDROBE.
   ============================================================ */

const ASSET_DIR = "assets/png";

/* categories + items; item id must match a manifest entry / png name */
const WARDROBE = [
  {
    id: "hair", name: "Hair", emoji: "💇", none: true,
    items: [
      { id: "blonde-hair", name: "Blonde Bun" },
      { id: "red-buns", name: "Red Buns" },
      { id: "punk-buns", name: "Punk Buns" },
      { id: "goth-hair", name: "Goth Buns" },
      { id: "turquoise-hair", name: "Turquoise Twintails" },
      { id: "chinese-hair", name: "Long Black Hair" },
      { id: "gradient-hair", name: "Gradient Waves" },
      { id: "purple-hair", name: "Purple Bun" },
      { id: "orange-berry-pigtails", name: "Orange Berry Pigtails" },
    ],
  },
  {
    id: "top", name: "Tops", emoji: "👕", none: true,
    items: [
      { id: "uniform-top", name: "Uniform Top" },
      { id: "punk-top", name: "Punk Top" },
      { id: "goth-top", name: "Goth Top" },
      { id: "black-top", name: "Black Goth Top" },
      { id: "turquoise-top", name: "Turquoise Corset" },
      { id: "chinese-top", name: "Red Camisole" },
    ],
  },
  {
    id: "dress", name: "Dresses", emoji: "👗", none: true,
    items: [{ id: "lolita-dress", name: "Lolita Dress" }],
  },
  {
    id: "skirt", name: "Skirts", emoji: "🩳", none: true,
    items: [
      { id: "uniform-skirt", name: "Uniform Skirt" },
      { id: "punk-skirt", name: "Punk Skirt" },
      { id: "star-skirt", name: "Star Skirt" },
      { id: "goth-skirt", name: "Goth Skirt" },
      { id: "turquoise-skirt", name: "Turquoise Skirt" },
      { id: "chinese-skirt", name: "Denim Skirt" },
    ],
  },
  {
    id: "jacket", name: "Jackets", emoji: "🧥", none: true,
    items: [
      { id: "punk-jacket", name: "Punk Jacket" },
      { id: "star-jacket", name: "Star Jacket" },
      { id: "goth-jacket", name: "Goth Sleeves" },
      { id: "turquoise-jacket", name: "Turquoise Sleeves" },
    ],
  },
  {
    id: "socks", name: "Socks", emoji: "🧦", none: true,
    items: [
      { id: "leg-warmers", name: "Leg Warmers" },
      { id: "frilly-socks", name: "Frilly Socks" },
    ],
  },
  {
    id: "shoes", name: "Shoes", emoji: "👟", none: true,
    items: [
      { id: "loafers", name: "Loafers" },
      { id: "mary-janes", name: "Mary Janes" },
      { id: "goth-boots", name: "Goth Boots" },
      { id: "turquoise-boots", name: "Turquoise Boots" },
      { id: "chinese-shoes", name: "Sneakers" },
    ],
  },
  {
    id: "accessory", name: "Accessories", emoji: "🎀", none: true,
    items: [
      { id: "thigh-strap", name: "Thigh Strap" },
      { id: "turquoise-garter", name: "Turquoise Garter" },
    ],
  },
];

/* draw order on the doll, bottom to top (top tucks under skirt, thigh strap
   sits on bare skin above socks, jacket over everything except hair) */
const LAYER_ORDER = ["top", "skirt", "dress", "accessory", "socks", "shoes", "jacket", "hair"];

const STORAGE_KEY = "dressup-png-outfit-v1";
const ADJUST_KEY = "dressup-png-adjust-v1";

let manifest = null;
let outfit = {};
let activeCategory = WARDROBE[0].id;

/* ---- manual position/rotation/scale tweaks (edit mode) ----
   saved adjustments live in the manifest ("adjust" per item, or per side
   for split left/right items); unsaved drafts are kept in localStorage so
   nothing is lost on reload.

   Items like socks/shoes are cut as ONE piece for two feet but stored as
   two independently-adjustable halves: manifest[itemId] = { parts: { left,
   right } } instead of a flat { x, y, w, h }. An "edit target" identifies
   what a tweak applies to: the plain itemId for single-piece garments, or
   "itemId:left" / "itemId:right" for a split piece. Players never see this
   — they still pick one wardrobe entry and both feet come along. */
let adjustments = {};
let editMode = false;
let editTarget = null;

const NEUTRAL = { dx: 0, dy: 0, rot: 0, scale: 1 };

/* the renderable pieces of a worn item: [{ target, src, box }] —
   one entry for a normal item, two (left/right) for a split item */
function partsOf(itemId) {
  const entry = manifest[itemId];
  if (!entry) return [];
  if (entry.parts) {
    return Object.entries(entry.parts).map(([side, box]) => ({
      target: `${itemId}:${side}`,
      src: `${ASSET_DIR}/${itemId}-${side}.png`,
      box,
    }));
  }
  return [{ target: itemId, src: `${ASSET_DIR}/${itemId}.png`, box: entry }];
}

function adjustOf(target) {
  return adjustments[target] || { ...NEUTRAL };
}

function isNeutral(a) {
  return !a || (a.dx === 0 && a.dy === 0 && a.rot === 0 && a.scale === 1);
}

function loadAdjustments() {
  adjustments = {};
  for (const [key, val] of Object.entries(manifest)) {
    if (key === "canvas") continue;
    if (val.parts) {
      for (const [side, box] of Object.entries(val.parts)) {
        if (box.adjust) adjustments[`${key}:${side}`] = { ...NEUTRAL, ...box.adjust };
      }
    } else if (val.adjust) {
      adjustments[key] = { ...NEUTRAL, ...val.adjust };
    }
  }
  try {
    const draft = JSON.parse(localStorage.getItem(ADJUST_KEY)) || {};
    for (const [key, val] of Object.entries(draft)) adjustments[key] = { ...NEUTRAL, ...val };
  } catch { /* ignore corrupt draft */ }
}

function saveDraft() {
  localStorage.setItem(ADJUST_KEY, JSON.stringify(adjustments));
}

function defaultOutfit() {
  const o = {};
  for (const cat of WARDROBE) o[cat.id] = "none";
  o.hair = "blonde-hair";
  o.top = "uniform-top";
  o.skirt = "uniform-skirt";
  o.socks = "leg-warmers";
  o.shoes = "loafers";
  return o;
}

function loadOutfit() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const o = defaultOutfit();
    for (const cat of WARDROBE) {
      const id = saved?.[cat.id];
      if (id === "none" && cat.none) o[cat.id] = "none";
      else if (cat.items.some((i) => i.id === id)) o[cat.id] = id;
    }
    if (o.dress !== "none") {
      o.top = "none";
      o.skirt = "none";
    }
    return o;
  } catch {
    return defaultOutfit();
  }
}

function saveOutfit() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(outfit));
}

function getCategory(id) {
  return WARDROBE.find((c) => c.id === id);
}

/* ---- doll rendering ---- */
const pdoll = document.getElementById("pdoll");

function sizeDoll() {
  // measure doll-area, not the whole stage — the edit panel is a sibling
  // that reserves its own space below, so the doll must fit above it
  const area = document.getElementById("doll-area").getBoundingClientRect();
  const { width: cw, height: ch } = manifest.canvas;
  const s = Math.min((area.width * 0.96) / cw, (area.height * 0.96) / ch);
  pdoll.style.width = cw * s + "px";
  pdoll.style.height = ch * s + "px";
}
window.addEventListener("resize", sizeDoll);

function appendOutfitLayers(host, wornOutfit, editable = false) {
  const { width: cw, height: ch } = manifest.canvas;
  for (const layerId of LAYER_ORDER) {
    const itemId = wornOutfit[layerId];
    if (itemId === "none" || !manifest[itemId]) continue;
    for (const { target: pieceTarget, src, box } of partsOf(itemId)) {
      const adj = adjustOf(pieceTarget);
      const w = box.w * adj.scale;
      const h = box.h * adj.scale;
      const x = box.x + adj.dx + (box.w - w) / 2; // scale around the piece's center
      const y = box.y + adj.dy + (box.h - h) / 2;
      const img = document.createElement("img");
      img.className = "layer" + (editable && editMode && pieceTarget === editTarget ? " editing" : "");
      img.src = src;
      img.alt = "";
      img.dataset.item = pieceTarget;
      img.draggable = false;
      img.style.left = (x / cw) * 100 + "%";
      img.style.top = (y / ch) * 100 + "%";
      img.style.width = (w / cw) * 100 + "%";
      img.style.transform = adj.rot ? `rotate(${adj.rot}deg)` : "";
      host.appendChild(img);
    }
  }
}

function renderDoll() {
  pdoll.querySelectorAll("img.layer").forEach((el) => el.remove());
  appendOutfitLayers(pdoll, outfit, true);
}

function renderAnimeSnapshot(container, wornOutfit) {
  const snapshot = document.createElement("div");
  snapshot.className = "competition-png-doll";
  const base = document.createElement("img");
  base.className = "base";
  base.src = `${ASSET_DIR}/base-doll.png`;
  base.alt = "";
  base.draggable = false;
  snapshot.appendChild(base);
  appendOutfitLayers(snapshot, wornOutfit);
  container.replaceChildren(snapshot);
}

/* ---- panel rendering ---- */
const tabsEl = document.getElementById("tabs");
const itemsEl = document.getElementById("items");

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const cat of WARDROBE) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cat.id === activeCategory ? "active" : "";
    btn.setAttribute("aria-label", cat.name);
    btn.setAttribute("aria-pressed", String(cat.id === activeCategory));
    btn.innerHTML = `${cat.emoji}<small>${cat.name}</small>`;
    btn.addEventListener("click", () => {
      activeCategory = cat.id;
      renderTabs();
      renderItems();
    });
    tabsEl.appendChild(btn);
  }
}

function renderItems() {
  const cat = getCategory(activeCategory);
  itemsEl.innerHTML = "";

  const entries = cat.none ? [{ id: "none", name: "None" }, ...cat.items] : cat.items;
  for (const item of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item" + (outfit[cat.id] === item.id ? " selected" : "");
    btn.title = item.name;
    btn.setAttribute("aria-label", item.name);
    btn.setAttribute("aria-pressed", String(outfit[cat.id] === item.id));
    if (item.id === "none") {
      btn.innerHTML = `<div class="none-thumb">🚫</div>`;
    } else {
      btn.innerHTML = `<img class="thumb" src="${ASSET_DIR}/${item.id}.png" alt="${item.name}">`;
    }
    btn.addEventListener("click", () => {
      outfit[cat.id] = item.id;
      // a dress replaces top + skirt, and vice versa
      if (cat.id === "dress" && item.id !== "none") {
        outfit.top = "none";
        outfit.skirt = "none";
      }
      if ((cat.id === "top" || cat.id === "skirt") && item.id !== "none") {
        outfit.dress = "none";
      }
      saveOutfit();
      renderDoll();
      renderItems();
    });
    itemsEl.appendChild(btn);
  }
}

/* ---- header buttons ---- */
document.getElementById("btn-reset").addEventListener("click", () => {
  outfit = defaultOutfit();
  saveOutfit();
  renderDoll();
  renderItems();
});

document.getElementById("btn-random").addEventListener("click", () => {
  for (const cat of WARDROBE) {
    const pool = cat.none ? [{ id: "none" }, ...cat.items] : cat.items;
    outfit[cat.id] = pool[Math.floor(Math.random() * pool.length)].id;
  }
  // Always make a complete look while preserving dress/separates exclusivity.
  if (Math.random() < 0.35) {
    outfit.dress = WARDROBE.find((cat) => cat.id === "dress").items[0].id;
    outfit.top = "none";
    outfit.skirt = "none";
  } else {
    outfit.dress = "none";
    outfit.top = pickAnime(WARDROBE.find((cat) => cat.id === "top").items).id;
    outfit.skirt = pickAnime(WARDROBE.find((cat) => cat.id === "skirt").items).id;
  }
  saveOutfit();
  renderDoll();
  renderItems();
});

/* ============================================================
   Edit mode: tap a worn item (or cycle with ◀ ▶), drag it around,
   fine-tune with nudge / rotate / scale buttons, then save.
   ============================================================ */

const editPanel = document.getElementById("edit-panel");
const epName = document.getElementById("ep-name");
const epStatus = document.getElementById("ep-status");

/* flat list of edit targets for everything currently worn — a plain item
   contributes one target, a split item (socks/shoes) contributes two */
function editTargets() {
  const targets = [];
  for (const layerId of LAYER_ORDER) {
    const itemId = outfit[layerId];
    if (itemId === "none" || !manifest[itemId]) continue;
    for (const part of partsOf(itemId)) targets.push(part.target);
  }
  return targets;
}

function itemLabel(target) {
  const [itemId, side] = target.split(":");
  let label = itemId;
  for (const cat of WARDROBE) {
    const item = cat.items.find((i) => i.id === itemId);
    if (item) { label = item.name; break; }
  }
  return side ? `${label} (${side} foot)` : label;
}

function renderEditPanel() {
  editPanel.hidden = !editMode;
  document.getElementById("btn-edit").classList.toggle("active", editMode);
  if (!editMode) return;
  const a = adjustOf(editTarget);
  epName.textContent = editTarget
    ? `${itemLabel(editTarget)}  (${a.dx >= 0 ? "+" : ""}${a.dx}, ${a.dy >= 0 ? "+" : ""}${a.dy}, ${a.rot}°, ×${a.scale.toFixed(2)})`
    : "nothing worn";
}

function setEditStatus(msg) {
  epStatus.textContent = msg;
  if (msg) setTimeout(() => { if (epStatus.textContent === msg) epStatus.textContent = ""; }, 4000);
}

function tweak(fn) {
  if (!editTarget) return;
  const a = { ...adjustOf(editTarget) };
  fn(a);
  a.scale = Math.min(3, Math.max(0.2, Math.round(a.scale * 100) / 100));
  a.rot = Math.round(a.rot * 2) / 2;
  adjustments[editTarget] = a;
  saveDraft();
  renderDoll();
  renderEditPanel();
}

const EDIT_ACTIONS = {
  left: (a) => { a.dx -= 2; },
  right: (a) => { a.dx += 2; },
  up: (a) => { a.dy -= 2; },
  down: (a) => { a.dy += 2; },
  rotl: (a) => { a.rot -= 0.5; },
  rotr: (a) => { a.rot += 0.5; },
  smaller: (a) => { a.scale -= 0.01; },
  bigger: (a) => { a.scale += 0.01; },
};

document.getElementById("btn-edit").addEventListener("click", () => {
  editMode = !editMode;
  if (editMode && !editTargets().includes(editTarget)) editTarget = editTargets()[0] || null;
  renderEditPanel(); // toggles the panel's `hidden` attr, which changes doll-area's height
  sizeDoll();
  renderDoll();
});

document.getElementById("ep-prev").addEventListener("click", () => cycleTarget(-1));
document.getElementById("ep-next").addEventListener("click", () => cycleTarget(1));

function cycleTarget(dir) {
  const targets = editTargets();
  if (!targets.length) return;
  const i = Math.max(0, targets.indexOf(editTarget));
  editTarget = targets[(i + dir + targets.length) % targets.length];
  renderDoll();
  renderEditPanel();
}

/* nudge buttons act on tap and repeat while held */
for (const btn of editPanel.querySelectorAll("[data-act]")) {
  const act = EDIT_ACTIONS[btn.dataset.act];
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    tweak(act);
    timer = setInterval(() => tweak(act), 120);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
}

document.getElementById("ep-reset").addEventListener("click", () => {
  if (!editTarget) return;
  delete adjustments[editTarget];
  saveDraft();
  renderDoll();
  renderEditPanel();
});

document.getElementById("ep-save").addEventListener("click", () => {
  for (const key of Object.keys(manifest)) {
    if (key === "canvas") continue;
    const entry = manifest[key];
    if (entry.parts) {
      for (const side of Object.keys(entry.parts)) {
        const target = `${key}:${side}`;
        if (isNeutral(adjustments[target])) delete entry.parts[side].adjust;
        else entry.parts[side].adjust = adjustments[target];
      }
    } else {
      if (isNeutral(adjustments[key])) delete entry.adjust;
      else entry.adjust = adjustments[key];
    }
  }
  fetch("/save-manifest", { method: "POST", body: JSON.stringify(manifest) })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      localStorage.removeItem(ADJUST_KEY);
      setEditStatus("Saved to assets/png/manifest ✓");
    })
    .catch(() => {
      // no dev server (e.g. GitHub Pages / file://) -> download the file instead
      const blob = new Blob([`window.DOLL_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`],
        { type: "text/javascript" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "manifest.js";
      link.click();
      URL.revokeObjectURL(link.href);
      setEditStatus("No dev server — downloaded manifest.js, put it in assets/png/");
    });
});

/* tap a layer to select it, drag to move it */
let drag = null;
pdoll.addEventListener("pointerdown", (e) => {
  if (!editMode) return;
  const img = e.target.closest("img.layer");
  if (!img) return;
  e.preventDefault();
  if (editTarget !== img.dataset.item) {
    editTarget = img.dataset.item;
    renderDoll();
    renderEditPanel();
  }
  const a = adjustOf(editTarget);
  drag = { x: e.clientX, y: e.clientY, dx: a.dx, dy: a.dy };
  pdoll.setPointerCapture(e.pointerId);
});
pdoll.addEventListener("pointermove", (e) => {
  if (!editMode || !drag) return;
  const pxPerCanvas = pdoll.getBoundingClientRect().width / manifest.canvas.width;
  tweak((a) => {
    a.dx = Math.round(drag.dx + (e.clientX - drag.x) / pxPerCanvas);
    a.dy = Math.round(drag.dy + (e.clientY - drag.y) / pxPerCanvas);
  });
});
for (const ev of ["pointerup", "pointercancel"]) {
  pdoll.addEventListener(ev, () => { drag = null; });
}

/* ---- shared challenge / competition adapter ---- */
const ANIME_RIVAL_PRESETS = {
  wedding: [
    { hair: "blonde-hair", dress: "lolita-dress", socks: "frilly-socks", shoes: "mary-janes" },
    { hair: "gradient-hair", dress: "lolita-dress", socks: "frilly-socks", shoes: "mary-janes", accessory: "thigh-strap" },
    { hair: "purple-hair", top: "turquoise-top", skirt: "turquoise-skirt", jacket: "turquoise-jacket", shoes: "turquoise-boots" },
  ],
  "school-dance": [
    { hair: "purple-hair", top: "punk-top", skirt: "star-skirt", jacket: "star-jacket", socks: "frilly-socks", shoes: "mary-janes" },
    { hair: "turquoise-hair", top: "turquoise-top", skirt: "turquoise-skirt", jacket: "turquoise-jacket", shoes: "turquoise-boots", accessory: "turquoise-garter" },
    { hair: "gradient-hair", dress: "lolita-dress", socks: "frilly-socks", shoes: "mary-janes" },
  ],
  "fashion-show": [
    { hair: "punk-buns", top: "punk-top", skirt: "punk-skirt", jacket: "punk-jacket", shoes: "goth-boots", accessory: "thigh-strap" },
    { hair: "goth-hair", top: "goth-top", skirt: "goth-skirt", jacket: "goth-jacket", shoes: "goth-boots", accessory: "thigh-strap" },
    { hair: "turquoise-hair", top: "turquoise-top", skirt: "turquoise-skirt", jacket: "turquoise-jacket", shoes: "turquoise-boots", accessory: "turquoise-garter" },
  ],
  "berry-picking": [
    { hair: "chinese-hair", top: "chinese-top", skirt: "chinese-skirt", shoes: "chinese-shoes" },
    { hair: "blonde-hair", top: "uniform-top", skirt: "chinese-skirt", socks: "leg-warmers", shoes: "chinese-shoes" },
    { hair: "red-buns", top: "chinese-top", skirt: "uniform-skirt", socks: "leg-warmers", shoes: "loafers" },
  ],
};

const ANIME_SCENARIO_FAVES = {
  wedding: ["lolita-dress", "mary-janes", "frilly-socks", "blonde-hair", "gradient-hair", "purple-hair", "turquoise-top", "turquoise-skirt"],
  "school-dance": ["star-skirt", "star-jacket", "turquoise-top", "turquoise-skirt", "turquoise-jacket", "lolita-dress", "mary-janes", "frilly-socks", "gradient-hair", "purple-hair"],
  "fashion-show": ["punk-top", "punk-skirt", "punk-jacket", "punk-buns", "goth-top", "goth-skirt", "goth-jacket", "goth-hair", "turquoise-top", "turquoise-skirt", "turquoise-jacket", "turquoise-hair", "star-skirt", "star-jacket", "goth-boots", "turquoise-boots"],
  "berry-picking": ["chinese-top", "chinese-skirt", "chinese-shoes", "chinese-hair", "blonde-hair", "red-buns", "uniform-top", "uniform-skirt", "leg-warmers", "loafers"],
};

function pickAnime(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function makeAnimeRival(scenario) {
  const rival = {};
  for (const cat of WARDROBE) rival[cat.id] = "none";
  Object.assign(rival, pickAnime(ANIME_RIVAL_PRESETS[scenario.id]));
  return rival;
}

function scoreAnimeOutfit(wornOutfit, scenario) {
  const selected = Object.values(wornOutfit).filter((id) => id && id !== "none");
  const favorites = ANIME_SCENARIO_FAVES[scenario.id] || [];
  const themeMatches = selected.filter((id) => favorites.includes(id)).length;
  const isDressed = wornOutfit.dress !== "none"
    || (wornOutfit.top !== "none" && wornOutfit.skirt !== "none");
  const collectionRoots = ["uniform", "punk", "goth", "turquoise", "chinese", "star"];
  const collectionBonus = collectionRoots.some((root) => selected.filter((id) => id.startsWith(root)).length >= 2) ? 0.8 : 0;
  let score = 3.4 + themeMatches * 0.55 + collectionBonus + (isDressed ? 0.9 : -1.8);
  if (wornOutfit.shoes !== "none") score += 0.35;
  score += Math.random() * 2.7 - 1.15;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function leaveEditMode() {
  if (!editMode) return;
  editMode = false;
  drag = null;
  renderEditPanel();
  sizeDoll();
  renderDoll();
}

/* ---- go! ----
   manifest comes from a plain <script> (assets/png/manifest.js), not
   fetch() — opening the game via file:// (e.g. double-clicking anime.html)
   blocks fetch() of local JSON in Safari/Chrome, but a <script> tag works
   the same over file:// or http://. */
manifest = window.DOLL_MANIFEST;
loadAdjustments();
outfit = loadOutfit();
sizeDoll();
renderDoll();
renderTabs();
renderItems();
renderEditPanel();

window.DressUpCompetition?.start({
  mode: "anime",
  getOutfit: () => ({ ...outfit }),
  makeRival: makeAnimeRival,
  renderSnapshot: renderAnimeSnapshot,
  scoreOutfit: scoreAnimeOutfit,
  beforeCompetition: leaveEditMode,
});
