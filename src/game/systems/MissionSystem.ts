import { Game } from '../scenes/Game';
import { Enemy } from '../entities/Enemy';
import {
  Mission,
  MissionCondition,
  MissionConditionKind,
  MissionProgress,
  WorldPoint,
} from '../types/MissionTypes';
import { EnemyType } from '../types/GameTypes';
import { GameConfig } from '../config/GameConfig';

interface ClassifiedKillPayload {
  type: EnemyType;
  isElite: boolean;
  isBoss: boolean;
  xp: number;
  x: number;
  y: number;
}

/** One control zone's placement + channel state (Control Zone Code Siege). */
interface CzZone {
  pos: WorldPoint;
  progress: number;   // 0..1
  decrypted: boolean;
  flashSec: number;   // hit-penalty flash, mirrors SupplyCache.flashHit
  marker: Phaser.GameObjects.Graphics;
}

/**
 * Per-run mission runtime (§4.1). One instance owned by Game. Subscribes only to
 * the scene events its condition needs, maintains MissionProgress, and emits a
 * single `mission_complete` scene event on win.
 *
 * Polled conditions (SURVIVE_TIME / HOLD_ZONE / FLAWLESS_WINDOW) are driven from
 * Game.update() via update(); everything else is event-driven (O(1), no per-frame
 * cost). The PURGE_TYPE board scan runs once, when the kill threshold is reached.
 */
export class MissionSystem {
  private scene: Game;
  private mission: Mission;
  private condition: MissionCondition;
  private progress: MissionProgress;
  private completeEmitted = false;

  // World-space marker for HOLD_ZONE missions. Created in the constructor and
  // torn down in destroy(); redrawn each update() to pulse + reflect in/out state.
  private zoneMarker?: Phaser.GameObjects.Graphics;
  private zonePulseSec = 0;

  // Bound listener refs so destroy() can detach exactly what was attached.
  private onClassifiedKill?: (p: ClassifiedKillPayload) => void;
  private onEliteDied?: () => void;
  private onBossDied?: () => void;
  private onPlayerHit?: () => void;
  private onPickupCollected?: (p: { type: string }) => void;

  // ── Control Zone Code Siege state (docs/specs/control-zone-code-siege.md) ──
  // Only populated when condition.kind === CONTROL_ZONE_SIEGE; every other
  // mission leaves these at their defaults and never touches the cz* methods.
  private static readonly CZ_MIN_COUNT = 2;
  private static readonly CZ_MAX_COUNT = 4;
  private static readonly CZ_DEFAULT_COUNT = 3;
  private static readonly CZ_DEFAULT_ZONE_RADIUS = 48;
  private static readonly CZ_DEFAULT_DECRYPT_SECONDS = 5;
  private static readonly CZ_DEFAULT_HOLD_RADIUS = 220;
  private static readonly CZ_DEFAULT_HOLD_SECONDS = 40;
  private static readonly CZ_HOLD_DIST_MIN = 700;
  private static readonly CZ_HOLD_DIST_MAX = 900;
  private static readonly CZ_MIN_DIST_FROM_HOLDZONE = 280;
  private static readonly CZ_MAX_DIST_FROM_HOLDZONE = 700;
  private static readonly CZ_MIN_MUTUAL_SPACING = 360;
  private static readonly CZ_PLACEMENT_ATTEMPTS = 20;
  private static readonly CZ_HIT_PENALTY = 0.25;

  private czControlZones: CzZone[] = [];
  private czHoldZone: WorldPoint = { x: 0, y: 0 };
  private czHoldRadius = 0;
  private czHoldMarker?: Phaser.GameObjects.Graphics;
  private czArmed = false;       // all zones decrypted, hold zone unlocked
  private czDwell = 0;           // siege hold-zone dwell accumulator
  private czChanneling = false;  // currently channeling a control zone (fire-suppress)
  private czPulseSec = 0;
  private czZoneRadius = 0;
  private czDecryptSeconds = 0;
  private czHoldSeconds = 0;
  // Geometrically-nearest un-decrypted zone, recomputed each update() tick
  // (getZoneTarget() has no player position of its own to compute this against).
  private czNearestZone: WorldPoint | null = null;

  constructor(scene: Game, mission: Mission, playerX = 0, playerY = 0) {
    this.scene = scene;
    this.mission = mission;
    this.condition = mission.condition;
    this.progress = this.initialProgress();
    this.wireListeners();
    this.createZoneMarker();
    this.setupControlZoneSiege(playerX, playerY);
  }

