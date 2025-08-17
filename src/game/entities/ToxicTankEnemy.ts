import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';

export class ToxicTankEnemy extends Enemy {
  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.TOXIC);
    // Green pulsing glow
    if ((this as any).preFX) {
      const glow = (this as any).preFX.addGlow(0x66ff66, 6, 0, false, 0.2, 16);
    } else {
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
    const g = this.scene.add.graphics();
    g.fillStyle(0x66ff66, 0.25);
    g.fillCircle(this.x, this.y, radius);
    g.setDepth(-0.5);
    const player: any = (this.scene as any).player;
    const tick = this.scene.time.addEvent({ delay: 200, loop: true, callback: () => {
      if (!player || !player.active) return;
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (d <= radius) {
        player.takeDamage?.(4, this);
      }
    }});
    this.scene.time.delayedCall(5000, () => { g.destroy(); tick.destroy(); });

    super.die();
  }

  public override destroy(fromScene?: boolean): void {
    this.glowTimer?.destroy();
    this.glowSprite?.destroy();
    super.destroy(fromScene);
  }
}

