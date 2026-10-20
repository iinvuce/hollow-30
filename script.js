import { COSMETICS, MODES, WEAPONS, WORLD } from "./shared/world.js";
import { renderLocker, renderCrates, rewardHTML } from "./cosmetics.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;
const defaults = {
  sound: false,
  music: false,
  volume: 0.25,
  glow: true,
  motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  quality: matchMedia("(pointer: coarse)").matches ? "low" : "high",
};
let settings;
try {
  settings = {
    ...defaults,
    ...JSON.parse(localStorage.getItem("hollow-settings") || "{}"),
  };
} catch {
  settings = defaults;
}
let token = localStorage.getItem("hollow-guest"),
  profile = null,
  party = null,
  snapshot = null,
  ws = null,
  scene = null,
  tab = "play",
  offset = 0,
  attempt = 0,
  retry = null,
  replaced = false,
  pendingInvite = false,
  pendingPractice = false,
  pendingSolo = false,
  openingCrate = false,
  buyingSkin = false,
  joinedInvite = false,
  resultId = null,
  previousHp = 100,
  lastEffect = 0,
  clockPing = 0;
let selectedMode = localStorage.getItem("hollow-mode") || "solo";
if (!Object.hasOwn(MODES, selectedMode) || selectedMode === "practice") selectedMode = "solo";
let previewSkin = null;
const keys = new Set();
const touchDevice = matchMedia("(pointer: coarse)").matches;
const touch = { moveX: 0, moveZ: 0, aiming: false, firing: false, sprinting: false, movePointer: null, aimPointer: null };
let touchHintShown = false;
function resetTouch() {
  touch.moveX = touch.moveZ = 0;
  touch.aiming = touch.firing = touch.sprinting = false;
  for (const name of ["move", "aim"]) {
    touch[name + "Pointer"] = null;
    const stick = $("#" + name + "-stick");
    stick?.classList.remove("engaged");
    const knob = stick?.querySelector(".stick-knob");
    if (knob) knob.style.transform = "translate(-50%, -50%)";
  }
  $("#touch-sprint")?.classList.remove("engaged");
  shooting = false;
}
function mobileAction(action) {
  if (!document.body.classList.contains("playing") || $("#modal").open || !connected) return;
  send("action", { action });
  if (navigator.vibrate) navigator.vibrate(12);
}
function setupTouch() {
  if (!touchDevice) return;
  document.body.classList.add("touch-device");
  for (const name of ["move", "aim"]) {
    const pad = $("#" + name + "-stick");
    const knob = pad.querySelector(".stick-knob");
    const update = (event) => {
      const rect = pad.getBoundingClientRect();
      const max = rect.width * 0.34;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx, dy);
      const strength = Math.min(length / max, 1);
      const x = length > 0 ? (dx / length) * strength : 0;
      const y = length > 0 ? (dy / length) * strength : 0;
      knob.style.transform = `translate(calc(-50% + ${x * max}px), calc(-50% + ${y * max}px))`;
      if (name === "move") {
        touch.moveX = Math.abs(x) > 0.12 ? x : 0;
        touch.moveZ = Math.abs(y) > 0.12 ? y : 0;
      } else {
        // World-space +Z points down on screen. Finger direction is the aim direction.
        if (strength > 0.18) scene?.setTouchAim(Math.atan2(x, y));
        touch.aiming = strength > 0.18;
        touch.firing = touch.aiming;
      }
    };
    pad.addEventListener("pointerdown", (event) => {
      if (!document.body.classList.contains("playing") || $("#modal").open) return;
      event.preventDefault();
      if (touch[name + "Pointer"] !== null) return;
      touch[name + "Pointer"] = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      pad.classList.add("engaged");
      update(event);
      initAudio();
    });
    pad.addEventListener("pointermove", (event) => {
      if (touch[name + "Pointer"] !== event.pointerId) return;
      event.preventDefault();
      update(event);
    });
    const end = (event) => {
      if (touch[name + "Pointer"] !== event.pointerId) return;
      touch[name + "Pointer"] = null;
      pad.classList.remove("engaged");
      knob.style.transform = "translate(-50%, -50%)";
      if (name === "move") touch.moveX = touch.moveZ = 0;
      else touch.aiming = touch.firing = false;
    };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    pad.addEventListener("lostpointercapture", end);
  }
  const sprint = $("#touch-sprint");
  sprint.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("playing") || $("#modal").open) return;
    event.preventDefault();
    sprint.setPointerCapture(event.pointerId);
    sprint.classList.add("engaged");
    touch.sprinting = true;
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) sprint.addEventListener(eventName, () => {
    touch.sprinting = false;
    sprint.classList.remove("engaged");
  });
  [["touch-interact", "interact"], ["touch-reload", "reload"], ["touch-heal", "heal"], ["touch-swap", "swap"]].forEach(([id, action]) => {
    $("#" + id).addEventListener("pointerdown", (e) => { e.preventDefault(); mobileAction(action); });
  });
  $("#touch-inventory").addEventListener("click", gameInventory);
  $("#touch-tip-close").addEventListener("click", () => {
    $("#touch-tip").hidden = true;
    localStorage.setItem("hollow-touch-seen", "yes");
  });
  window.addEventListener("orientationchange", resetTouch);
  document.addEventListener("visibilitychange", () => { if (document.hidden) resetTouch(); });
}

let shooting = false,
  ready3d = false,
  connected = false;