  /**
   * Build the on-screen zone marker for HOLD_ZONE missions so the player can see
   * where to stand. Drawn in world space (no scroll factor) just above the
   * background and below entities; redrawn each frame by drawZoneMarker().
   */
  private createZoneMarker(): void {
    if (this.condition.kind !== MissionConditionKind.HOLD_ZONE) return;
    const marker = this.scene.add.graphics();
    // Above the background (depth -1) but below the player/enemies (depth 0)
    // so the player sprite reads as standing *on* the zone.
    marker.setDepth(-0.5);
    this.zoneMarker = marker;
    this.drawZoneMarker(false);
  }

  /** Redraw the pulsing zone ring; `inside` brightens it for feedback. */
  private drawZoneMarker(inside: boolean): void {
    if (!this.zoneMarker || this.condition.kind !== MissionConditionKind.HOLD_ZONE) return;
    const c = this.condition;
    const g = this.zoneMarker;
    g.clear();

    // Pulse factor in [0,1] (slow sine), used for the animated outline.
    const pulse = 0.5 + 0.5 * Math.sin(this.zonePulseSec * 3);
    const baseColor = inside ? 0x66ff99 : 0x00ccff;

    // Translucent fill so it never hides what is underneath.
    g.fillStyle(baseColor, inside ? 0.22 : 0.12);
    g.fillCircle(c.location.x, c.location.y, c.radius);

    // Solid inner outline at the exact gameplay radius.
    g.lineStyle(4, baseColor, inside ? 1 : 0.85);
    g.strokeCircle(c.location.x, c.location.y, c.radius);

    // Animated outer pulse ring that breathes outward from the edge.
    g.lineStyle(3, baseColor, 0.5 * (1 - pulse));
    g.strokeCircle(c.location.x, c.location.y, c.radius + pulse * 24);
  }

  private initialProgress(): MissionProgress {
    const c = this.condition;
    switch (c.kind) {
      case MissionConditionKind.KILL_COUNT:
        return { current: 0, goal: c.target, completed: false, failed: false };
      case MissionConditionKind.SURVIVE_TIME:
        return { current: 0, goal: c.seconds, completed: false, failed: false, elapsedSec: 0 };
      case MissionConditionKind.KILL_TYPE:
        return { current: 0, goal: c.target, completed: false, failed: false };
      case MissionConditionKind.HOLD_ZONE:
        return { current: 0, goal: c.holdSeconds, completed: false, failed: false, zoneTimer: 0 };
      case MissionConditionKind.KILL_ELITES:
        return { current: 0, goal: c.target, completed: false, failed: false };
      case MissionConditionKind.SLAY_BOSS:
        return { current: 0, goal: 1, completed: false, failed: false };
      case MissionConditionKind.FLAWLESS_WINDOW:
        return { current: 0, goal: c.seconds, completed: false, failed: false, windowStartSec: 0, elapsedSec: 0 };
      case MissionConditionKind.COLLECT_DROPS:
        return { current: 0, goal: c.target, completed: false, failed: false };
      case MissionConditionKind.PURGE_TYPE:
        return { current: 0, goal: c.target, completed: false, failed: false };
      case MissionConditionKind.CONTROL_ZONE_SIEGE:
        // goal starts as the zone count (scout phase); armSiege() flips it to
        // holdSeconds once all zones are decrypted (§9.2 — this condition owns
        // two phases, unlike every other kind's single fixed goal).
        return {
          current: 0,
          goal: Phaser.Math.Clamp(
            c.zoneCount ?? MissionSystem.CZ_DEFAULT_COUNT,
            MissionSystem.CZ_MIN_COUNT,
            MissionSystem.CZ_MAX_COUNT
          ),
          completed: false,
          failed: false,
          zoneTimer: 0,
        };
    }
  }

