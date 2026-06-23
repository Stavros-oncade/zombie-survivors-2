import { Scene } from 'phaser';
import { CHARACTERS, LoadoutManager } from '../systems/LoadoutManager';
import { WEAPON_CATALOG, isWeaponSelectableAsStarter } from '../weapons/WeaponCatalog';
import { SpawningConfig } from '../systems/SpawningConfig';
import { SceneKey } from '../config/SceneKeys';
import { DefensiveSkillId, KillstreakPerkId } from '../types/GameTypes';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { ExpeditionManager } from '../systems/ExpeditionManager';
import { SUPPLIES, PERKS, RISK_MODIFIERS, MAX_PERK_SOCKETS, MAX_SURVIVOR_SLOTS } from '../config/Expedition';
import { RiskModifierId } from '../types/ExpeditionTypes';
import { ReconSystem } from '../systems/ReconSystem';
import { generateReconMap } from '../systems/ReconMapGenerator';

export class Loadout extends Scene {
  // Keep reference for future UI updates
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private title!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Text[] = [];
  private startButton!: Phaser.GameObjects.Text;
  private defensiveButtons: Phaser.GameObjects.Text[] = [];
  private killstreakButtons: Phaser.GameObjects.Text[] = [];
  private defensiveInfoText!: Phaser.GameObjects.Text;
  private killstreakInfoText!: Phaser.GameObjects.Text;
  private startingWeaponButtons: Phaser.GameObjects.Text[] = [];

  // Expedition planning panel — re-rendered on every allocation edit.
  private expedition = ExpeditionManager.getInstance();
  private expeditionRefreshers: Array<() => void> = [];
  private capacityText!: Phaser.GameObjects.Text;
  private rewardText!: Phaser.GameObjects.Text;
  private validationText!: Phaser.GameObjects.Text;

  // When true, this Loadout is the once-only expedition outfit screen for a Long
  // Recon: Start generates the route DAG, snapshots the loadout into ReconSystem,
  // and routes to the RouteMap instead of straight to Game (§6).
  private reconMode = false;

  constructor() { super(SceneKey.Loadout); }

  init(data?: { reconMode?: boolean }) {
    this.reconMode = !!data?.reconMode;
  }

