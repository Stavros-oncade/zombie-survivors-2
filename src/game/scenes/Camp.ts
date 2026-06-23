import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { CampSystem } from '../systems/CampSystem';
import { CAMP_BUILDINGS } from '../config/CampBuildings';
import { BuildingId } from '../types/CampTypes';
import { CampPlayer } from '../entities/CampPlayer';

// The Survivor Camp — a small walkable plaza hub (no combat). The player navigates
// like a level and steps into ZONES (Command Tent, Departure Gate) that open menus
// via an action button + on-screen hint. The town VISUALLY REFLECTS CampSystem:
// built facilities by tier (hidden until built), living survivor count (wandering
// NPCs), and a breached horde (zombies massing at the walls). Reads fresh state on
// every entry, so builds made in CampUpgrades show up the moment you walk back.

const WORLD_W = 1280;
const WORLD_H = 960;
const MAX_NPCS = 15;
const ZONE_RADIUS = 110;

interface ZoneAction { key: string; keyLabel: string; label: string; run: () => void; }
interface CampZone { id: string; x: number; y: number; title: string; texKey: string; actions: ZoneAction[]; }
interface WanderNPC { sprite: Phaser.GameObjects.Sprite; vx: number; vy: number; }

// Fixed plaza coordinates for each facility (Walls handled separately as a band).
const BUILDING_POS: Partial<Record<BuildingId, { x: number; y: number }>> = {
  [BuildingId.BARRACKS]: { x: 640, y: 230 },
  [BuildingId.FARM]: { x: 250, y: 720 },
  [BuildingId.WELL]: { x: 470, y: 820 },
  [BuildingId.INFIRMARY]: { x: 830, y: 800 },
  [BuildingId.WAREHOUSE]: { x: 1060, y: 690 },
};

const BUILDING_COLOR: Record<BuildingId, number> = {
  [BuildingId.FARM]: 0x6b8e23,
  [BuildingId.WELL]: 0x4a90d9,
  [BuildingId.INFIRMARY]: 0xd96a6a,
  [BuildingId.WALLS]: 0x9a9a9a,
  [BuildingId.WAREHOUSE]: 0xb8860b,
  [BuildingId.BARRACKS]: 0x8a6d3b,
};

export class Camp extends Scene {
  constructor() { super(SceneKey.Camp); }

  private camp!: CampSystem;
  private player!: CampPlayer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { [key: string]: Phaser.Input.Keyboard.Key };
  private keyShift!: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyC!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;

  private zones: CampZone[] = [];
  private npcs: WanderNPC[] = [];
  private hint!: Phaser.GameObjects.Text;
  private activeZoneId: string | null = null;
  private isMobile = false;

  // Virtual joystick state (mirrors the Game scene's touch wiring).
  private initialTouchPoint: Phaser.Math.Vector2 | null = null;
  private currentTouchPoint: Phaser.Math.Vector2 | null = null;

  // Mobile contextual action buttons (rebuilt when the active zone changes).
  private actionButtons: Phaser.GameObjects.Container[] = [];

  create() {
    this.camp = CampSystem.getInstance();
    // reset per-entry state (Phaser reuses scene instances across start()).
    this.zones = [];
    this.npcs = [];
    this.activeZoneId = null;
    this.initialTouchPoint = null;
    this.currentTouchPoint = null;
    this.actionButtons = [];

    if (this.camp.getState().extinct) {
      this.renderExtinction();
      return;
    }
    this.buildPlaza();
  }

