import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';
import { GameConstants } from '../config/GameConstants';
import { generateEliteName } from '../config/Naming';

// Assets needed:
// - Optional elite sprite or overlay (e.g., 'enemy_elite.png')
//   Fallback: tint base sprite and add glow.

export class EliteEnemy extends Enemy {
  private telegraphGraphics: Phaser.GameObjects.Graphics | null = null;
  private state: 'chase' | 'telegraph' | 'charge' = 'chase';
  private telegraphTimer?: Phaser.Time.TimerEvent;
  private chargeTimer?: Phaser.Time.TimerEvent;
  private affix: 'molten' | 'shielded' | 'frost' = 'shielded';
  private shieldHP: number = 50;
  private moltenTrailTimer?: Phaser.Time.TimerEvent;
  private glowSprite: Phaser.GameObjects.Sprite | null = null;
  private glowFollowEvent?: Phaser.Time.TimerEvent;
  private nameText?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.BASIC);
    this.makeElite();
  }

  private makeElite(): void {
    // Beef up stats relative to base
    // Using inherited setters is limited, but we can scale visually and FX
    this.setScale(0.7);
    this.setTint(0xff4444);
    // Greatly increase elite health (10x)
    (this as any).health = Math.floor(((this as any).health || 1) * 10);
    (this as any).maxHealth = (this as any).health;
    if ((this as any).preFX) {
      (this as any).preFX.addGlow(0xff0000, 4, 0, false, 0.1, 16);
    } else {
      // Fallback additive halo if preFX not available
      this.glowSprite = this.scene.add.sprite(this.x, this.y, this.texture.key);
      this.glowSprite.setScale(this.scaleX * 1.2, this.scaleY * 1.2);
      this.glowSprite.setTint(0xff4444).setAlpha(0.35);
      this.glowSprite.setBlendMode(Phaser.BlendModes.ADD);
      this.glowSprite.setDepth(this.depth - 1);
      this.glowFollowEvent = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
        if (this.glowSprite && this.active) this.glowSprite.setPosition(this.x, this.y);
      }});
    }
    // Random affix
    const r = Math.random();
    if (r < 0.34) this.affix = 'molten'; else if (r < 0.68) this.affix = 'shielded'; else this.affix = 'frost';
    if (this.affix === 'shielded') this.shieldHP = 80;
    if (this.affix === 'molten') {
      this.moltenTrailTimer = this.scene.time.addEvent({ delay: 300, loop: true, callback: () => this.leaveMolten() });
    }
    // Name label
    const nm = generateEliteName();
    this.nameText = this.scene.add.text(this.x, this.y + 36, nm, {
      fontFamily: 'Arial Black', fontSize: '16px', color: '#ffff99', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(this.depth + 1);
    this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
      if (this.nameText && this.active) this.nameText.setPosition(this.x, this.y + 36);
    }});
  }

  public update(player: Phaser.Physics.Arcade.Sprite): void {
    if (!this.active) return;
    switch (this.state) {
      case 'chase':
        super.moveTowardsPlayer(player as any);
        if (this.affix === 'frost' && Math.random() < 0.005) this.frostPulse();
        // Occasionally start telegraph/charge
        if (Math.random() < 0.01) {
          this.beginTelegraph(player);
        }
        break;
      case 'telegraph':
        // hold position and show cone
        this.setVelocity(0, 0);
        break;
      case 'charge':
        // velocity already set; let it ride
        break;
    }
  }

  private beginTelegraph(player: Phaser.GameObjects.Sprite) {
    if (this.state !== 'chase') return;
    this.state = 'telegraph';
    const angle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    this.drawTelegraphCone(angle);
    this.telegraphTimer?.destroy();
    this.telegraphTimer = this.scene.time.addEvent({
      delay: 500,
      callback: () => this.beginCharge(angle),
    });
  }

  private beginCharge(angle: number) {
    this.clearTelegraph();
    this.state = 'charge';
    // Double the dash speed
    const speed = GameConstants.ENEMIES.INITIAL_SPEED * 6;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);
    this.chargeTimer?.destroy();
    // Double the dash duration
    this.chargeTimer = this.scene.time.addEvent({ delay: 800, callback: () => (this.state = 'chase') });
  }

  private drawTelegraphCone(angle: number) {
    this.clearTelegraph();
    const g = this.scene.add.graphics();
    g.clear();
    g.fillStyle(0xff0000, 0.25);
    // Draw a filled sector only (not the whole circle)
    g.beginPath();
    g.moveTo(this.x, this.y);
    g.arc(this.x, this.y, 160, angle - 0.35, angle + 0.35, false);
    g.closePath();
    g.fillPath();
    g.setDepth(5);
    this.telegraphGraphics = g;
  }

  private clearTelegraph() {
    if (this.telegraphGraphics) {
      this.telegraphGraphics.destroy();
      this.telegraphGraphics = null;
    }
  }

  public destroy(fromScene?: boolean): void {
    this.telegraphTimer?.destroy();
    this.chargeTimer?.destroy();
    this.moltenTrailTimer?.destroy();
    this.clearTelegraph();
    // Emit before calling super.destroy, because super may clear this.scene
    if (this.scene && (this.scene as any).events) {
      this.scene.events.emit('elite_died', { x: this.x, y: this.y });
    }
    if (this.glowFollowEvent) this.glowFollowEvent.destroy();
    if (this.glowSprite) this.glowSprite.destroy();
    this.nameText?.destroy();
    super.destroy(fromScene);
  }

  private leaveMolten() {
    const g = this.scene.add.graphics();
    g.fillStyle(0xff4400, 0.5);
    g.fillCircle(this.x, this.y, 18);
    this.scene.time.delayedCall(1200, () => g.destroy());
    const player: any = (this.scene as any).player;
    const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (d < 20) player.takeDamage(2, this);
  }

  private frostPulse() {
    const g = this.scene.add.graphics();
    g.lineStyle(2, 0x66ccff, 0.8);
    g.strokeCircle(this.x, this.y, 120);
    this.scene.time.delayedCall(300, () => g.destroy());
    const player: any = (this.scene as any).player;
    const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    if (d < 120) {
      const prev = player.getMovementSpeed();
      player.setMovementSpeed(prev * 0.7);
      this.scene.time.delayedCall(800, () => player.setMovementSpeed(prev));
    }
  }

  public override takeDamage(amount: number): void {
    if (this.affix === 'shielded' && this.shieldHP > 0) {
      this.shieldHP -= amount;
      if (this.shieldHP <= 0) {
        const g = this.scene.add.graphics();
        g.lineStyle(3, 0x00ffaa, 1);
        g.strokeCircle(this.x, this.y, 30);
        this.scene.time.delayedCall(300, () => g.destroy());
      }
      return;
    }
    super.takeDamage(amount);
  }
}
