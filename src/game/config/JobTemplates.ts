// src/game/config/JobTemplates.ts
// Authored Job Board templates (§3). A template defines the SHAPE and flavor of a
// job; the generator (JobBoardSystem) scales targets, rolls modifiers, computes
// difficulty + reward. Designers control feel here; the generator controls balance.
import {
  JobModifier,
  JobModifierKind,
  JobLaunchKind,
} from '../types/JobBoardTypes';
import { Mission, MissionCondition, MissionConditionKind } from '../types/MissionTypes';
import { EnemyType } from '../types/GameTypes';
import { Rng, randInt, pick } from '../utils/Rng';

/** Which of the four currencies a template's reward budget leans toward. */
export type RewardEmphasis = Partial<Record<'blueprints' | 'campaign' | 'horde' | 'resources', number>>;

/** A single modifier roll option: a probability weight + a tier-scaled maker. */
export interface ModifierOption {
  make: (rng: Rng, tier: number) => JobModifier;
  weight: number;
}

export interface JobTemplate {
  id: string;                          // template id, e.g. 't_supply_run'
  titlePool: string[];                 // headline variants
  flavorPool: string[];
  conditionKind: MissionConditionKind; // which win condition to instantiate
  /** Builds the concrete (scaled) win condition for this offer. */
  buildCondition: (rng: Rng, tier: number) => MissionCondition;
  /** Modifiers that MAY roll onto this template. */
  modifierTable: ModifierOption[];
  /** Reward emphasis: how the budget (§5) splits across the 4 currencies. */
  rewardEmphasis: RewardEmphasis;
  /** Base difficulty anchor (1..5), matches Missions.ts authored ordering. */
  baseDifficulty: 1 | 2 | 3 | 4 | 5;
  launchKind?: JobLaunchKind;          // default GAME_RUN; set for special jobs
  minTier?: number;                    // gate harder/special templates behind progression
  /** Mono-Weapon (Specialist) lock for this template (docs/specs/mono-weapon-
   *  mission-mode.md). Copied verbatim onto the instantiated Mission so the run
   *  forces this weapon and locks the rest. Omitted ⇒ a normal draft run. */
  monoWeapon?: Mission['monoWeapon'];
}

// ── shared modifier makers ───────────────────────────────────────────────
const modDensity: ModifierOption = {
  weight: 3,
  make: (_rng, tier) => ({
    kind: JobModifierKind.ENEMY_DENSITY,
    multiplier: 1.2 + tier * 0.1,
  }),
};
const modElite: ModifierOption = {
  weight: 2,
  make: (_rng, tier) => ({
    kind: JobModifierKind.ELITE_CADENCE,
    intervalMs: Math.max(30000, 90000 - tier * 12000),
  }),
};
const modBoss: ModifierOption = {
  weight: 1,
  make: (_rng, tier) => ({
    kind: JobModifierKind.BOSS_TIMING,
    spawnAtSeconds: Math.max(120, 300 - tier * 40),
  }),
};
const modHazardToxic: ModifierOption = {
  weight: 2,
  make: (rng, tier) => ({
    kind: JobModifierKind.HAZARD_FIELD,
    hazard: 'toxic',
    patchCount: randInt(rng, 1, 1 + tier),
  }),
};
const modHazardFire: ModifierOption = {
  weight: 1,
  make: (rng, tier) => ({
    kind: JobModifierKind.HAZARD_FIELD,
    hazard: 'fire',
    patchCount: randInt(rng, 1, 1 + tier),
  }),
};
const modScarcity: ModifierOption = {
  weight: 2,
  make: (_rng, tier) => ({
    kind: JobModifierKind.SCARCITY,
    dropRateMultiplier: Math.max(0.4, 0.8 - tier * 0.1),
  }),
};
const modBuff: ModifierOption = {
  weight: 2,
  make: (_rng, tier) => ({
    kind: JobModifierKind.ENEMY_BUFF,
    hpMultiplier: 1.1 + tier * 0.1,
    speedMultiplier: 1.05 + tier * 0.05,
  }),
};
const modTimeLimit: ModifierOption = {
  weight: 2,
  make: (_rng, _tier) => ({
    kind: JobModifierKind.TIME_LIMIT,
    seconds: 180,
  }),
};
const infestation = (type: EnemyType): ModifierOption => ({
  weight: 3,
  make: (_rng, tier) => ({
    kind: JobModifierKind.TYPE_INFESTATION,
    enemyType: type,
    weight: 1 + tier,
  }),
});

