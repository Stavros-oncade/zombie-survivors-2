// src/game/types/JobBoardTypes.ts
// Data model for The Job Board outer-loop meta layer (Design Doc 1 of 6).
// See docs/specs/outer-loop-job-board.md. Pure data — no Phaser dependency.
//
// The Job Board is PURELY ADDITIVE over the mission system: it reuses `Mission`
// / `MissionCondition` wholesale and never modifies MissionTypes.ts. An offer
// wraps a Mission with (a) run modifiers, (b) a computed difficulty, (c) a
// four-currency reward bundle, and (d) a launch descriptor that routes special
// offers to other scenes.
import { Mission } from './MissionTypes';
import { EnemyType } from './GameTypes';
import { CampReward } from './CampTypes';

/* ──────────────────────────── Run modifiers ──────────────────────────── */

/** All run-altering modifier kinds an offer can carry. Each maps to a knob the
 *  Game / EnemySpawnSystem already exposes (or a small new setter — see §6.3). */
export enum JobModifierKind {
  ENEMY_DENSITY    = 'enemy_density',    // scales spawn count / cap
  ELITE_CADENCE    = 'elite_cadence',    // tightens/loosens the 90s elite interval
  BOSS_TIMING      = 'boss_timing',      // moves the 5:00 boss spawn earlier/later
  HAZARD_FIELD     = 'hazard_field',     // toxic clouds / fire patches seeded in the arena
  TIME_LIMIT       = 'time_limit',       // hard run timer; expiry = LOSE (see §6.3)
  ENEMY_BUFF       = 'enemy_buff',       // +% enemy hp or speed
  SCARCITY         = 'scarcity',         // lowers pickup drop rate (harder sustain)
  TYPE_INFESTATION = 'type_infestation', // biases spawn director toward a type
}

interface BaseModifier { kind: JobModifierKind; }

export interface EnemyDensityModifier extends BaseModifier {
  kind: JobModifierKind.ENEMY_DENSITY;
  multiplier: number;            // 1.0 = normal; 1.5 = +50% spawn pressure
}
export interface EliteCadenceModifier extends BaseModifier {
  kind: JobModifierKind.ELITE_CADENCE;
  intervalMs: number;            // default 90000; lower = more elites
}
export interface BossTimingModifier extends BaseModifier {
  kind: JobModifierKind.BOSS_TIMING;
  spawnAtSeconds: number;        // default 300; lower = boss rush
}
export interface HazardFieldModifier extends BaseModifier {
  kind: JobModifierKind.HAZARD_FIELD;
  hazard: 'toxic' | 'fire';
  patchCount: number;            // number of seeded hazard zones
}
export interface TimeLimitModifier extends BaseModifier {
  kind: JobModifierKind.TIME_LIMIT;
  seconds: number;               // run must complete the win condition before this
}
export interface EnemyBuffModifier extends BaseModifier {
  kind: JobModifierKind.ENEMY_BUFF;
  hpMultiplier?: number;         // e.g. 1.25
  speedMultiplier?: number;      // e.g. 1.15
}
export interface ScarcityModifier extends BaseModifier {
  kind: JobModifierKind.SCARCITY;
  dropRateMultiplier: number;    // 0.5 = half pickups
}
export interface TypeInfestationModifier extends BaseModifier {
  kind: JobModifierKind.TYPE_INFESTATION;
  enemyType: EnemyType;
  weight: number;                // bias strength toward this type
}

export type JobModifier =
  | EnemyDensityModifier | EliteCadenceModifier | BossTimingModifier
  | HazardFieldModifier  | TimeLimitModifier    | EnemyBuffModifier
  | ScarcityModifier     | TypeInfestationModifier;

/* ──────────────────────────── Rewards (4 currencies) ──────────────────────────── */

export enum CampResource { FOOD = 'food', WATER = 'water', MEDICINE = 'medicine' }

/**
 * The offer's reward. To flow through the Phase-1 camp cycle unchanged, the
 * bundle of (a) blueprints, (c) horde-pressure relief and (d) food/water/medicine
 * is expressed as a Phase-1 `CampReward` — the SAME type `CampSystem.advanceCycle`
 * already consumes (no double-pay, no new sink). The 4th currency, (b) campaign
 * progression, has no CampReward field yet, so it is carried alongside and paid
 * through `CampaignSystem` (a thin stub until the campaign doc lands).
 */
export interface JobReward {
  /** Blueprints + horde relief + food/water/medicine — flows through CampSystem. */
  camp: CampReward;
  /** Campaign progression points — paid through CampaignSystem (stub). */
  campaignPoints?: number;
}

/* ──────────────────────────── Special launch types ──────────────────────────── */

/** Normal offers launch SceneKey.Game. Special offers route elsewhere (§6.4). */
export enum JobLaunchKind {
  GAME_RUN         = 'game_run',          // default: launch the inner-loop Game scene
  LONG_RECON       = 'long_recon',        // → route map sub-loop (outer-loop-route-map.md)
  CITY_RECLAMATION = 'city_reclamation',  // → district reclamation (outer-loop-city-reclamation.md)
}

export interface JobLaunch {
  kind: JobLaunchKind;
  /** Opaque payload handed to the destination scene (route seed, district id, etc.). */
  payload?: Record<string, unknown>;
}

/* ──────────────────────────── The offer ──────────────────────────── */

/** One card on the Job Board. Wraps a Mission with modifiers + rewards + routing. */
export interface JobOffer {
  id: string;                    // stable per-generation id (seeded — see §4)
  title: string;                 // board headline, e.g. 'Supply Run: West Yards'
  flavor: string;                // one-line client/quest text
  mission: Mission;              // REUSED win condition (generated from a template)
  modifiers: JobModifier[];      // run-altering conditions
  reward: JobReward;             // balanced bundle (§5)
  difficulty: number;            // computed score (§5.1), 1..100, drives reward + UI tier
  rewardBudget: number;          // raw budget (§5.2) — used to verify the monotonicity invariant
  launch: JobLaunch;             // GAME_RUN by default; special types route elsewhere
  expiresAtRunCount?: number;    // board generation index this offer belongs to (§4.3)
}

/** Persisted board state (one active board of 3 offers + bookkeeping). */
export interface JobBoardState {
  version: 1;
  seed: number;                  // rng seed that produced the current offers
  generation: number;            // increments each refresh (run counter)
  offers: JobOffer[];            // exactly 3
  acceptedOfferId: string | null;// set when player commits an offer for the next run
  rerollsRemaining: number;      // free rerolls left this generation (§4.4)
}
