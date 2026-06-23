import { CharacterId, DefensiveSkillId, KillstreakPerkId } from '../types/GameTypes';
import { DEFAULT_MISSION_ID, getMissionById } from '../config/Missions';
import { getWeaponDef, isWeaponSelectableAsStarter } from '../weapons/WeaponCatalog';
import { ActiveZoneJob } from '../types/CityTypes';

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
  private missionId: string = DEFAULT_MISSION_ID;
  private startingWeaponId: string = ''; // '' = basic weapon only
  // City Reclamation: the zone job the accepted run is attributed to (§6.1). NOT
  // persisted across runs — a run carries exactly one accepted job; cleared on resolve
  // so a later free-play win can't mis-credit a finished zone job (§13.7).
  private activeZoneJob: ActiveZoneJob | null = null;

  private constructor() {
    const saved = localStorage.getItem('zs2_loadout_character');
    if (saved === CharacterId.SOLDIER || saved === CharacterId.SCOUT || saved === CharacterId.DEMOLITIONIST) {
      this.selected = saved as CharacterId;
    }
    const ds = localStorage.getItem('zs2_loadout_defensive');
    if (ds === DefensiveSkillId.DASH || ds === DefensiveSkillId.BARRIER || ds === DefensiveSkillId.REPULSE) this.defensiveSkill = ds as DefensiveSkillId;
    const kp = localStorage.getItem('zs2_loadout_killstreak');
    if (kp === KillstreakPerkId.DAMAGE || kp === KillstreakPerkId.XP || kp === KillstreakPerkId.SPEED) this.killstreakPerk = kp as KillstreakPerkId;
    const mid = localStorage.getItem('zs2_loadout_mission');
    if (mid && getMissionById(mid)) this.missionId = mid;
    // Accept the saved starting weapon only if it is a real catalog weapon AND
    // the player still owns the unlock for it (blueprint refunds can leave a
    // stale id). Anything else falls back to the basic weapon.
    const sw = localStorage.getItem('zs2_loadout_starting_weapon');
    if (sw) {
      const def = getWeaponDef(sw);
      if (def && isWeaponSelectableAsStarter(def)) this.startingWeaponId = sw;
    }
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

  public setMissionId(id: string) { this.missionId = id; localStorage.setItem('zs2_loadout_mission', id); }
  public getMissionId(): string { return this.missionId; }

  public setStartingWeaponId(id: string) { this.startingWeaponId = id; localStorage.setItem('zs2_loadout_starting_weapon', id); }
  public getStartingWeaponId(): string { return this.startingWeaponId; }

  public setActiveZoneJob(z: ActiveZoneJob | null) { this.activeZoneJob = z; }
  public getActiveZoneJob(): ActiveZoneJob | null { return this.activeZoneJob; }
}
