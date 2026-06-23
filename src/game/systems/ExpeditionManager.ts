// src/game/systems/ExpeditionManager.ts
// The Expedition Loadout meta layer — a localStorage-backed singleton mirroring
// LoadoutManager's singleton shape and BlueprintSystem/CampSystem's crash-proof
// storage discipline. See docs/specs/outer-loop-expedition-loadout.md §7, §9.
//
// It owns the DRAFT plan the Loadout scene edits, persists the scarce supply
// inventory, freezes an immutable ExpeditionPlan for the run, commits supplies
// on run start, and resolves survivor injury/death at run end (writing back to
// the camp roster via CampSystem.removeSurvivors).
import {
  ExpeditionPlan,
  ExpeditionPlanDraft,
  Perk,
  PerkKind,
  RiskModifierId,
  RunModifierSink,
  SupplyId,
  SurvivorAssignment,
  SurvivorOutcome,
  SurvivorRef,
  SurvivorStatus,
  ValidationResult,
} from '../types/ExpeditionTypes';
import {
  BASE_DANGER,
  BASE_SUPPLY_CAPACITY,
  DANGER_MAX,
  DANGER_MIN,
  DEATH_SHARE,
  LOSE_OUTCOME_FACTOR,
  MAX_PERK_SOCKETS,
  MAX_SURVIVOR_SLOTS,
  REWARD_MULT_CAP,
  SUPPLIES,
  WIN_OUTCOME_FACTOR,
  getPerk,
  getRiskDef,
  getSupplyDef,
} from '../config/Expedition';
import { LoadoutManager } from './LoadoutManager';
import { CampSystem } from './CampSystem';
import { mulberry32 } from '../utils/Rng';
import { resolveMission } from '../config/Missions';

const INVENTORY_KEY = 'zs2_supply_inventory';
const DRAFT_KEY = 'zs2_expedition_draft';

/** Cold-start supply inventory so the feature is playable before the camp
 *  scavenging income side ships (§3 income out of scope). */
const STARTER_INVENTORY: Record<SupplyId, number> = {
  [SupplyId.MEDKIT]: 3,
  [SupplyId.AMMO_CRATE]: 2,
  [SupplyId.ADRENALINE]: 2,
  [SupplyId.REINFORCED]: 1,
  [SupplyId.SCANNER]: 2,
};

function emptyDraft(missionId: string): ExpeditionPlanDraft {
  return { missionId, supplies: [], survivors: [], perks: [], risks: [] };
}

export class ExpeditionManager {
  private static _instance: ExpeditionManager;
  private inventory: Record<SupplyId, number>;
  private draft: ExpeditionPlanDraft;

  private constructor() {
    this.inventory = this.loadInventory();
    this.draft = this.loadDraft();
    // Reconcile the draft's mission with the accepted offer / loadout selection.
    this.setMission(LoadoutManager.getInstance().getMissionId());
  }

  static getInstance(): ExpeditionManager {
    return (this._instance ??= new ExpeditionManager());
  }

