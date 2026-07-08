/* ============================================================
   Dress Up! — all artwork is inline SVG drawn on a 300x600 grid.
   To add an item later (e.g. an AI-generated PNG), push a new
   entry into a category's `items` with either an `svg` string or
   `<image href="..." x=.. y=.. width=.. height=../>` markup.
   ============================================================ */

const SKIN = "#ffdbc4";
const HAIR = "#7a4f2b";

/* ---- base character, split into three layers so hair can slot in
   between: limbs/torso -> [hair back] -> head/face -> [hair front] ---- */
const BASE_LIMBS = `
  <!-- arms -->
  <path d="M121,170 Q97,195 94,288" stroke="${SKIN}" stroke-width="16" stroke-linecap="round" fill="none"/>
  <path d="M179,170 Q203,195 206,288" stroke="${SKIN}" stroke-width="16" stroke-linecap="round" fill="none"/>
  <!-- legs -->
  <path d="M136,300 L131,522" stroke="${SKIN}" stroke-width="23" stroke-linecap="round" fill="none"/>
  <path d="M164,300 L169,522" stroke="${SKIN}" stroke-width="23" stroke-linecap="round" fill="none"/>
  <!-- feet -->
  <ellipse cx="127" cy="530" rx="15" ry="9" fill="${SKIN}"/>
  <ellipse cx="173" cy="530" rx="15" ry="9" fill="${SKIN}"/>
  <!-- neck + torso -->
  <rect x="141" y="130" width="18" height="34" rx="8" fill="${SKIN}"/>
  <path d="M120,160 Q150,151 180,160 Q189,210 183,258 L186,296 Q150,308 114,296 L117,258 Q111,210 120,160 Z" fill="${SKIN}"/>
`;

const BASE_HEAD = `
  <!-- ears -->
  <ellipse cx="104" cy="102" rx="8" ry="10" fill="${SKIN}"/>
  <ellipse cx="196" cy="102" rx="8" ry="10" fill="${SKIN}"/>
  <!-- head -->
  <ellipse cx="150" cy="96" rx="47" ry="49" fill="${SKIN}"/>
  <!-- blush -->
  <ellipse cx="119" cy="121" rx="8" ry="4.5" fill="#ffb3c1" opacity="0.7"/>
  <ellipse cx="181" cy="121" rx="8" ry="4.5" fill="#ffb3c1" opacity="0.7"/>
`;

const BASE_UNDERWEAR = `
  <!-- underwear: camisole straps + top + briefs -->
  <path d="M124,188 L122,168 M176,188 L178,168" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M119,184 Q150,196 181,184 L183,213 Q150,224 117,213 Z" fill="#fff" stroke="#e9ecef" stroke-width="1.5"/>
  <path d="M113,288 Q150,301 187,288 L184,313 Q167,318 159,331 Q150,340 141,331 Q133,318 116,313 Z" fill="#fff" stroke="#e9ecef" stroke-width="1.5"/>
`;

/* ---- reusable builders ---- */
function tee(fill, stroke) {
  return `
    <path d="M150,153 Q169,153 183,162 L201,181 Q207,191 199,198 L184,189 L186,264 Q150,277 114,264 L116,189 L101,198 Q93,191 99,181 L117,162 Q131,153 150,153 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <path d="M134,155 Q150,167 166,155" fill="none" stroke="${stroke}" stroke-width="2"/>`;
}