  private wireListeners(): void {
    const c = this.condition;
    const events = this.scene.events;

    switch (c.kind) {
      case MissionConditionKind.KILL_COUNT:
        this.onClassifiedKill = () => {
          if (this.progress.completed) return;
          this.progress.current++;
          if (this.progress.current >= this.progress.goal) this.complete();
        };
        events.on('enemyKilledClassified', this.onClassifiedKill);
        break;

      case MissionConditionKind.KILL_TYPE:
        this.onClassifiedKill = (p) => {
          if (this.progress.completed) return;
          // Only count base enemies of the matching type — elites/bosses carry a
          // base EnemyType but should not satisfy a "kill type" objective.
          if (p.type === c.enemyType && !p.isElite && !p.isBoss) {
            this.progress.current++;
            if (this.progress.current >= this.progress.goal) this.complete();
          }
        };
        events.on('enemyKilledClassified', this.onClassifiedKill);
        break;

      case MissionConditionKind.KILL_ELITES:
        this.onEliteDied = () => {
          if (this.progress.completed) return;
          this.progress.current++;
          if (this.progress.current >= this.progress.goal) this.complete();
        };
        events.on('elite_died', this.onEliteDied);
        break;

      case MissionConditionKind.SLAY_BOSS:
        this.onBossDied = () => {
          if (this.progress.completed) return;
          this.progress.current = 1;
          this.complete();
        };
        events.on('boss_died', this.onBossDied);
        break;

      case MissionConditionKind.COLLECT_DROPS:
        this.onPickupCollected = (p) => {
          if (this.progress.completed) return;
          if (c.pickupTypes && c.pickupTypes.length > 0 && !c.pickupTypes.includes(p.type)) return;
          this.progress.current++;
          if (this.progress.current >= this.progress.goal) this.complete();
        };
        events.on('pickupCollected', this.onPickupCollected);
        break;

      case MissionConditionKind.PURGE_TYPE:
        this.onClassifiedKill = (p) => {
          if (this.progress.completed) return;
          if (p.type === c.enemyType && !p.isElite && !p.isBoss) {
            this.progress.current++;
          }
          // Once the kill threshold is reached, gate completion on a one-shot
          // board-clear scan (if required). Re-checked on each subsequent kill.
          if (this.progress.current >= this.progress.goal) {
            if (!c.requireBoardClearAtFinish || this.isBoardClearOf(c.enemyType)) {
              this.complete();
            } else {
              // Flash a transient "not yet clear" failure for the HUD, then reset.
              this.flashFailed();
            }
          }
        };
        events.on('enemyKilledClassified', this.onClassifiedKill);
        break;

      case MissionConditionKind.FLAWLESS_WINDOW:
        // Any hit restarts the clean window from the current run time.
        this.onPlayerHit = () => {
          if (this.progress.completed) return;
          // Restart the clean window from zero.
          this.progress.elapsedSec = 0;
          this.progress.current = 0;
          this.flashFailed();
        };
        events.on('player_hit', this.onPlayerHit);
        break;

      case MissionConditionKind.CONTROL_ZONE_SIEGE:
        // Hit-while-channeling penalty on whichever control zone the player is
        // currently inside (mirrors SupplyCacheSystem.handlePlayerHit, §3).
        this.onPlayerHit = () => this.handleCzPlayerHit();
        events.on('player_hit', this.onPlayerHit);
        break;

      case MissionConditionKind.SURVIVE_TIME:
      case MissionConditionKind.HOLD_ZONE:
        // Pure poll conditions — handled in update(), no listeners needed.
        break;
    }
  }

  // Called from Game.update(); dt in seconds. playTimeSec (cumulative run time)
  // is retained in the signature for callers/HUD but is no longer used to drive
  // the timed conditions — they accumulate dt locally so they are immune to a
  // stale cumulative clock from a reused scene instance.
  public update(dt: number, _playTimeSec: number, playerX: number, playerY: number): void {
    if (this.progress.completed) return;
    const c = this.condition;

    switch (c.kind) {
      case MissionConditionKind.SURVIVE_TIME: {
        // Accumulate elapsed *active* run time locally (mirrors HOLD_ZONE's
        // zoneTimer += dt) instead of slaving to the cumulative playTimeSec.
        // Game.update() already early-returns during pause / elite intro, so dt
        // only flows while the run is actually live. This keeps the timer correct
        // and self-contained even if playTimeSec is stale from a reused scene.
        const elapsed = (this.progress.elapsedSec ?? 0) + dt;
        this.progress.elapsedSec = elapsed;
        this.progress.current = Math.min(elapsed, c.seconds);
        if (elapsed >= c.seconds) this.complete();
        break;
      }

      case MissionConditionKind.HOLD_ZONE: {
        const dist = Phaser.Math.Distance.Between(playerX, playerY, c.location.x, c.location.y);
        const inside = dist <= c.radius;
        // Keep the marker animated and reflecting in/out state.
        this.zonePulseSec += dt;
        this.drawZoneMarker(inside);
        if (inside) {
          this.progress.zoneTimer = (this.progress.zoneTimer ?? 0) + dt;
        } else if (c.continuous) {
          this.progress.zoneTimer = 0;
        }
        this.progress.current = Math.floor(this.progress.zoneTimer ?? 0);
        if ((this.progress.zoneTimer ?? 0) >= c.holdSeconds) this.complete();
        break;
      }

      case MissionConditionKind.FLAWLESS_WINDOW: {
        // Accumulate the clean window locally; the player_hit listener resets it.
        // Self-contained (does not depend on cumulative playTimeSec) so it is
        // correct regardless of scene-reuse state.
        const elapsed = (this.progress.elapsedSec ?? 0) + dt;
        this.progress.elapsedSec = elapsed;
        this.progress.current = Math.min(elapsed, c.seconds);
        if (elapsed >= c.seconds) this.complete();
        break;
      }

      case MissionConditionKind.CONTROL_ZONE_SIEGE:
        this.updateControlZoneSiege(dt, playerX, playerY);
        break;

      default:
        break;
    }
  }

