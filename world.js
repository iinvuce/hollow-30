export const WORLD = {
  size: 70,
  shelter: { x: -24, z: 23, radius: 6 },
  bunker: { x: 23, z: -21, radius: 7 },
  extraction: { x: 25, z: 24, radius: 4 },
  buildings: [
    { x: -20, z: -17, w: 12, d: 9, h: 6, name: "PHARMACY" },
    { x: -3, z: -22, w: 9, d: 12, h: 8, name: "BLOCK 03" },
    { x: -19, z: 1, w: 9, d: 10, h: 5, name: "SUPPLIES" },
    { x: 4, z: 4, w: 11, d: 8, h: 6, name: "NO SIGNAL" },
    { x: 22, z: 1, w: 8, d: 11, h: 4, name: "DEPOT" },
  ],
};
export const BUNKER_WALLS = [
  { x: 17, z: -21, w: 0.6, d: 10 },
  { x: 29, z: -21, w: 0.6, d: 10 },
  { x: 23, z: -26, w: 12, d: 0.6 },
  { x: 18.75, z: -16, w: 3.5, d: 0.6 },
  { x: 27.25, z: -16, w: 3.5, d: 0.6 },
];
export const WEAPONS = {
  pistol: {
    label: "P12 Sidearm",
    damage: 26,
    interval: 320,
    mag: 12,
    range: 24,
    reload: 1200,
  },
  rifle: {
    label: "AR-30 Carbine",
    damage: 22,
    interval: 130,
    mag: 30,
    range: 32,
    reload: 1800,
  },
  shotgun: {
    label: "Breach-6",
    damage: 72,
    interval: 800,
    mag: 6,
    range: 12,
    reload: 2000,
  },
};
export const COSMETICS = [
  {
    id: "survivor",
    name: "Field operative",
    tag: "STANDARD ISSUE",
    color: "#929b71",
    xp: 0,
    rarity: "Common",
    price: 0,
    weight: 0,
    symbol: "shield",
  },
  {
    id: "hazmat",
    name: "Toxic protocol",
    tag: "NEON HAZMAT",
    color: "#c1f84a",
    xp: 100,
    rarity: "Rare",
    price: 100,
    weight: 35,
    symbol: "bio",
  },
  {
    id: "galaxy",
    name: "Event horizon",
    tag: "ANIMATED GALAXY",
    color: "#a486ff",
    xp: 300,
    rarity: "Epic",
    price: 500,
    weight: 25,
    symbol: "star",
  },
  {
    id: "skeleton",
    name: "Afterlife",
    tag: "GLOWING SKELETON",
    color: "#b8ffe4",
    xp: 600,
    rarity: "Legendary",
    price: 900,
    weight: 10,
    symbol: "skull",
  },
  { id: "ember", name: "Cinder unit", tag: "EMBER RESPONSE", color: "#f4a15b", xp: null, rarity: "Rare", price: 400, weight: 15, symbol: "flame" },
  { id: "spectre", name: "Ghost circuit", tag: "PHANTOM NETWORK", color: "#75e9ea", xp: null, rarity: "Epic", price: 700, weight: 10, symbol: "bolt" },
  { id: "ronin", name: "Crimson echo", tag: "LAST TRANSMISSION", color: "#ef6e86", xp: null, rarity: "Legendary", price: 1000, weight: 5, symbol: "blade" },
];
export const MODES = {
  solo: { label: "Solo", min: 1, max: 1, symbol: "solo", description: "One survivor. Your own way out." },
  duo: { label: "Duo", min: 2, max: 2, symbol: "users", description: "Two survivors. Watch each other’s six." },
  squad: { label: "Squad", min: 2, max: 4, symbol: "squad", description: "Two to four. Better odds together." },
  practice: { label: "Practice", min: 1, max: 1, symbol: "target", description: "Learn the zone. No progress rewards." },
};
export function blocked(x, z, radius = 0.45) {
  return (
    Math.abs(x) > 34 ||
    Math.abs(z) > 34 ||
    [...WORLD.buildings, ...BUNKER_WALLS].some(
      (b) =>
        Math.abs(x - b.x) < b.w / 2 + radius &&
        Math.abs(z - b.z) < b.d / 2 + radius,
    )
  );
}
export function visible(a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  for (let t = 0.4; t < d; t += 0.4)
    if (blocked(a.x + ((b.x - a.x) * t) / d, a.z + ((b.z - a.z) * t) / d, 0))
      return false;
  return true;
}
