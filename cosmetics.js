import { COSMETICS } from "./shared/world.js";

const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function renderLocker(el, profile, actions, selected) {
  const current = COSMETICS.find(c => c.id === selected) || COSMETICS.find(c => c.id === profile.outfit);
  el.innerHTML = `<div class="eyebrow">THE ARMOURY / ${profile.owned.length} OF ${COSMETICS.length} OWNED</div>
    <h1>DEAD WORLD.<br>LIVE STYLE<span>.</span></h1>
    <p class="section-intro">Make your last impression a good one.<br>Earned coins. Original outfits. Zero combat advantage.</p>
    <div class="shop-balance">${icon("coin")}<strong>${profile.coins.toLocaleString()}</strong><span>YOUR COINS</span><button id="shop-crates">${icon("box")} ${profile.crates} CRATE${profile.crates === 1 ? "" : "S"} ↗</button></div>
    <div class="skin-grid">${COSMETICS.map(c => `<button class="outfit-card skin-card ${c.id === current.id ? "selected" : ""}" data-preview="${c.id}" style="--skin:${c.color}" aria-pressed="${c.id === current.id}">
      <span class="skin-symbol">${icon(c.symbol)}</span><span class="skin-rarity">${c.rarity.toUpperCase()}</span>
      <strong>${c.name}</strong><small>${profile.outfit === c.id ? "✓ EQUIPPED" : profile.owned.includes(c.id) ? "✓ OWNED" : `${icon("coin")} ${c.price}`}</small>
    </button>`).join("")}</div>
    <div id="skin-detail" class="skin-detail"></div><button id="equip-outfit" class="skin-action"></button>
    <p class="panel-caption">Outfit + matching weapon finish. Drag to rotate. Coins are earned in matches and cannot be bought with real money.</p>`;
  const show = c => {
    actions.preview(c);
    el.querySelectorAll("[data-preview]").forEach(b => {
      b.classList.toggle("selected", b.dataset.preview === c.id);
      b.setAttribute("aria-pressed", b.dataset.preview === c.id ? "true" : "false");
    });
    const owned = profile.owned.includes(c.id), button = el.querySelector("#equip-outfit");
    el.querySelector("#skin-detail").innerHTML = `<span style="color:${c.color}">${icon(c.symbol)}</span><div><strong>${c.name}</strong><small>${c.tag}${Number.isFinite(c.xp) && c.xp > 0 ? ` · ALSO FREE AT ${c.xp} XP` : " · OUTFIT + WEAPON FINISH"}</small></div>`;
    button.disabled = !owned && profile.coins < c.price;
    button.innerHTML = owned ? icon("shield") + (profile.outfit === c.id ? " EQUIPPED" : " EQUIP OUTFIT") : profile.coins >= c.price ? `${icon("coin")} UNLOCK FOR ${c.price} COINS` : `${icon("lock")} ${c.price - profile.coins} MORE COINS NEEDED`;
    button.onclick = () => { if (owned) actions.equip(c); else { button.disabled = true; actions.buy(c); } };
  };
  el.querySelectorAll("[data-preview]").forEach(b => b.onclick = () => show(COSMETICS.find(c => c.id === b.dataset.preview)));
  el.querySelector("#shop-crates").onclick = actions.crates;
  show(current);
}

export function renderCrates(el, profile, open) {
  el.innerHTML = `<div class="eyebrow">SUPPLY CACHE / EARNED IN THE FIELD</div><h1>FORTUNE<br>FAVOURS YOU<span>.</span></h1>
    <p class="section-intro">Something worth coming back for.<br>Every case contains an outfit you don’t own.</p>
    <div class="supply-display"><div class="supply-halo"></div><div class="supply-case"><div class="case-lid"></div><div class="case-front">${icon("bio")}<b>H//30</b><small>FIELD SUPPLY / 07</small></div><i></i><i></i></div><span class="case-count">${profile.crates} AVAILABLE</span></div>
    <button class="skin-action" id="crate-button" ${profile.crates ? "" : "disabled"}>${icon("box")} ${profile.crates ? "OPEN SUPPLY CRATE" : "PLAY TO EARN A CRATE"}</button>
    <div class="cache-note">${icon("shield")} DUPLICATE PROTECTION <span>ALWAYS ON</span></div>
    <div class="drop-title">PUBLISHED BASE DROP CHANCES</div><div class="drop-table">${COSMETICS.filter(c => c.weight).map(c => `<div><span style="color:${c.color}">${icon(c.symbol)}</span><strong>${c.name}</strong><i style="--chance:${c.weight}%;--skin:${c.color}"></i><b>${c.weight}%</b></div>`).join("")}</div>
    <p class="panel-caption">Owned outfits leave the pool; remaining chances adjust proportionally. Complete collection: 50 XP + 50 coins. Everyone receives 150 welcome coins and one starter crate, once. Finish Solo, Duo or Squad matches to earn more. Crates are never sold.</p>`;
  el.querySelector("#crate-button").onclick = () => { el.querySelector("#crate-button").disabled = true; open(); };
}

export function rewardHTML(message) {
  const c = COSMETICS.find(c => c.id === message.cosmetic);
  if (!c) return `<div class="eyebrow">COLLECTION COMPLETE</div><h2>ALL YOURS.</h2><div class="reward-medallion" style="--skin:#c4f568">${icon("coin")}</div><p>Your collection is complete. This crate awarded <strong>50 coins + 50 XP</strong>.</p><button id="reward-continue" class="skin-action">KEEP SURVIVING ${icon("arrow")}</button>`;
  return `<div class="eyebrow">${message.purchase ? "OUTFIT PURCHASED / COINS" : "SUPPLY CASE OPENED / NEW OUTFIT"}</div><h2>${message.purchase ? "GOOD TASTE." : "A LITTLE LUCK."}</h2>
    <div class="reward-reveal" style="--skin:${c.color}"><div class="reward-rays"></div><div class="reward-medallion">${icon(c.symbol)}</div><span>${c.rarity.toUpperCase()} OUTFIT</span><h3>${c.name}</h3><p>${c.tag} · MATCHING WEAPON FINISH INCLUDED</p></div>
    <button id="reward-equip" class="skin-action">${icon("shield")} EQUIP NOW</button><button id="reward-continue" class="panel-action">VIEW IN LOCKER ↗</button><p class="panel-caption">Saved to your guest account. All style. No combat advantage.</p>`;
}