  private isBoardClearOf(type: EnemyType): boolean {
    const group = this.scene.getEnemiesGroup();
    if (!group) return true;
    const children = group.getChildren() as Enemy[];
    return !children.some((e) => {
      if (!e.active) return false;
      const cls = e.getKillClass();
      return cls.type === type && !cls.isElite && !cls.isBoss;
    });
  }

  private flashFailed(): void {
    this.progress.failed = true;
    // Transient — cleared shortly after so the HUD can flash without ending the run.
    this.scene.time.delayedCall(600, () => {
      if (!this.progress.completed) this.progress.failed = false;
    });
  }

  private complete(): void {
    if (this.completeEmitted) return;
    this.completeEmitted = true;
    this.progress.completed = true;
    this.progress.failed = false;
    this.destroyZoneMarker();
    this.destroyControlZoneSiegeMarkers();
    this.scene.events.emit('mission_complete', this.mission);
  }

  public getProgress(): MissionProgress {
    return this.progress;
  }

  public getMission(): Mission {
    return this.mission;
  }

  public isComplete(): boolean {
    return this.progress.completed;
  }

  /** Human-readable progress line for the HUD (e.g. "Toxic killed: 23 / 30"). */
  public getDetailLabel(): string {
    const c = this.condition;
    const p = this.progress;
    switch (c.kind) {
      case MissionConditionKind.KILL_COUNT:
        return `Kills: ${p.current} / ${p.goal}`;
      case MissionConditionKind.SURVIVE_TIME:
        return `Survived: ${Math.floor(p.current)}s / ${p.goal}s`;
      case MissionConditionKind.KILL_TYPE:
        return `${this.typeLabel(c.enemyType)} killed: ${p.current} / ${p.goal}`;
      case MissionConditionKind.HOLD_ZONE:
        return `Zone held: ${p.current}s / ${p.goal}s`;
      case MissionConditionKind.KILL_ELITES:
        return `Elites slain: ${p.current} / ${p.goal}`;
      case MissionConditionKind.SLAY_BOSS:
        return p.completed ? 'Boss slain!' : 'Slay the boss';
      case MissionConditionKind.FLAWLESS_WINDOW:
        return `Clean: ${Math.floor(p.current)}s / ${p.goal}s`;
      case MissionConditionKind.COLLECT_DROPS:
        return `Collected: ${p.current} / ${p.goal}`;
      case MissionConditionKind.PURGE_TYPE:
        return `${this.typeLabel(c.enemyType)} purged: ${p.current} / ${p.goal}`;
      case MissionConditionKind.CONTROL_ZONE_SIEGE:
        return this.czArmed
          ? `Zone held: ${p.current}s / ${p.goal}s`
          : `Zones decrypted: ${p.current} / ${p.goal}`;
    }
  }

  private typeLabel(type: EnemyType): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /** Zone center for the HUD pointer/ring, or null if this mission has no zone. */
  public getZoneTarget(): WorldPoint | null {
    if (this.condition.kind === MissionConditionKind.HOLD_ZONE) {
      return this.condition.location;
    }
    if (this.condition.kind === MissionConditionKind.CONTROL_ZONE_SIEGE) {
      if (this.czArmed) return this.czHoldZone;
      return this.czNearestZone ?? this.czHoldZone;
    }
    return null;
  }

