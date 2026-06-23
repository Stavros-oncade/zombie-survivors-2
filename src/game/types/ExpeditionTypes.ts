// src/game/types/ExpeditionTypes.ts
// Data model for The Expedition Loadout outer-loop meta layer (Design Doc 5 of N).
// See docs/specs/outer-loop-expedition-loadout.md. Pure data — no Phaser dependency.
//
// The Expedition Loadout is the prep step between camp and run: the player
// allocates four scarce resources (supplies, survivors, perks, risk modifiers)
// into an immutable ExpeditionPlan that is handed to the Game scene as run config.

/* ============================ SUPPLIES ============================ */

export enum SupplyId {
  MEDKIT = 'medkit', // heal-on-demand charge (in-run consumable)
  AMMO_CRATE = 'ammo_crate', // +weapon damage for the run
  ADRENALINE = 'adrenaline', // +attack speed for the run
  SCANNER = 'scanner', // reveals zone/boss earlier on HUD (+vision)
  REINFORCED = 'reinforced', // +max HP for the run
}

/** Designer-authored supply definition (a catalog entry). */
export interface SupplyDef {
  id: SupplyId;
  name: string;
  description: string;
  weight: number; // capacity cost (see scarcity §3)
  /** How a unit applies at run start. Consumed on use; inventory is a camp resource. */
  apply: (rc: RunModifierSink) => void;
}

/** A stack of a supply committed to the plan. */
export interface SupplyStack {
  id: SupplyId;
  qty: number; // how many units of this supply to bring
}

/* ============================ SURVIVORS ============================ */

export enum SurvivorStatus {
  HEALTHY = 'healthy',
  INJURED = 'injured', // recovering in camp; not assignable
  DEAD = 'dead', // removed from roster
}

/** Camp-owned unit (full definition lives in outer-loop-survivor-camp.md). */
export interface SurvivorRef {
  id: string; // stable survivor id from the camp roster
  name: string;
  level: number; // affects perk magnitude + survival odds
  perk: Perk; // the run-affecting perk this survivor grants while assigned
  status: SurvivorStatus; // must be HEALTHY to assign
}

/** One survivor committed to this expedition (self-contained run snapshot). */
export interface SurvivorAssignment {
  survivorId: string; // ref into the camp roster
  name: string;
  /** Cached at assign-time so the run is self-contained (roster may change). */
  perk: Perk;
  level: number;
}

/** Per-survivor outcome rolled at run end (§6). */
export interface SurvivorOutcome {
  survivorId: string;
  name: string;
  status: SurvivorStatus; // HEALTHY (returned), INJURED, or DEAD
}

/* ============================== PERKS ============================== */

export enum PerkKind {
  STAT_MULT = 'stat_mult', // multiply a player/weapon stat
  XP_MULT = 'xp_mult',
  SUPPLY_CAP = 'supply_cap', // raise carrying capacity
  SURVIVAL = 'survival', // improve survivor survival odds
  ON_WIN = 'on_win', // bonus reward on win
}

export interface Perk {
  id: string;
  name: string;
  description: string;
  kind: PerkKind;
  /** Generic magnitude; interpretation depends on kind (e.g. 1.1 = +10%). */
  magnitude: number;
  /** Optional stat selector for STAT_MULT. */
  stat?: 'maxHealth' | 'speed' | 'weaponDamage' | 'weaponSpeed' | 'projectileSpeed';
}

/* ========================= RISK MODIFIERS ========================= */

export enum RiskModifierId {
  DENSITY = 'density', // +X% enemy spawn count
  FEROCITY = 'ferocity', // +X% enemy damage
  VEIL = 'veil', // reduced vision / fog
  ELITE_TIDE = 'elite_tide', // faster elite cadence
  BRITTLE = 'brittle', // -X% player max HP
  IRONMAN = 'ironman', // no supplies usable this run
}

/** Designer-authored risk-modifier definition. */
export interface RiskModifierDef {
  id: RiskModifierId;
  name: string;
  description: string;
  /** Additive reward bonus this modifier contributes (e.g. 0.5 = +50%). */
  rewardBonus: number;
  /** Additive survivor-danger contribution (see §6). */
  dangerBonus: number;
  /** How the modifier mutates the run config when active. */
  apply: (rc: RunModifierSink) => void;
  /** Ids that cannot be combined with this one (mutual exclusion). */
  conflictsWith?: RiskModifierId[];
}

/* ===================== ASSEMBLED EXPEDITION PLAN ===================== */

/** Mutable draft the Loadout scene edits; persisted to localStorage. */
export interface ExpeditionPlanDraft {
  missionId: string;
  supplies: SupplyStack[];
  survivors: SurvivorAssignment[];
  perks: string[]; // slotted Perk ids
  risks: RiskModifierId[]; // active risk modifiers
}

/** The frozen plan handed to the Game scene as run config. */
export interface ExpeditionPlan {
  missionId: string; // the selected mission (drives MissionSystem)
  supplies: SupplyStack[];
  survivors: SurvivorAssignment[];
  perks: string[]; // slotted Perk ids
  risks: RiskModifierId[]; // active risk modifiers
  /** Derived, cached at freeze time (single source of truth for the run). */
  derived: {
    usedWeight: number;
    capacityWeight: number;
    rewardMultiplier: number; // total reward scaling (§5)
    dangerScore: number; // total survivor danger sans outcome (§6.1)
    onWinBonusPoints: number; // flat BP added on win (ON_WIN perks)
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * The narrow surface supplies / perks / risk modifiers mutate at run start.
 * Backed by the existing Game accessors so we do NOT widen Game's public API
 * more than necessary (see §8). Stat methods already exist on Game today; the
 * EnemySpawnSystem / vision / supply-charge hooks are the genuinely new surface.
 */
export interface RunModifierSink {
  adjustMaxHealth(mult: number): void;
  applyAsymptoticSpeed(mult: number): void;
  upgradeWeaponDamage(mult: number): void;
  upgradeWeaponSpeed(mult: number): void;
  upgradeProjectileSpeed(mult: number): void;
  setXPMultiplier(mult: number): void;
  grantSupplyCharge(id: SupplyId, qty: number): void; // in-run consumable charges (§8)
  setEnemyDensityMult(mult: number): void; // EnemySpawnSystem hook
  setEnemyDamageMult(mult: number): void; // EnemySpawnSystem hook
  setEliteIntervalMult(mult: number): void; // EnemySpawnSystem hook
  setVision(mult: number): void; // camera zoom hook
}