  create() {
    const lm = LoadoutManager.getInstance();
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    // Sync the expedition draft to the accepted/selected mission (clears stale
    // allocations) and reset per-create UI refresher list.
    this.expedition = ExpeditionManager.getInstance();
    this.expedition.setMission(lm.getMissionId());
    this.expeditionRefreshers = [];

    this.title = this.add.text(w/2, 40, 'Choose Your Character', {
      fontFamily: 'Arial Black', fontSize: '36px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5);

    // Read-only banner for the accepted Job Board offer (§7.3). The mission is
    // chosen on the Job Board now, not here.
    const accepted = JobBoardSystem.getAcceptedOffer();
    const bannerText = accepted
      ? `Job: ${accepted.title} — ${accepted.mission.description}\nReward: ${JobBoardSystem.describeReward(accepted.reward)}`
      : 'No job accepted — return to the Job Board to choose a mission.';
    this.add.text(w/2, 90, bannerText, {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffd54f', stroke: '#000000', strokeThickness: 3,
      align: 'center', wordWrap: { width: Math.min(820, w * 0.9) },
    }).setOrigin(0.5);

    let y = 150;
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
    this.add.text(w/2, y + 20, 'Defensive Skill', { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    y += 60;
    const defensiveOptions: Array<[string, DefensiveSkillId]> = [['Dash', DefensiveSkillId.DASH], ['Barrier', DefensiveSkillId.BARRIER], ['Repulse', DefensiveSkillId.REPULSE]];
    const updateDefensiveInfo = (id: DefensiveSkillId) => {
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
      btn.on('pointerdown', () => { lm2.setDefensiveSkill(id); this.defensiveButtons.forEach(() => {}); upd(); updateDefensiveInfo(id); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', upd);
      this.defensiveButtons.push(btn);
      y += 36;
    });

    // Initialize instructions text for saved selection
    updateDefensiveInfo(lm2.getDefensiveSkill());
    y += 54; // leave some space after instructions

    // Killstreak Perk selection
    this.add.text(w/2, y + 20, 'Killstreak Perk', { fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5);
    y += 60;
    const updateKillstreakInfo = (id: KillstreakPerkId) => {
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
    (['Damage','XP','Speed'] as const).forEach((name) => {
      const id: KillstreakPerkId =
        name === 'Damage' ? KillstreakPerkId.DAMAGE :
        name === 'XP' ? KillstreakPerkId.XP :
        KillstreakPerkId.SPEED;
      const btn = this.add.text(w/2, y, name, { fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const upd = () => btn.setStyle({ color: lm2.getKillstreakPerk() === id ? '#00ff88' : '#ffffff' });
      upd();
      btn.on('pointerdown', () => { lm2.setKillstreakPerk(id); this.killstreakButtons.forEach(() => {}); upd(); updateKillstreakInfo(id); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', upd);
      this.killstreakButtons.push(btn);
      y += 36;
    });
    // Initialize killstreak instructions
    updateKillstreakInfo(lm2.getKillstreakPerk());
    y += 54;

    // Starting Weapon selection (blueprint-unlocked weapons only)
    y = this.buildStartingWeaponGroup(w, y, lm);

    // Mission choice now lives on the Job Board (accepted-job banner above).

    // ── Expedition planning panel (supplies / survivors / perks / risks) ──
    this.buildExpeditionPanel(w);

    this.startButton = this.add.text(w/2, h - 100, this.reconMode ? 'Embark on Recon' : 'Start Run', {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#ffffff', stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.startButton.setStyle({ color: '#ffff00' }))
      .on('pointerout', () => this.startButton.setStyle({ color: '#ffffff' }))
      .on('pointerdown', () => {
        if (this.reconMode) { this.embarkRecon(); return; }
        // Block launch while the plan is invalid (capacity / inventory / Ironman).
        if (!this.expedition.validate().ok) return;
        // Freeze the assembled plan, spend supplies (scarcity §3), then launch.
        const plan = this.expedition.buildPlan();
        this.expedition.commitSupplies(plan);
        // Normal run flow bypasses the dev SpawnTuner, so reset any stale
        // tuner settings to safe defaults before starting the game.
        SpawningConfig.getInstance().reset();
        this.scene.start(SceneKey.Game, { expeditionPlan: plan });
      });

    // Initial validation state for the Start button.
    this.refreshExpedition();
  }

  /** Generate the recon DAG, snapshot the chosen loadout into ReconSystem, and
   *  route to the RouteMap (§6). The expedition supplies/survivors panel is not
   *  consumed in recon v1 — the recon carries HP/loadout, not per-node supplies. */
  private embarkRecon(): void {
    const lm = LoadoutManager.getInstance();
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const accepted = JobBoardSystem.getAcceptedOffer();
    const map = generateReconMap({ seed, name: accepted?.title });
    ReconSystem.getInstance().startRecon(map, {
      characterId: lm.getCharacter(),
      defensiveSkillId: lm.getDefensiveSkill(),
      killstreakPerkId: lm.getKillstreakPerk(),
    });
    SpawningConfig.getInstance().reset();
    this.scene.start(SceneKey.RouteMap);
  }

  // ─────────────────────── Starting weapon selection ───────────────────────

  private buildStartingWeaponGroup(w: number, startY: number, lm: LoadoutManager): number {
    let y = startY;
    this.add.text(w/2, y + 20, 'Starting Weapon', {
      fontFamily: 'Arial Black', fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    y += 60;

    // Only blueprint-unlocked (or city-minted) weapons are selectable. "Basic"
    // is always an option (no starting weapon beyond the default).
    const unlocked = WEAPON_CATALOG.filter(isWeaponSelectableAsStarter);

    // Re-validate any stale saved selection (e.g. its blueprint was refunded).
    if (lm.getStartingWeaponId() && !unlocked.some(d => d.id === lm.getStartingWeaponId())) {
      lm.setStartingWeaponId('');
    }

    const options: Array<{ id: string; label: string }> = [
      { id: '', label: 'Basic' },
      ...unlocked.map(d => ({ id: d.id, label: d.name })),
    ];

    if (unlocked.length === 0) {
      this.add.text(w/2, y, 'Unlock weapons in Blueprints to equip a starter.', {
        fontFamily: 'Arial', fontSize: '15px', color: '#aaaaaa', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5);
      y += 24;
    }

    for (const opt of options) {
      const btn = this.add.text(w/2, y, opt.label, {
        fontFamily: 'Arial', fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const upd = () => btn.setStyle({ color: lm.getStartingWeaponId() === opt.id ? '#00ff88' : '#ffffff' });
      upd();
      btn.on('pointerdown', () => { lm.setStartingWeaponId(opt.id); this.refreshStartingWeaponButtons(lm); });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
      btn.on('pointerout', upd);
      this.startingWeaponButtons.push(btn);
      y += 32;
    }
    return y + 16;
  }

  private refreshStartingWeaponButtons(lm: LoadoutManager): void {
    // Re-color each button against the current selection.
    const options = ['', ...WEAPON_CATALOG.filter(isWeaponSelectableAsStarter).map(d => d.id)];
    this.startingWeaponButtons.forEach((btn, i) => {
      const id = options[i] ?? '';
      btn.setStyle({ color: lm.getStartingWeaponId() === id ? '#00ff88' : '#ffffff' });
    });
  }

  // ─────────────────────── Expedition planning panel ───────────────────────

  private refreshExpedition(): void {
    for (const fn of this.expeditionRefreshers) fn();
    const v = this.expedition.validate();
    if (this.capacityText) {
      this.capacityText.setText(`Capacity: ${this.expedition.computeUsedWeight()}/${this.expedition.computeCapacity()}`);
    }
    if (this.rewardText) {
      const mult = this.expedition.computeRewardMultiplier();
      this.rewardText.setText(`Reward x${mult.toFixed(2)}  ·  Danger ${(this.expedition.computeDangerScore() * 100).toFixed(0)}%`);
    }
    if (this.validationText) {
      const msg = v.ok ? '' : v.errors[0];
      this.validationText.setText(msg);
    }
    if (this.startButton) {
      this.startButton.setStyle({ color: v.ok ? '#ffffff' : '#777777' });
      this.startButton.setAlpha(v.ok ? 1 : 0.6);
    }
  }

  private buildExpeditionPanel(w: number): void {
    // Right-hand column so it doesn't collide with the centered character list.
    const colX = Math.min(w - 250, w * 0.74);
    let y = 150;

    this.add.text(colX, y, 'EXPEDITION', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffd54f', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0, 0.5);
    y += 28;

    this.capacityText = this.add.text(colX, y, '', {
      fontFamily: 'Arial', fontSize: '15px', color: '#9fe0ff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5);
    y += 20;
    this.rewardText = this.add.text(colX, y, '', {
      fontFamily: 'Arial', fontSize: '15px', color: '#ffcf99', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5);
    y += 26;

    // ── Supplies ──
    this.add.text(colX, y, 'Supplies', { fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 0.5);
    y += 22;
    const inv = this.expedition.getSupplyInventory();
    for (const def of SUPPLIES) {
      const rowY = y;
      const minus = this.add.text(colX, rowY, '[-]', { fontFamily: 'Arial', fontSize: '15px', color: '#ff8888' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      const plus = this.add.text(colX + 34, rowY, '[+]', { fontFamily: 'Arial', fontSize: '15px', color: '#88ff88' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      const label = this.add.text(colX + 70, rowY, '', { fontFamily: 'Arial', fontSize: '14px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0, 0.5);
      minus.on('pointerdown', () => { this.expedition.removeSupply(def.id, 1); this.refreshExpedition(); });
      plus.on('pointerdown', () => { this.expedition.addSupply(def.id, 1); this.refreshExpedition(); });
      this.expeditionRefreshers.push(() => {
        const qty = this.expedition.getSupplyQty(def.id);
        const stock = inv[def.id] ?? 0;
        label.setText(`${def.name} ${qty}/${stock}  (w${def.weight})`);
      });
      y += 20;
    }
    y += 8;

    // ── Survivors ──
    this.add.text(colX, y, `Survivors (max ${MAX_SURVIVOR_SLOTS})`, { fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 0.5);
    y += 22;
    const roster = this.expedition.getRoster();
    if (roster.length === 0) {
      this.add.text(colX, y, 'No survivors available.', { fontFamily: 'Arial', fontSize: '13px', color: '#aaaaaa' }).setOrigin(0, 0.5);
      y += 20;
    } else {
      for (const s of roster.slice(0, 6)) {
        const rowY = y;
        const btn = this.add.text(colX, rowY, '', { fontFamily: 'Arial', fontSize: '14px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => {
          if (this.expedition.isSurvivorAssigned(s.id)) this.expedition.unassignSurvivor(s.id);
          else this.expedition.assignSurvivor(s.id);
          this.refreshExpedition();
        });
        this.expeditionRefreshers.push(() => {
          const on = this.expedition.isSurvivorAssigned(s.id);
          btn.setText(`${on ? '[x]' : '[ ]'} ${s.name}`);
          btn.setStyle({ color: on ? '#00ff88' : '#ffffff' });
        });
        y += 19;
      }
    }
    y += 8;

    // ── Perks ──
    this.add.text(colX, y, `Perks (${MAX_PERK_SOCKETS} sockets)`, { fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 0.5);
    y += 22;
    for (const perk of PERKS) {
      const rowY = y;
      const btn = this.add.text(colX, rowY, '', { fontFamily: 'Arial', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { this.expedition.togglePerk(perk.id); this.refreshExpedition(); });
      this.expeditionRefreshers.push(() => {
        const on = this.expedition.isPerkSlotted(perk.id);
        btn.setText(`${on ? '[x]' : '[ ]'} ${perk.name} — ${perk.description}`);
        btn.setStyle({ color: on ? '#00ff88' : '#ffffff' });
      });
      y += 19;
    }
    y += 8;

    // ── Risk modifiers ──
    this.add.text(colX, y, 'Risk Modifiers', { fontFamily: 'Arial Black', fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 0.5);
    y += 22;
    for (const risk of RISK_MODIFIERS) {
      const rowY = y;
      const btn = this.add.text(colX, rowY, '', { fontFamily: 'Arial', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => { this.expedition.toggleRisk(risk.id as RiskModifierId); this.refreshExpedition(); });
      this.expeditionRefreshers.push(() => {
        const on = this.expedition.isRiskActive(risk.id as RiskModifierId);
        btn.setText(`${on ? '[x]' : '[ ]'} ${risk.name} (+${Math.round(risk.rewardBonus * 100)}% rwd / +${Math.round(risk.dangerBonus * 100)}% dgr)`);
        btn.setStyle({ color: on ? '#ffb347' : '#ffffff' });
      });
      y += 19;
    }
    y += 6;

    this.validationText = this.add.text(colX, y, '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#ff6b6b', stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: 260 },
    }).setOrigin(0, 0.5);
  }

  private getDefensiveSkillInstructions(id: DefensiveSkillId): string {
    if (id === DefensiveSkillId.DASH) {
      return 'Dash — Press Shift to dash in your current movement direction.\nGrants brief invulnerability and a burst of speed. Cooldown ~1.2s (reduced with level).';
    }
    if (id === DefensiveSkillId.BARRIER) {
      return 'Barrier — Press Shift to deploy a short-lived protective field.\nGrants brief invulnerability while active. Cooldown similar to Dash; duration improves with level.';
    }
    if (id === DefensiveSkillId.REPULSE) {
      return 'Repulse — Press Shift to emit a shockwave that pushes enemies away without dealing damage.\nAlso disperses toxic gas clouds in range. Radius and force scale with level.';
    }
    return 'Select a defensive skill to see instructions.';
  }

  private getKillstreakInstructions(id: KillstreakPerkId): string {
    if (id === KillstreakPerkId.DAMAGE) {
      return 'Damage Killstreak — Each 10-kill streak raises a damage multiplier (up to a cap).\nThe multiplier resets if you get hit or stop killing for a short time.';
    }
    if (id === KillstreakPerkId.XP) {
      return 'XP Killstreak — Each 10-kill streak grants bonus XP from kills (up to a cap).\nResets on hit or if you stop chaining kills.';
    }
    if (id === KillstreakPerkId.SPEED) {
      return 'Attack Speed Killstreak — Each 10-kill streak increases your attack speed (up to a cap).\nResets when you get hit or let the streak decay.';
    }
    return 'Select a killstreak perk to see how it works.';
  }
}