  public getZoneRadius(): number | null {
    if (this.condition.kind === MissionConditionKind.HOLD_ZONE) {
      return this.condition.radius;
    }
    if (this.condition.kind === MissionConditionKind.CONTROL_ZONE_SIEGE) {
      return this.czArmed ? this.czHoldRadius : this.czZoneRadius;
    }
    return null;
  }

  /** True while the player is channeling a control zone (gates weapon fire, §3). */
  public isChanneling(): boolean {
    return this.czChanneling;
  }

  /** True once all control zones are decrypted and the hold-zone siege is live. */
  public isSiegeArmed(): boolean {
    return this.czArmed;
  }

  /** Hold-zone center once armed — Game.update() drives uncapped siege spawning here. */
  public getSiegeZone(): WorldPoint | null {
    return this.czArmed ? this.czHoldZone : null;
  }

  private destroyZoneMarker(): void {
    if (this.zoneMarker) {
      this.zoneMarker.destroy();
      this.zoneMarker = undefined;
    }
  }

  private destroyControlZoneSiegeMarkers(): void {
    this.czHoldMarker?.destroy();
    this.czHoldMarker = undefined;
    for (const zone of this.czControlZones) zone.marker.destroy();
    this.czControlZones = [];
  }

  public destroy(): void {
    this.destroyZoneMarker();
    this.destroyControlZoneSiegeMarkers();
    const events = this.scene.events;
    if (this.onClassifiedKill) events.off('enemyKilledClassified', this.onClassifiedKill);
    if (this.onEliteDied) events.off('elite_died', this.onEliteDied);
    if (this.onBossDied) events.off('boss_died', this.onBossDied);
    if (this.onPlayerHit) events.off('player_hit', this.onPlayerHit);
    if (this.onPickupCollected) events.off('pickupCollected', this.onPickupCollected);
  }

  // ── Control Zone Code Siege (docs/specs/control-zone-code-siege.md) ──

  /**
   * Resolve tunables, place the hold zone + control zones, and build their
   * Graphics markers. No-op for every other condition kind.
   */
  private setupControlZoneSiege(playerX: number, playerY: number): void {
    if (this.condition.kind !== MissionConditionKind.CONTROL_ZONE_SIEGE) return;
    const c = this.condition;

    const count = Phaser.Math.Clamp(
      c.zoneCount ?? MissionSystem.CZ_DEFAULT_COUNT,
      MissionSystem.CZ_MIN_COUNT,
      MissionSystem.CZ_MAX_COUNT
    );
    this.czZoneRadius = c.zoneRadius ?? MissionSystem.CZ_DEFAULT_ZONE_RADIUS;
    this.czDecryptSeconds = c.decryptSeconds ?? MissionSystem.CZ_DEFAULT_DECRYPT_SECONDS;
    this.czHoldRadius = c.holdZoneRadius ?? MissionSystem.CZ_DEFAULT_HOLD_RADIUS;
    this.czHoldSeconds = c.holdSeconds ?? MissionSystem.CZ_DEFAULT_HOLD_SECONDS;

    this.placeHoldZone(playerX, playerY);
    this.placeControlZones(count, playerX, playerY);

    const marker = this.scene.add.graphics();
    marker.setDepth(-0.5);
    this.czHoldMarker = marker;
    this.drawHoldZoneMarker(false);
  }

  /**
   * Place the hold zone at a random angle, distance-banded from the player's
   * start position (mirrors ExtractionSystem.placeZone, but a band instead of a
   * fixed distance — §2). Clamped to world bounds; falls back to the
   * furthest-tried point if every attempt lands too close to the player.
   */
  private placeHoldZone(playerX: number, playerY: number): void {
    const W = GameConfig.WORLD.WIDTH;
    const H = GameConfig.WORLD.HEIGHT;
    const margin = this.czHoldRadius + 64;
    const minSafe = this.czHoldRadius + 96;

    let best: WorldPoint = { x: playerX, y: playerY };
    let bestDist = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Linear(
        MissionSystem.CZ_HOLD_DIST_MIN,
        MissionSystem.CZ_HOLD_DIST_MAX,
        Math.random()
      );
      const x = Phaser.Math.Clamp(playerX + Math.cos(angle) * dist, margin, W - margin);
      const y = Phaser.Math.Clamp(playerY + Math.sin(angle) * dist, margin, H - margin);
      const d = Phaser.Math.Distance.Between(playerX, playerY, x, y);
      if (d >= minSafe) {
        this.czHoldZone = { x, y };
        return;
      }
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
    this.czHoldZone = best;
  }

