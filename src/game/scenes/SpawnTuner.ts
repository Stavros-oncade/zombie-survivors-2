import { Scene } from 'phaser';
import { SpawningConfig } from '../systems/SpawningConfig';

export class SpawnTuner extends Scene {
  constructor() { super('SpawnTuner'); }

  private rateText!: Phaser.GameObjects.Text;
  private eliteToggleText!: Phaser.GameObjects.Text;
  private bossToggleText!: Phaser.GameObjects.Text;
  private startStateText!: Phaser.GameObjects.Text;

  create() {
    // Clean up any stale references from a previous run
    this.eliteToggleText = undefined as any;
    this.bossToggleText = undefined as any;
    this.startStateText = undefined as any;

    const cfg = SpawningConfig.getInstance();
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add.text(w/2, 60, 'Spawning Tuner', {
      fontFamily: 'Arial Black', fontSize: '36px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5);

    // Rate controls
    this.add.text(w/2, 120, 'Spawn Rate Multiplier', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    this.rateText = this.add.text(w/2, 150, `Current: ${cfg.rateMultiplier.toFixed(2)}x`, {
      fontFamily: 'Arial', fontSize: '20px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5);

    const makeRateButton = (label: string, value: number, x: number, y: number) => {
      this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
        .setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
        .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
        .on('pointerdown', () => { cfg.rateMultiplier = value; this.rateText.setText(`Current: ${cfg.rateMultiplier.toFixed(2)}x`); });
    };
    const rowY = 190;
    makeRateButton('0.5x', 0.5, w/2 - 200, rowY);
    makeRateButton('1x', 1, w/2 - 100, rowY);
    makeRateButton('2x', 2, w/2, rowY);
    makeRateButton('5x', 5, w/2 + 100, rowY);
    makeRateButton('10x', 10, w/2 + 200, rowY);

    // Immediate spawn toggles
    this.add.text(w/2, 250, 'Immediate Spawns', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    const drawToggleText = () => {
      // (Re)create texts if missing or no longer active (destroyed on previous scene shutdown)
      if (!this.eliteToggleText || !this.eliteToggleText.active) {
        this.eliteToggleText = this.add
          .text(
            w / 2,
            280,
            `Spawn Elite on Start: ${cfg.spawnEliteOnStart ? 'ON' : 'OFF'}`,
            { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }
          )
          .setOrigin(0.5);
      } else {
        this.eliteToggleText.setText(
          `Spawn Elite on Start: ${cfg.spawnEliteOnStart ? 'ON' : 'OFF'}`
        );
      }

      if (!this.bossToggleText || !this.bossToggleText.active) {
        this.bossToggleText = this.add
          .text(
            w / 2,
            310,
            `Spawn Boss on Start: ${cfg.spawnBossOnStart ? 'ON' : 'OFF'}`,
            { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }
          )
          .setOrigin(0.5);
      } else {
        this.bossToggleText.setText(
          `Spawn Boss on Start: ${cfg.spawnBossOnStart ? 'ON' : 'OFF'}`
        );
      }
    };
    drawToggleText();

    const eliteBtn = this.add.text(w/2 - 120, 345, 'Toggle Elite', { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { cfg.spawnEliteOnStart = !cfg.spawnEliteOnStart; drawToggleText(); });
    const bossBtn = this.add.text(w/2 + 120, 345, 'Toggle Boss', { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { cfg.spawnBossOnStart = !cfg.spawnBossOnStart; drawToggleText(); });

    // Start game
    // Start wave state selection
    this.add.text(w/2, 400, 'Start Wave State', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    const drawState = () => {
      const label = cfg.startState ? cfg.startState : 'default (normal)';
      if (!this.startStateText || !this.startStateText.active) {
        this.startStateText = this.add
          .text(w / 2, 430, `Current: ${label}`, {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#ffeb99',
            stroke: '#000',
            strokeThickness: 3,
          })
          .setOrigin(0.5);
      } else {
        this.startStateText.setText(`Current: ${label}`);
      }
    };
    drawState();

    const makeStateBtn = (label: string, key: string, x: number, y: number) => {
      this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
        .setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
        .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
        .on('pointerdown', () => { cfg.startState = key; drawState(); });
    };

    const sy = 465;
    makeStateBtn('Normal', 'normal', w/2 - 260, sy);
    makeStateBtn('Peak', 'peak', w/2 - 130, sy);
    makeStateBtn('Cooldown', 'cooldown', w/2, sy);
    makeStateBtn('Ranged Pack', 'ranged_pack', w/2 + 130, sy);
    makeStateBtn('Carrier Pack', 'carrier_pack', w/2 + 130, sy);
    makeStateBtn('Toxic Pack', 'toxic_pack', w/2 + 260, sy);

    this.add.text(w/2, h - 100, 'Start Game', {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
      .on('pointerdown', () => this.scene.start('Game'));

    // Back option
    this.add.text(40, h - 40, 'Back', { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('Loadout'));

    // On shutdown/destroy, clear references so we don't hold onto destroyed objects
    this.events.once('shutdown', () => {
      this.eliteToggleText = undefined as any;
      this.bossToggleText = undefined as any;
      this.startStateText = undefined as any;
    });
    this.events.once('destroy', () => {
      this.eliteToggleText = undefined as any;
      this.bossToggleText = undefined as any;
      this.startStateText = undefined as any;
    });
  }
}