  // ───────────────────── persistence (crash-proof) ─────────────────────
  private loadInventory(): Record<SupplyId, number> {
    const inv = { ...STARTER_INVENTORY };
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (!raw) {
      this.saveInventoryObj(inv);
      return inv;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const def of SUPPLIES) {
          const v = parsed[def.id];
          if (Number.isFinite(v) && v >= 0) inv[def.id] = Math.floor(v);
        }
      }
    } catch {
      /* corrupt — fall back to starter */
    }
    return inv;
  }

  private saveInventoryObj(inv: Record<SupplyId, number>): void {
    try {
      localStorage.setItem(INVENTORY_KEY, JSON.stringify(inv));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  private saveInventory(): void {
    this.saveInventoryObj(this.inventory);
  }

  private loadDraft(): ExpeditionPlanDraft {
    const fallback = emptyDraft(LoadoutManager.getInstance().getMissionId());
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return fallback;
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return fallback;
      return {
        missionId: typeof p.missionId === 'string' ? p.missionId : fallback.missionId,
        supplies: Array.isArray(p.supplies)
          ? p.supplies.filter((s: { id: SupplyId; qty: number }) => getSupplyDef(s?.id) && s.qty > 0).map((s: { id: SupplyId; qty: number }) => ({ id: s.id, qty: Math.floor(s.qty) }))
          : [],
        survivors: Array.isArray(p.survivors) ? (p.survivors as SurvivorAssignment[]).filter((s) => s && typeof s.survivorId === 'string') : [],
        perks: Array.isArray(p.perks) ? (p.perks as string[]).filter((id) => !!getPerk(id)) : [],
        risks: Array.isArray(p.risks) ? (p.risks as RiskModifierId[]).filter((id) => !!getRiskDef(id)) : [],
      };
    } catch {
      return fallback;
    }
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this.draft));
    } catch {
      /* non-fatal */
    }
  }

  // ───────────────────── survivor roster (camp seam, §11.9) ─────────────────────
  /**
   * Survivors are a camp resource expressed as a count today
   * (CampSystem.getDeployableCount). Until the named-roster doc ships we expose a
   * synthetic, deterministic roster derived from that count so the feature works
   * end-to-end. Each synthetic survivor grants no perk (Perk-less) and is HEALTHY.
   * TODO(phase: survivor-camp) Replace with the named roster from zs2_camp_survivors.
   */
  getRoster(): SurvivorRef[] {
    const deployable = CampSystem.getInstance().getDeployableCount();
    const roster: SurvivorRef[] = [];
    for (let i = 0; i < deployable; i++) {
      roster.push({
        id: `s${i + 1}`,
        name: `Survivor ${i + 1}`,
        level: 1,
        status: SurvivorStatus.HEALTHY,
        // No bespoke per-survivor perk yet; assignment still carries danger/stakes.
        perk: { id: 'none', name: 'None', description: '', kind: PerkKind.STAT_MULT, magnitude: 1 },
      });
    }
    return roster;
  }

  private getRosterRef(survivorId: string): SurvivorRef | undefined {
    return this.getRoster().find((s) => s.id === survivorId);
  }

  // ───────────────────── draft editing ─────────────────────
  setMission(missionId: string): void {
    if (this.draft.missionId !== missionId) {
      this.draft.missionId = missionId;
    }
    // Drop now-invalid allocations (over-inventory supplies, stale survivors).
    this.draft.supplies = this.draft.supplies.filter((s) => getSupplyDef(s.id) && s.qty > 0);
    const rosterIds = new Set(this.getRoster().map((r) => r.id));
    this.draft.survivors = this.draft.survivors.filter((a) => rosterIds.has(a.survivorId)).slice(0, MAX_SURVIVOR_SLOTS);
    this.draft.perks = this.draft.perks.filter((id) => !!getPerk(id)).slice(0, MAX_PERK_SOCKETS);
    this.draft.risks = this.draft.risks.filter((id) => !!getRiskDef(id));
    this.saveDraft();
  }

  getDraft(): Readonly<ExpeditionPlanDraft> {
    return this.draft;
  }

  getSupplyQty(id: SupplyId): number {
    return this.draft.supplies.find((s) => s.id === id)?.qty ?? 0;
  }

  addSupply(id: SupplyId, qty = 1): boolean {
    const def = getSupplyDef(id);
    if (!def) return false;
    const have = this.getSupplyQty(id);
    if (have + qty > (this.inventory[id] ?? 0)) return false; // insufficient inventory
    // Capacity guard.
    if (this.computeUsedWeight() + def.weight * qty > this.computeCapacity()) return false;
    const stack = this.draft.supplies.find((s) => s.id === id);
    if (stack) stack.qty += qty;
    else this.draft.supplies.push({ id, qty });
    this.saveDraft();
    return true;
  }

  removeSupply(id: SupplyId, qty = 1): void {
    const stack = this.draft.supplies.find((s) => s.id === id);
    if (!stack) return;
    stack.qty -= qty;
    if (stack.qty <= 0) this.draft.supplies = this.draft.supplies.filter((s) => s.id !== id);
    this.saveDraft();
  }

  assignSurvivor(survivorId: string): boolean {
    if (this.draft.survivors.length >= MAX_SURVIVOR_SLOTS) return false;
    if (this.draft.survivors.some((a) => a.survivorId === survivorId)) return false;
    const ref = this.getRosterRef(survivorId);
    if (!ref || ref.status !== SurvivorStatus.HEALTHY) return false;
    this.draft.survivors.push({ survivorId: ref.id, name: ref.name, perk: ref.perk, level: ref.level });
    this.saveDraft();
    return true;
  }

  unassignSurvivor(survivorId: string): void {
    this.draft.survivors = this.draft.survivors.filter((a) => a.survivorId !== survivorId);
    this.saveDraft();
  }

  isSurvivorAssigned(survivorId: string): boolean {
    return this.draft.survivors.some((a) => a.survivorId === survivorId);
  }

  togglePerk(perkId: string): boolean {
    if (!getPerk(perkId)) return false;
    const idx = this.draft.perks.indexOf(perkId);
    if (idx >= 0) {
      this.draft.perks.splice(idx, 1);
      this.saveDraft();
      return true;
    }
    if (this.draft.perks.length >= MAX_PERK_SOCKETS) return false; // no free socket
    this.draft.perks.push(perkId);
    this.saveDraft();
    return true;
  }

  isPerkSlotted(perkId: string): boolean {
    return this.draft.perks.includes(perkId);
  }

  toggleRisk(id: RiskModifierId): boolean {
    const def = getRiskDef(id);
    if (!def) return false;
    const idx = this.draft.risks.indexOf(id);
    if (idx >= 0) {
      this.draft.risks.splice(idx, 1);
      this.saveDraft();
      return true;
    }
    // Conflict check (mutual exclusion, both directions).
    for (const active of this.draft.risks) {
      const aDef = getRiskDef(active);
      if (def.conflictsWith?.includes(active) || aDef?.conflictsWith?.includes(id)) return false;
    }
    this.draft.risks.push(id);
    this.saveDraft();
    return true;
  }

  isRiskActive(id: RiskModifierId): boolean {
    return this.draft.risks.includes(id);
  }

  // ───────────────────── derived computations ─────────────────────
  computeCapacity(): number {
    let cap = BASE_SUPPLY_CAPACITY;
    for (const perkId of this.draft.perks) {
      const p = getPerk(perkId);
      if (p?.kind === PerkKind.SUPPLY_CAP) cap += p.magnitude;
    }
    // Survivor capacity bonus: +1 per survivor level (level 1 → +1).
    for (const a of this.draft.survivors) cap += this.survivorCapacityBonus(a.level);
    return cap;
  }

  private survivorCapacityBonus(level: number): number {
    return Math.max(0, level);
  }

  computeUsedWeight(): number {
    let w = 0;
    for (const s of this.draft.supplies) {
      const def = getSupplyDef(s.id);
      if (def) w += def.weight * s.qty;
    }
    return w;
  }

  computeRewardMultiplier(): number {
    let mult = 1;
    for (const id of this.draft.risks) mult += getRiskDef(id)?.rewardBonus ?? 0;
    return Math.min(mult, REWARD_MULT_CAP);
  }

  /** Danger sans win/lose outcome factor (§6.1). */
  computeDangerScore(): number {
    let danger = BASE_DANGER;
    for (const id of this.draft.risks) danger += getRiskDef(id)?.dangerBonus ?? 0;
    const mission = resolveMission(this.draft.missionId);
    const difficulty = mission.difficulty ?? 2;
    danger += (difficulty - 1) * 0.1;
    // Survival perks reduce danger.
    for (const perkId of this.draft.perks) {
      const p = getPerk(perkId);
      if (p?.kind === PerkKind.SURVIVAL) danger -= p.magnitude;
    }
    // Survivor level mitigation (use the toughest assigned survivor's level).
    const maxLevel = this.draft.survivors.reduce((m, a) => Math.max(m, a.level), 0);
    danger -= Math.min(maxLevel * 0.03, 0.25);
    return Math.max(DANGER_MIN, Math.min(DANGER_MAX, danger));
  }

  private computeOnWinBonus(): number {
    let bonus = 0;
    for (const perkId of this.draft.perks) {
      const p = getPerk(perkId);
      if (p?.kind === PerkKind.ON_WIN) bonus += p.magnitude;
    }
    return Math.round(bonus);
  }

  // ───────────────────── validation ─────────────────────
  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const usedWeight = this.computeUsedWeight();
    const capacity = this.computeCapacity();

    if (usedWeight > capacity) errors.push(`Over capacity (${usedWeight}/${capacity}). Drop supplies.`);

    for (const s of this.draft.supplies) {
      if (s.qty > (this.inventory[s.id] ?? 0)) {
        const def = getSupplyDef(s.id);
        errors.push(`Not enough ${def?.name ?? s.id} in stores.`);
      }
    }

    if (this.draft.survivors.length > MAX_SURVIVOR_SLOTS) errors.push(`Too many survivors (max ${MAX_SURVIVOR_SLOTS}).`);
    const rosterIds = new Set(this.getRoster().map((r) => r.id));
    for (const a of this.draft.survivors) {
      if (!rosterIds.has(a.survivorId)) warnings.push(`${a.name} is no longer available; removed.`);
    }

    if (this.draft.perks.length > MAX_PERK_SOCKETS) errors.push(`Too many perks (max ${MAX_PERK_SOCKETS}).`);

    for (const id of this.draft.risks) {
      const def = getRiskDef(id);
      for (const conflict of def?.conflictsWith ?? []) {
        if (this.draft.risks.includes(conflict)) errors.push(`${def?.name} conflicts with another risk.`);
      }
    }

    if (this.draft.risks.includes(RiskModifierId.IRONMAN) && this.draft.supplies.length > 0) {
      errors.push('Ironman forbids carrying any supplies.');
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  // ───────────────────── freeze + handoff ─────────────────────
  buildPlan(): ExpeditionPlan {
    // Drop stale survivor refs before freezing (§10.7).
    const rosterIds = new Set(this.getRoster().map((r) => r.id));
    this.draft.survivors = this.draft.survivors.filter((a) => rosterIds.has(a.survivorId));
    this.saveDraft();

    const plan: ExpeditionPlan = {
      missionId: this.draft.missionId,
      supplies: this.draft.supplies.map((s) => ({ ...s })),
      survivors: this.draft.survivors.map((a) => ({ ...a })),
      perks: [...this.draft.perks],
      risks: [...this.draft.risks],
      derived: {
        usedWeight: this.computeUsedWeight(),
        capacityWeight: this.computeCapacity(),
        rewardMultiplier: this.computeRewardMultiplier(),
        dangerScore: this.computeDangerScore(),
        onWinBonusPoints: this.computeOnWinBonus(),
      },
    };
    return Object.freeze(plan);
  }

  /** Build a default empty plan for the dev/SpawnTuner entry (§10.2). */
  static emptyPlan(missionId: string): ExpeditionPlan {
    return Object.freeze({
      missionId,
      supplies: [],
      survivors: [],
      perks: [],
      risks: [],
      derived: {
        usedWeight: 0,
        capacityWeight: BASE_SUPPLY_CAPACITY,
        rewardMultiplier: 1,
        dangerScore: BASE_DANGER,
        onWinBonusPoints: 0,
      },
    });
  }

  // ───────────────────── inventory (scarcity) ─────────────────────
  getSupplyInventory(): Readonly<Record<SupplyId, number>> {
    return this.inventory;
  }

  /** Deduct committed supplies on run start. Not refunded on loss (§3). */
  commitSupplies(plan: ExpeditionPlan): void {
    for (const s of plan.supplies) {
      this.inventory[s.id] = Math.max(0, (this.inventory[s.id] ?? 0) - s.qty);
    }
    this.saveInventory();
    // Clear the spent supplies from the live draft so the UI reflects reality.
    this.draft.supplies = [];
    this.saveDraft();
  }

  // ───────────────────── survivor resolution (§6) ─────────────────────
  /**
   * Roll injury/death for each assigned survivor at run end and write back DEAD
   * survivors to the camp roster via CampSystem.removeSurvivors. The RNG is
   * seeded from the runId so a GameOver reload can't reroll fates (§6.3 note).
   * Resolution is delegated from Game inside its `runEnded` latch so it cannot
   * double-apply within a run; the camp's own runId guard is a second backstop
   * (deaths use a per-runId guard key via the caller threading runId).
   */
  resolveSurvivors(outcome: 'win' | 'lose', plan: ExpeditionPlan, runId: string): SurvivorOutcome[] {
    const outcomes: SurvivorOutcome[] = [];
    if (!plan.survivors.length) return outcomes;

    const seed = this.hashSeed(runId);
    const rng = mulberry32(seed);
    const outcomeFactor = outcome === 'win' ? WIN_OUTCOME_FACTOR : LOSE_OUTCOME_FACTOR;
    const effectiveDanger = Math.max(0, Math.min(1, plan.derived.dangerScore * outcomeFactor));

    let deaths = 0;
    for (const a of plan.survivors) {
      const r = rng();
      let status: SurvivorStatus;
      if (r < effectiveDanger * DEATH_SHARE) {
        status = SurvivorStatus.DEAD;
        deaths++;
      } else if (r < effectiveDanger) {
        status = SurvivorStatus.INJURED;
      } else {
        status = SurvivorStatus.HEALTHY;
      }
      outcomes.push({ survivorId: a.survivorId, name: a.name, status });
    }

    // Write back permanent losses to the camp (count-based roster).
    // INJURED survivors recover in camp; with a count-only roster they simply
    // return — no separate injured pool exists yet.
    // TODO(phase: survivor-camp) Persist INJURED status + recovery timers.
    if (deaths > 0) {
      CampSystem.getInstance().removeSurvivors(deaths);
    }

    return outcomes;
  }

  private hashSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Apply a perk to the run via the sink (used by Game.applyExpedition). */
  static applyPerk(perk: Perk, sink: RunModifierSink): void {
    switch (perk.kind) {
      case PerkKind.STAT_MULT:
        switch (perk.stat) {
          case 'maxHealth': sink.adjustMaxHealth(perk.magnitude); break;
          case 'speed': sink.applyAsymptoticSpeed(perk.magnitude); break;
          case 'weaponDamage': sink.upgradeWeaponDamage(perk.magnitude); break;
          case 'weaponSpeed': sink.upgradeWeaponSpeed(perk.magnitude); break;
          case 'projectileSpeed': sink.upgradeProjectileSpeed(perk.magnitude); break;
        }
        break;
      case PerkKind.XP_MULT:
        sink.setXPMultiplier(perk.magnitude);
        break;
      // SUPPLY_CAP, SURVIVAL, ON_WIN are resolved at plan-build time, not in-run.
      case PerkKind.SUPPLY_CAP:
      case PerkKind.SURVIVAL:
      case PerkKind.ON_WIN:
        break;
    }
  }
}