  /**
   * Scatter `count` control zones in a distance band AROUND THE HOLD ZONE (not
   * the player — §2's deliberate deviation from SupplyCacheSystem.placeCaches),
   * rejecting spots too close to the player's own spawn or to an already-placed
   * zone. Tracks a best-scoring fallback so placement always terminates.
   */
  private placeControlZones(count: number, playerX: number, playerY: number): void {
    const W = GameConfig.WORLD.WIDTH;
    const H = GameConfig.WORLD.HEIGHT;
    const margin = this.czZoneRadius + 64;
    const minFromPlayer = this.czZoneRadius + 96;
    const placed: WorldPoint[] = [];

    for (let i = 0; i < count; i++) {
      let best: WorldPoint = { x: this.czHoldZone.x, y: this.czHoldZone.y };
      let bestScore = -1;

      for (let attempt = 0; attempt < MissionSystem.CZ_PLACEMENT_ATTEMPTS; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Phaser.Math.Linear(
          MissionSystem.CZ_MIN_DIST_FROM_HOLDZONE,
          MissionSystem.CZ_MAX_DIST_FROM_HOLDZONE,
          Math.random()
        );
        const x = Phaser.Math.Clamp(this.czHoldZone.x + Math.cos(angle) * dist, margin, W - margin);
        const y = Phaser.Math.Clamp(this.czHoldZone.y + Math.sin(angle) * dist, margin, H - margin);

        const distFromPlayer = Phaser.Math.Distance.Between(playerX, playerY, x, y);
        const distFromNearestZone = placed.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(...placed.map((p) => Phaser.Math.Distance.Between(p.x, p.y, x, y)));

        const valid = distFromPlayer >= minFromPlayer
          && distFromNearestZone >= MissionSystem.CZ_MIN_MUTUAL_SPACING;
        if (valid) {
          best = { x, y };
          bestScore = Number.POSITIVE_INFINITY;
          break;
        }

        const score = Math.min(distFromPlayer, distFromNearestZone);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }

      placed.push(best);
      const marker = this.scene.add.graphics();
      marker.setDepth(-0.5);
      this.czControlZones.push({ pos: best, progress: 0, decrypted: false, flashSec: 0, marker });
    }
  }

  /**
   * Scout/decrypt phase before the siege arms: advance whichever zone(s) the
   * player is standing in (pause-not-reset on leaving, §3), then the siege
   * phase itself once armed (continuous dwell, reset-on-leave, §6).
   */
  private updateControlZoneSiege(dt: number, playerX: number, playerY: number): void {
    if (this.condition.kind !== MissionConditionKind.CONTROL_ZONE_SIEGE) return;
    this.czPulseSec += dt;

    if (!this.czArmed) {
      let channeling = false;
      let nearest: CzZone | null = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (const zone of this.czControlZones) {
        if (zone.decrypted) continue;
        if (zone.flashSec > 0) zone.flashSec = Math.max(0, zone.flashSec - dt);

        const dist = Phaser.Math.Distance.Between(playerX, playerY, zone.pos.x, zone.pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = zone;
        }
        const inside = dist <= this.czZoneRadius;
        if (inside) {
          channeling = true;
          zone.progress = Math.min(1, zone.progress + dt / this.czDecryptSeconds);
          if (zone.progress >= 1) {
            zone.decrypted = true;
            this.progress.current++;
            this.scene.events.emit('control_zone_decrypted', {
              decrypted: this.progress.current,
              total: this.czControlZones.length,
            });
          }
        }
        // else: paused, not reset — progress holds while outside the radius.
        this.drawControlZoneMarker(zone, inside);
      }
      this.czChanneling = channeling;
      // Cache the geometrically-nearest un-decrypted zone for getZoneTarget() —
      // it has no player position of its own to compute this against.
      this.czNearestZone = nearest ? nearest.pos : null;
      this.drawHoldZoneMarker(false);

      if (this.czControlZones.every((z) => z.decrypted)) this.armSiege();
      return;
    }

    this.czChanneling = false;
    const insideHold = Phaser.Math.Distance.Between(playerX, playerY, this.czHoldZone.x, this.czHoldZone.y) <= this.czHoldRadius;
    this.drawHoldZoneMarker(insideHold);
    if (insideHold) {
      this.czDwell += dt;
    } else {
      this.czDwell = 0; // continuous: reset-on-leave (§6 locked decision)
    }
    this.progress.current = Math.floor(this.czDwell);
    if (this.czDwell >= this.czHoldSeconds) this.complete();
  }

