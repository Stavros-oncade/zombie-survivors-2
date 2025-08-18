import { Game } from '../scenes/Game';
import { DefensiveSkillId, GasCloudTag } from '../types/GameTypes';
import { Player } from '../entities/Player';

export class SkillSystem {
  private game: Game;
  private skill: DefensiveSkillId;
  private level = 1;
  private cooldownMs = 1200;
  private lastUsed = -9999;
  private barrierActive = false;

  constructor(game: Game, skill: DefensiveSkillId) {
    this.game = game;
    this.skill = skill;
  }

  public levelUp() { this.level = Math.min(5, this.level + 1); }

  public getCooldownTotalMs(): number {
    return Math.max(400, this.cooldownMs - (this.level - 1) * 150);
  }

  public getCooldownRemainingMs(nowMs: number): number {
    const total = this.getCooldownTotalMs();
    const elapsed = nowMs - this.lastUsed;
    return Math.max(0, total - elapsed);
  }

  public tryActivate(): boolean {
    const now = this.game.time.now;
    const cd = Math.max(400, this.cooldownMs - (this.level - 1) * 150);
    if (now - this.lastUsed < cd) return false;
    this.lastUsed = now;
    if (this.skill === DefensiveSkillId.DASH) this.activateDash();
    if (this.skill === DefensiveSkillId.BARRIER) this.activateBarrier();
    if (this.skill === DefensiveSkillId.REPULSE) this.activateRepulse();
    return true;
  }

  private activateDash() {
    const player: Player = this.game.getPlayer();
    // Velocity burst in movement direction, brief i-frames
    const cursors = this.game.getCursors();
    const wasd = this.game.getWasdKeys();
    const dir = new Phaser.Math.Vector2(0,0);
    const push = 600 + (this.level - 1) * 80;
    if (cursors?.left?.isDown || wasd?.left?.isDown) dir.x = -1;
    if (cursors?.right?.isDown || wasd?.right?.isDown) dir.x = 1;
    if (cursors?.up?.isDown || wasd?.up?.isDown) dir.y = -1;
    if (cursors?.down?.isDown || wasd?.down?.isDown) dir.y = 1;
    if (dir.lengthSq() === 0) dir.y = -1; // default dash up
    dir.normalize();
    (player.body as Phaser.Physics.Arcade.Body).setVelocity(dir.x * push, dir.y * push);
    // i-frames
    player.grantImmunity(250 + (this.level - 1) * 40);
    this.game.cameras.main.shake(80, 0.003);
  }

  private activateBarrier() {
    if (this.barrierActive) return;
    this.barrierActive = true;
    const player: Player = this.game.getPlayer();
    const g = this.game.add.graphics();
    g.lineStyle(3, 0x00ffaa, 0.9);
    g.strokeCircle(0, 0, 26 + this.level * 2);
    g.setDepth(999);
    g.setScrollFactor(1);
    // Follow player until duration ends
    g.x = player.x; g.y = player.y;
    const follow = this.game.time.addEvent({ delay: 16, loop: true, callback: () => { if (!g.active) return; g.x = player.x; g.y = player.y; }});
    const dur = 1200 + (this.level-1)*200;
    this.game.time.delayedCall(dur, () => { g.destroy(); follow.destroy(); this.barrierActive = false; });
    // On hit while active, reduce damage (handled in Player? For prototype, grant i-frames window)
    player.grantImmunity(dur);
  }

  private activateRepulse() {
    const player: Player = this.game.getPlayer();
    const px = player.x, py = player.y;
    const radius = 220 + (this.level - 1) * 25; // grows slightly with level
    const maxForce = 900 + (this.level - 1) * 120; // stronger with level

    // Visual: brief expanding ring
    const ring = this.game.add.graphics();
    ring.lineStyle(4, 0x88ccff, 0.9);
    ring.strokeCircle(px, py, radius * 0.35);
    this.game.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 220,
      onUpdate: (tw) => {
        const t = tw.progress;
        ring.clear();
        ring.lineStyle(4, 0x88ccff, 0.9 * (1 - t));
        ring.strokeCircle(px, py, radius * (0.35 + 0.65 * t));
      },
      onComplete: () => ring.destroy()
    });
    this.game.cameras.main.shake(100, 0.004);

    // Apply pure knockback (no damage) to nearby enemies
    const enemiesGroup = this.game.getEnemiesGroup();
    if (enemiesGroup) {
      const enemies = enemiesGroup.getChildren() as Phaser.GameObjects.GameObject[];
      enemies.forEach((obj) => {
        const e = obj as unknown as { x: number; y: number; active: boolean; applyKnockback?: (force: number, angle: number) => void };
        if (!e || !e.active) return;
        const ex = e.x; const ey = e.y;
        const d = Phaser.Math.Distance.Between(px, py, ex, ey);
        if (d <= radius) {
          const angle = Phaser.Math.Angle.Between(px, py, ex, ey);
          const force = Math.max(0, maxForce * (1 - d / radius));
          e.applyKnockback?.(force, angle);
        }
      });
    }

    // Clear toxic gas clouds within radius
    const gasSet = this.game.getGasClouds();
    if (gasSet && gasSet.size > 0) {
      const toRemove: Array<Phaser.GameObjects.Graphics & GasCloudTag> = [];
      gasSet.forEach((g) => {
        const gx = g.__gasX ?? 0;
        const gy = g.__gasY ?? 0;
        const r = g.__gasRadius ?? 0;
        const d = Phaser.Math.Distance.Between(px, py, gx, gy);
        if (d <= radius + r) {
          toRemove.push(g);
        }
      });
      toRemove.forEach((g) => {
        try {
          g.__gasTick?.destroy?.();
        } catch (err) {
          // ignore
        }
        g.destroy();
        this.game.unregisterGasCloud(g);
      });
    }
  }
}
