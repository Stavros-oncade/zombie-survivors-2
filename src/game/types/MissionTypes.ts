// src/game/types/MissionTypes.ts
import { EnemyType } from './GameTypes';
import { CampReward } from './CampTypes';

/** All supported win-condition kinds. */
export enum MissionConditionKind {
  KILL_COUNT          = 'kill_count',           // #1
  SURVIVE_TIME        = 'survive_time',          // #2
  KILL_TYPE           = 'kill_type',             // #3
  HOLD_ZONE           = 'hold_zone',             // #4
  KILL_ELITES         = 'kill_elites',           // #5
  SLAY_BOSS           = 'slay_boss',             // #6
  FLAWLESS_WINDOW     = 'flawless_window',       // #7
  COLLECT_DROPS       = 'collect_drops',         // #8
  PURGE_TYPE          = 'purge_type',            // #9 (board clear / extermination)
}

/** A point in world space (world is 2048x1536; see GameConfig.WORLD). */
export interface WorldPoint { x: number; y: number; }

/**
 * Light source kinds (docs/specs/fog-of-war-light-sources.md §3).
 *  - streetlight  : large, steady, cool-white pool (the navigable "spine").
 *  - trashcanFire : smaller, warm, flickering landmark (an "intersection").
 *  - lantern      : carryable, dimmer, amber, permanent.
 *  - flare        : carryable, bright, hot-white, flickering.
 * streetlight/trashcanFire are placed landmarks; lantern/flare are carryable.
 */
export type LightKind = 'streetlight' | 'trashcanFire' | 'lantern' | 'flare';

/**
 * A single authored light placement (rides alongside `Mission.fog`). Each light
 * carves a lit pocket into the same fog reveal field as the player bubble.
 *  - radius?    : override the per-kind base reveal radius (px).
 *  - carryable? : spawn as a walk-over pickup the player can grab/drop (only
 *                 meaningful for lantern/flare; placed landmarks ignore it).
 */
export interface LightDef {
  kind: LightKind;
  x: number;
  y: number;
  radius?: number;
  carryable?: boolean;
}

/**
 * Classification carried by the `enemyKilledClassified` death signal. A virtual
 * Enemy.getKillClass() produces this so elites/bosses are classified correctly
 * (they are constructed with a base EnemyType and cannot be told apart by it).
 */
export interface KillClass {
  type: EnemyType;
  isElite: boolean;
  isBoss: boolean;
}

/* ---------- Discriminated union of condition definitions ---------- */

interface BaseCondition {
  kind: MissionConditionKind;
}

export interface KillCountCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_COUNT;
  target: number;                 // kill this many enemies (any classification)
}

export interface SurviveTimeCondition extends BaseCondition {
  kind: MissionConditionKind.SURVIVE_TIME;
  seconds: number;                // stay alive until run time >= seconds
}

export interface KillTypeCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_TYPE;
  enemyType: EnemyType;           // BASIC|FAST|TANK|RANGED|CARRIER|TOXIC
  target: number;                 // kill this many of that type
}

export interface HoldZoneCondition extends BaseCondition {
  kind: MissionConditionKind.HOLD_ZONE;
  location: WorldPoint;           // center of the zone (world coords)
  radius: number;                 // player must be within this distance (px)
  holdSeconds: number;            // cumulative OR continuous seconds required
  continuous: boolean;            // true = timer resets when you leave; false = cumulative
}

export interface KillElitesCondition extends BaseCondition {
  kind: MissionConditionKind.KILL_ELITES;
  target: number;                 // kill this many EliteEnemy instances
}

export interface SlayBossCondition extends BaseCondition {
  kind: MissionConditionKind.SLAY_BOSS;
  // The default boss spawns at 5:00 (EnemySpawnSystem.bossTimer, 300000ms).
  // forceEarlySpawnAtSeconds optionally overrides spawn timing for this mission.
  forceEarlySpawnAtSeconds?: number;
}

export interface FlawlessWindowCondition extends BaseCondition {
  kind: MissionConditionKind.FLAWLESS_WINDOW;
  seconds: number;                // survive this long...
  withoutBeingHit: true;          // ...taking zero hits (player_hit) during the window
}

export interface CollectDropsCondition extends BaseCondition {
  kind: MissionConditionKind.COLLECT_DROPS;
  target: number;                 // collect this many qualifying pickups/blueprint drops
  pickupTypes?: string[];         // optional filter (PickupType values); default = all
}

