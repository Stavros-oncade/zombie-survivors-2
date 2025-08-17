import { Scene } from 'phaser';
import { BlueprintSystem } from '../systems/BlueprintSystem';

export class BlueprintDrop extends Phaser.Physics.Arcade.Sprite {
  private value: number;

  constructor(scene: Scene, x: number, y: number, value = 1) {
    super(scene, x, y, 'blueprint_drop');
    this.value = value;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(5);
    this.setScale(0.8);

    // Gentle bobbing animation
    scene.tweens.add({ targets: this, y: this.y - 8, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  public collect(): void {
    BlueprintSystem.addPoints(this.value);
    // Floating text
    const txt = this.scene.add.text(this.x, this.y - 10, `+${this.value} BP`, {
      fontSize: '16px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3
    }).setDepth(1000).setOrigin(0.5);
    this.scene.tweens.add({ targets: txt, y: txt.y - 30, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
    this.destroy();
  }
}

