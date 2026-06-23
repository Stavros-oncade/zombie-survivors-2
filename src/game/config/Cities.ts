// src/game/config/Cities.ts
// Designer-authored city ladder + infestation constants for City Reclamation.
// See docs/specs/outer-loop-city-reclamation.md §2 (thresholds), §5 (unlock tables),
// §7 (city ladder). Patterned after src/game/config/Missions.ts lookups.
//
// Each city is a fully-packed BLOCK GRID (§13.11) produced deterministically by
// generateCityGrid from a fixed per-city seed: the grid is stable across reloads (the
// persisted save keys zones by ZoneDef.id and re-seeds baseInfestation on first visit).
// Designers author only the city frame + a few reward ANCHORS (the Safe Block, vendors,
// and the city-special boss block); the generator fills every other cell with a generic
// combat/hold block scaled by distance from the start. A block opens the moment any
// orthogonal neighbour is cleared (CityReclamationSystem.isZoneOpen).
import { EnemyType } from '../types/GameTypes';
import { BiomeId, CityDef, ZoneDef, ZoneJobDef } from '../types/CityTypes';
import { generateCityGrid, CityAnchor } from '../systems/CityMapGenerator';

/* ─────────────────────────── Thresholds & constants ─────────────────────────── */

export const INFESTATION = {
  MAX: 100,
  MIN: 0,
  CONTESTED_THRESHOLD: 66, // infestation <= 66 => CONTESTED
  CLEARED_THRESHOLD: 5,    // infestation <= 5  => CLEARED (snap to 0)
} as const;

/** 35% of the direct drop bleeds into each adjacent, uncleared zone (§3.2). */
export const ADJACENCY_BLEED = 0.35;
/** difficultyTierBonus = (difficulty - 1) * DIFFICULTY_BONUS_PER_TIER (§3.2). */
export const DIFFICULTY_BONUS_PER_TIER = 2;

/* ─────────────────────────── City 0 — New York Ruins ─────────────────────────── */
// A 5×4 block grid. The Safe Block (start) is pre-cleared and opens its orthogonal
// neighbours; the player expands outward, clearing whichever frontier block they pick.
// The Void Orb city special is minted by the deepest "City Hall" anchor (§Phase-4 hook,
// WeaponCatalog.isCityBlueprintOwned). Grid + seed are FIXED so saved progress is stable.

const NYC = 'city_nyc';

const NYC_ANCHORS: CityAnchor[] = [
  { name: 'Safe Block', placement: 'start', rewards: { vendorIds: ['vendor_quartermaster'] } },
  { name: 'Market', placement: 'inner', jobKind: 'kill',
    rewards: { vendorIds: ['vendor_gunsmith'], blueprintPoints: 3, hordePressureDelta: -5 } },
  { name: 'Clinic', placement: 'inner', jobKind: 'hold',
    rewards: { vendorIds: ['facility_infirmary'], blueprintPoints: 3, hordePressureDelta: -5 } },
  { name: 'Foundry', placement: 'inner', jobKind: 'hold',
    rewards: { vendorIds: ['facility_forge'], blueprintPoints: 4, hordePressureDelta: -6 } },
  // The payoff: clearing the deepest block mints the Void Orb city special.
  { name: 'City Hall', placement: 'farthest', jobKind: 'kill',
    rewards: { cityBlueprintIds: ['city_bp_void_core'], blueprintPoints: 6, hordePressureDelta: -10 } },
];

const NYC_ZONES: ZoneDef[] = generateCityGrid({
  cityId: NYC, seed: 0x4e594331, cols: 5, rows: 4, anchors: NYC_ANCHORS,
});

/* ─────────────────────────── City 1 — Flooded Delta ─────────────────────────── */
// A smaller 4×3 grid proving multi-city advance + escalation. seedCityZones copies
// baseInfestation into live state when nyc reward.unlocksCityId fires.

const DELTA = 'city_delta';

