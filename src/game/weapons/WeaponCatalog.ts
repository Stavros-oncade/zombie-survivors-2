// Pure weapon METADATA catalog — intentionally imports NO weapon implementation
// classes. The concrete classes (and their level-1 factories) live in
// WeaponFactory.ts, which is only imported by WeaponSystem (already inside the
// Game scene's module graph).
//
// Why the split: BlueprintSystem/LoadoutManager/Loadout/LevelUpSelection load
// very early (from menus) and only need metadata + unlock predicates. If this
// module pulled in the weapon classes, it would drag `Enemy` into the early
// module graph and trigger a circular-init crash
// ("Cannot access 'Enemy' before initialization" via EliteEnemy extends Enemy).

/** How a weapon may be obtained. */
export enum WeaponUnlockTier {
  STARTER = 'starter',           // always owned (basic weapon)
  LEVELUP_ONLY = 'levelup_only', // appears in level-up; never a blueprint
  BLUEPRINT = 'blueprint',       // level-up AND buyable as a starting weapon
  CITY_SPECIAL = 'city_special', // requires a city-reclamation special blueprint
}

export interface WeaponDef {
  /** Stable id. Reused as the localStorage token and the level-up offer id. */
  id: string;
  name: string;
  description: string;
  tier: WeaponUnlockTier;
  /** Icon key for LevelUpSelection / Loadout (placeholder auto-generated). */
  iconKey: string;
  /** Blueprint cost (points) for BLUEPRINT tier. Omitted for STARTER/LEVELUP_ONLY. */
  blueprintCost?: number;
  /** For CITY_SPECIAL: the special-blueprint id that must be owned. */
  requiresCityBlueprintId?: string;
}

export const WEAPON_CATALOG: WeaponDef[] = [
  // --- migrated existing (numbers live in WeaponFactory.ts) ---
  {
    id: 'piercing_shot', name: 'Piercing Shot',
    description: 'A bolt that pierces multiple enemies.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_piercing', blueprintCost: 4,
  },
  {
    id: 'explosive_burst', name: 'Explosive Burst',
    description: 'A short-range explosive burst around you.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_explosive', blueprintCost: 4,
  },
  {
    id: 'orbital_shield', name: 'Orbital Shield',
    description: 'Guardian bodies orbit and damage nearby foes.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_orbital', blueprintCost: 5,
  },

  // --- new (weapon-unlocks spec) ---
  {
    id: 'ricochet_disc', name: 'Ricochet Disc',
    description: 'A disc that ricochets between enemies.',
    tier: WeaponUnlockTier.LEVELUP_ONLY, iconKey: 'upgrade_ricochet',
  },
  {
    id: 'tesla_arc', name: 'Tesla Arc',
    description: 'Lightning that chains between clustered enemies.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_tesla', blueprintCost: 5,
  },
  {
    id: 'sentry_drone', name: 'Sentry Drone',
    description: 'An autonomous drone that fires at nearby foes.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_drone', blueprintCost: 6,
  },
  {
    id: 'frost_mine', name: 'Frost Mine',
    description: 'Deploy chilling mines that slow and damage.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_frostmine', blueprintCost: 6,
  },
  {
    id: 'prism_beam', name: 'Prism Beam',
    description: 'A sustained beam that melts the nearest threat.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_beam', blueprintCost: 7,
  },
  {
    id: 'void_orb', name: 'Void Orb',
    description: 'Collapse a singularity that pulls and grinds crowds.',
    tier: WeaponUnlockTier.CITY_SPECIAL, iconKey: 'upgrade_voidorb',
    requiresCityBlueprintId: 'city_bp_void_core',
  },
  {
    id: 'sniper_rifle', name: 'Sniper Rifle',
    description: 'Slow, long-range shot that always targets the farthest threat.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_sniper', blueprintCost: 6,
  },
  {
    id: 'inferno_beam', name: 'Inferno Beam',
    description: 'A wide beam that scorches and ignites everything it touches.',
    tier: WeaponUnlockTier.BLUEPRINT, iconKey: 'upgrade_inferno_beam', blueprintCost: 7,
  },
];

export function getWeaponDef(id: string): WeaponDef | undefined {
  return WEAPON_CATALOG.find(w => w.id === id);
}

// Crash-proof localStorage readers. These intentionally read storage directly
// (rather than importing BlueprintSystem) to avoid a circular import:
// BlueprintSystem builds its bp_weapon_* rows from this catalog at module load.
function readIdArray(key: string): string[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** True if the normal-points blueprint with this id has been purchased. */
export function isBlueprintOwned(id: string): boolean {
  return readIdArray('zs2_blueprints_v1').includes(id);
}

/** True if the city-reclamation special blueprint has been minted. */
export function isCityBlueprintOwned(id: string): boolean {
  return readIdArray('zs2_city_blueprints_v1').includes(id);
}

/**
 * Whether a weapon may appear anywhere (level-up offer, loadout list).
 *
 * BLUEPRINT-tier weapons are findable in level-ups by everyone — the blueprint
 * purchase only unlocks the *starting-weapon* slot in the Loadout (see
 * isWeaponSelectableAsStarter). The only weapon a non-meta player cannot
 * encounter in-run is the CITY_SPECIAL (Void Orb).
 */
export function isWeaponUnlocked(def: WeaponDef): boolean {
  switch (def.tier) {
    case WeaponUnlockTier.STARTER:
    case WeaponUnlockTier.LEVELUP_ONLY:
    case WeaponUnlockTier.BLUEPRINT:
      return true;
    case WeaponUnlockTier.CITY_SPECIAL:
      return isCityBlueprintOwned(def.requiresCityBlueprintId!);
  }
}

/**
 * Whether the player may equip this weapon as their starting weapon in the
 * Loadout: BLUEPRINT weapons require the owned `bp_weapon_<id>` blueprint;
 * CITY_SPECIAL weapons require their minted city blueprint.
 */
export function isWeaponSelectableAsStarter(def: WeaponDef): boolean {
  switch (def.tier) {
    case WeaponUnlockTier.BLUEPRINT:
      return isBlueprintOwned(`bp_weapon_${def.id}`);
    case WeaponUnlockTier.CITY_SPECIAL:
      return isCityBlueprintOwned(def.requiresCityBlueprintId!);
    default:
      return false; // STARTER is implicit; LEVELUP_ONLY can never be a starter.
  }
}
