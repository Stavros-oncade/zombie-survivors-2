// src/game/config/Expedition.ts
// Authored catalogs + balance constants for the Expedition Loadout layer.
// See docs/specs/outer-loop-expedition-loadout.md §4–§6. Pattern after
// Missions.ts / RelicSystem RELICS table.
import {
  Perk,
  PerkKind,
  RiskModifierDef,
  RiskModifierId,
  SupplyDef,
  SupplyId,
} from '../types/ExpeditionTypes';

/* ============================ CONSTANTS ============================ */

export const BASE_SUPPLY_CAPACITY = 10;
export const MAX_SURVIVOR_SLOTS = 3;
export const MAX_PERK_SOCKETS = 2;
export const REWARD_MULT_CAP = 4.0;

// Survivor danger (§6)
export const BASE_DANGER = 0.05;
export const DEATH_SHARE = 0.30; // share of danger mass that resolves to DEAD
export const WIN_OUTCOME_FACTOR = 0.4;
export const LOSE_OUTCOME_FACTOR = 1.0;
export const DANGER_MIN = 0.02;
export const DANGER_MAX = 0.95;

/* ============================ SUPPLIES ============================ */

export const SUPPLIES: SupplyDef[] = [
  {
    id: SupplyId.MEDKIT,
    name: 'Medkit',
    description: 'Grants 1 heal charge (press Q in-run).',
    weight: 2,
    apply: (rc) => rc.grantSupplyCharge(SupplyId.MEDKIT, 1),
  },
  {
    id: SupplyId.AMMO_CRATE,
    name: 'Ammo Crate',
    description: '+15% weapon damage for the run.',
    weight: 3,
    apply: (rc) => rc.upgradeWeaponDamage(1.15),
  },
  {
    id: SupplyId.ADRENALINE,
    name: 'Adrenaline',
    description: '+15% attack speed for the run.',
    weight: 2,
    apply: (rc) => rc.upgradeWeaponSpeed(1.15),
  },
  {
    id: SupplyId.REINFORCED,
    name: 'Reinforced Vest',
    description: '+20% max HP for the run.',
    weight: 4,
    apply: (rc) => rc.adjustMaxHealth(1.2),
  },
  {
    id: SupplyId.SCANNER,
    name: 'Scanner',
    description: '+25% reveal radius in the dark (fog missions).',
    weight: 1,
    // Repointed to real Fog of War (docs/specs/fog-of-war.md §4.4): widens the
    // reveal bubble. Inert on missions that are not fogged.
    apply: (rc) => rc.setRevealRadius(1.25),
  },
];

export function getSupplyDef(id: SupplyId): SupplyDef | undefined {
  return SUPPLIES.find((s) => s.id === id);
}

/* ============================== PERKS ============================== */

export const PERKS: Perk[] = [
  {
    id: 'quartermaster',
    name: 'Quartermaster',
    description: '+4 supply capacity.',
    kind: PerkKind.SUPPLY_CAP,
    magnitude: 4,
  },
  {
    id: 'field_medic',
    name: 'Field Medic',
    description: '+10% max HP.',
    kind: PerkKind.STAT_MULT,
    magnitude: 1.1,
    stat: 'maxHealth',
  },
  {
    id: 'scavenger',
    name: 'Scavenger',
    description: '+15% XP gain.',
    kind: PerkKind.XP_MULT,
    magnitude: 1.15,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: '-20% survivor danger.',
    kind: PerkKind.SURVIVAL,
    magnitude: 0.2,
  },
  {
    id: 'bounty',
    name: 'Bounty Hunter',
    description: '+1 blueprint point on win.',
    kind: PerkKind.ON_WIN,
    magnitude: 1,
  },
];

export function getPerk(id: string): Perk | undefined {
  return PERKS.find((p) => p.id === id);
}

/* ========================= RISK MODIFIERS ========================= */

export const RISK_MODIFIERS: RiskModifierDef[] = [
  {
    id: RiskModifierId.DENSITY,
    name: 'Swarm',
    description: '+50% enemy density.',
    rewardBonus: 0.5,
    dangerBonus: 0.2,
    apply: (rc) => rc.setEnemyDensityMult(1.5),
  },
  {
    id: RiskModifierId.FEROCITY,
    name: 'Ferocity',
    description: '+50% enemy damage.',
    rewardBonus: 0.4,
    dangerBonus: 0.25,
    apply: (rc) => rc.setEnemyDamageMult(1.5),
  },
  {
    id: RiskModifierId.ELITE_TIDE,
    name: 'Elite Tide',
    description: 'Elites arrive ~40% sooner.',
    rewardBonus: 0.35,
    dangerBonus: 0.2,
    apply: (rc) => rc.setEliteIntervalMult(0.6),
  },
  {
    id: RiskModifierId.VEIL,
    name: 'The Veil',
    description: 'The run is fogged — a tighter reveal bubble.',
    rewardBonus: 0.3,
    dangerBonus: 0.15,
    // Repointed to real Fog of War (docs/specs/fog-of-war.md §4.4): forces fog ON
    // for the run and narrows the reveal radius for a reward bump.
    apply: (rc) => {
      rc.setFog(true);
      rc.setRevealRadius(0.65);
    },
  },
  {
    id: RiskModifierId.BRITTLE,
    name: 'Brittle',
    description: '-25% player max HP.',
    rewardBonus: 0.45,
    dangerBonus: 0.3,
    apply: (rc) => rc.adjustMaxHealth(0.75),
  },
  {
    id: RiskModifierId.IRONMAN,
    name: 'Ironman',
    description: 'No supplies may be carried.',
    rewardBonus: 0.6,
    dangerBonus: 0.35,
    apply: () => {
      /* supplies are skipped at apply time; enforced by validation. */
    },
  },
];

export function getRiskDef(id: RiskModifierId): RiskModifierDef | undefined {
  return RISK_MODIFIERS.find((r) => r.id === id);
}
