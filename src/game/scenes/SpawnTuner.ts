import { Scene } from 'phaser';
import { SpawningConfig } from '../systems/SpawningConfig';
import { SpawnState } from '../types/GameTypes';
import { SceneKey } from '../config/SceneKeys';
import { transitionTo, fadeIn, FADE_NIGHT } from '../utils/transition';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { JOB_TEMPLATES } from '../config/JobTemplates';
import { JobLaunchKind } from '../types/JobBoardTypes';

export class SpawnTuner extends Scene {
  constructor() { super(SceneKey.SpawnTuner); }

  private rateText?: Phaser.GameObjects.Text;
  private eliteToggleText?: Phaser.GameObjects.Text;
  private bossToggleText?: Phaser.GameObjects.Text;
  private startStateText?: Phaser.GameObjects.Text;

  create() {
    fadeIn(this);
    // Clean up any stale references from a previous run
    this.eliteToggleText = undefined;
    this.bossToggleText = undefined;
    this.startStateText = undefined;

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

    this.rateText = this.add.text(w/2, 150, `Current: ${cfg.rateMultiplier?.toFixed(2) ?? '1.00'}x`, {
      fontFamily: 'Arial', fontSize: '20px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5);

    const makeRateButton = (label: string, value: number, x: number, y: number) => {
      this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
        .setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
        .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
        .on('pointerdown', () => { cfg.rateMultiplier = value; this.rateText?.setText(`Current: ${cfg.rateMultiplier.toFixed(2)}x`); });
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

    this.add.text(w/2 - 120, 345, 'Toggle Elite', { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { cfg.spawnEliteOnStart = !cfg.spawnEliteOnStart; drawToggleText(); });
    this.add.text(w/2 + 120, 345, 'Toggle Boss', { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { cfg.spawnBossOnStart = !cfg.spawnBossOnStart; drawToggleText(); });

    // Start game
    // Start wave state selection
    this.add.text(w/2, 400, 'Start Wave State', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    const drawState = () => {
      const label = cfg.startState ? cfg.startState : SpawnState.NORMAL;
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

    const makeStateBtn = (label: string, key: SpawnState, x: number, y: number) => {
      this.add.text(x, y, label, { fontFamily: 'Arial', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, backgroundColor: '#333', padding: { x: 10, y: 6 } })
        .setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
        .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
        .on('pointerdown', () => { cfg.startState = key; drawState(); });
    };

    const sy = 465;
    makeStateBtn('Normal', SpawnState.NORMAL, w/2 - 325, sy);
    makeStateBtn('Peak', SpawnState.PEAK, w/2 - 195, sy);
    makeStateBtn('Cooldown', SpawnState.COOLDOWN, w/2 - 65, sy);
    makeStateBtn('Ranged Pack', SpawnState.RANGED_PACK, w/2 + 65, sy);
    makeStateBtn('Carrier Pack', SpawnState.CARRIER_PACK, w/2 + 195, sy);
    makeStateBtn('Toxic Pack', SpawnState.TOXIC_PACK, w/2 + 325, sy);

    // Job Board template launcher (debug). Force-generates + accepts an offer from
    // any of the 12 authored templates (bypassing the normal random 3-offer board)
    // and routes exactly like a real Job Board accept (JobBoard.ts:accept()), so
    // the full reward/mission pipeline is exercised unchanged. Useful for testing
    // template-specific features (e.g. Search & Retrieve's t_supply_run caches)
    // without rerolling for them.
    this.add.text(w/2, 495, 'Job Board Templates (Debug)', {
      fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    const launchTemplate = (templateId: string) => {
      const offer = JobBoardSystem.debugForceAcceptTemplate(templateId);
      if (!offer) return;
      SpawningConfig.getInstance().reset();
      switch (offer.launch.kind) {
        case JobLaunchKind.GAME_RUN:
          transitionTo(this, SceneKey.Loadout);
          break;
        case JobLaunchKind.LONG_RECON:
          transitionTo(this, SceneKey.Loadout, { reconMode: true });
          break;
        case JobLaunchKind.CITY_RECLAMATION:
          transitionTo(this, SceneKey.CityReclamation);
          break;
      }
    };

    const cols = 4;
    const colXs = [w/2 - 330, w/2 - 110, w/2 + 110, w/2 + 330];
    const rowYs = [524, 552, 580];
    JOB_TEMPLATES.forEach((tmpl, i) => {
      const x = colXs[i % cols];
      const y = rowYs[Math.floor(i / cols)];
      const label = (tmpl.titlePool[0] ?? tmpl.id).slice(0, 18);
      this.add.text(x, y, label, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
        backgroundColor: '#333', padding: { x: 6, y: 4 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
        .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
        .on('pointerdown', () => launchTemplate(tmpl.id));
    });

    this.add.text(w/2, h - 100, 'Start Game', {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffffff' }); })
      .on('pointerdown', () => transitionTo(this, SceneKey.Game, undefined, { color: FADE_NIGHT }));

    // Back option
    this.add.text(40, h - 40, 'Back', { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => transitionTo(this, SceneKey.MainMenu));

    // On shutdown/destroy, clear references so we don't hold onto destroyed objects
    this.events.once('shutdown', () => {
      this.eliteToggleText = undefined;
      this.bossToggleText = undefined;
      this.startStateText = undefined;
    });
    this.events.once('destroy', () => {
      this.eliteToggleText = undefined;
      this.bossToggleText = undefined;
      this.startStateText = undefined;
    });
  }
}
