import { Scene } from 'phaser';
import { CHARACTERS, LoadoutManager } from '../systems/LoadoutManager';

export class Loadout extends Scene {
  private title!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Text[] = [];
  private startButton!: Phaser.GameObjects.Text;
  private defensiveButtons: Phaser.GameObjects.Text[] = [];
  private killstreakButtons: Phaser.GameObjects.Text[] = [];
  private defensiveInfoText!: Phaser.GameObjects.Text;
  private killstreakInfoText!: Phaser.GameObjects.Text;

  constructor() { super('Loadout'); }

  create() {
    const lm = LoadoutManager.getInstance();
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.title = this.add.text(w/2, 60, 'Choose Your Character', {
      fontFamily: 'Arial Black', fontSize: '36px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5);

    let y = 140;
    CHARACTERS.forEach((c) => {
      const btn = this.add.text(w/2, y, `${c.name} — ${c.description}`, {
        fontFamily: 'Arial', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      const updateStyle = () => {
        btn.setStyle({ color: lm.getCharacter() === c.id ? '#00ff88' : '#ffffff' });
      };
      updateStyle();

      btn.on('pointerdown', () => { lm.setCharacter(c.id); this.buttons.forEach(() => {}); updateStyle(); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', () => updateStyle());

      this.buttons.push(btn);
      y += 48;
    });

    // Defensive Skill selection
    const lm2 = LoadoutManager.getInstance();
    const defLabel = this.add.text(w/2, y + 20, 'Defensive Skill', { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    y += 60;
    const defensiveOptions: Array<[string, string]> = [['Dash','dash'], ['Barrier','barrier'], ['Repulse','repulse']];
    const updateDefensiveInfo = (id: string) => {
      const info = this.getDefensiveSkillInstructions(id);
      if (!this.defensiveInfoText) {
        this.defensiveInfoText = this.add.text(w/2, y + 18, info, {
          fontFamily: 'Arial', fontSize: '18px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3,
          align: 'center', wordWrap: { width: Math.min(720, w * 0.85) }
        }).setOrigin(0.5);
      } else {
        this.defensiveInfoText.setText(info);
      }
    };

    defensiveOptions.forEach(([name,id]) => {
      const btn = this.add.text(w/2, y, name as string, { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const upd = () => btn.setStyle({ color: lm2.getDefensiveSkill() === id ? '#00ff88' : '#ffffff' });
      upd();
      btn.on('pointerdown', () => { lm2.setDefensiveSkill(id as any); this.defensiveButtons.forEach(() => {}); upd(); updateDefensiveInfo(id); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', upd);
      this.defensiveButtons.push(btn);
      y += 36;
    });

    // Initialize instructions text for saved selection
    updateDefensiveInfo(lm2.getDefensiveSkill());
    y += 54; // leave some space after instructions

    // Killstreak Perk selection
    const ksLabel = this.add.text(w/2, y + 20, 'Killstreak Perk', { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    y += 60;
    const updateKillstreakInfo = (id: string) => {
      const info = this.getKillstreakInstructions(id);
      if (!this.killstreakInfoText) {
        this.killstreakInfoText = this.add.text(w/2, y + 18, info, {
          fontFamily: 'Arial', fontSize: '18px', color: '#ffeb99', stroke: '#000000', strokeThickness: 3,
          align: 'center', wordWrap: { width: Math.min(720, w * 0.85) }
        }).setOrigin(0.5);
      } else {
        this.killstreakInfoText.setPosition(w/2, y + 18);
        this.killstreakInfoText.setText(info);
      }
    };
    [['Damage','damage'], ['XP','xp'], ['Speed','speed']].forEach(([name,id]) => {
      const btn = this.add.text(w/2, y, name as string, { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const upd = () => btn.setStyle({ color: lm2.getKillstreakPerk() === id ? '#00ff88' : '#ffffff' });
      upd();
      btn.on('pointerdown', () => { lm2.setKillstreakPerk(id as any); this.killstreakButtons.forEach(() => {}); upd(); updateKillstreakInfo(id); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', upd);
      this.killstreakButtons.push(btn);
      y += 36;
    });
    // Initialize killstreak instructions
    updateKillstreakInfo(lm2.getKillstreakPerk());
    y += 54;

    this.startButton = this.add.text(w/2, h - 100, 'Start Run', {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.startButton.setStyle({ color: '#ffff00' }))
      .on('pointerout', () => this.startButton.setStyle({ color: '#ffffff' }))
      .on('pointerdown', () => this.scene.start('SpawnTuner'));
  }

  private getDefensiveSkillInstructions(id: string): string {
    if (id === 'dash') {
      return 'Dash — Press Shift to dash in your current movement direction.\nGrants brief invulnerability and a burst of speed. Cooldown ~1.2s (reduced with level).';
    }
    if (id === 'barrier') {
      return 'Barrier — Press Shift to deploy a short-lived protective field.\nGrants brief invulnerability while active. Cooldown similar to Dash; duration improves with level.';
    }
    if (id === 'repulse') {
      return 'Repulse — Press Shift to emit a shockwave that pushes enemies away without dealing damage.\nAlso disperses toxic gas clouds in range. Radius and force scale with level.';
    }
    return 'Select a defensive skill to see instructions.';
  }

  private getKillstreakInstructions(id: string): string {
    if (id === 'damage') {
      return 'Damage Killstreak — Each 10-kill streak raises a damage multiplier (up to a cap).\nThe multiplier resets if you get hit or stop killing for a short time.';
    }
    if (id === 'xp') {
      return 'XP Killstreak — Each 10-kill streak grants bonus XP from kills (up to a cap).\nResets on hit or if you stop chaining kills.';
    }
    if (id === 'speed') {
      return 'Attack Speed Killstreak — Each 10-kill streak increases your attack speed (up to a cap).\nResets when you get hit or let the streak decay.';
    }
    return 'Select a killstreak perk to see how it works.';
  }
}
