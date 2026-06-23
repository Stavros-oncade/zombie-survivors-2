import Phaser from 'phaser';
import { Game } from '../scenes/Game';
import { Mission, WorldPoint } from '../types/MissionTypes';
import { GameConfig } from '../config/GameConfig';
import { EnemySpawnSystem } from './EnemySpawnSystem';

/**
 * Optional "Extraction" mission end. Owned by Game and constructed only when a
 * mission's primary objective completes AND `mission.extraction.enabled`. Mirrors
 * MissionSystem's HOLD_ZONE precedent: a pulsing world-space ring the player must
 * reach and dwell inside (reset-on-leave) to win. During the phase, Game drives
 * uncapped directional spawning (see EnemySpawnSystem.beginExtractionSpawning).
 *
 * State machine:
 *   IDLE -> ARMED (zone placed)        on begin()
 *   ARMED <-> DWELLING                 player enters/leaves the zone (dwell resets on leave)
 *   DWELLING -> EXTRACTED              dwell >= dwellSeconds (latched, emits extraction_complete)
 *
 * Completion is also gated by a `done` latch and a player.getIsDead() check so a
 * death in the same frame as dwell-complete loses, not wins.
 */
export enum ExtractionState {
  IDLE = 'idle',
  ARMED = 'armed',
  DWELLING = 'dwelling',
  EXTRACTED = 'extracted',
}

export class ExtractionSystem {
  // Fixed distance from the player to drop the extraction zone — ~one viewport
  // away so it starts off-screen but is reachable.
  private static readonly EXTRACT_SPAWN_DIST = 600;
  private static readonly DEFAULT_RADIUS = 160;
  private static readonly DEFAULT_DWELL = 3;

  private scene: Game;
  private mission: Mission;
  private spawnSystem?: EnemySpawnSystem;

  private state: ExtractionState = ExtractionState.IDLE;
  private zone: WorldPoint = { x: 0, y: 0 };
  private radius: number;
  private dwellSeconds: number;
  private dwell = 0;
  private done = false;

  private zoneMarker?: Phaser.GameObjects.Graphics;
  private zonePulseSec = 0;

  constructor(scene: Game, mission: Mission, spawnSystem?: EnemySpawnSystem) {
    this.scene = scene;
    this.mission = mission;
    this.spawnSystem = spawnSystem;
    this.radius = mission.extraction?.radius ?? ExtractionSystem.DEFAULT_RADIUS;
    this.dwellSeconds = mission.extraction?.dwellSeconds ?? ExtractionSystem.DEFAULT_DWELL;
  }

  /** Place the zone, create its marker, arm the state machine, announce. */
  public begin(playerX: number, playerY: number): void {
    if (this.state !== ExtractionState.IDLE) return;
    this.placeZone(playerX, playerY);
    this.createZoneMarker();
    this.state = ExtractionState.ARMED;
    this.scene.events.emit('extraction_started', { zone: { ...this.zone }, radius: this.radius });
  }

  /**
   * Pick a point at EXTRACT_SPAWN_DIST from the player at a random angle, clamped
   * to world bounds with a margin so it is never half off-map. If the clamp pulls
   * it back on top of the player, re-roll the angle / push outward.
   */
  private placeZone(playerX: number, playerY: number): void {
    const W = GameConfig.WORLD.WIDTH;
    const H = GameConfig.WORLD.HEIGHT;
    const margin = this.radius + 64;
    const minSafe = this.radius + 96; // never effectively on top of the player

    let best: WorldPoint = { x: playerX, y: playerY };
    let bestDist = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const x = Phaser.Math.Clamp(
        playerX + Math.cos(angle) * ExtractionSystem.EXTRACT_SPAWN_DIST,
        margin,
        W - margin
      );
      const y = Phaser.Math.Clamp(
        playerY + Math.sin(angle) * ExtractionSystem.EXTRACT_SPAWN_DIST,
        margin,
        H - margin
      );
      const d = Phaser.Math.Distance.Between(playerX, playerY, x, y);
      if (d >= minSafe) {
        this.zone = { x, y };
        return;
      }
      // Track the furthest fallback in case every roll clamps near the player
      // (player pinned in a corner of a small map).
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
    this.zone = best;
  }

  /** Per-frame update. dt in seconds. Drives the dwell timer + marker pulse. */
  public update(dt: number, playerX: number, playerY: number): void {
    if (this.done || this.state === ExtractionState.IDLE) return;

    const inside = Phaser.Math.Distance.Between(playerX, playerY, this.zone.x, this.zone.y) <= this.radius;

    this.zonePulseSec += dt;
    this.drawZoneMarker(inside);

    if (inside) {
      this.state = ExtractionState.DWELLING;
      this.dwell += dt;
      if (this.dwell >= this.dwellSeconds) this.complete();
    } else {
      // Reset-on-leave (proven HOLD_ZONE continuous behavior).
      this.state = ExtractionState.ARMED;
      this.dwell = 0;
    }
  }

  /**
   * Latch completion and emit `extraction_complete`. Guarded by the `done` latch
   * and a death check so a death in the same frame as dwell-complete loses.
   */
  private complete(): void {
    if (this.done) return;
    if (this.scene.getPlayer()?.getIsDead()) return;
    this.done = true;
    this.state = ExtractionState.EXTRACTED;
    this.destroyZoneMarker();
    this.scene.events.emit('extraction_complete', this.mission);
  }

  private createZoneMarker(): void {
    const marker = this.scene.add.graphics();
    marker.setDepth(-0.5);
    this.zoneMarker = marker;
    this.drawZoneMarker(false);
  }

  /** Pulsing green ring; brightens when the player is inside (mirrors HOLD_ZONE). */
  private drawZoneMarker(inside: boolean): void {
    if (!this.zoneMarker) return;
    const g = this.zoneMarker;
    const { x, y } = this.zone;
    g.clear();

    const pulse = 0.5 + 0.5 * Math.sin(this.zonePulseSec * 3);
    const baseColor = 0x44ff88;

    g.fillStyle(baseColor, inside ? 0.24 : 0.12);
    g.fillCircle(x, y, this.radius);

    g.lineStyle(4, baseColor, inside ? 1 : 0.85);
    g.strokeCircle(x, y, this.radius);

    g.lineStyle(3, baseColor, 0.5 * (1 - pulse));
    g.strokeCircle(x, y, this.radius + pulse * 24);
  }

  private destroyZoneMarker(): void {
    if (this.zoneMarker) {
      this.zoneMarker.destroy();
      this.zoneMarker = undefined;
    }
  }

  public isActive(): boolean {
    return this.state !== ExtractionState.IDLE && !this.done;
  }

  public isDone(): boolean {
    return this.done;
  }

  public getDwellRemaining(): number {
    return Math.max(0, this.dwellSeconds - this.dwell);
  }

  public getZone(): WorldPoint {
    return this.zone;
  }

  public getRadius(): number {
    return this.radius;
  }

  /**
   * Tear down: stop the uncapped extraction spawning and destroy the marker so
   * nothing leaks into GameOver. Safe to call multiple times.
   */
  public destroy(): void {
    this.spawnSystem?.endExtractionSpawning();
    this.destroyZoneMarker();
  }
}
