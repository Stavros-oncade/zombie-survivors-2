// src/game/types/CityTypes.ts
// Data model for City Reclamation (Outer Loop Design Doc 4 of 6).
// See docs/specs/outer-loop-city-reclamation.md §2.
//
// City Reclamation is PURELY ADDITIVE over the mission system. A ZoneJobDef.condition
// is literally a MissionCondition reused verbatim — City Reclamation only cares about
// the RESULT of a winning run, never the in-run loop. Pure data — no Phaser dependency.
import { EnemyType } from './GameTypes';
import { MissionCondition } from './MissionTypes';

/** A zone moves INFESTED -> CONTESTED -> CLEARED as infestation drops past thresholds. */
export enum ZoneState {
  INFESTED  = 'infested',   // infestation > CONTESTED_THRESHOLD
  CONTESTED = 'contested',  // CLEARED_THRESHOLD < infestation <= CONTESTED_THRESHOLD
  CLEARED   = 'cleared',    // infestation <= CLEARED_THRESHOLD (snapped to 0)
}

export enum BiomeId {
  URBAN_RUINS   = 'urban_ruins',   // city 1
  FLOODED_DELTA = 'flooded_delta', // city 2
  ASH_WASTES    = 'ash_wastes',    // city 3
  FROZEN_SPRAWL = 'frozen_sprawl', // city 4
  TOXIC_JUNGLE  = 'toxic_jungle',  // city 5 (overgrown, spore-choked ruins)
}

/** What clearing this zone grants. All entries are additive and idempotent. */
export interface ZoneRewards {
  /** Special city-reclamation blueprints minted into zs2_city_blueprints_v1 (weapon unlocks). */
  cityBlueprintIds?: string[];
  /** Revealed-blueprint ledger ids (forward ref into BLUEPRINTS bp.special — weapon-unlocks doc). */
  blueprintIds?: string[];
  /** Camp vendors/facilities unlocked -> emitted as vendor_unlocked (camp doc). */
  vendorIds?: string[];
  /** One-time meta-currency grant (BlueprintSystem.addPoints). */
  blueprintPoints?: number;
  /** Additive regional horde-pressure change (usually negative => lowers horde via CampSystem). */
  hordePressureDelta?: number;
}

/** One job attached to a zone. Reuses MissionCondition; adds infestation weighting. */
export interface ZoneJobDef {
  id: string;                  // stable, e.g. 'nyc_z_03_j1'
  name: string;                // 'Cull the Harbor'
  condition: MissionCondition; // REUSED from mission system (kill/survive/hold/purge/...)
  /** How much infestation a single win of THIS job removes from its own zone (pre-adjacency). */
  infestationReward: number;
  /** Optional reward override layered on the mission's own reward.blueprintPoints. */
  bonusBlueprintPoints?: number;
  repeatable: boolean;         // grindable for partial reduction, or one-shot?
}

/** Designer-authored, immutable zone definition (the "blueprint" of a zone). */
export interface ZoneDef {
  id: string;                 // stable, city-unique, e.g. 'nyc_z_03'
  name: string;               // 'Harbor District'
  cityId: string;             // owning city
  grid: { col: number; row: number }; // position on the city grid (layout + adjacency)
  adjacency: string[];        // ids of neighboring zones (explicit; not derived from grid)
  baseInfestation: number;    // starting infestation 0..100 (deeper zones start higher)
  jobs: ZoneJobDef[];         // the job(s) that reduce this zone
  isLongRecon?: boolean;      // TODO(phase: route-map) true => surfaced on the Route Map
  rewards: ZoneRewards;       // granted once on CLEARED
  /** Optional: a zone can require an adjacent zone to be at least CONTESTED before it opens. */
  requiresZoneId?: string;
}

export interface CityReward {
  cityBlueprintIds?: string[]; // tier-up special blueprints minted into zs2_city_blueprints_v1
  blueprintIds?: string[];     // tier-up revealed-blueprint ids
  blueprintPoints?: number;
  unlocksCityId?: string;      // the next city (campaign chaining)
}

/** Designer-authored city definition. */
export interface CityDef {
  id: string;                 // 'city_nyc'
  name: string;               // 'New York Ruins'
  order: number;              // campaign order (0 = first city)
  biome: BiomeId;             // drives visuals + enemy mix
  zones: ZoneDef[];           // the city's zone graph
  /** Enemy-mix weighting for runs launched from this city (escalation knob). */
  enemyMix: Partial<Record<EnemyType, number>>; // weight per type; missing => baseline
  difficultyScalar: number;   // global multiplier applied to spawn rate / HP for this city
  reward: CityReward;         // granted once the WHOLE city is reclaimed
}

/* ---------------- Live, persisted runtime state ---------------- */

/** Per-zone mutable state, persisted to localStorage. */
export interface ZoneState_Live {
  infestation: number;        // current 0..100
  state: ZoneState;           // derived from infestation, cached for fast reads
  cleared: boolean;           // latched; once true, rewards already granted (idempotency)
  jobsCompleted: string[];    // ids of one-shot jobs already done
}

/** The whole persisted City Reclamation document (one per save). */
export interface CityReclamationSave {
  version: number;            // schema version for migrations
  currentCityId: string;      // the city the player is actively reclaiming
  zones: Record<string, ZoneState_Live>; // keyed by ZoneDef.id, across ALL discovered cities
  reclaimedCityIds: string[]; // cities fully cleared (campaign progress)
  grantedRewardKeys: string[];// idempotency ledger: 'zone:<id>' / 'city:<id>' already granted
}

/** Payload carried from MetaMap -> Game -> GameOver and applied at the WIN edge (§6). */
export interface ActiveZoneJob {
  zoneId: string;
  jobId: string;
}
