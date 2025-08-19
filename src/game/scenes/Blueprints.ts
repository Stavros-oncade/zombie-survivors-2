import { Scene } from 'phaser';
import { BLUEPRINTS, BlueprintSystem } from '../systems/BlueprintSystem';
import { SceneKey } from '../config/SceneKeys';

export class Blueprints extends Scene {
  constructor() { super(SceneKey.Blueprints); }
  private pointsText!: Phaser.GameObjects.Text;

  create() {
    const w = this.cameras.main.width;
    this.add.text(w/2, 60, 'Blueprints', {
      fontFamily: 'Arial Black', fontSize: '36px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5);

    this.pointsText = this.add.text(w/2, 110, `Points: ${BlueprintSystem.getPoints()}`, {
      fontFamily: 'Arial', fontSize: '20px', color: '#00ff88', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5);

    let y = 160;
    BLUEPRINTS.forEach(bp => {
      const renderText = () => {
        const unlocked = BlueprintSystem.isUnlocked(bp.id);
        return `${bp.name} (${bp.cost}) — ${bp.description} ${unlocked ? '[UNLOCKED]' : ''}`;
      };
      const unlocked = BlueprintSystem.isUnlocked(bp.id);
      const txt = this.add.text(w/2, y, renderText(), {
        fontFamily: 'Arial', fontSize: '20px', color: unlocked ? '#00ff88' : '#ffffff', stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (!BlueprintSystem.isUnlocked(bp.id)) {
          const ok = BlueprintSystem.unlock(bp.id);
          if (ok) {
            txt.setText(renderText());
            txt.setStyle({ color: '#00ff88' });
            this.pointsText.setText(`Points: ${BlueprintSystem.getPoints()}`);
          }
        } else {
          // Unequip to refund points
          const ok = BlueprintSystem.unequip(bp.id);
          if (ok) {
            txt.setText(renderText());
            txt.setStyle({ color: '#ffffff' });
            this.pointsText.setText(`Points: ${BlueprintSystem.getPoints()}`);
          }
        }
      });
      y += 40;
    });

    this.add.text(w/2, y + 40, 'Back', {
      fontFamily: 'Arial Black', fontSize: '28px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this.scene.start(SceneKey.MainMenu));
  }
}
