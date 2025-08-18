import { CharacterId, DefensiveSkillId, KillstreakPerkId } from '../types/GameTypes';

type CharacterPreset = {
  id: CharacterId;
  name: string;
  description: string;
};

export const CHARACTERS: CharacterPreset[] = [
  { id: CharacterId.SOLDIER, name: 'Soldier', description: '+20% max HP' },
  { id: CharacterId.SCOUT, name: 'Scout', description: '+10% movement speed toward cap' },
  { id: CharacterId.DEMOLITIONIST, name: 'Demolitionist', description: 'Start with Explosive Burst' },
];

export class LoadoutManager {
  private static instance: LoadoutManager;
  private selected: CharacterId = CharacterId.SOLDIER;
  private defensiveSkill: DefensiveSkillId = DefensiveSkillId.DASH;
  private killstreakPerk: KillstreakPerkId = KillstreakPerkId.DAMAGE;

  private constructor() {
    const saved = localStorage.getItem('zs2_loadout_character');
    if (saved === CharacterId.SOLDIER || saved === CharacterId.SCOUT || saved === CharacterId.DEMOLITIONIST) {
      this.selected = saved as CharacterId;
    }
    const ds = localStorage.getItem('zs2_loadout_defensive');
    if (ds === DefensiveSkillId.DASH || ds === DefensiveSkillId.BARRIER || ds === DefensiveSkillId.REPULSE) this.defensiveSkill = ds as DefensiveSkillId;
    const kp = localStorage.getItem('zs2_loadout_killstreak');
    if (kp === KillstreakPerkId.DAMAGE || kp === KillstreakPerkId.XP || kp === KillstreakPerkId.SPEED) this.killstreakPerk = kp as KillstreakPerkId;
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
