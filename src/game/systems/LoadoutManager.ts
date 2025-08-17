export type CharacterId = 'soldier' | 'scout' | 'demolitionist';
export type DefensiveSkillId = 'dash' | 'barrier';
export type KillstreakPerkId = 'damage' | 'xp' | 'speed';

type CharacterPreset = {
  id: CharacterId;
  name: string;
  description: string;
};

export const CHARACTERS: CharacterPreset[] = [
  { id: 'soldier', name: 'Soldier', description: '+20% max HP' },
  { id: 'scout', name: 'Scout', description: '+10% movement speed toward cap' },
  { id: 'demolitionist', name: 'Demolitionist', description: 'Start with Explosive Burst' },
];

export class LoadoutManager {
  private static instance: LoadoutManager;
  private selected: CharacterId = 'soldier';
  private defensiveSkill: DefensiveSkillId = 'dash';
  private killstreakPerk: KillstreakPerkId = 'damage';

  private constructor() {
    const saved = localStorage.getItem('zs2_loadout_character');
    if (saved === 'soldier' || saved === 'scout' || saved === 'demolitionist') {
      this.selected = saved;
    }
    const ds = localStorage.getItem('zs2_loadout_defensive');
    if (ds === 'dash' || ds === 'barrier') this.defensiveSkill = ds;
    const kp = localStorage.getItem('zs2_loadout_killstreak');
    if (kp === 'damage' || kp === 'xp' || kp === 'speed') this.killstreakPerk = kp;
  }

  static getInstance(): LoadoutManager {
    if (!LoadoutManager.instance) LoadoutManager.instance = new LoadoutManager();
    return LoadoutManager.instance;
  }

  public setCharacter(id: CharacterId) {
    this.selected = id;
    localStorage.setItem('zs2_loadout_character', id);
  }

  public getCharacter(): CharacterId { return this.selected; }

  public setDefensiveSkill(id: DefensiveSkillId) { this.defensiveSkill = id; localStorage.setItem('zs2_loadout_defensive', id); }
  public getDefensiveSkill(): DefensiveSkillId { return this.defensiveSkill; }

  public setKillstreakPerk(id: KillstreakPerkId) { this.killstreakPerk = id; localStorage.setItem('zs2_loadout_killstreak', id); }
  public getKillstreakPerk(): KillstreakPerkId { return this.killstreakPerk; }
}
