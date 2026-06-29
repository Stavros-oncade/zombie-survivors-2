import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { BlueprintSystem } from '../systems/BlueprintSystem';
import { CampSystem } from '../systems/CampSystem';
import { CAMP_BUILDINGS } from '../config/CampBuildings';
import { BuildingId, NeedKind } from '../types/CampTypes';
import { transitionTo, fadeIn } from '../utils/transition';

// The camp management screen, opened from the Command Tent zone in the Camp plaza.
// This is the stat/list UI that used to BE the Camp scene: NEEDS / HORDE /
// POPULATION panels, next-cycle projection, and the buildable FACILITIES list.
// Back returns to the walkable plaza, which re-reads CampSystem on create() so any
// builds/upgrades made here are reflected by the plaza's building sprites.
export class CampUpgrades extends Scene {
  constructor() { super(SceneKey.CampUpgrades); }

  private camp!: CampSystem;

  create() {
    fadeIn(this);
    this.camp = CampSystem.getInstance();
    this.renderCamp();
  }

  private renderCamp() {
    const w = this.cameras.main.width;
    this.cameras.main.setBackgroundColor(0x1a1a22);

    this.add.text(w / 2, 36, 'Command Tent', {
      fontFamily: 'Arial Black', fontSize: '34px', color: '#ffffff', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);

    const state = this.camp.getState();
    this.add.text(w / 2, 74, `Blueprint Points: ${BlueprintSystem.getPoints()}  ·  Cycle ${state.cyclesSurvived}`, {
      fontFamily: 'Arial', fontSize: '18px', color: '#00ff88', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    // ---- Needs / horde / population panel (left column) ----
    let ly = 110;
    const lx = 40;
    this.add.text(lx, ly, 'NEEDS', { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd54f' }); ly += 28;

    for (const need of [NeedKind.FOOD, NeedKind.WATER, NeedKind.MEDICINE] as const) {
      const slot = need === NeedKind.FOOD ? state.needs.food : need === NeedKind.WATER ? state.needs.water : state.needs.medicine;
      const cap = this.camp.getCapacity(need);
      const drain = this.camp.getDrainPerCycle(need);
      const runway = drain > 0 ? slot.stock / drain : 99;
      const color = runway >= 3 ? '#7CFC8A' : runway >= 1.5 ? '#FFC857' : '#FF6B6B';
      const label = need.charAt(0).toUpperCase() + need.slice(1);
      this.add.text(lx, ly, `${label}: ${slot.stock}/${cap}   -${drain}/cyc`, {
        fontFamily: 'Arial', fontSize: '17px', color,
      });
      ly += 26;
    }

    ly += 10;
    this.add.text(lx, ly, 'HORDE', { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd54f' }); ly += 28;
    const horde = state.hordeStrength;
    const defense = this.camp.getCampDefense();
    const breached = horde > defense;
    this.add.text(lx, ly, `Pressure ${horde} vs Defense ${defense}${breached ? '  BREACH!' : ''}`, {
      fontFamily: 'Arial', fontSize: '17px', color: breached ? '#FF6B6B' : '#7CFC8A',
    });
    ly += 36;

    this.add.text(lx, ly, 'POPULATION', { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd54f' }); ly += 28;
    this.add.text(lx, ly, `Survivors ${state.survivors}/${this.camp.getSurvivorCap()}`, {
      fontFamily: 'Arial', fontSize: '17px', color: '#ffffff',
    });
    ly += 36;

    // ---- Next-cycle projection ----
    this.add.text(lx, ly, 'NEXT CYCLE PROJECTION', { fontFamily: 'Arial Black', fontSize: '16px', color: '#8fd3ff' }); ly += 26;
    const proj = this.camp.projectNextCycle();
    const projDeaths = proj.deaths.fromFood + proj.deaths.fromWater + proj.deaths.fromMedicine + proj.deaths.fromBreach;
    const projLines = [
      `Horde ${proj.hordeStrengthAfter}/${proj.campDefense}${proj.breached ? ' (BREACH)' : ''}`,
      projDeaths > 0 ? `${projDeaths} survivor(s) will die` : (proj.regrowth > 0 ? `+${proj.regrowth} survivor(s) regrowth` : 'Stable'),
      `Survivors → ${proj.survivorsAfter}`,
    ];
    this.add.text(lx, ly, projLines.join('\n'), {
      fontFamily: 'Arial', fontSize: '15px', color: projDeaths > 0 ? '#FF9F9F' : '#cfe8cf', lineSpacing: 4,
    });

    // ---- Buildings list (right column) ----
    const rx = Math.max(w / 2, 420);
    let ry = 110;
    this.add.text(rx, ry, `FACILITIES  (${this.camp.getOwnedBuildingCount()}/${this.camp.getMaxBuildingSlots()} slots)`, {
      fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd54f',
    });
    ry += 30;

    for (const def of CAMP_BUILDINGS) {
      this.renderBuildingRow(def.id, rx, ry);
      ry += 44;
    }

    // ---- Permanent Blueprints (folded in here; both spend blueprint points) ----
    this.add.text(rx, ry + 8, 'Permanent Blueprints ▸', {
      fontFamily: 'Arial Black', fontSize: '16px', color: '#9fe0ff',
    }).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#ffff00' }); })
      .on('pointerout', function (this: Phaser.GameObjects.Text) { this.setStyle({ color: '#9fe0ff' }); })
      .on('pointerdown', () => transitionTo(this, SceneKey.Blueprints));

    // ---- Back to the plaza ----
    this.add.text(w / 2, this.cameras.main.height - 36, 'Back', {
      fontFamily: 'Arial Black', fontSize: '26px', color: '#ffffff', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => transitionTo(this, SceneKey.Camp));
  }

  private renderBuildingRow(id: BuildingId, x: number, y: number) {
    const def = CAMP_BUILDINGS.find(b => b.id === id)!;
    const render = () => {
      const owned = this.camp.getOwnedTier(id);
      const cost = this.camp.getUpgradeCost(id);
      const blocked = this.camp.getBuildBlockedReason(id);
      const tierLabel = owned > 0 ? `T${owned}` : '—';
      const action = cost === null ? 'MAX' : (owned > 0 ? `Upgrade (${cost})` : `Build (${cost})`);
      const reason = blocked && blocked !== 'Not enough points' ? `  [${blocked}]` : '';
      return { text: `${def.name} ${tierLabel}  ·  ${action}${reason}`, blocked };
    };
    const initial = render();
    const color = () => {
      const r = render();
      return r.blocked === 'Maxed' ? '#00ff88' : r.blocked ? '#888888' : '#ffffff';
    };
    const txt = this.add.text(x, y, initial.text, {
      fontFamily: 'Arial', fontSize: '16px', color: color(),
    }).setInteractive({ useHandCursor: true })
      .on('pointerover', () => { if (!render().blocked) txt.setStyle({ color: '#ffff00' }); })
      .on('pointerout', () => txt.setStyle({ color: color() }))
      .on('pointerdown', () => {
        if (this.camp.getBuildBlockedReason(id) === null) {
          if (this.camp.buildOrUpgrade(id)) {
            this.refresh();
          }
        }
      });
    this.add.text(x, y + 20, def.description, { fontFamily: 'Arial', fontSize: '12px', color: '#9aa0a6' });
  }

  private refresh() {
    // Simplest robust refresh: rebuild the scene.
    this.scene.restart();
  }
}
