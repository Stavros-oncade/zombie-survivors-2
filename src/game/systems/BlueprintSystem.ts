import { Game } from '../scenes/Game';

type Blueprint = { id: string; name: string; description: string; cost: number; apply: (game: Game) => void };

const STORAGE_KEY = 'zs2_blueprints_v1';
const STORAGE_POINTS = 'zs2_bp_points';

export const BLUEPRINTS: Blueprint[] = [
  { id: 'bp_xp_boost', name: 'XP Booster', description: '+10% experience gain', cost: 3, apply: (game) => {
      const rs = game.getRelicSystemInternal();
      (rs as any).xpMultiplier = (rs as any).xpMultiplier * 1.1;
    } },
  { id: 'bp_hp_boost', name: 'Toughness', description: '+10% max HP', cost: 2, apply: (game) => {
      game.playerAdjustMaxHealth(1.1);
    } },
  { id: 'bp_start_piercing', name: 'Arms Cache', description: 'Start with Piercing Shot', cost: 4, apply: (game) => {
      game.getWeaponSystem().unlockPiercing();
    } },
  { id: 'bp_start_explosive', name: 'Demolition Kit', description: 'Start with Explosive Burst', cost: 4, apply: (game) => {
      game.getWeaponSystem().unlockExplosive();
    } },
  { id: 'bp_weapon_power', name: 'Armorer', description: '+10% weapon damage', cost: 3, apply: (game) => {
      game.getWeaponSystem().upgradeWeaponDamage(1.1);
    } },
];

export class BlueprintSystem {
  static getPoints(): number { return parseInt(localStorage.getItem(STORAGE_POINTS) || '5'); }
  static setPoints(v: number) { localStorage.setItem(STORAGE_POINTS, String(Math.max(0, Math.floor(v)))); }
  static addPoints(delta: number) { this.setPoints(this.getPoints() + Math.floor(delta)); }

  static isUnlocked(id: string): boolean {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try { const set = JSON.parse(raw) as string[]; return set.includes(id); } catch { return false; }
  }
  static getUnlockedIds(): string[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  static unlock(id: string): boolean {
    const cost = BLUEPRINTS.find(b => b.id === id)?.cost ?? 0;
    const pts = this.getPoints();
    if (this.isUnlocked(id) || pts < cost) return false;
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    arr.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    this.setPoints(pts - cost);
    return true;
  }

  // Unequip / refund blueprint: removes it from unlocked list and refunds cost
  static unequip(id: string): boolean {
    if (!this.isUnlocked(id)) return false;
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const idx = arr.indexOf(id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    const cost = BLUEPRINTS.find(b => b.id === id)?.cost ?? 0;
    const pts = this.getPoints();
    this.setPoints(pts + cost);
    return true;
  }

  static applyToGame(game: Game) {
    BLUEPRINTS.forEach(bp => { if (this.isUnlocked(bp.id)) bp.apply(game); });
  }
}
