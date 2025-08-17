import { Game } from '../scenes/Game';

export type DefensiveSkillId = 'dash' | 'barrier';

export class SkillSystem {
  private game: Game;
  private skill: DefensiveSkillId;
  private level = 1;
  private cooldownMs = 1200;
  private lastUsed = -9999;
  private barrierActive = false;
  private barrierSprite: Phaser.GameObjects.Graphics | null = null;

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
    if (this.skill === 'dash') this.activateDash();
    if (this.skill === 'barrier') this.activateBarrier();
    return true;
  }

  private activateDash() {
    const player: any = (this.game as any).player;
    // Velocity burst in movement direction, brief i-frames
    const cursors = (this.game as any).cursors as Phaser.Types.Input.Keyboard.CursorKeys;
    const wasd = (this.game as any).wasdKeys as any;
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
    (player as any).immunityTimer?.destroy();
    (player as any).immunityTimer = this.game.time.addEvent({ delay: 250 + (this.level-1)*40, callback: () => { (player as any).lastDamageSource = null; }});
    this.game.cameras.main.shake(80, 0.003);
  }

  private activateBarrier() {
    if (this.barrierActive) return;
    this.barrierActive = true;
    const player: any = (this.game as any).player;
    const g = this.game.add.graphics();
    g.lineStyle(3, 0x00ffaa, 0.9);
    g.strokeCircle(0, 0, 26 + this.level * 2);
    g.setDepth(999);
    g.setScrollFactor(1);
    this.barrierSprite = g;
    g.x = player.x; g.y = player.y;
    const follow = this.game.time.addEvent({ delay: 16, loop: true, callback: () => { if (!g.active) return; g.x = player.x; g.y = player.y; }});
    const dur = 1200 + (this.level-1)*200;
    this.game.time.delayedCall(dur, () => { g.destroy(); follow.destroy(); this.barrierActive = false; });
    // On hit while active, reduce damage (handled in Player? For prototype, grant i-frames window)
    (player as any).immunityTimer?.destroy();
    (player as any).immunityTimer = this.game.time.addEvent({ delay: dur, callback: () => { (player as any).lastDamageSource = null; }});
  }
}
