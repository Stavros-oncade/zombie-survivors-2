import { Scene } from 'phaser';
import { SceneKey } from '../config/SceneKeys';
import { LoadoutManager, CHARACTERS } from '../systems/LoadoutManager';
import { JobBoardSystem } from '../systems/JobBoardSystem';
import { resolveMission } from '../config/Missions';
import { getWeaponDef } from '../weapons/WeaponCatalog';
import { DefensiveSkillId, KillstreakPerkId } from '../types/GameTypes';
import { ExpeditionPlan } from '../types/ExpeditionTypes';
import { Mission } from '../types/MissionTypes';
import { transitionTo, fadeIn, FADE_NIGHT } from '../utils/transition';

// Deploy briefing — the dramatized beat between Loadout "Start Run" and the Game
// scene. The run is already frozen (supplies committed in Loadout), so this scene
// only DISPLAYS the run and forwards the plan; it never mutates state. It front-
// loads the same OBJECTIVE the Game shows in-level (Game suppresses its banner
// when handed `briefed: true`), pairs it with the job's flavor line and a loadout
// readout, then flashes into combat. Click / Space / Enter deploys early; it also
// auto-advances after a short hold so the player is never stuck on the card.
export class Briefing extends Scene {
  private plan!: ExpeditionPlan;
  private deployed = false;

  constructor() { super(SceneKey.Briefing); }

  init(data?: { expeditionPlan?: ExpeditionPlan }) {
    this.deployed = false;
    // Loadout always hands us a frozen plan; fall back defensively just in case.
    this.plan = data?.expeditionPlan
      ?? { missionId: LoadoutManager.getInstance().getMissionId(), supplies: [], survivors: [], perks: [], risks: [],
           derived: { usedWeight: 0, capacityWeight: 0, rewardMultiplier: 1, dangerScore: 0, onWinBonusPoints: 0 } };
  }