const DELTA_ANCHORS: CityAnchor[] = [
  { name: 'Pier Camp', placement: 'start', rewards: {} },
  { name: 'Tide Market', placement: 'inner', jobKind: 'kill',
    rewards: { vendorIds: ['vendor_gunsmith'], blueprintPoints: 3, hordePressureDelta: -5 } },
  { name: 'Sunken Row', placement: 'farthest', jobKind: 'kill',
    rewards: { cityBlueprintIds: ['city_bp_tide_caller'], blueprintPoints: 5, hordePressureDelta: -8 } },
];

const DELTA_ZONES: ZoneDef[] = generateCityGrid({
  cityId: DELTA, seed: 0x44454c54, cols: 4, rows: 3, anchors: DELTA_ANCHORS,
  blockNames: ['Flooded Pier', 'Sunken Lot', 'Boardwalk', 'Drowned Block', 'Tidal Flats', 'Wharf', 'Marsh Gate', 'Spillway'],
});

/* ─────────────────────────── City 2 — Cinder Reach (Ash Wastes) ─────────────────────────── */
// A 4×4 grid of scorched, ash-choked ruins. The Bunker is the pre-cleared start; two inner
// facilities give a foothold; the deepest "Crematorium" mints an ash-themed city special.

const ASH = 'city_ash';

const ASH_ANCHORS: CityAnchor[] = [
  { name: 'Cinder Bunker', placement: 'start', rewards: { vendorIds: ['vendor_quartermaster'] } },
  { name: 'Slag Market', placement: 'inner', jobKind: 'kill',
    rewards: { vendorIds: ['vendor_gunsmith'], blueprintPoints: 4, hordePressureDelta: -6 } },
  { name: 'Ember Forge', placement: 'inner', jobKind: 'hold',
    rewards: { vendorIds: ['facility_forge'], blueprintPoints: 4, hordePressureDelta: -6 } },
  { name: 'Crematorium', placement: 'farthest', jobKind: 'kill',
    rewards: { cityBlueprintIds: ['city_bp_cinder_maw'], blueprintPoints: 7, hordePressureDelta: -10 } },
];

const ASH_ZONES: ZoneDef[] = generateCityGrid({
  cityId: ASH, seed: 0x41534831, cols: 4, rows: 4, anchors: ASH_ANCHORS,
  blockNames: ['Ash Drift', 'Scorched Row', 'Cinder Yard', 'Burnt Plaza', 'Soot Alley', 'Pyre Block', 'Smolder Lot', 'Charcoal Walk', 'Slag Heap', 'Ember Field'],
});

/* ─────────────────────────── City 3 — Hailgate (Frozen Sprawl) ─────────────────────────── */
// A wide 5×3 grid buried in ice. The Warming Hut is the pre-cleared start; inner blocks
// give a clinic + market; the deepest "Glacier Vault" mints a frost-themed city special.

const FROST = 'city_frost';

const FROST_ANCHORS: CityAnchor[] = [
  { name: 'Warming Hut', placement: 'start', rewards: {} },
  { name: 'Frost Market', placement: 'inner', jobKind: 'kill',
    rewards: { vendorIds: ['vendor_gunsmith'], blueprintPoints: 5, hordePressureDelta: -6 } },
  { name: 'Ice Clinic', placement: 'inner', jobKind: 'hold',
    rewards: { vendorIds: ['facility_infirmary'], blueprintPoints: 5, hordePressureDelta: -7 } },
  { name: 'Glacier Vault', placement: 'farthest', jobKind: 'hold',
    rewards: { cityBlueprintIds: ['city_bp_rime_shard'], blueprintPoints: 8, hordePressureDelta: -12 } },
];

const FROST_ZONES: ZoneDef[] = generateCityGrid({
  cityId: FROST, seed: 0x46524f53, cols: 5, rows: 3, anchors: FROST_ANCHORS,
  blockNames: ['Snowdrift', 'Frozen Lot', 'Ice Span', 'Sleet Row', 'Glazed Block', 'Permafrost', 'Hail Yard', 'Frostbite Alley', 'Whiteout', 'Glacier Walk'],
});