export interface PurgeTypeCondition extends BaseCondition {
  kind: MissionConditionKind.PURGE_TYPE;
  enemyType: EnemyType;           // exterminate this type...
  target: number;                 // ...this many, AND board must be clear of it at the end
  requireBoardClearAtFinish: boolean;
}

export type MissionCondition =
  | KillCountCondition
  | SurviveTimeCondition
  | KillTypeCondition
  | HoldZoneCondition
  | KillElitesCondition
  | SlayBossCondition
  | FlawlessWindowCondition
  | CollectDropsCondition
  | PurgeTypeCondition;

/** Static, designer-authored mission definition. */
export interface Mission {
  id: string;                     // stable id, e.g. 'm_kill_200'
  name: string;                   // HUD title, e.g. 'Cull the Horde'
  description: string;            // short flavor / instruction
  condition: MissionCondition;    // the win condition
  reward?: CampReward;            // meta reward on WIN (blueprints + camp resources, §4.1).
                                  // Back-compatible superset of { blueprintPoints? }.
  unlocksMissionId?: string;      // campaign chaining
  difficulty?: 1 | 2 | 3 | 4 | 5; // for sorting / UI
  // Optional "Extraction" mission end. When the primary condition completes, if
  // enabled, the run flips into a survival Extraction phase (reach an off-screen
  // zone and dwell to win) instead of ending immediately. Missions without this
  // flag are unchanged.
  extraction?: { enabled: boolean; radius?: number; dwellSeconds?: number };
  // Optional Mono-Weapon "Specialist" mode (docs/specs/mono-weapon-mission-mode.md).
  // When enabled, the run is locked to a single weapon: the specialist replaces the
  // player's starting loadout (basic/Demolitionist/starting/carried grants) and every
  // OTHER catalog weapon is filtered out of the level-up AND relic-chest pools. Mirrors
  // the `extraction?` opt-in — missions without this flag leave monoWeaponId null and
  // are byte-for-byte unchanged.
  //  - weaponId:       fixed specialist (catalog id, e.g. 'tesla_arc'); '' / 'basic'
  //                    locks to the default peashooter. Resolution order: weaponId.
  //  - weaponPool:     random-from-set when weaponId is omitted (picked at run start).
  //  - playerChoice:   (deferred) let the player choose at mission start.
  //  - replaceBasic:   true = specialist REPLACES the basic weapon (true mono, default);
  //                    false = specialist layered on top of basic (gentler floor).
  //  - allowEvolution: (deferred) enable single-source evolution recipes for this run.
  monoWeapon?: {
    enabled: boolean;
    weaponId?: string;
    weaponPool?: string[];
    playerChoice?: boolean;
    replaceBasic?: boolean;
    allowEvolution?: boolean;
  };
  // Optional Fog of War (docs/specs/fog-of-war.md). When enabled, the arena is
  // shrouded and the player sees only a bubble of light around their survivor.
  // Mirrors the `extraction?` opt-in: missions without this flag never construct
  // FogSystem and are byte-for-byte unchanged.
  //  - revealRadius:   override the default player reveal radius (px).
  //  - blackoutStates: SpawnState ids that, while active, dim the world (§4.5).
  fog?: { enabled: boolean; revealRadius?: number; blackoutStates?: string[] };
  // Optional light sources (docs/specs/fog-of-war-light-sources.md). Placed +
  // carryable lights that emit into the same reveal field as the player bubble.
  // Constructed by LightSystem; mirrors the `fog?` opt-in. Missions without
  // lights (and with fog off) never construct LightSystem (zero change).
  lights?: LightDef[];
}

/** Live, per-run progress for the active mission. */
export interface MissionProgress {
  current: number;                // generic numeric progress (kills, seconds, drops…)
  goal: number;                   // target for the bar (target/seconds/holdSeconds…)
  completed: boolean;             // win latched
  failed: boolean;                // only used by conditions that can hard-fail (e.g. flawless)
  // condition-specific scratch:
  zoneTimer?: number;             // accumulated seconds in zone (HOLD_ZONE)
  windowStartSec?: number;        // when a flawless window started (FLAWLESS_WINDOW)
  lastTickSec?: number;           // for delta accumulation
  elapsedSec?: number;            // accumulated active seconds since start (SURVIVE_TIME)
}