function dressBodice(fill, stroke, skirt) {
  return `
    <path d="M150,153 Q169,153 183,162 L199,181 Q205,191 197,198 L183,190 ${skirt} L117,190 L103,198 Q95,191 101,181 L117,162 Q131,153 150,153 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
}

/* ---- shared bangs shape, reused by every hairstyle ---- */
const BANGS = `M102,86 Q101,40 150,37 Q199,40 198,86 Q191,93 185,83 Q176,64 165,85 Q156,60 146,83 Q137,63 127,86 Q117,70 111,88 Q103,94 102,86 Z`;
const SHORT_CROWN = `M92,90 Q92,25 150,25 Q208,25 208,90 L204,110 Q150,122 96,110 Z`;

/* gradients referenced by `url(#id)` need their own <defs> wherever they're
   drawn (main doll AND item thumbnails), so keep the markup in one spot */
const RAINBOW_ID = "rainbow-hair";
const RAINBOW_DEFS = `
  <defs>
    <linearGradient id="${RAINBOW_ID}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff5d5d"/>
      <stop offset="17%" stop-color="#ffa94d"/>
      <stop offset="34%" stop-color="#ffe66d"/>
      <stop offset="51%" stop-color="#63e6be"/>
      <stop offset="68%" stop-color="#4dabf7"/>
      <stop offset="85%" stop-color="#9775fa"/>
      <stop offset="100%" stop-color="#f783ac"/>
    </linearGradient>
  </defs>`;

/* ---- wardrobe ---- */
const CATEGORIES = [
  {
    id: "hair", name: "Hair", emoji: "💇", none: false,
    preview: "70 15 160 260",
    items: [
      {
        id: "long", name: "Long", color: HAIR,
        back: `M90,90 Q90,25 150,25 Q210,25 210,90 L216,238 Q217,262 194,258 L189,170 Q150,200 111,170 L106,258 Q83,262 84,238 Z`,
        front: BANGS,
      },
      {
        id: "bob", name: "Bob", color: HAIR,
        back: `M92,90 Q92,25 150,25 Q208,25 208,90 L206,175 Q150,190 94,175 Z`,
        front: BANGS,
      },
      {
        id: "ponytail", name: "Ponytail", color: HAIR,
        back: `${SHORT_CROWN} M150,50 Q185,90 178,220 Q170,225 164,215 Q168,100 140,60 Z`,
        front: BANGS,
      },
      {
        id: "twintails", name: "Twin Tails", color: HAIR,
        back: `${SHORT_CROWN} M100,100 Q75,160 85,260 Q95,265 100,255 Q92,160 112,105 Z M200,100 Q225,160 215,260 Q205,265 200,255 Q208,160 188,105 Z`,
        front: BANGS,
      },
      {
        id: "pigtails", name: "Pigtails", color: HAIR,
        back: `${SHORT_CROWN}
          M65,110 Q65,80 95,80 Q125,80 125,110 Q125,140 95,140 Q65,140 65,110 Z
          M175,110 Q175,80 205,80 Q235,80 235,110 Q235,140 205,140 Q175,140 175,110 Z
          M80,135 Q70,180 80,225 Q90,230 96,222 Q86,180 101,140 Z
          M220,135 Q230,180 220,225 Q210,230 204,222 Q214,180 199,140 Z`,
        front: BANGS,
      },
      {
        id: "rainbow", name: "Rainbow Tails", color: `url(#${RAINBOW_ID})`,
        back: `${SHORT_CROWN} M100,100 Q75,160 85,260 Q95,265 100,255 Q92,160 112,105 Z M200,100 Q225,160 215,260 Q205,265 200,255 Q208,160 188,105 Z`,
        front: BANGS,
      },
    ],
  },
  {
    id: "hat", name: "Hats", emoji: "🎩", none: true,
    preview: "80 0 140 90",
    items: [
      {
        id: "bow", name: "Bow", svg: `
          <path d="M150,38 L116,22 L121,56 Z" fill="#ff5d8f" stroke="#d6336c" stroke-width="2"/>
          <path d="M150,38 L184,22 L179,56 Z" fill="#ff5d8f" stroke="#d6336c" stroke-width="2"/>
          <circle cx="150" cy="38" r="9" fill="#d6336c"/>`
      },
      {
        id: "witch", name: "Witch Hat", svg: `
          <ellipse cx="150" cy="58" rx="56" ry="12" fill="#5f3dc4" stroke="#3b2a8c" stroke-width="2"/>
          <path d="M150,2 L184,58 Q150,70 116,58 Z" fill="#5f3dc4" stroke="#3b2a8c" stroke-width="2"/>
          <rect x="136" y="42" width="28" height="10" rx="2" fill="#ffd43b"/>`
      },
      {
        id: "cap", name: "Cap", svg: `
          <path d="M106,68 Q106,28 150,28 Q194,28 194,68 Z" fill="#339af0" stroke="#1c7ed6" stroke-width="2"/>
          <path d="M150,60 Q214,56 218,72 Q190,80 148,73 Z" fill="#1c7ed6"/>
          <ellipse cx="150" cy="68" rx="45" ry="8" fill="#1c7ed6"/>
          <circle cx="150" cy="28" r="5" fill="#1c7ed6"/>`
      },
      {
        id: "flowers", name: "Flower Crown", svg: `
          ${[[112, 72, "#ff8fab"], [130, 54, "#ffd43b"], [150, 47, "#ff8fab"], [170, 54, "#ffd43b"], [188, 72, "#ff8fab"]]
            .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}"/><circle cx="${x}" cy="${y}" r="3" fill="#e8590c"/>`)
            .join("")}`
      },
      {
        id: "rainbow-witch", name: "Rainbow Witch", svg: `
          <ellipse cx="150" cy="58" rx="56" ry="12" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>
          <path d="M150,2 L184,58 Q150,70 116,58 Z" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>
          <rect x="136" y="42" width="28" height="10" rx="2" fill="#ffd43b" stroke="#f08c00" stroke-width="1.5"/>`
      },
      {
        id: "rainbow-bow", name: "Rainbow Bow", svg: `
          <path d="M150,38 L116,22 L121,56 Z" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>
          <path d="M150,38 L184,22 L179,56 Z" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>
          <circle cx="150" cy="38" r="9" fill="#ffd43b" stroke="#f08c00" stroke-width="2"/>`
      },
    ],
  },
  {
    id: "eyes", name: "Eyes", emoji: "👀", none: false,
    preview: "105 80 90 45",
    items: [
      {
        id: "sparkle", name: "Sparkly", svg: `
          <path d="M118,92 Q128,86 138,90 M162,90 Q172,86 182,92" stroke="#5c4432" stroke-width="3" fill="none" stroke-linecap="round"/>
          <ellipse cx="130" cy="106" rx="9" ry="12" fill="#4a3020"/>
          <ellipse cx="170" cy="106" rx="9" ry="12" fill="#4a3020"/>
          <circle cx="127" cy="101" r="3.2" fill="#fff"/>
          <circle cx="167" cy="101" r="3.2" fill="#fff"/>
          <circle cx="133" cy="110" r="1.6" fill="#fff" opacity="0.8"/>
          <circle cx="173" cy="110" r="1.6" fill="#fff" opacity="0.8"/>`
      },
      {
        id: "happy", name: "Happy", svg: `
          <path d="M121,106 Q130,96 139,106 M161,106 Q170,96 179,106" stroke="#5c4432" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
      },
      {
        id: "wink", name: "Wink", svg: `
          <ellipse cx="130" cy="106" rx="9" ry="12" fill="#4a3020"/>
          <circle cx="127" cy="101" r="3.2" fill="#fff"/>
          <path d="M161,106 Q170,98 179,106" stroke="#5c4432" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
      },
      {
        id: "stars", name: "Stars", svg: `
          <path d="M130,94 L133.5,102.5 L142,106 L133.5,109.5 L130,118 L126.5,109.5 L118,106 L126.5,102.5 Z" fill="#fcc419" stroke="#f59f00" stroke-width="1.5"/>
          <path d="M170,94 L173.5,102.5 L182,106 L173.5,109.5 L170,118 L166.5,109.5 L158,106 L166.5,102.5 Z" fill="#fcc419" stroke="#f59f00" stroke-width="1.5"/>`
      },
      {
        id: "rainbow", name: "Rainbow", svg: `
          <path d="M118,92 Q128,86 138,90 M162,90 Q172,86 182,92" stroke="#5c4432" stroke-width="3" fill="none" stroke-linecap="round"/>
          <ellipse cx="130" cy="106" rx="9" ry="12" fill="url(#${RAINBOW_ID})"/>
          <ellipse cx="170" cy="106" rx="9" ry="12" fill="url(#${RAINBOW_ID})"/>
          <circle cx="127" cy="101" r="3.2" fill="#fff"/>
          <circle cx="167" cy="101" r="3.2" fill="#fff"/>`
      },
    ],
  },
  {
    id: "mouth", name: "Mouth", emoji: "👄", none: false,
    preview: "125 115 50 35",
    items: [
      {
        id: "smile", name: "Smile", svg: `
          <path d="M141,130 Q150,139 159,130" stroke="#d6495b" stroke-width="3" fill="none" stroke-linecap="round"/>`
      },
      {
        id: "laugh", name: "Laugh", svg: `
          <path d="M139,127 Q150,147 161,127 Z" fill="#c92a2a"/>
          <path d="M144,135 Q150,141 156,135 L150,139 Z" fill="#ff8787"/>`
      },
      {
        id: "cat", name: "Cat", svg: `
          <path d="M138,129 Q144,137 150,130 Q156,137 162,129" stroke="#d6495b" stroke-width="3" fill="none" stroke-linecap="round"/>`
      },
      {
        id: "ooh", name: "Ooh!", svg: `
          <ellipse cx="150" cy="132" rx="4.5" ry="6.5" fill="#c92a2a"/>`
      },
      {
        id: "rainbow", name: "Rainbow", svg: `
          <path d="M139,133 Q150,144 161,133" stroke="url(#${RAINBOW_ID})" stroke-width="4" fill="none" stroke-linecap="round"/>`
      },
    ],
  },
  {
    id: "shirt", name: "Shirts", emoji: "👕", none: true,
    preview: "85 140 130 150",
    items: [
      { id: "tee-white", name: "White Tee", svg: tee("#ffffff", "#ced4da") },
      { id: "tee-yellow", name: "Sunny Tee", svg: tee("#ffd43b", "#f08c00") },
      {
        id: "sailor", name: "Sailor Top", svg: `
          ${tee("#ffffff", "#ced4da")}
          <path d="M114,252 Q150,260 186,252 L186,264 Q150,277 114,264 Z" fill="#4263eb"/>
          <path d="M134,155 L150,180 L166,155 L177,161 L150,192 L123,161 Z" fill="#4263eb"/>
          <circle cx="150" cy="196" r="4" fill="#f03e3e"/>`
      },
      { id: "rainbow", name: "Rainbow Tee", svg: tee(`url(#${RAINBOW_ID})`, "#adb5bd") },
    ],
  },
  {
    id: "dress", name: "Dresses", emoji: "👗", none: true,
    preview: "75 140 150 340",
    items: [
      {
        id: "party", name: "Party Dress", svg: `
          ${dressBodice("#f783ac", "#e64980", "L186,240 L208,346 Q210,357 198,357 L102,357 Q90,357 92,346 L114,240 L117,190")}
          <path d="M114,240 Q150,252 186,240" stroke="#e64980" stroke-width="3" fill="none"/>
          <circle cx="150" cy="246" r="5" fill="#fff"/>`
      },
      {
        id: "princess", name: "Princess Gown", svg: `
          ${dressBodice("#b197fc", "#7048e8", "L186,235 L217,455 Q219,468 205,468 L95,468 Q81,468 83,455 L114,235 L117,190")}
          <path d="M114,235 Q150,247 186,235" stroke="#7048e8" stroke-width="3" fill="none"/>
          ${[[120, 300], [165, 330], [135, 390], [180, 420], [110, 430], [150, 360]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff" opacity="0.9"/>`)
            .join("")}`
      },
      {
        id: "sundress", name: "Sundress", svg: `
          ${dressBodice("#63e6be", "#0ca678", "L186,238 L202,370 Q203,380 192,380 L108,380 Q97,380 98,370 L114,238 L117,190")}
          <path d="M114,238 Q150,250 186,238" stroke="#0ca678" stroke-width="3" fill="none"/>
          <path d="M120,300 Q150,312 180,300 M112,345 Q150,358 188,345" stroke="#0ca678" stroke-width="2" fill="none"/>`
      },
      {
        id: "rainbow", name: "Rainbow Dress", svg: `
          ${dressBodice(`url(#${RAINBOW_ID})`, "#adb5bd", "L186,240 L208,346 Q210,357 198,357 L102,357 Q90,357 92,346 L114,240 L117,190")}
          <path d="M114,240 Q150,252 186,240" stroke="#fff" stroke-width="3" fill="none"/>
          <circle cx="150" cy="246" r="5" fill="#fff"/>`
      },
      {
        id: "rainbow-princess", name: "Rainbow Gown", svg: `
          ${dressBodice(`url(#${RAINBOW_ID})`, "#adb5bd", "L186,235 L217,455 Q219,468 205,468 L95,468 Q81,468 83,455 L114,235 L117,190")}
          <path d="M114,235 Q150,247 186,235" stroke="#fff" stroke-width="3" fill="none"/>
          ${[[120, 300], [165, 330], [135, 390], [180, 420], [110, 430], [150, 360], [170, 280], [125, 350]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff" opacity="0.9"/>`)
            .join("")}`
      },
    ],
  },
  {
    id: "pants", name: "Pants", emoji: "👖", none: true,
    preview: "90 275 120 265",
    items: [
      {
        id: "skirt", name: "Skirt", svg: `
          <path d="M111,288 Q150,301 189,288 L201,358 Q150,372 99,358 Z" fill="#4dabf7" stroke="#1971c2" stroke-width="2"/>
          <path d="M125,293 L119,362 M150,300 L150,368 M175,293 L181,362" stroke="#1971c2" stroke-width="2"/>`
      },
      {
        id: "jeans", name: "Jeans", svg: `
          <path d="M112,287 Q150,299 188,287 L195,420 L192,526 L157,526 L154,420 L150,342 L146,420 L143,526 L108,526 L105,420 Z" fill="#4c6ef5" stroke="#364fc7" stroke-width="2"/>
          <path d="M113,300 Q150,311 187,300" stroke="#364fc7" stroke-width="2" fill="none"/>`
      },
      {
        id: "shorts", name: "Shorts", svg: `
          <path d="M112,287 Q150,299 188,287 L193,343 L156,346 L150,326 L144,346 L107,343 Z" fill="#20c997" stroke="#0ca678" stroke-width="2"/>`
      },
      {
        id: "rainbow", name: "Rainbow Skirt", svg: `
          <path d="M111,288 Q150,301 189,288 L201,358 Q150,372 99,358 Z" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>`
      },
    ],
  },
  {
    id: "shoes", name: "Shoes", emoji: "👟", none: true,
    preview: "100 455 100 90",
    items: [
      {
        id: "flats", name: "Red Flats", svg: `
          <ellipse cx="127" cy="530" rx="16" ry="10" fill="#fa5252" stroke="#c92a2a" stroke-width="2"/>
          <ellipse cx="173" cy="530" rx="16" ry="10" fill="#fa5252" stroke="#c92a2a" stroke-width="2"/>`
      },
      {
        id: "sneakers", name: "Sneakers", svg: `
          <ellipse cx="127" cy="529" rx="17" ry="11" fill="#ffffff" stroke="#adb5bd" stroke-width="2"/>
          <ellipse cx="173" cy="529" rx="17" ry="11" fill="#ffffff" stroke="#adb5bd" stroke-width="2"/>
          <path d="M112,532 Q127,538 142,532 M158,532 Q173,538 188,532" stroke="#339af0" stroke-width="3" fill="none"/>`
      },
      {
        id: "boots", name: "Boots", svg: `
          <rect x="117" y="468" width="27" height="60" rx="10" fill="#9775fa" stroke="#7048e8" stroke-width="2"/>
          <rect x="156" y="468" width="27" height="60" rx="10" fill="#9775fa" stroke="#7048e8" stroke-width="2"/>
          <ellipse cx="128" cy="529" rx="17" ry="10" fill="#9775fa" stroke="#7048e8" stroke-width="2"/>
          <ellipse cx="172" cy="529" rx="17" ry="10" fill="#9775fa" stroke="#7048e8" stroke-width="2"/>`
      },
      {
        id: "rainbow", name: "Rainbow", svg: `
          <ellipse cx="127" cy="529" rx="17" ry="11" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>
          <ellipse cx="173" cy="529" rx="17" ry="11" fill="url(#${RAINBOW_ID})" stroke="#adb5bd" stroke-width="2"/>`
      },
    ],
  },
];

/* z-order of clothing layers on the doll, bottom to top */
const LAYER_ORDER = ["eyes", "mouth", "pants", "shoes", "shirt", "dress", "hat"];

const STORAGE_KEY = "dressup-outfit-v1";

/* ---- state ---- */
function defaultOutfit() {
  const o = {};
  for (const cat of CATEGORIES) o[cat.id] = cat.none ? "none" : cat.items[0].id;
  return o;
}

function loadOutfit() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const outfit = defaultOutfit();
    for (const cat of CATEGORIES) {
      const id = saved?.[cat.id];
      if (id === "none" && cat.none) outfit[cat.id] = "none";
      else if (cat.items.some((i) => i.id === id)) outfit[cat.id] = id;
    }
    return outfit;
  } catch {
    return defaultOutfit();
  }
}

let outfit = loadOutfit();
let activeCategory = CATEGORIES[0].id;

function saveOutfit() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(outfit));
}

function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id);
}

/* ---- doll rendering ---- */
const doll = document.getElementById("doll");

function renderDoll() {
  const hair = getCategory("hair").items.find((i) => i.id === outfit.hair);

  let svg = RAINBOW_DEFS;
  svg += `<g id="base-limbs">${BASE_LIMBS}</g>`;
  if (hair) svg += `<g data-layer="hair-back"><path d="${hair.back}" fill="${hair.color}"/></g>`;
  svg += `<g id="base-head">${BASE_HEAD}</g>`;
  if (hair) svg += `<g data-layer="hair-front"><path d="${hair.front}" fill="${hair.color}"/></g>`;
  svg += `<g id="base-underwear">${BASE_UNDERWEAR}</g>`;

  for (const layerId of LAYER_ORDER) {
    const cat = getCategory(layerId);
    const item = cat.items.find((i) => i.id === outfit[layerId]);
    if (item) svg += `<g data-layer="${layerId}">${item.svg}</g>`;
  }
  doll.innerHTML = svg;
}

/* ---- panel rendering ---- */
const tabsEl = document.getElementById("tabs");
const itemsEl = document.getElementById("items");

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const cat of CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = cat.id === activeCategory ? "active" : "";
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
    btn.className = "item" + (outfit[cat.id] === item.id ? " selected" : "");
    if (item.id === "none") {
      btn.innerHTML = `<div class="none-thumb">🚫</div><span>None</span>`;
    } else {
      const artwork = item.svg ?? `${RAINBOW_DEFS}<path d="${item.back}" fill="${item.color}"/><ellipse cx="150" cy="96" rx="47" ry="49" fill="${SKIN}"/><path d="${item.front}" fill="${item.color}"/>`;
      btn.innerHTML = `<svg viewBox="${cat.preview}" xmlns="http://www.w3.org/2000/svg">${artwork}</svg><span>${item.name}</span>`;
    }
    btn.addEventListener("click", () => selectItem(cat.id, item.id));
    itemsEl.appendChild(btn);
  }
}

function selectItem(catId, itemId) {
  outfit[catId] = itemId;
  // a dress replaces shirt + pants, and vice versa
  if (catId === "dress" && itemId !== "none") {
    outfit.shirt = "none";
    outfit.pants = "none";
  }
  if ((catId === "shirt" || catId === "pants") && itemId !== "none") {
    outfit.dress = "none";
  }
  saveOutfit();
  renderDoll();
  renderItems();
}

/* ---- header buttons ---- */
document.getElementById("btn-reset").addEventListener("click", () => {
  outfit = defaultOutfit();
  saveOutfit();
  renderDoll();
  renderItems();
});

document.getElementById("btn-random").addEventListener("click", () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  for (const cat of CATEGORIES) outfit[cat.id] = pick(cat.items).id;
  if (Math.random() < 0.5) {
    outfit.shirt = "none";
    outfit.pants = "none";
  } else {
    outfit.dress = "none";
  }
  saveOutfit();
  renderDoll();
  renderItems();
});

/* ---- go! ---- */
renderDoll();
renderTabs();
renderItems();
