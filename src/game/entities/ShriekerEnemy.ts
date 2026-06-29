import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';
import { Game } from '../scenes/Game';

/**
 * Shrieker — pack-rally aura enemy. Slow and fragile, it hangs at the back of a
 * pack and projects a pulsing aura that buffs nearby "normal" zombies (+speed,
 * +damage). Because most weapons auto-target the NEAREST enemy, a Shrieker at the
 * rear is killed last — the player must reposition to prioritize it. Killing it
 * (or simply moving the pack out of its aura) lets the buff decay back to
 * baseline via the refresh-timer pattern on Enemy.applyRally().
 */
export class ShriekerEnemy extends Enemy {
  // Aura radius in world pixels.
  private static readonly AURA_RADIUS = 180;
  // Buff strength. Damage scaling is derived inside applyRally() (~1.3x here).
  private static readonly RALLY_SPEED_FACTOR = 1.4;
  // Refresh window must outlast the scan cadence so the buff stays topped-up
  // while in range, but expires shortly after the enemy leaves the aura / the
  // Shrieker dies. We scan every frame, so a few hundred ms is plenty.
  private static readonly RALLY_DURATION_MS = 300;

  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowFollowEvent?: Phaser.Time.TimerEvent;
  private auraRing: Phaser.GameObjects.Arc | null = null;
  private auraTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.SHRIEKER);
    this.setTint(0xff3344);
    // Pulsing red glow so the Shrieker reads as a priority target.
    const hadGlow = this.tryAddGlow(0xff3344, 10, 0, false, 0.25, 16);
    if (!hadGlow) {
      // Fallback halo for environments without preFX (e.g., Canvas renderer).
      this.glowSprite = this.scene.add.sprite(this.x, this.y, this.texture.key);
      this.glowSprite.setScale(this.scaleX * 1.3, this.scaleY * 1.3);
      this.glowSprite.setTint(0xff3344).setAlpha(0.4);
      this.glowSprite.setBlendMode(Phaser.BlendModes.ADD);
      this.glowSprite.setDepth(this.depth - 1);
      this.glowFollowEvent = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
        if (this.glowSprite && this.active) this.glowSprite.setPosition(this.x, this.y);
      }});
    }

    // A faint, pulsing red ring drawn at the aura radius so the buff zone reads.
    this.auraRing = this.scene.add.circle(this.x, this.y, ShriekerEnemy.AURA_RADIUS, 0xff3344, 0.0);
    this.auraRing.setStrokeStyle(2, 0xff3344, 0.5);
    this.auraRing.setDepth(this.depth - 1);
    this.auraTween = this.scene.tweens.add({
      targets: this.auraRing,
      scale: { from: 0.85, to: 1.0 },
      alpha: { from: 0.5, to: 0.15 },
      duration: 900,
      yoyo: true,
      repeat: -1
    });
  }

  /**
   * Per-frame behavior: shamble toward the player like a normal zombie, then scan
   * the enemy group and rally nearby normal zombies. The rally is re-applied every
   * frame an enemy is in range; applyRally() snapshots the baseline once and always
   * recomputes from it, so repeated calls do NOT compound. When the enemy leaves
   * the aura (or this Shrieker dies), the rally refresh stops and the buff decays
   * back to baseline after RALLY_DURATION_MS.
   */
  public updateBehavior(player: Phaser.Physics.Arcade.Sprite): void {
    if (!this.active) return;

    // Keep the aura visuals pinned to the Shrieker.
    if (this.auraRing) this.auraRing.setPosition(this.x, this.y);

    // Move like a basic zombie so it still advances with the pack.
    this.moveTowardsPlayer(player);

    const scene = this.scene as Game;
    const group = (scene && scene.getEnemiesGroup) ? scene.getEnemiesGroup() : null;
    if (!group) return;

    const radiusSq = ShriekerEnemy.AURA_RADIUS * ShriekerEnemy.AURA_RADIUS;
    const children = group.getChildren() as Enemy[];
    for (const other of children) {
      if (other === this || !other.active) continue;
      // Only buff plain rank-and-file zombies. Don't rally other Shriekers,
      // ranged/carrier/toxic specials, elites, or bosses.
      if (!ShriekerEnemy.isRallyable(other)) continue;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      if (dx * dx + dy * dy <= radiusSq) {
        other.applyRally(ShriekerEnemy.RALLY_SPEED_FACTOR, ShriekerEnemy.RALLY_DURATION_MS);
      }
    }
  }

  /** Only the basic horde types get the rally buff. */
  private static isRallyable(enemy: Enemy): boolean {
    if (enemy instanceof ShriekerEnemy) return false;
    const kc = enemy.getKillClass();
    if (kc.isElite || kc.isBoss) return false;
    return kc.type === EnemyType.BASIC
      || kc.type === EnemyType.FAST
      || kc.type === EnemyType.TANK;
  }

  public override destroy(fromScene?: boolean): void {
    if (this.glowFollowEvent) this.glowFollowEvent.destroy();
    if (this.auraTween) this.auraTween.remove();
    // The glow sprite and aura ring are scene-owned display objects. On a full
    // scene shutdown Phaser's DisplayList destroys them on its own pass, so
    // destroying them here would double-remove and corrupt that iteration.
    if (!fromScene) {
      this.glowSprite?.destroy();
      this.auraRing?.destroy();
    }
    super.destroy(fromScene);
  }
}
