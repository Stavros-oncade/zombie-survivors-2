// src/game/types/CampTypes.ts
// Data model for The Survivor Camp outer-loop meta layer (Design Doc 2 of 4).
// See docs/specs/outer-loop-survivor-camp.md. Pure data — no Phaser dependency.

/** The four camp needs. Three consumable stocks + the adversarial horde pressure. */
export enum NeedKind {
  FOOD = 'food',
  WATER = 'water',
  MEDICINE = 'medicine',
  HORDE = 'horde',
}

/** Persistent camp facilities, bought once with blueprint points and tiered. */
export enum BuildingId {
  FARM = 'farm',           // produces food
  WELL = 'well',           // produces water
  INFIRMARY = 'infirmary', // produces medicine + buffers it
  WALLS = 'walls',         // raises campDefense + passive horde suppression
  WAREHOUSE = 'warehouse', // raises capacity (buffer) of food & water
  BARRACKS = 'barracks',   // raises survivor cap + slow passive regrowth (housing)
}

export interface BuildingTier {
  tier: number;                 // 1..maxTier
  cost: number;                 // blueprint points to reach this tier from the previous
  // effects (any subset; interpreted by CampSystem.advanceCycle)
  produces?: { need: NeedKind; amount: number };      // per-cycle yield
  capacityBonus?: { need: NeedKind; amount: number }; // raises that need's capacity
  defenseValue?: number;        // walls: campDefense
  hordeSuppression?: number;    // walls: passive hordeStrength bleed per cycle
  survivorCapBonus?: number;    // barracks: raises max survivors
  survivorRegrowth?: number;    // barracks: survivors regained per cycle if needs are met
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  tiers: BuildingTier[];        // index 0 = tier 1
}

/**
 * Reward a mission grants on WIN. Additive superset of the original
 * `{ blueprintPoints? }` shape, so existing missions keep compiling unchanged.
 */
export interface CampReward {
  blueprintPoints?: number;         // existing — still paid to BlueprintSystem
  food?: number;                    // adds to camp food stock (clamped to capacity)
  water?: number;
  medicine?: number;
  hordePressureReduction?: number;  // subtracts from hordeStrength ("lower horde pressure")
  survivorsRescued?: number;        // adds to population (rescue missions)
}

/** Persisted camp state. localStorage key: 'zs2_camp_v1'. */
export interface CampState {
  version: 1;
  survivors: number;
  needs: {
    food: { stock: number };     // capacity is DERIVED from base + buildings, not stored
    water: { stock: number };
    medicine: { stock: number };
  };
  hordeStrength: number;
  buildings: Partial<Record<BuildingId, number>>; // BuildingId -> owned tier (1..max); absent = not built
  cyclesSurvived: number;
  totalSurvivorsLost: number;
  extinct: boolean;
  lastResolvedRunId: string | null; // idempotency guard for advanceCycle
}

/** Per-cycle resolution report, returned by advanceCycle for the UI / GameOver summary. */
export interface CycleReport {
  produced: Partial<Record<NeedKind, number>>;
  drained: Partial<Record<NeedKind, number>>;
  rewardApplied: CampReward | null;
  hordeStrengthAfter: number;
  campDefense: number;
  breached: boolean;
  deaths: { fromFood: number; fromWater: number; fromMedicine: number; fromBreach: number };
  regrowth: number;
  survivorsAfter: number;
  extinct: boolean;
}

export function defaultCampState(): CampState {
  return {
    version: 1,
    survivors: 10,
    needs: { food: { stock: 30 }, water: { stock: 30 }, medicine: { stock: 15 } },
    hordeStrength: 10,
    buildings: {},                 // no buildings; player buys with blueprint points
    cyclesSurvived: 0,
    totalSurvivorsLost: 0,
    extinct: false,
    lastResolvedRunId: null,
  };
}