function loading(pct, text) {
  $("#loading-bar").style.width = pct + "%";
  $("#loading-number").textContent = pct + "%";
  $("#loading-label").textContent = text;
}
function dismissLoading() {
  if (ready3d && connected) {
    loading(100, "Ready for deployment");
    $("#loading").classList.add("done");
    setTimeout(() => ($("#loading").hidden = true), 700);
  }
}
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 4500);
}
function send(type, data = {}) {
  if (ws?.readyState === WebSocket.OPEN && profile) {
    ws.send(JSON.stringify({ type, ...data }));
    return true;
  }
  toast("Server disconnected. Reconnecting…", true);
  return false;
}
function status(text, online) {
  $("#connection").classList.toggle("offline", !online);
  $("#connection").innerHTML = "<i></i>" + escapeHTML(text);
}
function connect() {
  clearTimeout(retry);
  if (ws && ws.readyState < 2) return;
  status(attempt ? "RECONNECTING" : "CONNECTING", false);
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/socket`,
  );
  ws.addEventListener("open", () =>
    ws.send(
      JSON.stringify({
        type: "hello",
        token,
        name: "Survivor_" + Math.floor(Math.random() * 900 + 100),
      }),
    ),
  );
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    switch (m.type) {
      case "welcome":
        profile = m.profile;
        token = m.token;
        localStorage.setItem("hollow-guest", token);
        connected = true;
        attempt = 0;
        status("SERVER CONNECTED", true);
        $("#loading-retry").hidden = true;
        renderProfile();
        renderParty();
        dismissLoading();
        if (!joinedInvite) {
          const invite = new URLSearchParams(location.search).get("invite");
          if (invite) {
            joinedInvite = true;
            send("join", { code: invite });
          }
        }
        break;
      case "profile":
        profile = m.profile;
        renderProfile();
        if (tab !== "play") renderTab();
        break;
      case "party":
        party = m.party;
        if (party && !party.practice) { selectedMode = party.mode; localStorage.setItem("hollow-mode", selectedMode); }
        renderParty();
        if (pendingInvite && party) {
          pendingInvite = false;
          inviteDialog();
        }
        if (pendingPractice && party?.practice && party.state === "lobby") {
          const me = party.members.find((p) => p.id === profile.id);
          if (!me.ready) send("ready");
          else {
            pendingPractice = false;
            send("start");
          }
        }
        if (pendingSolo && party?.mode === "solo" && party.state === "lobby") {
          const me = party.members.find(p => p.id === profile.id);
          if (!me.ready) send("ready");
          else { pendingSolo = false; send("start"); }
        }
        if (!party || party.state === "lobby") showLobby();
        break;
      case "snapshot":
        snapshot = m;
        offset = (m.serverTime || Date.now()) - Date.now();
        if (m.state === "match") {
          showMatch();
          scene?.snapshot(m, profile.id);
          renderHud();
        } else if (m.state === "results" && resultId !== m.results.matchId) {
          resultId = m.results.matchId;
          showResults(m.results);
        }
        break;
      case "error":
        pendingSolo = false;
        pendingPractice = false;
        buyingSkin = false;
        if (openingCrate) { openingCrate = false; $("#modal").close(); }
        toast(m.message, true);
        if (!profile) {
          loading(ready3d ? 85 : 45, m.message);
          $("#loading-retry").hidden = false;
        }
        break;
      case "crate":
        openingCrate = false;
        profile = m.profile;
        renderProfile();
        renderTab();
        showCrateReward(m);
        sound("reward");
        break;
      case "purchase":
        buyingSkin = false;
        profile = m.profile;
        renderProfile();
        renderTab();
        showCrateReward({ ...m, purchase: true });
        sound("reward");
        break;
      case "pong":
        offset = m.serverTime - (Date.now() + m.sent) / 2;
        $("#ping").textContent = Math.max(1, Date.now() - m.sent) + " MS";
        break;
      case "replaced":
        replaced = true;
        toast(
          "This guest is active in another tab. Use a separate browser profile for player two.",
          true,
        );
        status("SESSION MOVED", false);
        break;
    }
  });
  ws.addEventListener("close", () => {
    connected = false;
    if (replaced) return;
    status("RECONNECTING", false);
    if (!$("#loading").hidden) {
      $("#loading-label").textContent =
        "Server unavailable. Retrying connection…";
      $("#loading-retry").hidden = false;
    } else
      toast("Connection lost. Your place is reserved for 45 seconds.", true);
    attempt++;
    retry = setTimeout(
      connect,
      Math.min(10000, 700 * 2 ** Math.min(attempt, 4)),
    );
    renderParty();
  });
  ws.addEventListener("error", () => status("SERVER UNAVAILABLE", false));
}
function renderProfile() {
  if (!profile) return;
  $("#profile-button").textContent = profile.name[0].toUpperCase();
  $("#character-name").textContent = profile.name.toUpperCase();
  $("#outfit-label").textContent = COSMETICS.find(
    (c) => c.id === profile.outfit,
  )?.name.toUpperCase();
  if (tab !== "locker") scene?.preview(profile.outfit);
  $("#coin-balance").textContent = profile.coins.toLocaleString();
  $("#crate-balance").textContent = profile.crates;
  $("#coins-button").setAttribute("aria-label", `${profile.coins} coins. Open outfit shop`);
  $("#crates-button").setAttribute("aria-label", `${profile.crates} supply crates. Open crates`);
}
function renderParty() {
  const members =
      party?.members ||
      (profile ? [{ ...profile, connected, ready: false }] : []),
    leader = party?.leader || profile?.id;
  const mode = MODES[party?.mode || selectedMode];
  $("#squad-count").innerHTML = `0${members.length} <i>/ 0${mode.max}</i>`;
  $("#party-title").textContent = mode.max === 1 ? "YOUR DEPLOYMENT" : "YOUR PARTY";
  $("#party-privacy").textContent = party?.practice
    ? "PRACTICE / NO REWARDS"
    : mode.max === 1 ? "SOLO / REWARDS ENABLED" : "PRIVATE / INVITE ONLY";
  $("#members").innerHTML =
    members
      .map(
        (p) =>
          `<div class="member"><div class="avatar">${escapeHTML(p.name[0].toUpperCase())}</div><div class="member-info"><strong>${escapeHTML(p.name)} ${p.id === profile?.id ? '<span style="color:#80966b;font-size:8px">YOU</span>' : ""}</strong><small>${p.id === leader ? "SQUAD LEADER" : "SURVIVOR"}</small></div><span class="member-status ${p.ready ? "ready" : ""}">${!p.connected ? "OFFLINE" : p.ready ? "✓ READY" : "NOT READY"}</span></div>`,
      )
      .join("") +
    Array.from(
      { length: Math.max(0, mode.max - members.length) },
      () =>
        '<div class="empty-member"><span class="empty-avatar">+</span><span>WAITING FOR A SURVIVOR</span></div>',
    ).join("");
  const me = members.find((p) => p.id === profile?.id),
    isLeader = leader === profile?.id,
    allReady = members.every((p) => p.ready && p.connected);
  $("#ready-button").innerHTML =
    (mode.max === 1 && !party?.practice ? "DEPLOY SOLO" : !party ? "CREATE PARTY" : me?.ready ? "CANCEL READY" : "READY UP") +
    icon(mode.max === 1 ? "target" : "arrow");
  $("#ready-button").disabled = !connected;
  $("#start-button").hidden = !party || mode.max === 1 && !party.practice;
  $("#start-button").disabled = !isLeader || !allReady || members.length < mode.min || !connected;
  $("#start-button").textContent = `${isLeader ? "DEPLOY" : "LEADER DEPLOYS"} ${mode.label.toUpperCase()} ↗`;
  $("#deploy-mode").innerHTML = icon(mode.symbol) + " " + mode.label.toUpperCase() + " SURVIVAL";
  $("#ready-status").textContent = mode.max === 1
    ? party?.practice ? "Training only. No XP, coins or crates." : "Drop in now. Earn XP, coins and a crate."
    : !party ? mode.description
    : members.length < mode.min ? `Invite ${mode.min - members.length} friend. ${mode.label} needs ${mode.min} players.`
    : allReady ? "All survivors ready. Leader can deploy."
    : me?.ready ? "You’re ready. Waiting for your party." : "Ready up, then the leader can deploy.";
  $("#invite-button").disabled = !connected;
  $("#invite-button").innerHTML = icon("plus") + (mode.max === 1 ? " PLAY WITH A FRIEND" : " INVITE A FRIEND") + '<span>↗</span>';
  $("#practice-button").hidden = !!party;
  $$("[data-mode]").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.mode === (party?.mode || selectedMode) ? "true" : "false");
    b.disabled = !!party && (!isLeader || party.state !== "lobby");
  });
}
function showLobby() {
  if (document.body.classList.contains("playing")) {
    $("#modal").close();
    snapshot = null;
    resultId = null;
    keys.clear();
    shooting = false;
    resetTouch();
  }
  document.body.classList.remove("playing");
  $("#app").hidden = false;
  $("#game-hud").hidden = true;
  $("#touch-controls").hidden = true;
  scene?.setMode("lobby", profile?.id);
  if (tab === "inventory") renderTab();
}
function showMatch() {
  if (!document.body.classList.contains("playing")) {
    $("#modal").close();
    previousHp = 100;
    keys.clear();
    shooting = false;
  }
  document.body.classList.add("playing");
  $("#app").hidden = true;
  $("#game-hud").hidden = false;
  $("#touch-controls").hidden = !touchDevice;
  if (touchDevice && !touchHintShown) {
    touchHintShown = true;
    const hint = $("#touch-tip");
    hint.hidden = localStorage.getItem("hollow-touch-seen") === "yes";
    if (!hint.hidden) setTimeout(() => { hint.hidden = true; }, 8500);
  }
  scene?.setMode("match", profile?.id);
}
function selectTab(next) {
  tab = next;
  document.body.classList.remove(
    "locker-open",
    "inventory-open",
    "season-open",
    "settings-open",
  );
  if (next !== "play") document.body.classList.add(next + "-open");
  $$(".tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === next);
    el.setAttribute("aria-current", el.dataset.tab === next ? "page" : "false");
  });
  $("#play-panel").hidden = next !== "play";
  $("#secondary-panel").hidden = next === "play";
  if (next !== "play") renderTab();
  else renderProfile();
}
function renderTab() {
  const el = $("#secondary-panel");
  if (tab === "locker") {
    renderLocker(el, profile, {
      preview: c => { previewSkin = c.id; scene?.preview(c.id); $("#outfit-label").textContent = c.name.toUpperCase(); },
      equip: c => send("outfit", { outfit: c.id }),
      buy: c => { if (!buyingSkin) { buyingSkin = true; send("buy", { cosmetic: c.id }); } },
      crates: () => selectTab("crates")
    }, previewSkin);
  } else if (tab === "crates") {
    renderCrates(el, profile, openCrate);
    renderProfile();
  } else if (tab === "inventory") {
    el.innerHTML = `<div class="eyebrow">FIELD EQUIPMENT / LOADOUT</div><h1>PACK LIGHT.<br>HIT HARD<span>.</span></h1><p class="section-intro">Your gear is found in Blackwood.<br>Every deployment starts with a clean slate.</p>${inventoryHTML()}<p class="panel-caption">Body armour absorbs 35% of damage. A helmet adds 15%. Backpacks increase carrying capacity. Outfits have no combat stats.</p>`;
    bindInventory();
    renderProfile();
  } else if (tab === "season") {
    renderSeason(el);
    renderProfile();
  } else if (tab === "settings") {
    el.innerHTML = `<div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>YOUR GAME.<br>YOUR RULES<span>.</span></h1><p class="section-intro">Fine-tune your time in the dead zone.</p>${settingsHTML()}<button class="panel-action" id="rename-button">EDIT GUEST NAME</button><div class="guest-warning">Your guest credential is saved in this browser. Clearing browser data loses access to your progress. Account linking is not available in this version.</div><button class="panel-action" id="reset-guest">CREATE A NEW GUEST</button>`;
    bindSettings();
    $("#rename-button").onclick = profileDialog;
    $("#reset-guest").onclick = () => {
      openDialog(
        `<div class="eyebrow">GUEST IDENTITY</div><h2>START OVER?</h2><p>Your existing progress will stay in the database, but you will lose access from this browser. Account recovery is not implemented.</p><button class="ready-button" id="confirm-reset">CREATE NEW GUEST</button>`,
      );
      $("#confirm-reset").onclick = () => {
        localStorage.removeItem("hollow-guest");
        location.href = "/";
      };
    };
    renderProfile();
  }
}
function renderSeason(el) {
  const xp = profile?.xp || 0;
  el.innerHTML = `<div class="eyebrow">SEASON 01 / AFTER THE FALL</div><h1>LEAVE YOUR<br>MARK<span>.</span></h1><p class="section-intro">Play Solo, Duo or Squad.<br>Come back with something to show for it.</p>
    <div class="season-summary"><div>${icon("star")}<b>${xp}</b><small>SEASON XP</small></div><div>${icon("coin")}<b>${profile.coins}</b><small>COINS</small></div><div>${icon("box")}<b>${profile.crates}</b><small>CRATES</small></div></div>
    <div class="progress-bar"><i style="width:${Math.min(100, xp / 6)}%"></i></div><p class="field-label">${xp} XP EARNED · FREE COSMETIC TRACK</p>
    ${COSMETICS.filter(c => Number.isFinite(c.xp)).map(c => `<div class="reward-row"><span class="track-symbol" style="color:${c.color}">${icon(c.symbol)}</span><div><strong>${c.name}</strong><small>${c.xp} XP · OUTFIT + WEAPON FINISH</small></div><span>${profile.owned.includes(c.id) ? "✓ UNLOCKED" : "LOCKED"}</span></div>`).join("")}
    <button class="panel-action" id="crate-button">${icon("box")} YOUR SUPPLY CACHE · ${profile.crates} AVAILABLE ↗</button>
    <p class="panel-caption">Finish a match: 30 XP + 25 coins. Each kill: +10 XP +5 coins. Extract: +100 XP +100 coins. Every completed survival match earns a crate. Practice has no rewards.</p>
    <div class="gear-slot"><div><small>PREMIUM TRACK & REAL-MONEY PURCHASES</small><strong>Coming soon</strong></div>${icon("lock")}</div>`;
  $("#crate-button").onclick = () => selectTab("crates");
}
function openCrate() {
  if (openingCrate || !profile?.crates) return;
  openingCrate = true;
  openDialog(`<div class="eyebrow">SUPPLY CASE / AUTHENTICATING</div><h2>WHAT’S INSIDE?</h2><div class="crate-wait">${icon("box")}</div><p>Opening your earned crate on the server…</p>`);
  if (!send("crate")) { openingCrate = false; $("#modal").close(); }
}
function showCrateReward(message) {
  const cosmetic = COSMETICS.find(c => c.id === message.cosmetic);
  openDialog(rewardHTML(message));
  if (cosmetic) {
    scene?.preview(cosmetic.id);
    $("#reward-equip").onclick = () => { send("outfit", { outfit: cosmetic.id }); $("#modal").close(); };
  }
  $("#reward-continue").onclick = () => { $("#modal").close(); if (cosmetic) { previewSkin = cosmetic.id; selectTab("locker"); } };
}
function chooseMode(mode) {
  if (!Object.hasOwn(MODES, mode) || mode === "practice") return;
  pendingSolo = false; pendingPractice = false;
  if (party) { if (party.mode !== mode) send("mode", { mode }); }
  else { selectedMode = mode; localStorage.setItem("hollow-mode", mode); renderParty(); }
}
function deploy() {
  const mode = party?.mode || selectedMode;
  if (mode === "solo") {
    pendingSolo = true;
    if (!party) send("create", { mode: "solo" });
    else if (party.members.find(p => p.id === profile.id)?.ready) { pendingSolo = false; send("start"); }
    else send("ready");
  } else if (!party) send("create", { mode });
  else send("ready");
}
function inventoryHTML() {
  const p = snapshot?.players?.find((p) => p.id === profile?.id),
    gear = p?.gear || {
      helmet: null,
      armour: null,
      backpack: null,
      primary: "pistol",
      secondary: "pistol",
    };
  const titles = {
    helmet: "HELMET",
    armour: "BODY ARMOUR",
    backpack: "BACKPACK",
    primary: "PRIMARY WEAPON",
    secondary: "SECONDARY WEAPON",
  };
  return (
    Object.entries(gear)
      .map(
        ([slot, item]) =>
          `<div class="gear-slot"><div><small>${titles[slot]}</small><strong>${item ? escapeHTML(WEAPONS[item]?.label || item.toUpperCase()) : "EMPTY SLOT"}</strong></div>${p && item && !["primary", "secondary"].includes(slot) ? `<button data-remove="${slot}">REMOVE</button>` : icon("shield")}</div>`,
      )
      .join("") +
    (p
      ? `<p class="field-label">FOUND EQUIPMENT · CLICK TO EQUIP</p><div class="bag-items">${p.bag.map((item) => `<button data-equip="${item}">${escapeHTML(WEAPONS[item]?.label || item.toUpperCase())}</button>`).join("")}</div><p class="panel-caption">Ammo: ${p.ammo} · Medkits: ${p.medkits}<br>Weapons equip to primary. Use 1 / 2 to switch to your sidearm.</p>`
      : '<p class="panel-caption">Collect loot with E during a match, then open inventory with I to equip it.</p>')
  );
}
function bindInventory() {
  document.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        send("action", { action: "equip", slot: b.dataset.remove, item: null });
        setTimeout(refreshInventory, 150);
      }),
  );
  document.querySelectorAll("[data-equip]").forEach(
    (b) =>
      (b.onclick = () => {
        send("action", {
          action: "equip",
          slot: WEAPONS[b.dataset.equip] ? "primary" : b.dataset.equip,
          item: b.dataset.equip,
        });
        setTimeout(refreshInventory, 150);
      }),
  );
}
function refreshInventory() {
  if ($("#modal").open && $("#inventory-live")) {
    $("#inventory-live").innerHTML = inventoryHTML();
    bindInventory();
  }
}
function settingsHTML() {
  return `<div class="setting"><label for="set-sound">Sound effects</label><input id="set-sound" type="checkbox" ${settings.sound ? "checked" : ""}></div><div class="setting"><label for="set-music">Ambient soundtrack</label><input id="set-music" type="checkbox" ${settings.music ? "checked" : ""}></div><div class="setting"><label for="set-volume">Volume</label><input id="set-volume" type="range" min="0" max="1" step=".05" value="${settings.volume}"></div><div class="setting"><label for="set-glow">Outfit glow</label><input id="set-glow" type="checkbox" ${settings.glow ? "checked" : ""}></div><div class="setting"><label for="set-motion">Reduced motion</label><input id="set-motion" type="checkbox" ${settings.motion ? "checked" : ""}></div><div class="setting"><label for="set-quality">Graphics quality</label><select id="set-quality"><option value="high" ${settings.quality === "high" ? "selected" : ""}>High</option><option value="low" ${settings.quality === "low" ? "selected" : ""}>Performance</option></select></div>`;
}
function bindSettings() {
  ["sound", "music", "volume", "glow", "motion", "quality"].forEach(
    (key) =>
      ($("#set-" + key).onchange = (e) => {
        settings[key] = ["volume", "quality"].includes(key)
          ? key === "volume"
            ? Number(e.target.value)
            : e.target.value
          : e.target.checked;
        saveSettings();
        if (key === "glow" && scene) {
          const prev = scene.previewOutfit;
          scene.previewOutfit = null;
          scene.preview(prev);
          for (const entity of scene.entities.values()) {
            if (entity.userData.outfit) entity.userData.outfit = null;
          }
        }
        if (key === "quality" && scene) {
          scene.renderer.setPixelRatio(
            Math.min(devicePixelRatio, settings.quality === "low" ? 1 : 1.7),
          );
          scene.renderer.shadowMap.enabled = settings.quality !== "low";
          scene.resize();
        }
      }),
  );
}
function saveSettings() {
  localStorage.setItem("hollow-settings", JSON.stringify(settings));
  $("#audio-button span").textContent = settings.sound
    ? "SOUND ON"
    : "SOUND OFF";
  updateMusic();
}
function openDialog(html) {
  resetTouch();
  keys.clear();
  shooting = false;
  $("#modal-content").innerHTML = html;
  if (!$("#modal").open) $("#modal").showModal();
}
function profileDialog() {
  openDialog(
    `<div class="eyebrow">STILL HERE. STILL YOU.</div><h2>CALL SIGN.</h2><p>This is how your squad will know you.</p><form id="name-form"><label class="field-label" for="guest-name">DISPLAY NAME</label><input id="guest-name" type="text" maxlength="20" required value="${escapeHTML(profile?.name || "")}"><button class="ready-button" type="submit">SAVE CALL SIGN ${icon("arrow")}</button></form><p class="panel-caption">Guest progress is tied to this browser’s credential. Clearing it loses access. Account linking is coming later.</p>`,
  );
  $("#name-form").onsubmit = (e) => {
    e.preventDefault();
    send("name", { name: $("#guest-name").value });
    $("#modal").close();
  };
}
function inviteDialog() {
  if (!party || MODES[party.mode].max === 1) {
    pendingInvite = true;
    pendingSolo = false;
    if (party) send("mode", { mode: "duo" });
    else send("create", { mode: selectedMode === "solo" ? "duo" : selectedMode });
    return;
  }
  openDialog(
    `<div class="eyebrow">PRIVATE SQUAD / FRIENDS ONLY</div><h2>DON’T GO ALONE.</h2><p>Anyone with this private code or link can join. Share it only with your squad. Up to four survivors.</p><div class="invite-code">${escapeHTML(party.code)}</div><div class="dialog-actions"><button class="outline-button" id="copy-invite">COPY INVITE LINK</button><button class="outline-button" id="copy-code">COPY CODE</button></div><form id="join-form"><label class="field-label" for="room-code">HAVE AN INVITE? JOIN ANOTHER SQUAD</label><input id="room-code" type="text" minlength="12" maxlength="12" placeholder="12-character room code" required autocomplete="off"><button class="ready-button" type="submit">JOIN SQUAD ${icon("arrow")}</button></form><button class="panel-action" id="leave-party">LEAVE CURRENT PARTY</button>`,
  );
  $("#copy-invite").onclick = () =>
    copy(`${location.origin}/?invite=${party.code}`);
  $("#copy-code").onclick = () => copy(party.code);
  $("#join-form").onsubmit = (e) => {
    e.preventDefault();
    send("join", { code: $("#room-code").value });
    $("#modal").close();
  };
  $("#leave-party").onclick = () => {
    send("leave");
    $("#modal").close();
  };
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Your squad is one link away.");
  } catch {
    toast("Clipboard unavailable. Select and copy the room code above.", true);
  }
}
function controls() {
  openDialog(
    `<div class="eyebrow">SURVIVAL FIELD MANUAL / 001</div><h2>KNOW YOUR WAY OUT.</h2><p>Find the purple keycard in town, unlock the military bunker, then head to the green extraction zone. Press E at each objective. Shelter is safe from attacks.</p><div class="controls-grid">${[
      ["WASD", "Move"],
      ["MOUSE", "Aim"],
      ["LMB", "Fire"],
      ["SHIFT", "Sprint"],
      ["E", "Loot / interact"],
      ["R", "Reload"],
      ["Q", "Use medkit"],
      ["1 / 2", "Switch weapon"],
      ["I", "Inventory"],
      ["ESC", "Game menu"],
      ...(touchDevice ? [["LEFT STICK", "Move"], ["RIGHT STICK", "Aim + auto-fire"], ["BUTTONS", "Sprint, use, heal, reload, swap"]] : []),
    ]
      .map(([k, l]) => `<div><kbd>${k}</kbd>${l}</div>`)
      .join(
        "",
      )}</div><p class="panel-caption">On phone, use the twin joysticks and action buttons. On desktop, use keyboard and mouse. Every squad member must extract or be downed to end early. Missing extraction when the timer expires ends the match.</p><button class="ready-button" id="controls-close">GOT IT ${icon("arrow")}</button>`,
  );
  $("#controls-close").onclick = () => $("#modal").close();
}
function mapDialog() {
  openDialog(
    `<div class="eyebrow">BRIEFING / BLACKWOOD</div><h2>WELCOME TO<br>THE DEAD ZONE.</h2><p>A compact quarantine sector. One shelter. One keycard. One way out.</p><div class="map-legend"><div><b>01 / SHELTER</b><small>South-west. Your safe start.</small></div><div><b>02 / TOWN</b><small>Centre and north. Loot and keycard.</small></div><div><b>03 / BUNKER</b><small>North-east. Bring the keycard.</small></div><div><b>04 / EXTRACTION</b><small>South-east. Unlock bunker first.</small></div></div><p>Your minimap marks loot in lime, the keycard in violet, and squad members in white. Buildings block movement and bullets.</p><button class="ready-button" id="map-close">STAY SHARP ${icon("arrow")}</button>`,
  );
  $("#map-close").onclick = () => $("#modal").close();
}
function gameMenu() {
  openDialog(
    `<div class="eyebrow">MATCH CONTINUES WHILE MENU IS OPEN</div><h2>TAKE A BREATH.</h2><button class="panel-action" id="resume-game">BACK TO BLACKWOOD</button><button class="panel-action" id="open-game-inventory">FIELD INVENTORY</button><button class="panel-action" id="open-game-settings">SETTINGS</button><button class="panel-action" id="open-game-controls">CONTROLS</button><button class="panel-action" id="leave-match">LEAVE MATCH</button><p class="panel-caption">Your squad’s timer keeps running. Leaving forfeits unfinished match rewards.</p>`,
  );
  $("#resume-game").onclick = () => $("#modal").close();
  $("#open-game-inventory").onclick = gameInventory;
  $("#open-game-settings").onclick = () => {
    openDialog(
      '<div class="eyebrow">FIELD SETTINGS</div><h2>TUNE IN.</h2>' +
        settingsHTML(),
    );
    bindSettings();
  };
  $("#open-game-controls").onclick = controls;
  $("#leave-match").onclick = () => {
    send("leave");
    $("#modal").close();
  };
}
function gameInventory() {
  openDialog(
    '<div class="eyebrow">FIELD INVENTORY / LIVE MATCH</div><h2>CHECK YOUR GEAR.</h2><div id="inventory-live">' +
      inventoryHTML() +
      '</div><p class="panel-caption">The match continues while this menu is open.</p>',
  );
  bindInventory();
}
function showResults(results) {
  const mine = results.players.find((p) => p.id === profile?.id);
  openDialog(
    `<div class="eyebrow">${results.practice ? "PRACTICE / NO REWARDS" : (MODES[results.mode]?.label || "Squad").toUpperCase() + " / OPERATION COMPLETE"}</div><h2>${mine?.extracted ? "STILL BREATHING." : "THE ZONE REMEMBERS."}</h2><div class="result-stamp">${escapeHTML(results.reason.toUpperCase())}</div><div class="season-summary result-loot"><div>${icon("star")}<b>+${mine?.xp || 0}</b><small>SEASON XP</small></div><div>${icon("coin")}<b>+${mine?.coins || 0}</b><small>COINS EARNED</small></div><div>${icon("box")}<b>+${results.practice ? 0 : 1}</b><small>SUPPLY CRATE</small></div></div>${results.players.map((p) => `<div class="result-player"><span>${escapeHTML(p.name)}</span><span>${p.kills} KILLS</span><span>${p.extracted ? "EXTRACTED" : "LEFT BEHIND"}</span><strong>+${p.xp} XP</strong></div>`).join("")}<p>${results.practice ? "Practice has no permanent rewards. Choose Solo, Duo or Squad to earn coins, XP and crates." : "Coins, XP and your supply crate are saved. Your field equipment stays in Blackwood."}</p><button class="ready-button" id="return-button">RETURN TO LOBBY ${icon("arrow")}</button><p class="panel-caption">Your party returns automatically in 25 seconds.</p>`,
  );
  $("#return-button").onclick = () => send("return");
  sound("reward");
}
function renderHud() {
  const p = snapshot?.players?.find((p) => p.id === profile?.id);
  if (!p) return;
  $("#match-mode").textContent = party?.practice
    ? "BLACKWOOD / SOLO PRACTICE / NO REWARDS"
    : "BLACKWOOD / " + MODES[party?.mode || "squad"].label.toUpperCase() + " SURVIVAL";
  $("#hp-label").textContent = Math.ceil(p.hp);
  $("#hp-bar").style.width = p.hp + "%";
  $("#armour-label").textContent =
    p.gear.armour || p.gear.helmet
      ? `${(p.gear.armour ? 35 : 0) + (p.gear.helmet ? 15 : 0)}% PROTECTION`
      : "NO ARMOUR";
  $("#medkit-label").innerHTML = p.medkits + " MEDKITS <kbd>Q</kbd>";
  $("#weapon-label").textContent = WEAPONS[p.weapon].label.toUpperCase();
  $("#magazine").textContent = p.magazines[p.weapon];
  $("#ammo").textContent = p.ammo;
  $("#reload-label").textContent = p.reloadAt
    ? "RELOADING…"
    : "R RELOAD · 1 / 2 SWITCH";
  if (p.hp < previousHp) {
    $("#damage-flash").style.opacity = ".8";
    setTimeout(() => ($("#damage-flash").style.opacity = "0"), 150);
    sound("hurt");
  }
  previousHp = p.hp;
  const title =
    p.hp <= 0
      ? "YOU ARE DOWN"
      : p.extracted
        ? "EXTRACTED / HOLD FOR SQUAD"
        : snapshot.bunkerOpen
          ? "REACH EXTRACTION"
          : snapshot.keycard
            ? "UNLOCK THE MILITARY BUNKER"
            : "FIND THE BUNKER KEYCARD";
  const hint =
    p.hp <= 0
      ? "Your squad can still make it out."
      : p.extracted
        ? "You made it. Waiting for the other survivors."
        : snapshot.bunkerOpen
          ? "Head south-east. Press E in the green zone."
          : snapshot.keycard
            ? "Head north-east. Press E by the bunker."
            : "Search the town. Keycard marked violet on map.";
  $("#objective strong").textContent = title;
  $("#objective p").textContent = hint;
  $("#team-hud").innerHTML = snapshot.players
    .filter((x) => x.id !== p.id)
    .map(
      (x) =>
        `<div><span>${escapeHTML(x.name)}</span>${!x.connected ? "RECONNECTING" : x.extracted ? "EXTRACTED" : x.hp <= 0 ? "DOWN" : Math.ceil(x.hp) + " HP"}</div>`,
    )
    .join("");
  let prompt = "";
  const loot = snapshot.loot.find(
    (l) => Math.hypot(l.x - p.x, l.z - p.z) < 2.8,
  );
  if (loot)
    prompt =
      "COLLECT " + (WEAPONS[loot.item]?.label || loot.item).toUpperCase();
  else if (
    snapshot.keycard &&
    !snapshot.bunkerOpen &&
    Math.hypot(p.x - WORLD.bunker.x, p.z - WORLD.bunker.z) < WORLD.bunker.radius
  )
    prompt = "UNLOCK BUNKER";
  else if (
    snapshot.bunkerOpen &&
    Math.hypot(p.x - WORLD.extraction.x, p.z - WORLD.extraction.z) <
      WORLD.extraction.radius
  )
    prompt = "EXTRACT NOW";
  $("#interact-prompt").hidden = !prompt || p.hp <= 0 || p.extracted;
  $("#touch-interact").classList.toggle("available", !!prompt && p.hp > 0 && !p.extracted);
  $("#touch-heal").disabled = p.medkits <= 0 || p.hp <= 0 || p.hp >= 100;
  $("#interact-prompt span").textContent = prompt;
  for (const effect of snapshot.effects || [])
    if (effect.id > lastEffect) {
      if (effect.player === profile.id)
        sound(effect.kind === "hit" ? "hit" : "shot");
      if (effect.kind === "extract") sound("reward");
      lastEffect = effect.id;
    }
  drawMinimap();
}
function drawMinimap() {
  const ctx = $("#minimap").getContext("2d"),
    scale = 180 / 72,
    to = (v) => (v + 36) * scale;
  ctx.clearRect(0, 0, 180, 180);
  ctx.fillStyle = "#142319";
  ctx.fillRect(0, 0, 180, 180);
  ctx.strokeStyle = "#31452c";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 180; i += 15) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 180);
    ctx.moveTo(0, i);
    ctx.lineTo(180, i);
    ctx.stroke();
  }
  ctx.fillStyle = "#566044";
  for (const b of WORLD.buildings)
    ctx.fillRect(
      to(b.x - b.w / 2),
      to(b.z - b.d / 2),
      b.w * scale,
      b.d * scale,
    );
  for (const [pos, c] of [
    [WORLD.shelter, "#87b56a"],
    [WORLD.bunker, "#af86ed"],
    [WORLD.extraction, "#c4f568"],
  ]) {
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(to(pos.x), to(pos.z), pos.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const l of snapshot.loot) {
    ctx.fillStyle = l.item === "keycard" ? "#c4a2ff" : "#9cbb5a";
    ctx.fillRect(to(l.x) - 1.5, to(l.z) - 1.5, 3, 3);
  }
  for (const z of snapshot.zombies) {
    ctx.fillStyle = "#a07858";
    ctx.fillRect(to(z.x) - 1, to(z.z) - 1, 2, 2);
  }
  for (const p of snapshot.players) {
    ctx.fillStyle = p.id === profile.id ? "#c4f568" : "#f2f4e6";
    ctx.beginPath();
    ctx.arc(to(p.x), to(p.z), p.hp > 0 ? 3 : 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#a1b491";
  ctx.font = "7px monospace";
  ctx.fillText("N ↑", 8, 12);
}
setInterval(() => {
  if (connected) {
    clockPing = Date.now();
    send("ping", { sent: clockPing });
  }
}, 5000);
setInterval(() => {
  if (snapshot?.state === "match") {
    const seconds = Math.max(
      0,
      Math.ceil((snapshot.endsAt - Date.now() - offset) / 1000),
    );
    $("#timer").textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    $(".timer-box").classList.toggle("warning", seconds <= 300);
  }
}, 100);
setInterval(() => {
  if (
    !document.body.classList.contains("playing") ||
    snapshot?.state !== "match" ||
    !connected
  )
    return;
  const blocked = $("#modal").open;
  send("input", {
    input: {
      x: blocked ? 0 : Math.max(-1, Math.min(1, touch.moveX + (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0))),
      z: blocked ? 0 : Math.max(-1, Math.min(1, touch.moveZ + (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0))),
      aim: scene?.aim() || 0,
      shoot: !blocked && (shooting || touch.firing),
      sprint: !blocked && (keys.has("shift") || touch.sprinting),
    },
  });
}, 50);
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === "escape") {
    if ($("#modal").open) return;
    if (document.body.classList.contains("playing")) gameMenu();
    return;
  }
  if (key === "?" && !e.repeat) {
    controls();
    return;
  }
  if (!document.body.classList.contains("playing") || $("#modal").open) return;
  if (
    ["w", "a", "s", "d", " ", "shift", "i", "e", "q", "r", "1", "2"].includes(
      key,
    )
  )
    e.preventDefault();
  keys.add(key);
  if (e.repeat) return;
  if (key === "i") gameInventory();
  if (["e", "q", "r", "1", "2"].includes(key))
    send("action", {
      action: { e: "interact", q: "heal", r: "reload", 1: "swap", 2: "swap" }[
        key
      ],
    });
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  keys.clear();
  shooting = false;
  resetTouch();
});
setupTouch();
$("#scene").addEventListener("pointerdown", (e) => {
  if (
    e.button === 0 &&
    e.pointerType === "mouse" &&
    document.body.classList.contains("playing") &&
    !$("#modal").open
  ) {
    shooting = true;
    initAudio();
  }
});
window.addEventListener("pointerup", (event) => { if (event.pointerType === "mouse") shooting = false; });
window.addEventListener("contextmenu", (e) => {
  if (document.body.classList.contains("playing")) e.preventDefault();
});
$$("[data-tab]").forEach((b) => (b.onclick = () => selectTab(b.dataset.tab)));
$$("[data-open]").forEach((b) => (b.onclick = () => selectTab(b.dataset.open)));
$("#invite-button").onclick = inviteDialog;
$("#ready-button").onclick = deploy;
$("#coins-button").onclick = () => selectTab("locker");
$("#crates-button").onclick = () => selectTab("crates");
$$("[data-mode]").forEach(b => b.onclick = () => chooseMode(b.dataset.mode));
$("#start-button").onclick = () => send("start");
$("#practice-button").onclick = () => {
  pendingSolo = false;
  pendingPractice = true;
  send("create", { practice: true });
};
$("#profile-button").onclick = profileDialog;
$("#controls-button").onclick = controls;
$("#help-button").onclick = controls;
$("#map-button").onclick = mapDialog;
$("#game-menu").onclick = gameMenu;
$(".close-modal").onclick = () => $("#modal").close();
$("#modal").addEventListener("close", () => { if (!document.body.classList.contains("playing")) renderProfile(); });
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("#modal").close();
  }
});
$("#loading-retry").onclick = () => {
  if (ws?.readyState === 1 && !profile) {
    openDialog(
      '<h2>GUEST CREDENTIAL.</h2><p>The server did not recognize this browser’s guest credential. If the server database was reset, create a new guest to continue.</p><button class="ready-button" id="retry-guest">CREATE NEW GUEST</button>',
    );
    $("#modal").style.zIndex = 101;
    $("#retry-guest").onclick = () => {
      localStorage.removeItem("hollow-guest");
      location.reload();
    };
  } else connect();
};
let audio,
  drone = [];
function initAudio() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audio.state === "suspended") audio.resume();
}
function sound(kind) {
  if (!settings.sound) return;
  try {
    initAudio();
    const o = audio.createOscillator(),
      gain = audio.createGain(),
      now = audio.currentTime;
    const tones = {
      shot: [130, 35, 0.07, "sawtooth"],
      hit: [800, 250, 0.055, "square"],
      hurt: [100, 40, 0.16, "triangle"],
      reward: [440, 880, 0.5, "sine"],
    };
    const [a, b, d, type] = tones[kind] || tones.shot;
    o.type = type;
    o.frequency.setValueAtTime(a, now);
    o.frequency.exponentialRampToValueAtTime(b, now + d);
    gain.gain.setValueAtTime(settings.volume * 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + d);
    o.connect(gain).connect(audio.destination);
    o.start();
    o.stop(now + d);
  } catch {}
}
function updateMusic() {
  try {
    drone.forEach((d) => {
      d.osc.stop();
      d.gain.disconnect();
    });
    drone = [];
    if (!settings.music) return;
    initAudio();
    [55, 82.41, 110.2].forEach((frequency, i) => {
      const osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.value = (settings.volume * 0.035) / (i + 1);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      drone.push({ osc, gain });
    });
  } catch {}
}
$("#audio-button").onclick = () => {
  settings.sound = !settings.sound;
  saveSettings();
  if (settings.sound) sound("reward");
};
document.addEventListener(
  "pointerdown",
  () => {
    if (settings.sound || settings.music) {
      initAudio();
      if (settings.music && !drone.length) updateMusic();
    }
  },
  { once: true },
);
async function boot() {
  let stage = "server";
  try {
    loading(5, "Checking multiplayer server");
    await checkGameServer();
    connect();
    stage = "assets";
    loading(10, "Loading original 3D assets");
    const { GameScene } = await import("./scene.js");
    stage = "scene";
    loading(25, "Initializing 3D renderer");
    scene = new GameScene($("#scene"), settings, loading);
    scene.onError = (message) => toast(message, true);
    await scene.ready();
    ready3d = true;
    loading(90, "Connecting to survival server");
    if (profile) {
      renderProfile();
      if (snapshot?.state === "match") {
        scene.setMode("match", profile.id);
        scene.snapshot(snapshot, profile.id);
      }
    }
    dismissLoading();
  } catch (e) {
    console.error(e);
    const serverError = stage === "server";
    const graphicsError = e.code === "GRAPHICS_UNAVAILABLE";
    loading(
      0,
      serverError
        ? "Game server required"
        : graphicsError
          ? "This browser could not start 3D graphics"
          : stage === "assets"
            ? "Game assets could not be loaded"
            : "Game initialization failed",
    );
    const help = $("#loading-help");
    help.hidden = false;
    help.textContent = serverError
      ? "Live Server and static previews cannot run this game. Start Start-HOLLOW.cmd (or run npm.cmd start), then open the game server on port 3000."
      : graphicsError
        ? "Open the game in a browser with WebGL 2 support, such as Chrome or Edge. A graphics context could not be created, even with anti-aliasing disabled."
        : stage === "assets"
          ? "A game module failed to load. Run npm.cmd ci, restart the Node game server, and reload this page."
          : "The game reported an error during startup. The technical details below show the actual cause.";
    if (
      serverError &&
      ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    ) {
      const url = new URL(location.href);
      url.port = "3000";
      url.pathname = "/";
      $("#loading-open").href = url.href;
      $("#loading-open").hidden = false;
    }
    $("#loading-error").textContent =
      `${e.name || "Error"}: ${e.message || String(e)}`;
    $("#loading-details").hidden = false;
    $("#loading-retry").hidden = false;
    $("#loading-retry").textContent = "Reload game";
    $("#loading-retry").onclick = () => location.reload();
  }
  saveSettings();
}
async function checkGameServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      throw new Error(
        "This URL does not serve the HOLLOW//30 multiplayer backend. Static Live Server previews do not provide /api/health, /vendor, or /socket.",
      );
    }
    const health = await response.json();
    if (
      health.status !== "ok" ||
      !Number.isFinite(health.duration) ||
      !Number.isFinite(health.rooms)
    ) {
      throw new Error(
        "The server returned an unexpected health response. Open the Node game server instead of a static preview.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
boot();