  /** All zones decrypted: flip the hold zone locked→armed and announce it (§4). */
  private armSiege(): void {
    if (this.czArmed) return;
    this.czArmed = true;
    this.progress.current = 0;
    this.progress.goal = this.czHoldSeconds;
    for (const zone of this.czControlZones) this.drawControlZoneMarker(zone, false);
    this.scene.events.emit('control_zone_code_assembled', this.mission);
  }

  /** Hit-while-channeling penalty on whichever zone the player is inside (§3). */
  private handleCzPlayerHit(): void {
    const player = this.scene.getPlayer();
    if (!player) return;
    for (const zone of this.czControlZones) {
      if (zone.decrypted) continue;
      const inside = Phaser.Math.Distance.Between(player.x, player.y, zone.pos.x, zone.pos.y) <= this.czZoneRadius;
      if (inside) {
        zone.progress = Math.max(0, zone.progress - MissionSystem.CZ_HIT_PENALTY);
        zone.flashSec = 0.3;
        break; // mutual spacing guarantees at most one match
      }
    }
  }

  /** Cyan→green decrypting dial, distinct from SupplyCache's blue→amber (§3). */
  private drawControlZoneMarker(zone: CzZone, inside: boolean): void {
    if (zone.decrypted) {
      zone.marker.clear();
      return;
    }
    const g = zone.marker;
    g.clear();

    const pulse = 0.5 + 0.5 * Math.sin(this.czPulseSec * 3);
    const color = zone.flashSec > 0 ? 0xff3333 : MissionSystem.lerpCzColor(zone.progress);
    const { x, y } = zone.pos;

    g.fillStyle(color, inside ? 0.24 : 0.12);
    g.fillCircle(x, y, this.czZoneRadius);
    g.lineStyle(4, color, inside ? 1 : 0.85);
    g.strokeCircle(x, y, this.czZoneRadius);
    g.lineStyle(3, color, 0.5 * (1 - pulse));
    g.strokeCircle(x, y, this.czZoneRadius + pulse * 12);

    if (zone.progress > 0) {
      g.lineStyle(5, 0xffffff, 0.9);
      const start = Phaser.Math.DegToRad(-90);
      const end = start + Math.PI * 2 * zone.progress;
      g.beginPath();
      g.arc(x, y, this.czZoneRadius - 6, start, end, false);
      g.strokePath();
    }
  }

  /** Dim/inert while locked (§5); pulsing HOLD_ZONE idiom once armed. */
  private drawHoldZoneMarker(inside: boolean): void {
    if (!this.czHoldMarker) return;
    const g = this.czHoldMarker;
    const { x, y } = this.czHoldZone;
    g.clear();

    if (!this.czArmed) {
      g.fillStyle(0x888888, 0.08);
      g.fillCircle(x, y, this.czHoldRadius);
      g.lineStyle(3, 0x888888, 0.5);
      g.strokeCircle(x, y, this.czHoldRadius);
      return;
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.czPulseSec * 3);
    const baseColor = inside ? 0x66ff99 : 0x00ccff;
    g.fillStyle(baseColor, inside ? 0.22 : 0.12);
    g.fillCircle(x, y, this.czHoldRadius);
    g.lineStyle(4, baseColor, inside ? 1 : 0.85);
    g.strokeCircle(x, y, this.czHoldRadius);
    g.lineStyle(3, baseColor, 0.5 * (1 - pulse));
    g.strokeCircle(x, y, this.czHoldRadius + pulse * 24);
  }

  /** cyan (0x00ccff) → green (0x66ff99), matching this file's HOLD_ZONE palette. */
  private static lerpCzColor(t: number): number {
    const c1: [number, number, number] = [0x00, 0xcc, 0xff];
    const c2: [number, number, number] = [0x66, 0xff, 0x99];
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return (r << 16) | (g << 8) | b;
  }
}
