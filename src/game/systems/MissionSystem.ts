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

interface ClassifiedKillPayload {
  type: EnemyType;
  isElite: boolean;
  isBoss: boolean;
  xp: number;
  x: number;
  y: number;
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

  constructor(scene: Game, mission: Mission) {
    this.scene = scene;
    this.mission = mission;
    this.condition = mission.condition;
    this.progress = this.initialProgress();
    this.wireListeners();
    this.createZoneMarker();
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
    return null;
  }

  public getZoneRadius(): number | null {
    if (this.condition.kind === MissionConditionKind.HOLD_ZONE) {
      return this.condition.radius;
    }
    return null;
  }

  private destroyZoneMarker(): void {
    if (this.zoneMarker) {
      this.zoneMarker.destroy();
      this.zoneMarker = undefined;
    }
  }

  public destroy(): void {
    this.destroyZoneMarker();
    const events = this.scene.events;
    if (this.onClassifiedKill) events.off('enemyKilledClassified', this.onClassifiedKill);
    if (this.onEliteDied) events.off('elite_died', this.onEliteDied);
    if (this.onBossDied) events.off('boss_died', this.onBossDied);
    if (this.onPlayerHit) events.off('player_hit', this.onPlayerHit);
    if (this.onPickupCollected) events.off('pickupCollected', this.onPickupCollected);
  }
}