const COMMON_MODS: ModifierOption[] = [modDensity, modElite, modScarcity, modBuff];

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: 't_supply_run',
    titlePool: ['Supply Run: West Yards', 'Scavenge the Depot', 'Quartermaster Errand'],
    flavorPool: ['The camp needs food. Clear the yards and we eat tonight.'],
    conditionKind: MissionConditionKind.KILL_COUNT,
    baseDifficulty: 1,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.KILL_COUNT,
      target: randInt(rng, 120, 160) + tier * 40,
    }),
    modifierTable: [modDensity, modScarcity, modTimeLimit],
    rewardEmphasis: { resources: 0.7, blueprints: 0.3 },
  },
  {
    id: 't_hold_perimeter',
    titlePool: ['Hold the Perimeter', 'Last Light Watch', 'Stand the Wall'],
    flavorPool: ['Keep them off the fence line until dawn. Just survive.'],
    conditionKind: MissionConditionKind.SURVIVE_TIME,
    baseDifficulty: 2,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.SURVIVE_TIME,
      seconds: randInt(rng, 180, 240) + tier * 30,
    }),
    modifierTable: [modDensity, modElite, modBuff],
    rewardEmphasis: { horde: 0.7, blueprints: 0.3 },
  },
  {
    id: 't_pest_control',
    titlePool: ['Pest Control: Toxics', 'Cull the Spitters', 'Toxic Sweep'],
    flavorPool: ['The toxic strain is spreading. Thin the numbers.'],
    conditionKind: MissionConditionKind.KILL_TYPE,
    baseDifficulty: 3,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.KILL_TYPE,
      enemyType: EnemyType.TOXIC,
      target: randInt(rng, 20, 30) + tier * 10,
    }),
    modifierTable: [infestation(EnemyType.TOXIC), modHazardToxic, modDensity],
    rewardEmphasis: { resources: 0.5, blueprints: 0.5 },
  },
  {
    id: 't_beacon_defense',
    titlePool: ['Beacon Defense', 'Hold the Relay', 'Light the Signal'],
    flavorPool: ['Hold the broadcast zone long enough to raise the relay.'],
    conditionKind: MissionConditionKind.HOLD_ZONE,
    baseDifficulty: 3,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.HOLD_ZONE,
      location: { x: 512, y: 384 },
      radius: 200,
      holdSeconds: randInt(rng, 25, 35) + tier * 8,
      continuous: false,
    }),
    modifierTable: [modDensity, modElite, modHazardFire],
    rewardEmphasis: { horde: 0.5, campaign: 0.5 },
  },
  {
    id: 't_elite_bounty',
    titlePool: ['Elite Bounty', 'Headhunter Contract', 'Mark the Brutes'],
    flavorPool: ['There is a price on the big ones. Bring proof.'],
    conditionKind: MissionConditionKind.KILL_ELITES,
    baseDifficulty: 3,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.KILL_ELITES,
      target: randInt(rng, 2, 3) + Math.floor(tier / 2),
    }),
    modifierTable: [modElite, modBuff, modDensity],
    rewardEmphasis: { blueprints: 0.8, campaign: 0.2 },
  },
  {
    id: 't_decapitation',
    titlePool: ['Decapitation', 'Kingslayer Contract', 'Behead the Horde'],
    flavorPool: ['Their alpha leads from the front. End it and they scatter.'],
    conditionKind: MissionConditionKind.SLAY_BOSS,
    baseDifficulty: 5,
    buildCondition: (_rng, tier) => ({
      kind: MissionConditionKind.SLAY_BOSS,
      forceEarlySpawnAtSeconds: tier >= 2 ? 240 : undefined,
    }),
    modifierTable: [modBoss, modBuff, modDensity],
    rewardEmphasis: { campaign: 0.6, blueprints: 0.4 },
    minTier: 1,
  },
  {
    id: 't_ghost_protocol',
    titlePool: ['Ghost Protocol', 'Untouchable', 'No Marks'],
    flavorPool: ['In and out without a scratch. Discipline over firepower.'],
    conditionKind: MissionConditionKind.FLAWLESS_WINDOW,
    baseDifficulty: 4,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.FLAWLESS_WINDOW,
      seconds: randInt(rng, 45, 75) + tier * 15,
      withoutBeingHit: true,
    }),
    modifierTable: [modDensity, modElite],
    rewardEmphasis: { blueprints: 0.8, campaign: 0.2 },
    minTier: 1,
  },
  {
    id: 't_salvage_sweep',
    titlePool: ['Salvage Sweep', 'Picker Run', 'Scrap the Field'],
    flavorPool: ['Grab everything that drops. The camp turns scrap into life.'],
    conditionKind: MissionConditionKind.COLLECT_DROPS,
    baseDifficulty: 2,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.COLLECT_DROPS,
      target: randInt(rng, 12, 18) + tier * 5,
    }),
    modifierTable: [modDensity, modBuff],
    rewardEmphasis: { resources: 0.8, blueprints: 0.2 },
  },
  // ── Specialist (Mono-Weapon) jobs (docs/specs/mono-weapon-mission-mode.md).
  //    The whole run is locked to one weapon; weapon + objective are curated as a
  //    pair (§5.3): a crowd-clear tool on a horde, a single-target tool on elites. ──
  {
    id: 't_specialist_storm',
    titlePool: ['Specialist: Storm Caller', 'Tesla Doctrine', 'One Tool: Arc'],
    flavorPool: ['Field test: the Arc rig and nothing else. Make it chain.'],
    conditionKind: MissionConditionKind.KILL_COUNT,
    baseDifficulty: 3,
    buildCondition: (rng, tier) => ({
      kind: MissionConditionKind.KILL_COUNT,
      target: randInt(rng, 140, 180) + tier * 40,
    }),
    modifierTable: [modDensity, modElite],
    rewardEmphasis: { horde: 0.6, blueprints: 0.4 },
    monoWeapon: { enabled: true, weaponId: 'tesla_arc' },
  },
  {
    id: 't_specialist_marksman',
    titlePool: ['Specialist: Marksman', 'Piercing Doctrine', 'One Tool: Lance'],
    flavorPool: ['Just the Piercing rig. Punch a hole through their line.'],
    conditionKind: MissionConditionKind.KILL_ELITES,
    baseDifficulty: 3,
    buildCondition: (_rng, tier) => ({
      kind: MissionConditionKind.KILL_ELITES,
      target: 2 + Math.floor(tier / 2),
    }),
    modifierTable: [modElite, modBuff],
    rewardEmphasis: { blueprints: 0.6, resources: 0.4 },
    monoWeapon: { enabled: true, weaponId: 'piercing_shot' },
  },
  // ── special offers — route to sub-loops (§6.4). Gated behind minTier until
  //    those scenes exist; the wrapped Mission is nominal. ──
  {
    id: 't_long_recon',
    titlePool: ['Long Recon', 'Deep Patrol', 'The Far Road'],
    flavorPool: ['Map the road ahead. A branching expedition awaits.'],
    conditionKind: MissionConditionKind.SURVIVE_TIME,
    baseDifficulty: 4,
    buildCondition: () => ({ kind: MissionConditionKind.SURVIVE_TIME, seconds: 300 }),
    modifierTable: [],
    rewardEmphasis: { campaign: 0.6, blueprints: 0.4 },
    launchKind: JobLaunchKind.LONG_RECON,
    minTier: 0, // Route map shipped — surfaced on the board.
  },
  {
    id: 't_city_reclamation',
    titlePool: ['City Reclamation', 'Reclaim the District', 'Push the Line'],
    flavorPool: ['Take back a district from the infestation, block by block.'],
    conditionKind: MissionConditionKind.HOLD_ZONE,
    baseDifficulty: 5,
    buildCondition: () => ({
      kind: MissionConditionKind.HOLD_ZONE,
      location: { x: 512, y: 384 },
      radius: 200,
      holdSeconds: 40,
      continuous: false,
    }),
    modifierTable: [],
    rewardEmphasis: { campaign: 0.5, horde: 0.5 },
    launchKind: JobLaunchKind.CITY_RECLAMATION,
    minTier: 0, // City Reclamation scene shipped — surfaced on the board.
  },
];

/** Pick a title/flavor deterministically from a template's pools. */
export function pickTitle(rng: Rng, tmpl: JobTemplate): string {
  return pick(rng, tmpl.titlePool);
}
export function pickFlavor(rng: Rng, tmpl: JobTemplate): string {
  return pick(rng, tmpl.flavorPool);
}

// Common modifier menu re-export for templates that want the generic set.
export { COMMON_MODS };