  create() {
    fadeIn(this, { color: FADE_NIGHT });

    const cam = this.cameras.main;
    const w = cam.width, h = cam.height;
    const cx = w / 2;
    cam.setBackgroundColor(FADE_NIGHT);

    const lm = LoadoutManager.getInstance();
    const offer = JobBoardSystem.getAcceptedOffer();
    const mission: Mission = offer?.mission ?? resolveMission(lm.getMissionId());

    // Atmospheric backdrop: the purpose-built deploy art if present, else the menu
    // background pushed dark. briefing_bg is already night-dark with room for text,
    // so it only needs a light dim; the menu fallback needs a heavier tint + dim.
    const usingBriefingArt = this.textures.exists('briefing_bg');
    const bgImg = this.add.image(0, 0, usingBriefingArt ? 'briefing_bg' : 'background')
      .setOrigin(0, 0).setDisplaySize(w, h);
    if (!usingBriefingArt) bgImg.setTint(0x2a3a52);
    this.add.rectangle(0, 0, w, h, FADE_NIGHT, usingBriefingArt ? 0.28 : 0.55).setOrigin(0, 0);

    // ── Header ──
    this.add.text(cx, h * 0.14, 'DEPLOYING', {
      fontFamily: 'Arial Black', fontSize: '20px', color: '#00ffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setAlpha(0.85);

    this.add.text(cx, h * 0.14 + 30, 'OBJECTIVE', {
      fontFamily: 'Arial', fontSize: '15px', color: '#7fd6ff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.add.text(cx, h * 0.26, mission.name, {
      fontFamily: 'Arial Black', fontSize: '44px', color: '#ffffff', stroke: '#000000', strokeThickness: 7,
      align: 'center', wordWrap: { width: Math.min(820, w * 0.9) },
    }).setOrigin(0.5);

    this.add.text(cx, h * 0.36, mission.description, {
      fontFamily: 'Arial', fontSize: '20px', color: '#cfe8ff', stroke: '#000000', strokeThickness: 4,
      align: 'center', wordWrap: { width: Math.min(760, w * 0.85) },
    }).setOrigin(0.5);

    // Job flavor line (amber, the "client brief").
    if (offer?.flavor) {
      this.add.text(cx, h * 0.44, `“${offer.flavor}”`, {
        fontFamily: 'Arial', fontSize: '17px', color: '#ffd27f', stroke: '#000000', strokeThickness: 3,
        align: 'center', wordWrap: { width: Math.min(720, w * 0.82) },
      }).setOrigin(0.5);
    }

    // Mono-weapon lock (Specialist missions) — make the lock unmistakable here too.
    if (mission.monoWeapon?.enabled) {
      const locked = mission.monoWeapon.weaponId
        ? (getWeaponDef(mission.monoWeapon.weaponId)?.name ?? 'Basic')
        : 'Basic';
      this.add.text(cx, h * 0.50, `WEAPON LOCKED: ${locked}`, {
        fontFamily: 'Arial Black', fontSize: '17px', color: '#ff9d5c', stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);
    }

    // ── Loadout readout + hero sprite ──
    this.buildLoadoutPanel(cx, h * 0.62, lm, mission, offer ? JobBoardSystem.describeReward(offer.reward) : null);

    // ── Deploy prompt (auto-advances; click / key deploys early) ──
    const prompt = this.add.text(cx, h - 56, 'Click or press SPACE to deploy', {
      fontFamily: 'Arial Black', fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.input.once('pointerdown', () => this.deploy());
    this.input.keyboard?.once('keydown-SPACE', () => this.deploy());
    this.input.keyboard?.once('keydown-ENTER', () => this.deploy());
    this.time.delayedCall(2600, () => this.deploy());
  }

  private buildLoadoutPanel(cx: number, y: number, lm: LoadoutManager, mission: Mission, reward: string | null): void {
    const w = this.cameras.main.width;

    // Hero sprite anchored left of the readout.
    if (this.textures.exists('player')) {
      this.add.image(cx - Math.min(260, w * 0.3), y + 14, 'player').setScale(1.6).setOrigin(0.5);
    }

    const character = CHARACTERS.find(c => c.id === lm.getCharacter())?.name ?? 'Soldier';
    const weaponName = mission.monoWeapon?.enabled
      ? (mission.monoWeapon.weaponId ? (getWeaponDef(mission.monoWeapon.weaponId)?.name ?? 'Basic') : 'Basic')
      : (lm.getStartingWeaponId() ? (getWeaponDef(lm.getStartingWeaponId())?.name ?? 'Basic') : 'Basic');

    const lines = [
      `${character}  ·  ${weaponName}`,
      `Defensive: ${this.defensiveName(lm.getDefensiveSkill())}    Streak: ${this.killstreakName(lm.getKillstreakPerk())}`,
      `Reward x${this.plan.derived.rewardMultiplier.toFixed(2)}   ·   Danger ${Math.round(this.plan.derived.dangerScore * 100)}%`,
      ...(reward ? [`Payout: ${reward}`] : []),
    ];

    this.add.text(cx + Math.min(40, w * 0.04), y, lines.join('\n'), {
      fontFamily: 'Arial', fontSize: '18px', color: '#e8e0d0', stroke: '#000000', strokeThickness: 3,
      align: 'left', lineSpacing: 8,
    }).setOrigin(0, 0.5);
  }

  private deploy(): void {
    if (this.deployed) return;
    this.deployed = true;
    // Game suppresses its in-level OBJECTIVE banner when briefed, and flashes in.
    transitionTo(this, SceneKey.Game, { expeditionPlan: this.plan, briefed: true }, { color: FADE_NIGHT });
  }

  private defensiveName(id: DefensiveSkillId): string {
    return id === DefensiveSkillId.BARRIER ? 'Barrier' : id === DefensiveSkillId.REPULSE ? 'Repulse' : 'Dash';
  }

  private killstreakName(id: KillstreakPerkId): string {
    return id === KillstreakPerkId.XP ? 'XP' : id === KillstreakPerkId.SPEED ? 'Attack Speed' : 'Damage';
  }
}