  // ─────────────────────────────── plaza ───────────────────────────────
  private buildPlaza() {
    this.isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const state = this.camp.getState();

    // World + camera.
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor(0x2a2620);

    // Ground: use the camp_ground art if it's been loaded; otherwise a placeholder
    // tinted rectangle + subtle grid so the plaza is always legible.
    if (this.textures.exists('camp_ground')) {
      this.add.image(0, 0, 'camp_ground').setOrigin(0).setDisplaySize(WORLD_W, WORLD_H).setDepth(-10);
    } else {
      this.add.rectangle(0, 0, WORLD_W, WORLD_H, 0x352f27).setOrigin(0).setDepth(-10);
      const grid = this.add.graphics().setDepth(-9);
      grid.lineStyle(1, 0x3f3930, 0.6);
      for (let x = 0; x <= WORLD_W; x += 64) { grid.lineBetween(x, 0, x, WORLD_H); }
      for (let y = 0; y <= WORLD_H; y += 64) { grid.lineBetween(0, y, WORLD_W, y); }
    }

    // Walls band + breach zombies along the top.
    this.renderWalls();

    // Facility buildings (hidden until built).
    for (const def of CAMP_BUILDINGS) {
      if (def.id === BuildingId.WALLS) continue; // handled by renderWalls()
      const tier = this.camp.getOwnedTier(def.id);
      if (tier < 1) continue;
      const pos = BUILDING_POS[def.id];
      if (!pos) continue;
      this.placeBuilding(def.id, def.name, tier, pos.x, pos.y);
    }

    // Interactable zone structures.
    this.zones = [
      {
        id: 'command', x: 300, y: 380, title: 'Command Tent', texKey: 'tent_command',
        actions: [{ key: 'E', keyLabel: 'E', label: 'Manage', run: () => this.scene.start(SceneKey.CampUpgrades) }],
      },
      {
        id: 'gate', x: 980, y: 380, title: 'Departure Gate', texKey: 'gate_departure',
        actions: [
          { key: 'E', keyLabel: 'E', label: 'Jobs', run: () => this.scene.start(SceneKey.JobBoard) },
          { key: 'C', keyLabel: 'C', label: 'City Map', run: () => this.scene.start(SceneKey.CityReclamation) },
        ],
      },
    ];
    for (const z of this.zones) {
      this.ensureStructureTexture(z.texKey, z.id === 'command' ? 0x6d5a8c : 0x4f7a8c);
      this.add.image(z.x, z.y, z.texKey).setDepth(z.y);
      this.add.text(z.x, z.y + 60, z.title, {
        fontFamily: 'Arial Black', fontSize: '15px', color: '#ffe9b0', stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(z.y);
    }

    // Survivor NPCs scaled to population (capped for perf).
    this.spawnSurvivors(Math.min(MAX_NPCS, state.survivors));

    // Player.
    this.player = new CampPlayer(this, WORLD_W / 2, 600).spawn();
    this.cameras.main.startFollow(this.player);

    // Input.
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasdKeys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as { [key: string]: Phaser.Input.Keyboard.Key };
      this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    }
    this.setupTouch();

    // World-space zone hint (hidden until in a zone).
    this.hint = this.add.text(0, 0, '', {
      fontFamily: 'Arial Black', fontSize: '16px', color: '#ffff99', stroke: '#000000', strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5, 1).setDepth(5000).setVisible(false);

    this.buildHud();
    if (this.isMobile) this.buildMobileButtons();

    // A lightweight way back to the title screen.
    this.add.text(this.cameras.main.width - 16, 14, 'Menu', {
      fontFamily: 'Arial Black', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(5001).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
      .on('pointerdown', () => this.scene.start(SceneKey.MainMenu));
  }

  update() {
    if (!this.player || !this.player.active) return;

    this.player.update(this.cursors, this.wasdKeys, this.initialTouchPoint, this.currentTouchPoint);
    // Top-down y-sort: the player occludes structures north of it and hides behind
    // those south of it (buildings/NPCs use depth = their y).
    this.player.setDepth(this.player.y);

    // Dash (keyboard Shift; mobile uses the dash button).
    if (this.keyShift && Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      this.player.dash();
    }

    // Escape → title.
    if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.scene.start(SceneKey.MainMenu);
      return;
    }

    this.tickNpcs();
    this.updateActiveZone();
    this.handleZoneKeys();
  }

  // ───────────────────────────── zones / hint ─────────────────────────────
  private updateActiveZone() {
    let zone: CampZone | null = null;
    let best = ZONE_RADIUS;
    for (const z of this.zones) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, z.x, z.y);
      if (d <= best) { best = d; zone = z; }
    }

    const newId = zone ? zone.id : null;
    if (newId !== this.activeZoneId) {
      this.activeZoneId = newId;
      this.refreshActionButtons(zone);
    }

    if (zone) {
      const keys = zone.actions.map(a => `[${a.keyLabel}] ${a.label}`).join('   ');
      this.hint.setText(`${zone.title}\n${keys}`);
      this.hint.setPosition(zone.x, zone.y - 70);
      this.hint.setVisible(true);
    } else {
      this.hint.setVisible(false);
    }
  }

  private handleZoneKeys() {
    if (!this.activeZoneId) return;
    const zone = this.zones.find(z => z.id === this.activeZoneId);
    if (!zone) return;
    for (const a of zone.actions) {
      const k = a.key === 'E' ? this.keyE : a.key === 'C' ? this.keyC : null;
      if (k && Phaser.Input.Keyboard.JustDown(k)) { a.run(); return; }
    }
    // Space activates the primary (first) action.
    if (this.keySpace && Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      zone.actions[0]?.run();
    }
  }

  // ─────────────────────────────── visuals ───────────────────────────────
  private placeBuilding(id: BuildingId, name: string, tier: number, x: number, y: number) {
    const key = `bldg_${id}_t${tier}`;
    this.ensureBuildingTexture(key, BUILDING_COLOR[id], tier);
    this.add.image(x, y, key).setDepth(y);
    this.add.text(x, y + 54, `${name} T${tier}`, {
      fontFamily: 'Arial', fontSize: '13px', color: '#e8e0d0', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(y);
  }

  private renderWalls() {
    const tier = this.camp.getOwnedTier(BuildingId.WALLS);
    const wallY = 110;
    if (tier >= 1) {
      const key = `wall_segment_t${tier}`;
      this.ensureWallTexture(key, tier);
      for (let x = 60; x <= WORLD_W - 60; x += 90) {
        this.add.image(x, wallY, key).setDepth(wallY);
      }
    }
    // Breach: zombies massing at the wall when pressure exceeds defense.
    const horde = this.camp.getState().hordeStrength;
    const defense = this.camp.getCampDefense();
    if (horde > defense) {
      const count = Math.min(8, Math.max(2, Math.ceil((horde - defense) / 5)));
      for (let i = 0; i < count; i++) {
        const x = 120 + (i / Math.max(1, count - 1)) * (WORLD_W - 240) + Phaser.Math.Between(-20, 20);
        const z = this.add.sprite(x, wallY - 46, 'enemy').setScale(0.45).setDepth(wallY + 1);
        this.tweens.add({ targets: z, y: z.y - 8, duration: 500 + Phaser.Math.Between(0, 300), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      this.add.text(WORLD_W / 2, wallY - 84, 'BREACH!', {
        fontFamily: 'Arial Black', fontSize: '22px', color: '#ff5555', stroke: '#000000', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(wallY + 2);
    }
  }

  private spawnSurvivors(n: number) {
    const variants = ['survivor_a', 'survivor_b', 'survivor_c'];
    const colors = [0xdcc89a, 0x9ad1dc, 0xc89adc];
    variants.forEach((k, i) => this.ensureCircleTexture(k, colors[i]));
    for (let i = 0; i < n; i++) {
      const x = Phaser.Math.Between(180, WORLD_W - 180);
      const y = Phaser.Math.Between(320, WORLD_H - 120);
      const sprite = this.add.sprite(x, y, variants[i % variants.length]).setDepth(y);
      const speed = 25 + Math.random() * 35;
      const angle = Math.random() * Math.PI * 2;
      this.npcs.push({ sprite, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }
  }

  private tickNpcs() {
    const dt = this.game.loop.delta / 1000;
    for (const n of this.npcs) {
      n.sprite.x += n.vx * dt;
      n.sprite.y += n.vy * dt;
      if (n.sprite.x < 160 || n.sprite.x > WORLD_W - 160) n.vx *= -1;
      if (n.sprite.y < 300 || n.sprite.y > WORLD_H - 100) n.vy *= -1;
      if (Math.random() < 0.01) {
        const speed = Math.hypot(n.vx, n.vy);
        const a = Math.random() * Math.PI * 2;
        n.vx = Math.cos(a) * speed; n.vy = Math.sin(a) * speed;
      }
      n.sprite.setDepth(n.sprite.y);
    }
  }

  private buildHud() {
    const state = this.camp.getState();
    const f = state.needs.food.stock, w = state.needs.water.stock, m = state.needs.medicine.stock;
    const line = `Survivors ${state.survivors}/${this.camp.getSurvivorCap()}    Food ${f}  Water ${w}  Med ${m}    Cycle ${state.cyclesSurvived}`;
    this.add.rectangle(0, 0, this.cameras.main.width, 40, 0x000000, 0.5).setOrigin(0).setScrollFactor(0).setDepth(5000);
    this.add.text(16, 10, line, {
      fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setScrollFactor(0).setDepth(5001);
  }

  // ───────────────────────── mobile on-screen buttons ─────────────────────────
  private buildMobileButtons() {
    const cam = this.cameras.main;
    // Always-available dash button, bottom-left (action buttons live bottom-right).
    this.makeButton(70, cam.height - 70, 'Dash', 0x335577, () => this.player.dash());
  }

  private refreshActionButtons(zone: CampZone | null) {
    if (!this.isMobile) return;
    this.actionButtons.forEach(b => b.destroy());
    this.actionButtons = [];
    if (!zone) return;
    const cam = this.cameras.main;
    zone.actions.forEach((a, i) => {
      const btn = this.makeButton(cam.width - 70, cam.height - 70 - i * 96, a.label, 0x556633, () => a.run());
      this.actionButtons.push(btn);
    });
  }

  private makeButton(x: number, y: number, label: string, color: number, onTap: () => void): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(color, 0.65);
    g.fillCircle(0, 0, 42);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeCircle(0, 0, 42);
    const t = this.add.text(0, 0, label, { fontSize: '14px', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    const c = this.add.container(x, y, [g, t]).setScrollFactor(0).setDepth(6000).setSize(84, 84);
    c.setInteractive(new Phaser.Geom.Circle(0, 0, 42), Phaser.Geom.Circle.Contains);
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, e: Phaser.Types.Input.EventData) => {
      e?.stopPropagation?.();
      onTap();
    });
    return c;
  }

  private setupTouch() {
    // Touch-anywhere virtual joystick (the fixed buttons capture their own pointers).
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.initialTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
      this.currentTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) this.currentTouchPoint = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
    this.input.on('pointerup', () => {
      this.initialTouchPoint = null;
      this.currentTouchPoint = null;
    });
  }

  // ─────────────────────── placeholder texture generators ───────────────────────
  // These only run if the real art (manifest, status:"present") hasn't been loaded,
  // so dropping in final sprites later overrides them with no code change.
  private ensureBuildingTexture(key: string, baseColor: number, tier: number) {
    if (this.textures.exists(key)) return;
    const size = 96 + tier * 12;
    const color = this.lighten(baseColor, (tier - 1) * 0.18);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(2, size - 14, size - 4, 12, 4); // shadow
    g.fillStyle(color, 1); g.fillRoundedRect(0, 0, size, size, 10);
    g.lineStyle(3, 0x000000, 0.4); g.strokeRoundedRect(0, 0, size, size, 10);
    g.fillStyle(0xffffff, 0.85);
    for (let i = 0; i < tier; i++) g.fillCircle(12 + i * 14, 14, 5); // tier pips
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private ensureWallTexture(key: string, tier: number) {
    if (this.textures.exists(key)) return;
    const w = 92, h = 50 + tier * 8;
    const g = this.add.graphics();
    g.fillStyle(this.lighten(0x8a8a8a, (tier - 1) * 0.12), 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x000000, 0.5);
    g.strokeRect(0, 0, w, h);
    for (let bx = 0; bx < w; bx += 23) g.lineBetween(bx, 0, bx, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  private ensureStructureTexture(key: string, color: number) {
    if (this.textures.exists(key)) return;
    const w = 120, h = 110;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(4, h - 12, w - 8, 12, 4);
    g.fillStyle(color, 1); g.fillTriangle(w / 2, 0, 0, h, w, h); // tent silhouette
    g.lineStyle(3, 0xffffff, 0.6); g.strokeTriangle(w / 2, 0, 0, h, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  private ensureCircleTexture(key: string, color: number) {
    if (this.textures.exists(key)) return;
    const s = 28;
    const g = this.add.graphics();
    g.fillStyle(color, 1); g.fillCircle(s / 2, s / 2, s / 2 - 2);
    g.lineStyle(2, 0x000000, 0.5); g.strokeCircle(s / 2, s / 2, s / 2 - 2);
    g.generateTexture(key, s, s);
    g.destroy();
  }

  private lighten(color: number, amount: number): number {
    const c = Phaser.Display.Color.IntegerToColor(color);
    const f = Phaser.Math.Clamp(amount, 0, 1);
    return Phaser.Display.Color.GetColor(
      Math.round(c.red + (255 - c.red) * f),
      Math.round(c.green + (255 - c.green) * f),
      Math.round(c.blue + (255 - c.blue) * f),
    );
  }

  // ───────────────────────────── extinction ─────────────────────────────
  private renderExtinction() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.cameras.main.setBackgroundColor(0x200000);
    const state = this.camp.getState();

    this.add.text(w / 2, h / 2 - 140, 'EXTINCTION', {
      fontFamily: 'Arial Black', fontSize: '64px', color: '#ff4444', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 - 60, 'The human race is gone.', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffcccc', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 + 10,
      `Cycles survived: ${state.cyclesSurvived}\nTotal survivors lost: ${state.totalSurvivorsLost}`, {
      fontFamily: 'Arial', fontSize: '22px', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 + 110, 'Begin Again', {
      fontFamily: 'Arial Black', fontSize: '30px', color: '#ffffff', backgroundColor: '#000000',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
      .on('pointerdown', () => {
        this.camp.resetCamp();
        this.scene.restart();
      });

    this.add.text(w / 2, h / 2 + 180, 'Main Menu', {
      fontFamily: 'Arial', fontSize: '22px', color: '#cccccc', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#cccccc' }); })
      .on('pointerdown', () => this.scene.start(SceneKey.MainMenu));
  }
}
