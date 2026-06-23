import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';
import { KillClass } from '../types/MissionTypes';
import { generateBossName } from '../config/Naming';
import { SceneKey } from '../config/SceneKeys';

// Prototype boss with 3 phases
export class BossEnemy extends Enemy {
  private maxHP = 25000; // buffed ~12.5x for testing
  private phase: 1|2|3 = 1;
  private lastAction = 0;
  private nameText?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.TANK);
    this.setMaxHealth(this.maxHP);
    this.setHealth(this.maxHP);
    this.setScale(1.0);
    this.setTint(0x8844ff);
    this.tryAddGlow(0x8844ff, 6, 0, false, 0.1, 16);
    // Name label under boss
    const nm = generateBossName();
    this.nameText = scene.add.text(this.x, this.y + 48, nm, {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffdddd', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setDepth((this.depth || 0) + 1);
    scene.time.addEvent({ delay: 16, loop: true, callback: () => {
      if (this.nameText && this.active) this.nameText.setPosition(this.x, this.y + 48);
    }});
  }

  public getNameText(): Phaser.GameObjects.Text | null {
    return this.nameText ?? null;
  }

  public override getKillClass(): KillClass {
    return { type: this.enemyType, isElite: false, isBoss: true };
  }

  public update(player: Phaser.Physics.Arcade.Sprite) {
    const hp = this.getHealthSafe();
    const pct = hp / this.maxHP;
    const t = this.scene.time.now;
    if (pct < 0.66 && this.phase === 1) this.enterPhase(2);
    if (pct < 0.33 && this.phase === 2) this.enterPhase(3);

    switch (this.phase) {
      case 1:
        super.moveTowardsPlayer(player);
        if (t - this.lastAction > 1500) { this.fireProjectileAt(player); this.lastAction = t; }
        break;
      case 2:
        this.setVelocity(0, 0);
        if (t - this.lastAction > 2000) { this.radialBurst(12); this.lastAction = t; }
        break;
      case 3:
        super.moveTowardsPlayer(player);
        if (t - this.lastAction > 3000) { this.summonMinions(4); this.lastAction = t; }
        break;
    }
  }

  private enterPhase(n: 2|3) {
    this.phase = n;
    const g = this.scene.add.graphics();
    g.lineStyle(4, n === 2 ? 0xffaa00 : 0xff4444, 1);
    g.strokeCircle(this.x, this.y, 60);
    this.scene.time.delayedCall(400, () => g.destroy());
  }

  private fireProjectileAt(target: Phaser.GameObjects.Sprite) {
    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    const key = this.scene.textures.exists('projectile') ? 'projectile' : 'player';
    const s = this.scene.add.sprite(this.x, this.y, key);
    this.scene.physics.add.existing(s);
    (s.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle)*250, Math.sin(angle)*250);
    s.setScale(0.8);
    this.scene.time.delayedCall(4000, () => s.destroy());
  }

  private radialBurst(count: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const key = this.scene.textures.exists('projectile') ? 'projectile' : 'player';
      const s = this.scene.add.sprite(this.x, this.y, key);
      this.scene.physics.add.existing(s);
      (s.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a)*200, Math.sin(a)*200);
      s.setScale(0.6);
      this.scene.time.delayedCall(3000, () => s.destroy());
    }
  }

  private summonMinions(n: number) {
    const EnemyCls = Enemy;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 120 + Math.random()*40;
      const x = this.x + Math.cos(angle)*r;
      const y = this.y + Math.sin(angle)*r;
      const m = new EnemyCls(this.scene, x, y, EnemyType.BASIC);
      this.scene.add.existing(m);
      const gameScene = this.scene.scene.get(SceneKey.Game) as import('../scenes/Game').Game;
      if (gameScene) {
        gameScene.getEnemiesGroup().add(m);
      }
    }
  }

  private getHealthSafe(): number { return this.getHealth(); }

  public destroy(fromScene?: boolean): void {
    // Emit boss death before destruction so listeners can react
    if (this.scene && this.scene.events) {
      this.scene.events.emit('boss_died', { x: this.x, y: this.y });
    }
    this.nameText?.destroy();
    super.destroy(fromScene);
  }
}
