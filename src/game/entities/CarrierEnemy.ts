import { Enemy } from './Enemy';
import { EnemyType } from '../types/GameTypes';
import { Game } from '../scenes/Game';

export class CarrierEnemy extends Enemy {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, EnemyType.CARRIER);
    this.setTint(0x99cc66);
    this.tryAddGlow(0x99cc66, 4, 0, false, 0.1, 16);
  }

  // On death, spawn 4 basic enemies around the position
  public override die(): void {
    // Drop pickup + effects handled by base, but we'll spawn minions before destroying
    const spawnOffsets = [
      { x: 20, y: 0 },
      { x: -20, y: 0 },
      { x: 0, y: 20 },
      { x: 0, y: -20 }
    ];
    const scene = this.scene as Game;
    const group = (scene && scene.getEnemiesGroup) ? scene.getEnemiesGroup() : null;
    spawnOffsets.forEach(off => {
      const e = new Enemy(scene, this.x + off.x, this.y + off.y, EnemyType.BASIC);
      scene.add.existing(e);
      if (group) { group.add(e); }
    });
    super.die();
  }
}

