import { Game } from '../scenes/Game';
import { WEAPON_CATALOG, WeaponUnlockTier } from '../weapons/WeaponCatalog';
import { LoadoutManager } from './LoadoutManager';

type Blueprint = { id: string; name: string; description: string; cost: number; apply: (game: Game) => void };

const STORAGE_KEY = 'zs2_blueprints_v1';
const STORAGE_POINTS = 'zs2_bp_points';
const STORAGE_CITY_KEY = 'zs2_city_blueprints_v1';

// Non-weapon blueprints (hand-authored).
const BASE_BLUEPRINTS: Blueprint[] = [
  { id: 'bp_xp_boost', name: 'XP Booster', description: '+10% experience gain', cost: 3, apply: (game) => {
      const rs = game.getRelicSystemInternal();
      rs.setXPMultiplier(rs.getXPMultiplier() * 1.1);
    } },
  { id: 'bp_hp_boost', name: 'Toughness', description: '+10% max HP', cost: 2, apply: (game) => {
      game.playerAdjustMaxHealth(1.1);
    } },
  { id: 'bp_weapon_power', name: 'Armorer', description: '+10% weapon damage', cost: 3, apply: (game) => {
      game.getWeaponSystem().upgradeWeaponDamage(1.1);
    } },
];

// Weapon-unlock blueprints generated from the catalog (single source of truth).
// Each `bp_weapon_<id>` unlocks the weapon for the Loadout; the run only starts
// with it if the player equipped it as their starting weapon.
const WEAPON_BLUEPRINTS: Blueprint[] = WEAPON_CATALOG
  .filter(w => w.tier === WeaponUnlockTier.BLUEPRINT)
  .map(w => ({
    id: `bp_weapon_${w.id}`,
    name: `Arms: ${w.name}`,
    description: `Unlock ${w.name} for your loadout (and start with it if equipped).`,
    cost: w.blueprintCost ?? 5,
    apply: (game: Game) => {
      if (LoadoutManager.getInstance().getStartingWeaponId() === w.id) {
        game.getWeaponSystem().unlockWeapon(w.id);
      }
    },
  }));

export const BLUEPRINTS: Blueprint[] = [...BASE_BLUEPRINTS, ...WEAPON_BLUEPRINTS];

export class BlueprintSystem {
  static getPoints(): number {
    const n = parseInt(localStorage.getItem(STORAGE_POINTS) || '5', 10);
    // Guard against corrupt/non-numeric storage: NaN here would defeat the
    // affordability check and then get persisted back as the string "NaN",
    // permanently poisoning the balance.
    return Number.isFinite(n) ? n : 5;
  }
  static setPoints(v: number) { localStorage.setItem(STORAGE_POINTS, String(Math.max(0, Math.floor(v)))); }
  static addPoints(delta: number) { this.setPoints(this.getPoints() + Math.floor(delta)); }

  // Single safe reader for the unlocked-id list so every consumer is crash-proof
  // against corrupt JSON in localStorage (manual edits, partial writes, other tabs).
  private static readUnlockedArray(): string[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  static isUnlocked(id: string): boolean {
    return this.readUnlockedArray().includes(id);
  }
  static getUnlockedIds(): string[] {
    return this.readUnlockedArray();
  }
  static unlock(id: string): boolean {
    const cost = BLUEPRINTS.find(b => b.id === id)?.cost ?? 0;
    const pts = this.getPoints();
    if (this.isUnlocked(id) || pts < cost) return false;
    const arr = this.readUnlockedArray();
    arr.push(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    this.setPoints(pts - cost);
    return true;
  }

  // Unequip / refund blueprint: removes it from unlocked list and refunds cost
  static unequip(id: string): boolean {
    if (!this.isUnlocked(id)) return false;
    const arr = this.readUnlockedArray();
    const idx = arr.indexOf(id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    const cost = BLUEPRINTS.find(b => b.id === id)?.cost ?? 0;
    const pts = this.getPoints();
    this.setPoints(pts + cost);
    return true;
  }

  // City-reclamation special blueprints live in their own store, minted by the
  // (not-yet-built) City phase. Read-only here so CITY_SPECIAL weapons can be
  // gated without crashing before that phase exists.
  static isCityBlueprintOwned(id: string): boolean {
    const raw = localStorage.getItem(STORAGE_CITY_KEY);
    try { return !!raw && (JSON.parse(raw) as string[]).includes(id); } catch { return false; }
  }

  static applyToGame(game: Game) {
    BLUEPRINTS.forEach(bp => { if (this.isUnlocked(bp.id)) bp.apply(game); });
  }
}
