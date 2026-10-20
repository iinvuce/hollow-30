import * as T from "three";
import { WORLD, COSMETICS, BUNKER_WALLS } from "./shared/world.js";
const mats = new Map();
function material(color, options = {}) {
  const key = color + JSON.stringify(options);
  if (!mats.has(key))
    mats.set(
      key,
      new T.MeshStandardMaterial({ color, roughness: 0.75, ...options }),
    );
  return mats.get(key);
}
function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(parent, x, y, z, w, h, d, color, options = {}) {
  return mesh(
    new T.BoxGeometry(w, h, d),
    material(color, options),
    parent,
    x,
    y,
    z,
  );
}
function sphere(parent, x, y, z, r, color, options = {}) {
  return mesh(
    new T.SphereGeometry(r, 16, 12),
    material(color, options),
    parent,
    x,
    y,
    z,
  );
}
function cylinder(parent, x, y, z, r1, r2, h, color, n = 32, options = {}) {
  return mesh(
    new T.CylinderGeometry(r1, r2, h, n),
    material(color, options),
    parent,
    x,
    y,
    z,
  );
}
function label(text, fg = "#c0d99e", bg = "#17251b", w = 512, h = 128) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `bold ${Math.floor(h * 0.55)}px 'Arial Narrow', Arial`;
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2, w * 0.9);
  return new T.CanvasTexture(c);
}
function sign(
  parent,
  text,
  x,
  y,
  z,
  w = 3,
  h = 0.7,
  fg = "#b9d299",
  bg = "#1b2b20",
) {
  return mesh(
    new T.PlaneGeometry(w, h),
    new T.MeshBasicMaterial({ map: label(text, fg, bg), side: T.DoubleSide }),
    parent,
    x,
    y,
    z,
  );
}
function glow(parent, x, y, z, color, intensity = 3, range = 8) {
  const light = new T.PointLight(color, intensity, range, 2);
  light.position.set(x, y, z);
  parent.add(light);
  return light;
}
function groundTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#29352c";
  ctx.fillRect(0, 0, 512, 512);
  let seed = 61;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 28000; i++) {
    const n = 30 + rand() * 40;
    ctx.fillStyle = `rgba(${n},${n + 10},${n},${rand() * 0.25})`;
    ctx.fillRect(rand() * 512, rand() * 512, rand() * 4 + 1, rand() * 3 + 1);
  }
  ctx.strokeStyle = "#090f0c66";
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(512, i * 64);
    ctx.stroke();
    for (let j = 0; j < 6; j++) {
      ctx.strokeRect(j * 96 + (i % 2 ? 48 : 0), i * 64, 96, 64);
    }
  }
  const texture = new T.CanvasTexture(c);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "#a2b59970");
  g.addColorStop(0.3, "#829b8160");
  g.addColorStop(0.7, "#627c6a18");
  g.addColorStop(1, "#627c6a00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(c);
}
function createGameRenderer(quality) {
  let cause;
  for (const antialias of quality === "low" ? [false] : [true, false]) {
    try {
      const canvas = document.createElement("canvas");
      // Let the browser choose its GPU, and retry without multisampling.
      const context = canvas.getContext("webgl2", {
        antialias,
        alpha: false,
        powerPreference: "default",
      });
      if (context) return new T.WebGLRenderer({ canvas, context, antialias });
    } catch (error) {
      cause = error;
    }
  }
  const error = new Error(
    "No WebGL 2 context was available from this browser.",
    { cause },
  );
  error.code = "GRAPHICS_UNAVAILABLE";
  throw error;
}
export class GameScene {
  constructor(container, settings, onProgress) {
    this.settings = settings;
    this.mode = "lobby";
    this.playerId = null;
    this.previewOutfit = "survivor";
    this.touchAimAngle = null;
    this.rotation = 0.12;
    this.entities = new Map();
    this.lootEntities = new Map();
    this.effects = [];
    this.lastEffect = 0;
    this.onError = null;
    this.renderer = createGameRenderer(settings.quality);
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, settings.quality === "low" ? 1 : matchMedia("(pointer: coarse)").matches ? 1.25 : 1.7),
    );
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = settings.quality !== "low";
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#293a2b");
    this.scene.fog = new T.FogExp2("#293a2b", 0.043);
    this.camera = new T.PerspectiveCamera(
      innerWidth < 580 ? 40 : 35,
      innerWidth / innerHeight,
      0.1,
      180,
    );
    this.camera.position.set(6, 4.5, 13);
    this.target = new T.Vector3(0, 2.1, 0);
    this.camera.lookAt(this.target);
    this.scene.add(new T.HemisphereLight("#c6d9b3", "#151d1a", 2));
    const sun = new T.DirectionalLight("#d5dfae", 2.7);
    sun.position.set(-8, 15, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
    });
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    const rim = new T.DirectionalLight("#b5f77c", 2.8);
    rim.position.set(-5, 4, -6);
    this.scene.add(rim);
    const violet = new T.DirectionalLight("#ab9ff5", 1.5);
    violet.position.set(5, 4, 2);
    this.scene.add(violet);
    this.lobbyGroup = new T.Group();
    this.scene.add(this.lobbyGroup);
    this.gameGroup = new T.Group();
    this.gameGroup.visible = false;
    this.scene.add(this.gameGroup);
    this.makeLobby();
    onProgress(45, "Building Blackwood");
    this.makeMap();
    onProgress(70, "Preparing survivor");
    this.hero = createCharacter("survivor", settings.glow);
    this.lobbyGroup.add(this.hero);
    this.hero.position.set(0.3, 0.1, 0);
    this.hero.rotation.y = 0.12;
    this.raycaster = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    this.aimPoint = new T.Vector3();
    this.drag = false;
    this.dragX = 0;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.mode === "lobby") {
        this.drag = true;
        this.dragX = e.clientX;
      }
    });
    window.addEventListener("pointerup", () => (this.drag = false));
    window.addEventListener("pointermove", (e) => {
      this.pointer.set(
        (e.clientX / innerWidth) * 2 - 1,
        (-e.clientY / innerHeight) * 2 + 1,
      );
      if (this.drag && this.mode === "lobby") {
        this.rotation += (e.clientX - this.dragX) * 0.01;
        this.dragX = e.clientX;
      }
    });
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.onError?.(
        "3D graphics paused. Reload the page to restore the scene.",
      );
    });
    this.clock = new T.Clock();
    this.loop();
  }
  async ready() {
    await this.renderer.compileAsync(this.scene, this.camera);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.fov = this.mode === "lobby" ? (innerWidth < 580 ? 40 : 35) : (innerHeight > innerWidth && matchMedia("(pointer: coarse)").matches ? 59 : 47);
    this.camera.updateProjectionMatrix();
  }
  makeLobby() {
    const g = this.lobbyGroup;
    const floor = mesh(
      new T.PlaneGeometry(160, 160),
      new T.MeshStandardMaterial({
        map: groundTexture(),
        roughness: 0.53,
        metalness: 0.24,
      }),
      g,
      0,
      -0.12,
      0,
    );
    floor.rotation.x = -Math.PI / 2;
    cylinder(g, 0.3, -0.04, 0, 2.5, 2.75, 0.16, "#354135", 96);
    cylinder(g, 0.3, 0.045, 0, 2.35, 2.35, 0.08, "#26312a", 96, {
      roughness: 0.45,
      metalness: 0.45,
    });
    const ring = mesh(
      new T.TorusGeometry(2.42, 0.017, 8, 128),
      material("#b5e86a", { emissive: "#b5e86a", emissiveIntensity: 1.5 }),
      g,
      0.3,
      0.07,
      0,
    );
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const dash = box(
        g,
        0.3 + Math.cos(a) * 2.18,
        0.095,
        Math.sin(a) * 2.18,
        0.025,
        0.012,
        0.16,
        "#72865d",
      );
      dash.rotation.y = -a + Math.PI / 2;
    }
    for (let i = 0; i < 7; i++) {
      const line = box(
        g,
        -4 + i * 0.35,
        -0.1,
        4.5,
        0.13,
        0.012,
        4,
        "#8e965452",
      );
      line.rotation.y = 0.1;
    }
    glow(g, 0, 0.3, 0, "#bbff68", 2.5, 5);
    glow(g, 5, 2, -5, "#ab83ff", 10, 15);
    this.container(g, -8, 1.4, -7, 7, 2.8, 3, "#3f5140", "DOVY / 07");
    this.container(g, 7, 1.5, -11, 6, 3, 3, "#3b453f", "RESTRICTED");
    this.container(g, 9, 4.4, -12, 6, 2.8, 3, "#3f4d42", "KEEP OUT");
    box(g, -12, 2.5, -15, 9, 5, 8, "#3f4d3e");
    const roof = box(g, -12, 5.15, -15, 10, 0.3, 9, "#273b30");
    roof.rotation.z = 0.05;
    sign(g, "QUARANTINE", -11, 3.8, -10.95, 6, 1, "#b8bf82", "#26352a");
    sign(
      g,
      "BLACKWOOD // SECTOR 07",
      -11,
      2.6,
      -10.94,
      6,
      0.45,
      "#7c946c",
      "#26352a",
    );
    for (let i = 0; i < 4; i++) {
      box(g, -15 + i * 2, 1.5, -10.94, 1.1, 1.4, 0.07, "#111d18");
      box(g, -15 + i * 2, 1.5, -10.85, 0.04, 1.4, 0.06, "#6c7d5f");
    }
    for (const [x, z] of [
      [-5, -10],
      [5, -8],
      [12, -16],
      [-17, -6],
    ]) {
      box(g, x, 4, z, 0.13, 8, 0.13, "#263b2a");
      box(g, x, 8, z, 3, 0.12, 0.12, "#3f4f36");
      for (let a = -1; a <= 1; a++) {
        cylinder(g, x + a, 8.25, z, 0.07, 0.07, 0.35, "#718568");
        const pts = [];
        for (let j = 0; j <= 20; j++)
          pts.push(
            new T.Vector3(
              x + a + j * 0.45,
              8.4 - Math.sin((j / 20) * Math.PI) * 1.1,
              z,
            ),
          );
        g.add(
          new T.Line(
            new T.BufferGeometry().setFromPoints(pts),
            new T.LineBasicMaterial({ color: "#1b2d21" }),
          ),
        );
      }
    }
    this.watchtower(g, 13, -19);
    this.fence(g, -1, -18, 15);
    this.fence(g, -20, -7, 8);
    for (let i = 0; i < 10; i++) {
      const x = -9 + (i % 5) * 0.8,
        z = 2 + Math.floor(i / 5) * 0.8;
      box(g, x, 0.28, z, 0.65, 0.55, 0.65, "#43533d");
      box(g, x, 0.57, z, 0.67, 0.035, 0.67, "#76815a");
      box(g, x, 0.28, z + 0.33, 0.05, 0.55, 0.02, "#1d2d22");
    }
    const moon = mesh(
      new T.SphereGeometry(5, 32, 24),
      new T.MeshBasicMaterial({ color: "#c7d49b" }),
      g,
      -18,
      20,
      -65,
    );
    moon.castShadow = false;
    for (let i = 0; i < 30; i++) {
      const x = Math.sin(i * 47) * 50,
        z = -26 - Math.abs(Math.cos(i * 13) * 40),
        h = 8 + Math.sin(i) * 3;
      box(g, x, h / 2, z, 1.2, h, 1.2, "#263b2b");
      const tree = mesh(
        new T.ConeGeometry(3.5, h, 6),
        material("#243c2b"),
        g,
        x,
        h,
        z,
      );
      tree.rotation.y = i;
    }
    const cloud = cloudTexture();
    this.fogSprites = [];
    for (let i = 0; i < 24; i++) {
      const sprite = new T.Sprite(
        new T.SpriteMaterial({
          map: cloud,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          color: i % 2 ? "#abc7a4" : "#b3baca",
        }),
      );
      sprite.position.set(
        Math.sin(i * 8) * 15,
        0.3 + (i % 5) * 0.25,
        -10 + Math.cos(i * 7) * 13,
      );
      sprite.scale.set(12 + (i % 5), 3, 1);
      g.add(sprite);
      this.fogSprites.push(sprite);
    }
    const pts = [];
    for (let i = 0; i < 450; i++)
      pts.push(
        Math.sin(i * 93) * 25,
        Math.abs(Math.cos(i * 77)) * 16,
        Math.sin(i * 32) * 20,
      );
    this.dust = new T.Points(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute(pts, 3),
      ),
      new T.PointsMaterial({
        color: "#c8e9ad",
        size: 0.027,
        transparent: true,
        opacity: 0.4,
      }),
    );
    g.add(this.dust);
  }
  container(g, x, y, z, w, h, d, color, text) {
    const c = new T.Group();
    g.add(c);
    c.position.set(x, y, z);
    box(c, 0, 0, 0, w, h, d, color, { metalness: 0.45, roughness: 0.6 });
    for (let i = 0; i < w / 0.25; i++)
      box(
        c,
        -w / 2 + i * 0.25,
        0,
        d / 2 + 0.025,
        0.045,
        h - 0.12,
        0.05,
        "#53604a",
      );
    for (const sy of [-1, 1])
      box(c, 0, sy * (h / 2 - 0.08), d / 2 + 0.07, w, 0.12, 0.14, "#647354");
    sign(c, text, 0, 0, d / 2 + 0.08, w * 0.65, 0.45, "#a0af89", "#3d4e3c");
    return c;
  }
  fence(g, x, z, w) {
    for (let i = 0; i <= w / 2; i++)
      box(g, x - w / 2 + i * 2, 1.6, z, 0.07, 3.2, 0.07, "#526450");
    for (let i = 0; i < 10; i++) {
      const l = box(g, x, 0.3 + i * 0.28, z, w, 0.014, 0.015, "#70806a", {
        transparent: true,
        opacity: 0.35,
      });
      l.castShadow = false;
    }
    box(g, x, 3.25, z, w, 0.04, 0.04, "#77816c");
  }
  watchtower(g, x, z) {
    for (const dx of [-1.3, 1.3])
      for (const dz of [-1.3, 1.3])
        box(g, x + dx, 4, z + dz, 0.18, 8, 0.18, "#3a4c3c");
    box(g, x, 7, z, 3.5, 0.3, 3.5, "#56634e");
    box(g, x, 8.3, z, 3.2, 0.1, 3.2, "#344b3c");
    for (let i = 0; i < 6; i++)
      box(g, x - 0.3, 1 + i, z + 1.4, 0.6, 0.09, 0.1, "#63745a");
    sign(g, "07", x, 7.6, z + 1.61, 1, 0.6);
    glow(g, x, 7, z, "#afc68a", 15, 18);
  }
  makeMap() {
    const g = this.gameGroup;
    const ground = mesh(
      new T.PlaneGeometry(72, 72),
      new T.MeshStandardMaterial({ map: groundTexture(), roughness: 0.82 }),
      g,
      0,
      -0.1,
      0,
    );
    ground.rotation.x = -Math.PI / 2;
    box(g, 0, -0.07, 0, 7, 0.03, 70, "#384539");
    box(g, 0, -0.06, 13, 70, 0.03, 5, "#3e483b");
    for (let z = -32; z < 33; z += 4)
      box(g, 0, -0.04, z, 0.14, 0.02, 1.8, "#8c95715c");
    for (const b of WORLD.buildings) {
      box(g, b.x, b.h / 2, b.z, b.w, b.h, b.d, "#46523f");
      box(g, b.x, b.h + 0.1, b.z, b.w + 0.4, 0.3, b.d + 0.4, "#273b30");
      box(g, b.x, 1.2, b.z + b.d / 2 + 0.05, b.w + 0.05, 0.2, 0.1, "#788364");
      for (let x = -b.w / 2 + 1; x < b.w / 2; x += 2.4) {
        box(g, b.x + x, 2.6, b.z + b.d / 2 + 0.06, 1.2, 1.4, 0.1, "#172920");
        box(g, b.x + x, 2.6, b.z + b.d / 2 + 0.12, 0.04, 1.4, 0.1, "#8a9e70");
      }
      sign(
        g,
        b.name,
        b.x,
        b.h - 0.8,
        b.z + b.d / 2 + 0.1,
        Math.min(6, b.w - 1),
        0.6,
      );
    }
    this.zone(g, WORLD.shelter, 6, "#a2d87c", "SHELTER / SAFE ZONE");
    this.zone(g, WORLD.bunker, 6.5, "#a389e2", "BUNKER / RESTRICTED");
    this.zone(g, WORLD.extraction, 4, "#c4f568", "EXTRACTION");
    for (const b of BUNKER_WALLS)
      box(g, b.x, 1.2, b.z, b.w, 2.4, b.d, "#525a55");
    this.bunkerDoor = new T.Group();
    this.bunkerDoor.position.set(23, 0, -16);
    g.add(this.bunkerDoor);
    box(this.bunkerDoor, 0, 1.1, 0, 5, 2.2, 0.5, "#646380");
    for (let i = 0; i < 5; i++)
      box(this.bunkerDoor, -2 + i, 1.1, 0.3, 0.04, 2, 0.03, "#252b33");
    sign(
      this.bunkerDoor,
      "KEYCARD REQUIRED",
      0,
      1.6,
      0.32,
      3,
      0.35,
      "#c2a4f2",
      "#353747",
    );
    box(g, 23, 0.8, -23, 2, 1.6, 0.8, "#273b31");
    sign(
      g,
      "SIGNAL RESTORED",
      23,
      1.4,
      -22.58,
      1.6,
      0.35,
      "#c4f568",
      "#14241a",
    );
    this.container(g, -29, 1.2, 23, 5, 2.4, 4, "#495e40", "SAFEHOUSE");
    this.container(g, 28, 1.2, -29, 6, 2.4, 3, "#475445", "BUNKER 07");
    for (const [x, z] of [
      [-31, 7],
      [-9, 15],
      [12, -28],
      [32, 20],
      [-4, -5],
    ]) {
      box(g, x, 0.4, z, 1.7, 0.8, 1.1, "#535b3d");
      box(g, x, 0.85, z, 1.8, 0.1, 1.2, "#7d8960");
    }
    for (let i = 0; i < 32; i++) {
      const side = i % 4,
        k = Math.floor(i / 4);
      const x = side === 0 ? -35 : side === 1 ? 35 : -31 + k * 9,
        z = side === 2 ? -35 : side === 3 ? 35 : -31 + k * 9;
      box(g, x, 1.5, z, side < 2 ? 0.3 : 8, 3, side < 2 ? 8 : 0.3, "#3e4e3c");
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2,
        x = Math.cos(a) * 44,
        z = Math.sin(a) * 44;
      box(g, x, 3, z, 0.6, 6, 0.6, "#293e2c");
      mesh(new T.ConeGeometry(3, 9, 6), material("#28412d"), g, x, 9, z);
    }
    this.mapLabel = sign(
      g,
      "BLACKWOOD / SECTOR 07",
      -5,
      0.01,
      29,
      12,
      2,
      "#73896a",
      "#2b3b2d",
    );
    this.mapLabel.rotation.x = -Math.PI / 2;
  }
  zone(g, pos, radius, color, text) {
    const ring = mesh(
      new T.TorusGeometry(radius, 0.055, 6, 64),
      material(color, { emissive: color, emissiveIntensity: 0.7 }),
      g,
      pos.x,
      0.03,
      pos.z,
    );
    ring.rotation.x = Math.PI / 2;
    const zone = mesh(
      new T.CircleGeometry(radius, 48),
      material(color, { transparent: true, opacity: 0.08, depthWrite: false }),
      g,
      pos.x,
      0.01,
      pos.z,
    );
    zone.rotation.x = -Math.PI / 2;
    const tag = sign(
      g,
      text,
      pos.x,
      0.08,
      pos.z,
      radius * 1.5,
      1,
      color,
      "#243a2a",
    );
    tag.rotation.x = -Math.PI / 2;
    glow(g, pos.x, 3, pos.z, color, 8, 12);
  }
  preview(id) {
    if (this.previewOutfit === id) return;
    this.previewOutfit = id;
    this.lobbyGroup.remove(this.hero);
    disposeObject(this.hero);
    this.hero = createCharacter(id, this.settings.glow);
    this.hero.position.set(0.3, 0.1, 0);
    this.lobbyGroup.add(this.hero);
  }
  setMode(mode, id) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.playerId = id;
    this.lobbyGroup.visible = mode === "lobby";
    this.gameGroup.visible = mode === "match";
    if (mode === "match") {
      this.scene.fog.density = 0.014;
      this.camera.fov = innerHeight > innerWidth && matchMedia("(pointer: coarse)").matches ? 59 : 47;
      this.camera.updateProjectionMatrix();
    } else {
      this.scene.fog.density = 0.043;
      this.camera.fov = innerWidth < 580 ? 40 : 35;
      this.camera.updateProjectionMatrix();
    }
  }
  snapshot(s, id) {
    this.snapshotData = s;
    this.playerId = id;
    const wanted = new Set();
    for (const p of s.players) {
      const key = "p" + p.id;
      wanted.add(key);
      let o = this.entities.get(key);
      if (!o || o.userData.outfit !== p.outfit) {
        if (o) {
          this.gameGroup.remove(o);
          disposeObject(o);
        }
        o = createCharacter(p.outfit, this.settings.glow);
        o.scale.setScalar(0.52);
        o.userData.outfit = p.outfit;
        this.entities.set(key, o);
        this.gameGroup.add(o);
        o.position.set(p.x, 0, p.z);
      }
      o.userData.target = new T.Vector3(p.x, 0, p.z);
      o.userData.aim = p.aim;
      o.userData.dead = p.hp <= 0;
      o.visible = !p.extracted;
      o.userData.gear = p.gear;
      updateGear(o, p.gear, p.weapon);
    }
    for (const z of s.zombies) {
      const key = "z" + z.id;
      wanted.add(key);
      let o = this.entities.get(key);
      if (!o) {
        o = createZombie();
        o.position.set(z.x, 0, z.z);
        this.entities.set(key, o);
        this.gameGroup.add(o);
      }
      o.userData.target = new T.Vector3(z.x, 0, z.z);
      o.userData.dead = false;
    }
    for (const [key, o] of this.entities)
      if (!wanted.has(key)) {
        this.gameGroup.remove(o);
        disposeObject(o);
        this.entities.delete(key);
      }
    const lootWanted = new Set();
    for (const l of s.loot) {
      lootWanted.add(l.id);
      let o = this.lootEntities.get(l.id);
      if (!o) {
        o = new T.Group();
        const c =
          l.item === "keycard"
            ? "#b193fa"
            : l.item === "medkit"
              ? "#faf0c0"
              : "#c4f568";
        box(o, 0, 0.35, 0, 0.7, 0.5, 0.5, c, {
          emissive: c,
          emissiveIntensity: 0.25,
        });
        const beam = mesh(
          new T.CylinderGeometry(0.07, 0.4, 2, 8),
          material(c, { transparent: true, opacity: 0.1, depthWrite: false }),
          o,
          0,
          1.4,
          0,
        );
        o.userData.beam = beam;
        this.gameGroup.add(o);
        this.lootEntities.set(l.id, o);
      }
      o.position.set(l.x, 0, l.z);
    }
    for (const [key, o] of this.lootEntities)
      if (!lootWanted.has(key)) {
        this.gameGroup.remove(o);
        disposeObject(o);
        this.lootEntities.delete(key);
      }
    this.bunkerDoor.position.y = s.bunkerOpen ? -3 : 0;
    for (const e of s.effects || [])
      if (e.id > this.lastEffect) {
        this.effect(e);
        this.lastEffect = e.id;
      }
  }
  effect(e) {
    if (e.kind === "extract") {
      const ring = mesh(
        new T.TorusGeometry(1, 0.08, 8, 48),
        material("#c4f568", {
          emissive: "#c4f568",
          emissiveIntensity: 2,
          transparent: true,
          opacity: 1,
        }),
        this.gameGroup,
        e.x,
        0.2,
        e.z,
      );
      ring.rotation.x = Math.PI / 2;
      this.effects.push({ object: ring, life: 1, extract: true });
      return;
    }
    const pts = [new T.Vector3(e.x, 1, e.z), new T.Vector3(e.tx, 1, e.tz)];
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineBasicMaterial({
        color: e.kind === "hit" ? "#d1ff84" : "#fcdf9a",
        transparent: true,
        opacity: 1,
      }),
    );
    this.gameGroup.add(line);
    this.effects.push({ object: line, life: 0.14 });
    if (e.kind === "hit") {
      for (let i = 0; i < 5; i++) {
        const spark = mesh(
          new T.BoxGeometry(0.08, 0.08, 0.08),
          material("#c5f472", { emissive: "#c5f472" }),
          this.gameGroup,
          e.tx,
          1,
          e.tz,
        );
        this.effects.push({
          object: spark,
          life: 0.3,
          velocity: new T.Vector3(
            Math.sin(i * 4) * 3,
            Math.random() * 3,
            Math.cos(i * 4) * 3,
          ),
        });
      }
    }
  }
  setTouchAim(angle) {
    this.touchAimAngle = angle;
  }
  aim() {
    if (this.touchAimAngle !== null) return this.touchAimAngle;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.aimPoint);
    const p = this.snapshotData?.players.find((p) => p.id === this.playerId);
    return p ? Math.atan2(this.aimPoint.x - p.x, this.aimPoint.z - p.z) : 0;
  }
  loop() {
    this.frame = requestAnimationFrame(() => this.loop());
    if (document.hidden) return;
    const now = performance.now();
    if (
      this.lastFrame &&
      now - this.lastFrame < (this.settings.quality === "low" ? 32 : 15)
    )
      return;
    this.lastFrame = now;
    const dt = Math.min(this.clock.getDelta(), 0.05),
      t = this.clock.elapsedTime,
      still = this.settings.motion;
    const aspect = innerWidth / innerHeight;
    if (this.mode === "lobby") {
      const mobile = innerWidth < 580;
      this.hero.rotation.y =
        this.rotation + (still ? 0 : Math.sin(t * 0.22) * 0.07);
      this.hero.position.y = 0.1 + (still ? 0 : Math.sin(t * 1.4) * 0.025);
      animateCharacter(this.hero, t, 0, still);
      if (this.previewOutfit === "galaxy" && this.settings.glow)
        this.hero.traverse((o) => {
          if (o.userData.star && !still)
            o.material.emissiveIntensity =
              0.8 + Math.sin(t * 2 + o.position.x * 5) * 0.7;
        });
      const pos = mobile ? new T.Vector3(7, 5, 14) : new T.Vector3(6, 4.5, 13);
      this.camera.position.lerp(pos, 0.08);
      this.target.set(
        mobile ? -0.8 : aspect < 1.2 ? -1.2 : 0,
        mobile ? 3.1 : 2.1,
        0,
      );
      this.camera.lookAt(this.target);
      if (!still) {
        this.fogSprites.forEach((s, i) => {
          s.position.x += Math.sin(i + 1) * dt * 0.09;
          s.position.y = 0.5 + (i % 5) * 0.2 + Math.sin(t * 0.2 + i) * 0.15;
        });
        this.dust.rotation.y = t * 0.005;
      }
    } else {
      const player = this.snapshotData?.players.find(
        (p) => p.id === this.playerId,
      );
      if (player) {
        const portrait = innerHeight > innerWidth && matchMedia("(pointer: coarse)").matches;
        const target = new T.Vector3(player.x, portrait ? 27 : 21, player.z + (portrait ? 20 : 17));
        this.camera.position.lerp(target, 1 - Math.exp(-dt * 6));
        this.target.set(player.x, 0, player.z);
        this.camera.lookAt(this.target);
      }
      for (const o of this.entities.values()) {
        const target = o.userData.target;
        if (!target) continue;
        const speed = o.position.distanceTo(target);
        const old = o.position.clone();
        o.position.lerp(target, 1 - Math.exp(-dt * 14));
        const dir =
          o.userData.aim ?? Math.atan2(target.x - old.x, target.z - old.z);
        if (speed > 0.01 || o.userData.aim !== undefined) o.rotation.y = dir;
        animateCharacter(o, t, speed > 0.03 ? 1 : 0, still);
        o.rotation.z = o.userData.dead ? Math.PI / 2 : 0;
      }
      for (const o of this.lootEntities.values()) {
        o.children[0].rotation.y = still ? 0 : t * 0.6;
        o.children[0].position.y = 0.5 + (still ? 0 : Math.sin(t * 2) * 0.1);
      }
    }
    this.effects = this.effects.filter((e) => {
      e.life -= dt;
      if (e.life <= 0) {
        this.gameGroup.remove(e.object);
        e.object.geometry?.dispose();
        if (e.object.isLine) e.object.material.dispose();
        return false;
      }
      if (e.velocity) e.object.position.addScaledVector(e.velocity, dt);
      if (e.extract) {
        e.object.scale.multiplyScalar(1 + dt * 2);
        e.object.position.y += dt * 4;
      }
      return true;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
function createCharacter(outfit, glows) {
  const g = new T.Group(),
    c = COSMETICS.find((c) => c.id === outfit)?.color || "#929b71",
    dark = "#252e28",
    black = "#141e1b",
    olive = outfit === "survivor" ? "#69785c" : c,
    em = glows ? c : "#17221a";
  g.userData.limbs = [];
  // Heavy boots and articulated trousers.
  for (const side of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(side * 0.28, 1.6, 0);
    g.add(leg);
    const thigh = mesh(
      new T.CapsuleGeometry(0.23, 0.56, 5, 10),
      material(olive),
      leg,
      0,
      -0.36,
      0,
    );
    box(leg, 0, -0.86, 0.1, 0.37, 0.35, 0.38, dark);
    mesh(
      new T.CapsuleGeometry(0.19, 0.43, 5, 10),
      material(olive),
      leg,
      0,
      -1.1,
      0,
    );
    box(leg, 0, -1.42, 0.11, 0.43, 0.28, 0.69, black);
    box(leg, 0, -1.55, 0.1, 0.45, 0.09, 0.71, "#0e1714");
    box(leg, side * 0.24, -0.3, 0.03, 0.1, 0.4, 0.29, "#4b5844");
    box(leg, 0, -0.87, 0.31, 0.23, 0.22, 0.05, "#7a8665");
    g.userData.limbs.push(leg);
  }
  cylinder(g, 0, 1.64, 0, 0.46, 0.43, 0.19, dark, 12);
  box(g, 0, 1.64, 0.37, 0.18, 0.14, 0.08, "#8d9879", { metalness: 0.8 });
  mesh(
    new T.CapsuleGeometry(0.51, 0.75, 6, 12),
    material(olive),
    g,
    0,
    2.23,
    0,
  );
  box(g, 0, 2.22, 0.38, 0.86, 0.89, 0.24, dark);
  box(g, 0, 2.65, 0.37, 0.75, 0.13, 0.19, "#3b4938");
  // Webbing, magazine pouches, radio and original studio patch.
  for (const x of [-0.32, 0.32])
    box(g, x, 2.51, 0.5, 0.12, 0.56, 0.055, "#78846a");
  for (let i = 0; i < 3; i++) {
    box(g, -0.28 + i * 0.28, 2.1, 0.56, 0.22, 0.35, 0.17, "#56644d");
    box(g, -0.28 + i * 0.28, 2.2, 0.66, 0.19, 0.06, 0.03, "#7c8965");
  }
  box(g, -0.3, 2.55, 0.54, 0.19, 0.29, 0.12, "#2a352a");
  box(g, -0.36, 2.83, 0.53, 0.025, 0.3, 0.025, "#64785b");
  sign(g, "D//30", 0.18, 2.5, 0.52, 0.29, 0.13, "#c5e18f", "#293a25");
  const backpack = new T.Group();
  g.add(backpack);
  box(backpack, 0, 2.24, -0.49, 0.66, 0.95, 0.4, "#46593e");
  box(backpack, 0, 2.23, -0.72, 0.45, 0.55, 0.12, "#5b6b4d");
  for (const x of [-0.21, 0.21])
    box(backpack, x, 2.2, -0.8, 0.06, 0.8, 0.04, "#263726");
  g.userData.backpack = backpack;
  // Hood, inset gas mask lenses, twin filters and breathing valve.
  const head = new T.Group();
  head.position.set(0, 3.35, 0);
  g.add(head);
  sphere(head, 0, 0, 0, 0.51, olive);
  sphere(head, 0, -0.025, 0.18, 0.42, black);
  const seam = mesh(
    new T.TorusGeometry(0.445, 0.035, 8, 32),
    material("#6f7b58"),
    head,
    0,
    0.015,
    0.22,
  );
  seam.scale.set(1, 1.05, 0.7);
  for (const x of [-0.2, 0.2]) {
    const lens = mesh(
      new T.CylinderGeometry(0.16, 0.17, 0.1, 24),
      material("#879c72", { metalness: 0.8, roughness: 0.2 }),
      head,
      x,
      0.09,
      0.49,
    );
    lens.rotation.x = Math.PI / 2;
    const glass = sphere(head, x, 0.09, 0.55, 0.125, "#101d17", {
      metalness: 0.9,
      roughness: 0.1,
      emissive: em,
      emissiveIntensity: glows ? 0.3 : 0,
    });
    glass.scale.set(1, 0.8, 0.3);
    sphere(head, x - 0.033, 0.13, 0.59, 0.027, "#c6e7a7", {
      emissive: em,
      emissiveIntensity: glows ? 1 : 0,
    });
  }
  const valve = cylinder(head, 0, -0.23, 0.48, 0.16, 0.18, 0.19, "#50624c", 20);
  valve.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const f = cylinder(
      head,
      side * 0.35,
      -0.22,
      0.36,
      0.17,
      0.19,
      0.24,
      "#344537",
      16,
    );
    f.rotation.z = side * 0.6;
    f.rotation.x = Math.PI / 2;
    const cap = cylinder(
      head,
      side * 0.4,
      -0.26,
      0.46,
      0.17,
      0.17,
      0.06,
      "#738365",
      16,
    );
    cap.rotation.x = Math.PI / 2;
  }
  box(head, 0, 0.41, 0.15, 0.24, 0.07, 0.15, "#d0df9b", {
    emissive: em,
    emissiveIntensity: glows ? 0.5 : 0,
  });
  // Rolled sleeves, gloves and shouldered carbine.
  for (const side of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(side * 0.57, 2.64, 0);
    arm.rotation.z = side * 0.23;
    g.add(arm);
    mesh(
      new T.CapsuleGeometry(0.23, 0.37, 5, 10),
      material(olive),
      arm,
      0,
      -0.2,
      0,
    );
    box(arm, side * 0.06, -0.15, 0.21, 0.2, 0.18, 0.08, "#394735");
    mesh(
      new T.CapsuleGeometry(0.17, 0.37, 5, 10),
      material(olive),
      arm,
      0,
      -0.68,
      0.13,
    );
    sphere(arm, 0, -0.95, 0.25, 0.19, black);
    g.userData.limbs.push(arm);
  }
  const gun = new T.Group();
  g.add(gun);
  gun.position.set(0.03, 1.8, 0.73);
  gun.rotation.z = -0.13;
  box(gun, -0.1, 0, 0, 1.15, 0.22, 0.2, "#202a26", { metalness: 0.7 });
  box(gun, -0.68, 0, 0, 0.33, 0.13, 0.15, "#405144");
  box(gun, 0.61, 0.015, 0, 0.4, 0.07, 0.07, "#0b1512", { metalness: 0.8 });
  box(gun, 0.87, 0.015, 0, 0.14, 0.12, 0.12, "#222e26");
  box(gun, -0.12, -0.23, 0, 0.2, 0.35, 0.14, "#354434");
  box(gun, -0.44, -0.17, 0, 0.13, 0.22, 0.13, "#14201a");
  box(gun, -0.08, 0.18, 0, 0.34, 0.12, 0.13, "#111b17");
  for (let i = 0; i < 5; i++)
    box(gun, 0.17 + i * 0.06, 0.13, 0, 0.035, 0.045, 0.17, "#718364");
  box(gun, 0.1, 0, 0.11, 0.5, 0.055, 0.018, c, {
    emissive: em,
    emissiveIntensity: glows ? 0.65 : 0,
  });
  g.userData.gun = gun;
  const helmet = mesh(
    new T.SphereGeometry(0.54, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    material("#424e3c"),
    g,
    0,
    3.45,
    -0.025,
  );
  helmet.visible = false;
  g.userData.helmet = helmet;
  const armour = box(g, 0, 2.25, 0.53, 0.84, 0.78, 0.1, "#4e5b43", {
    metalness: 0.5,
  });
  armour.visible = false;
  g.userData.armour = armour;
  if (outfit === "skeleton") {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const rib = box(
          g,
          side * 0.2,
          2.5 - i * 0.13,
          0.53,
          0.33,
          0.035,
          0.02,
          c,
          { emissive: em, emissiveIntensity: glows ? 1.8 : 0 },
        );
        rib.rotation.z = side * 0.13;
      }
      box(g, side * 0.28, 0.9, 0.23, 0.045, 0.85, 0.04, c, {
        emissive: em,
        emissiveIntensity: glows ? 1.5 : 0,
      });
    }
    box(g, 0, 2.3, 0.55, 0.04, 0.65, 0.025, c, {
      emissive: em,
      emissiveIntensity: glows ? 1.5 : 0,
    });
  }
  if (outfit === "galaxy") {
    for (let i = 0; i < 35; i++) {
      const star = sphere(
        g,
        Math.sin(i * 5) * 0.42,
        1.85 + (i % 11) * 0.16,
        0.52 + Math.cos(i) * 0.04,
        0.014 + (i % 3) * 0.006,
        i % 2 ? "#d3a7ff" : "#a6dcff",
        {
          emissive: i % 2 ? "#c684fb" : "#7ca4ff",
          emissiveIntensity: glows ? 1.4 : 0,
        },
      );
      star.userData.star = true;
    }
  }
  if (outfit === "ember") {
    for (const side of [-1, 1]) {
      cylinder(g, side * .24, 2.3, -.6, .17, .17, .9, "#343c34", 12);
      cylinder(g, side * .24, 2.3, -.6, .18, .18, .08, c, 12, { emissive: em, emissiveIntensity: glows ? .8 : 0 });
      const plate = box(g, side * .6, 2.72, .02, .4, .18, .5, "#4b4940", { metalness: .6 }); plate.rotation.z = side * .24;
      for(let i=0;i<3;i++) box(g,side*.6,2.81,.15-i*.12,.25,.025,.045,c,{emissive:em,emissiveIntensity:glows ? .7 : 0});
    }
  }
  if (outfit === "spectre") {
    for (const side of [-1, 1]) {
      box(g,side*.36,2.3,.55,.025,.72,.025,c,{emissive:em,emissiveIntensity:glows?1.4:0});
      box(g,side*.28,1,.24,.025,.7,.025,c,{emissive:em,emissiveIntensity:glows?1.2:0});
      sphere(head,side*.47,.07,0,.12,"#273c40",{metalness:.8});
    }
    const halo=mesh(new T.TorusGeometry(.56,.013,6,48),material(c,{emissive:em,emissiveIntensity:glows?1.8:0}),head,0,.25,0);halo.rotation.x=Math.PI/2;
  }
  if (outfit === "ronin") {
    const scarf=mesh(new T.TorusGeometry(.36,.12,8,16),material("#a23751"),g,0,2.94,.06);scarf.rotation.x=Math.PI/2;
    const tail=box(g,-.38,2.52,-.25,.23,.85,.08,"#a23751");tail.rotation.z=-.24;
    for(const side of[-1,1]){const horn=mesh(new T.ConeGeometry(.085,.4,4),material(c,{metalness:.6}),head,side*.38,.47,.1);horn.rotation.z=-side*.45;}
    sign(g,"//",0,2.45,.6,.18,.14,c,"#30272d");
  }
  return g;
}
function createZombie() {
  const g = new T.Group();
  g.userData.limbs = [];
  for (const side of [-1, 1]) {
    const leg = box(g, side * 0.16, 0.5, 0, 0.22, 0.8, 0.25, "#28392c");
    g.userData.limbs.push(leg);
  }
  mesh(
    new T.CapsuleGeometry(0.34, 0.45, 4, 8),
    material("#52614b"),
    g,
    0,
    1.2,
    0,
  );
  sphere(g, 0, 1.86, 0.03, 0.29, "#879974");
  for (const side of [-1, 1]) {
    const arm = box(g, side * 0.39, 1.28, 0.25, 0.16, 0.65, 0.18, "#6a7a58");
    arm.rotation.x = -0.8;
    g.userData.limbs.push(arm);
    sphere(g, side * 0.11, 1.9, 0.28, 0.045, "#d8c58a", {
      emissive: "#f5c65a",
      emissiveIntensity: 1,
    });
  }
  return g;
}
function animateCharacter(o, t, moving, still) {
  if (still) return;
  const limbs = o.userData.limbs || [];
  limbs.forEach((l, i) => {
    if (i < 2) l.rotation.x = Math.sin(t * 9 + i * Math.PI) * moving * 0.37;
    else l.rotation.x = Math.sin(t * 2 + i) * 0.025;
  });
  if (o.userData.gun)
    o.userData.gun.position.y = 1.8 + Math.sin(t * 1.4) * 0.015;
}
function updateGear(o, gear, weapon) {
  if (!o.userData.helmet) return;
  o.userData.helmet.visible = !!gear.helmet;
  o.userData.armour.visible = !!gear.armour;
  o.userData.backpack.visible = !!gear.backpack;
  o.userData.gun.rotation.y = -Math.PI / 2;
  o.userData.gun.scale.x =
    weapon === "pistol" ? 0.55 : weapon === "shotgun" ? 0.8 : 1;
}
function disposeObject(o) {
  o.traverse((child) => {
    child.geometry?.dispose();
    if (child.material?.map) {
      child.material.map.dispose();
      child.material.dispose();
    }
  });
}