/* ─────────────────────────── City 4 — Verdant Tomb (Toxic Jungle) ─────────────────────────── */
// The smallest 3×3 grid: an overgrown, spore-choked ruin. The Greenhouse is the pre-cleared
// start; one inner facility; the deepest "Spore Heart" mints the final city special. Terminal.

const JUNGLE = 'city_jungle';

const JUNGLE_ANCHORS: CityAnchor[] = [
  { name: 'Greenhouse', placement: 'start', rewards: { vendorIds: ['vendor_quartermaster'] } },
  { name: 'Vine Market', placement: 'inner', jobKind: 'kill',
    rewards: { vendorIds: ['vendor_gunsmith'], blueprintPoints: 6, hordePressureDelta: -7 } },
  { name: 'Spore Heart', placement: 'farthest', jobKind: 'kill',
    rewards: { cityBlueprintIds: ['city_bp_spore_crown'], blueprintPoints: 10, hordePressureDelta: -14 } },
];

const JUNGLE_ZONES: ZoneDef[] = generateCityGrid({
  cityId: JUNGLE, seed: 0x4a554e47, cols: 3, rows: 3, anchors: JUNGLE_ANCHORS,
  blockNames: ['Vine Wall', 'Spore Field', 'Rotten Lot', 'Mossy Block', 'Fungal Row', 'Overgrowth', 'Bramble Walk', 'Choking Mire', 'Canopy Gap'],
});

/* ─────────────────────────── The city ladder ─────────────────────────── */

export const CITIES: CityDef[] = [
  {
    id: NYC, name: 'New York Ruins', order: 0, biome: BiomeId.URBAN_RUINS,
    zones: NYC_ZONES,
    enemyMix: {}, // baseline
    difficultyScalar: 1.0,
    reward: { blueprintPoints: 8, unlocksCityId: DELTA },
  },
  {
    id: DELTA, name: 'Flooded Delta', order: 1, biome: BiomeId.FLOODED_DELTA,
    zones: DELTA_ZONES,
    enemyMix: { [EnemyType.RANGED]: 2, [EnemyType.TOXIC]: 2 }, // §7.2 escalation lean
    difficultyScalar: 1.25,
    reward: { blueprintPoints: 12, unlocksCityId: ASH },
  },
  {
    id: ASH, name: 'Cinder Reach', order: 2, biome: BiomeId.ASH_WASTES,
    zones: ASH_ZONES,
    enemyMix: { [EnemyType.FAST]: 2, [EnemyType.CARRIER]: 2 },
    difficultyScalar: 1.5,
    reward: { blueprintPoints: 16, unlocksCityId: FROST },
  },
  {
    id: FROST, name: 'Hailgate', order: 3, biome: BiomeId.FROZEN_SPRAWL,
    zones: FROST_ZONES,
    enemyMix: { [EnemyType.TANK]: 3, [EnemyType.RANGED]: 2 },
    difficultyScalar: 1.75,
    reward: { blueprintPoints: 20, unlocksCityId: JUNGLE },
  },
  {
    id: JUNGLE, name: 'Verdant Tomb', order: 4, biome: BiomeId.TOXIC_JUNGLE,
    zones: JUNGLE_ZONES,
    enemyMix: { [EnemyType.TOXIC]: 3, [EnemyType.CARRIER]: 2, [EnemyType.FAST]: 1 },
    difficultyScalar: 2.0,
    reward: { blueprintPoints: 28, cityBlueprintIds: ['city_bp_overgrowth_relic'] },
  },
];

export const FIRST_CITY_ID = CITIES[0].id;

/* ─────────────────────────── Lookups (pattern: Missions.ts) ─────────────────────────── */

export function getCityById(id: string): CityDef | undefined {
  return CITIES.find((c) => c.id === id);
}

export function getZoneById(zoneId: string): ZoneDef | undefined {
  for (const c of CITIES) {
    const z = c.zones.find((z) => z.id === zoneId);
    if (z) return z;
  }
  return undefined;
}

export function getJob(zoneId: string, jobId: string): ZoneJobDef | undefined {
  return getZoneById(zoneId)?.jobs.find((j) => j.id === jobId);
}
