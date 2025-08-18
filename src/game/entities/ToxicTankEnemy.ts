import { Enemy } from './Enemy';
import { EnemyType, GasCloudTag } from '../types/GameTypes';
import { Game } from '../scenes/Game';
import { SceneKey } from '../config/SceneKeys';

export class ToxicTankEnemy extends Enemy {
  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.TOXIC);
    // Green pulsing glow, prefer preFX if available
    const hadGlow = this.tryAddGlow(0x66ff66, 6, 0, false, 0.2, 16);
    if (!hadGlow) {
      this.glowSprite = scene.add.sprite(this.x, this.y, this.texture.key)
        .setTint(0x66ff66).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(this.depth - 1).setScale(this.scaleX * 1.2, this.scaleY * 1.2);
      this.glowTimer = scene.time.addEvent({ delay: 100, loop: true, callback: () => {
        if (this.glowSprite && this.active) {
          this.glowSprite.setPosition(this.x, this.y);
          // pulse scale
          const t = Math.sin(scene.time.now / 200) * 0.05 + 1.0;
          this.glowSprite.setScale(this.scaleX * 1.2 * t, this.scaleY * 1.2 * t);
        }
      }});
    }
  }

  public override die(): void {
    // Spawn gas cloud on death: damages player if inside for 5s
    const radius = 120;
    const g = this.scene.add.graphics() as Phaser.GameObjects.Graphics & GasCloudTag;
    g.fillStyle(0x66ff66, 0.25);
    g.fillCircle(this.x, this.y, radius);
    g.setDepth(-0.5);
    const player = (this.scene.scene.get(SceneKey.Game) as Game).getPlayer();
    const tick = this.scene.time.addEvent({ delay: 200, loop: true, callback: () => {
      if (!player || !player.active) return;
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (d <= radius) {
        player.takeDamage?.(4, this);
      }
    }});
    // Tag for cleanup by repulse skill
    g.__gasX = this.x;
    g.__gasY = this.y;
    g.__gasRadius = radius;
    g.__gasTick = tick;
    const gameScene = this.scene.scene.get(SceneKey.Game) as Game;
    gameScene.registerGasCloud(g);
    this.scene.time.delayedCall(5000, () => {
      try { tick.destroy(); } catch {}
      try { g.destroy(); } catch {}
      gameScene.unregisterGasCloud(g);
    });

    super.die();
  }

  public override destroy(fromScene?: boolean): void {
    this.glowTimer?.destroy();
    this.glowSprite?.destroy();
    super.destroy(fromScene);
  }
}
