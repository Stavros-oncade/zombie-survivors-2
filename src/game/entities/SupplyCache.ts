import { WorldPoint } from '../types/MissionTypes';

/**
 * Visual + per-cache state for one Search & Retrieve supply cache
 * (docs/specs/search-and-retrieve-supply-caches.md). Plain class — owns a single
 * Graphics instance directly, mirroring MissionSystem's zoneMarker idiom, rather
 * than subclassing a Phaser GameObject. Driven entirely by SupplyCacheSystem.
 */
export class SupplyCache {
  private static readonly COOL_BLUE: [number, number, number] = [0x3f, 0xa9, 0xff];
  private static readonly AMBER: [number, number, number] = [0xff, 0xaa, 0x33];
  private static readonly HIT_FLASH = 0xff3333;

  private scene: Phaser.Scene;
  private pos: WorldPoint;
  private radius: number;
  private graphics: Phaser.GameObjects.Graphics;
  private progress = 0; // 0..1
  private retrieved = false;
  private destroyed = false;
  private pulseSec = 0;
  private flashSec = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, radius: number) {
    this.scene = scene;
    this.pos = { x, y };
    this.radius = radius;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(-0.5);
    this.redraw(false);
  }

  public update(dt: number, inside: boolean): void {
    if (this.destroyed || this.retrieved) return;
    this.pulseSec += dt;
    if (this.flashSec > 0) this.flashSec = Math.max(0, this.flashSec - dt);
    this.redraw(inside);
  }

  public setProgress(p: number): void {
    this.progress = Phaser.Math.Clamp(p, 0, 1);
  }

  public getProgress(): number {
    return this.progress;
  }

  public getRetrieved(): boolean {
    return this.retrieved;
  }

  public markRetrieved(): void {
    this.retrieved = true;
  }

  public getWorldPos(): WorldPoint {
    return this.pos;
  }

  public getRadius(): number {
    return this.radius;
  }

  /** Brief red flash when a hit-while-channeling penalty lands. */
  public flashHit(): void {
    this.flashSec = 0.3;
  }

  /** Scale/fade tween + floating text, mirrors BlueprintDrop.collect(). Self-destroys. */
  public playRetrievedFx(label = '+Supplies'): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const txt = this.scene.add
      .text(this.pos.x, this.pos.y - 10, label, {
        fontSize: '16px',
        color: '#9ccc65',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(1000)
      .setOrigin(0.5);
    this.scene.tweens.add({
      targets: txt,
      y: txt.y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => txt.destroy(),
    });

    this.scene.tweens.add({
      targets: this.graphics,
      alpha: 0,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 200,
      onComplete: () => this.graphics.destroy(),
    });
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.graphics.destroy();
  }

  private redraw(inside: boolean): void {
    const g = this.graphics;
    g.clear();

    const pulse = 0.5 + 0.5 * Math.sin(this.pulseSec * 3);
    const color = this.flashSec > 0 ? SupplyCache.HIT_FLASH : SupplyCache.lerpColor(this.progress);
    const { x, y } = this.pos;

    // Translucent fill + solid ring + breathing pulse outline (MissionSystem.drawZoneMarker idiom).
    g.fillStyle(color, inside ? 0.22 : 0.12);
    g.fillCircle(x, y, this.radius);
    g.lineStyle(4, color, inside ? 1 : 0.85);
    g.strokeCircle(x, y, this.radius);
    g.lineStyle(3, color, 0.5 * (1 - pulse));
    g.strokeCircle(x, y, this.radius + pulse * 12);

    // Progress arc around the ring (radial channel readout).
    if (this.progress > 0) {
      g.lineStyle(5, 0xffffff, 0.9);
      const start = Phaser.Math.DegToRad(-90);
      const end = start + Math.PI * 2 * this.progress;
      g.beginPath();
      g.arc(x, y, this.radius - 6, start, end, false);
      g.strokePath();
    }

    // Small procedural crate icon at the center (no new art asset).
    const half = 12;
    g.fillStyle(0x6b4a2f, 0.95);
    g.fillRect(x - half, y - half * 0.75, half * 2, half * 1.5);
    g.lineStyle(2, 0x3e2c1c, 1);
    g.strokeRect(x - half, y - half * 0.75, half * 2, half * 1.5);
    g.lineBetween(x - half, y, x + half, y);
    g.lineBetween(x, y - half * 0.75, x, y + half * 0.75);
  }

  private static lerpColor(t: number): number {
    const [r1, g1, b1] = SupplyCache.COOL_BLUE;
    const [r2, g2, b2] = SupplyCache.AMBER;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
  }
}
