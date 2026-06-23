// src/game/systems/CampSystem.ts
// The Survivor Camp meta layer — a localStorage-backed, versioned singleton.
// Pure model (no Phaser dependency) so scenes and future Job Board / Expedition
// systems all call the same instance. See docs/specs/outer-loop-survivor-camp.md.
import { BlueprintSystem } from './BlueprintSystem';
import { CAMP_BUILDINGS } from '../config/CampBuildings';
import {
  BuildingId,
  CampReward,
  CampState,
  CycleReport,
  NeedKind,
  defaultCampState,
} from '../types/CampTypes';

const STORAGE_KEY = 'zs2_camp_v1';

// Generous starting cap until City Reclamation (§5.3) raises it.
const MAX_BUILDING_SLOTS = 6;

// ---- balance: consumable needs (§2.2) ----
const CONSUMABLE_NEEDS = [NeedKind.FOOD, NeedKind.WATER, NeedKind.MEDICINE] as const;
type ConsumableNeed = (typeof CONSUMABLE_NEEDS)[number];

const BASE_DRAIN: Record<ConsumableNeed, number> = {
  [NeedKind.FOOD]: 2,
  [NeedKind.WATER]: 2,
  [NeedKind.MEDICINE]: 1,
};
const PER_CAPITA: Record<ConsumableNeed, number> = {
  [NeedKind.FOOD]: 0.5,
  [NeedKind.WATER]: 0.5,
  [NeedKind.MEDICINE]: 0.2,
};
const BASE_CAPACITY: Record<ConsumableNeed, number> = {
  [NeedKind.FOOD]: 50,
  [NeedKind.WATER]: 50,
  [NeedKind.MEDICINE]: 30,
};
// units of unmet demand that kill one survivor — lower = deadlier (§6.1)
const LETHALITY: Record<ConsumableNeed, number> = {
  [NeedKind.FOOD]: 3,
  [NeedKind.WATER]: 2,
  [NeedKind.MEDICINE]: 4,
};

// ---- balance: horde / breach (§2.3 / §6.2) ----
const HORDE_GROWTH_PER_CYCLE = 4;
const BREACH_LETHALITY = 5;

// ---- balance: base survivor housing (§5) ----
const BASE_SURVIVOR_CAP = 10;

function clampInt(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
}

export class CampSystem {
  private static _instance: CampSystem;
  private state: CampState;
  private lastReport: CycleReport | null = null;

  private constructor() {
    this.state = this.load();
  }

  static getInstance(): CampSystem {
    return (this._instance ??= new CampSystem());
  }

  // ---- persistence (corrupt-proof, mirrors BlueprintSystem.readUnlockedArray) ----
  private load(): CampState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCampState();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
        return defaultCampState();
      }
      const d = defaultCampState();
      const needs = parsed.needs ?? {};
      const buildings: Partial<Record<BuildingId, number>> = {};
      const rawBuildings = parsed.buildings ?? {};
      for (const def of CAMP_BUILDINGS) {
        const tier = rawBuildings[def.id];
        if (Number.isFinite(tier) && tier >= 1) {
          buildings[def.id] = Math.min(def.tiers.length, Math.floor(tier));
        }
      }
      return {
        version: 1,
        survivors: clampInt(parsed.survivors, d.survivors),
        needs: {
          food: { stock: clampInt(needs.food?.stock, d.needs.food.stock) },
          water: { stock: clampInt(needs.water?.stock, d.needs.water.stock) },
          medicine: { stock: clampInt(needs.medicine?.stock, d.needs.medicine.stock) },
        },
        hordeStrength: clampInt(parsed.hordeStrength, d.hordeStrength),
        buildings,
        cyclesSurvived: clampInt(parsed.cyclesSurvived, 0),
        totalSurvivorsLost: clampInt(parsed.totalSurvivorsLost, 0),
        extinct: parsed.extinct === true,
        lastResolvedRunId:
          typeof parsed.lastResolvedRunId === 'string' ? parsed.lastResolvedRunId : null,
      };
    } catch {
      return defaultCampState();
    }
  }

  private save(): void {
    // Clamp stocks to derived capacity before persisting (§ edge case 3).
    for (const need of CONSUMABLE_NEEDS) {
      const slot = this.needSlot(need);
      slot.stock = Math.min(slot.stock, this.getCapacity(need));
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage full / unavailable — non-fatal, state stays in memory.
    }
  }

  private needSlot(need: NeedKind): { stock: number } {
    switch (need) {
      case NeedKind.FOOD: return this.state.needs.food;
      case NeedKind.WATER: return this.state.needs.water;
      case NeedKind.MEDICINE: return this.state.needs.medicine;
      default: return this.state.needs.food;
    }
  }

  // ---- derived getters (capacity & defense recomputed from buildings) ----
  getState(): Readonly<CampState> {
    return this.state;
  }

  getCapacity(need: NeedKind): number {
    if (need === NeedKind.HORDE) return 0;
    const cn = need as ConsumableNeed;
    let cap = BASE_CAPACITY[cn] ?? 0;
    for (const def of CAMP_BUILDINGS) {
      const tier = this.getOwnedTier(def.id);
      if (tier < 1) continue;
      const t = def.tiers[tier - 1];
      if (!t.capacityBonus) continue;
      // Warehouse boosts BOTH food and water; others match their authored need.
      if (def.id === BuildingId.WAREHOUSE) {
        if (cn === NeedKind.FOOD || cn === NeedKind.WATER) cap += t.capacityBonus.amount;
      } else if (t.capacityBonus.need === need) {
        cap += t.capacityBonus.amount;
      }
    }
    return cap;
  }

  getCampDefense(): number {
    const tier = this.getOwnedTier(BuildingId.WALLS);
    if (tier < 1) return 0;
    return getBuildingTierField(BuildingId.WALLS, tier, 'defenseValue') ?? 0;
  }

  private getWallsSuppression(): number {
    const tier = this.getOwnedTier(BuildingId.WALLS);
    if (tier < 1) return 0;
    return getBuildingTierField(BuildingId.WALLS, tier, 'hordeSuppression') ?? 0;
  }

  getSurvivorCap(): number {
    let cap = BASE_SURVIVOR_CAP;
    const tier = this.getOwnedTier(BuildingId.BARRACKS);
    if (tier >= 1) {
      cap += getBuildingTierField(BuildingId.BARRACKS, tier, 'survivorCapBonus') ?? 0;
    }
    return cap;
  }

  private getBarracksRegrowth(): number {
    const tier = this.getOwnedTier(BuildingId.BARRACKS);
    if (tier < 1) return 0;
    return getBuildingTierField(BuildingId.BARRACKS, tier, 'survivorRegrowth') ?? 0;
  }

  getDrainPerCycle(need: NeedKind): number {
    if (need === NeedKind.HORDE) return 0;
    const cn = need as ConsumableNeed;
    return BASE_DRAIN[cn] + Math.ceil(this.state.survivors * PER_CAPITA[cn]);
  }

  getDeployableCount(): number {
    return Math.max(0, this.state.survivors - 1); // §7 floor guard
  }

  // ---- buildings (spends blueprint points) ----
  getMaxBuildingSlots(): number {
    return MAX_BUILDING_SLOTS;
  }

  getOwnedBuildingCount(): number {
    return Object.values(this.state.buildings).filter(t => (t ?? 0) >= 1).length;
  }

  getOwnedTier(id: BuildingId): number {
    return this.state.buildings[id] ?? 0;
  }

  getUpgradeCost(id: BuildingId): number | null {
    const def = CAMP_BUILDINGS.find(b => b.id === id);
    if (!def) return null;
    const owned = this.getOwnedTier(id);
    if (owned >= def.tiers.length) return null; // maxed
    return def.tiers[owned].cost; // tiers[owned] is the NEXT tier (0-indexed)
  }

  /** Returns a reason the build is blocked, or null if it can proceed. */
  getBuildBlockedReason(id: BuildingId): string | null {
    const cost = this.getUpgradeCost(id);
    if (cost === null) return 'Maxed';
    const isNew = this.getOwnedTier(id) === 0;
    if (isNew && this.getOwnedBuildingCount() >= this.getMaxBuildingSlots()) {
      return 'Reclaim a zone to expand.';
    }
    if (BlueprintSystem.getPoints() < cost) return 'Not enough points';
    return null;
  }

  buildOrUpgrade(id: BuildingId): boolean {
    if (this.getBuildBlockedReason(id) !== null) return false;
    const cost = this.getUpgradeCost(id);
    if (cost === null) return false;
    BlueprintSystem.setPoints(BlueprintSystem.getPoints() - cost);
    this.state.buildings[id] = this.getOwnedTier(id) + 1;
    this.save();
    return true;
  }

  // ---- the cycle engine (§2.4) ----
  applyMissionReward(r: CampReward): void {
    this.applyRewardInternal(r);
    this.save();
  }

  private applyRewardInternal(r: CampReward): void {
    if (r.blueprintPoints) BlueprintSystem.addPoints(r.blueprintPoints);
    if (r.food) this.addStock(NeedKind.FOOD, r.food);
    if (r.water) this.addStock(NeedKind.WATER, r.water);
    if (r.medicine) this.addStock(NeedKind.MEDICINE, r.medicine);
    if (r.hordePressureReduction) {
      this.state.hordeStrength = Math.max(0, this.state.hordeStrength - r.hordePressureReduction);
    }
    if (r.survivorsRescued) {
      this.state.survivors += Math.floor(r.survivorsRescued);
    }
  }

  private addStock(need: NeedKind, amount: number): void {
    const slot = this.needSlot(need);
    slot.stock = Math.min(this.getCapacity(need), slot.stock + Math.floor(amount));
  }

  advanceCycle(ctx: { outcome: 'win' | 'lose'; runId: string; missionReward?: CampReward; dryRun?: boolean }): CycleReport {
    // Idempotency guard (§3): a single run advances the camp exactly once.
    // Skipped for dry-run projections, which never commit.
    if (!ctx.dryRun && ctx.runId && ctx.runId === this.state.lastResolvedRunId && this.lastReport) {
      return this.lastReport;
    }

    const report: CycleReport = {
      produced: {},
      drained: {},
      rewardApplied: null,
      hordeStrengthAfter: 0,
      campDefense: 0,
      breached: false,
      deaths: { fromFood: 0, fromWater: 0, fromMedicine: 0, fromBreach: 0 },
      regrowth: 0,
      survivorsAfter: 0,
      extinct: false,
    };

    // 1. Production — buildings add yield, clamped to capacity.
    for (const def of CAMP_BUILDINGS) {
      const tier = this.getOwnedTier(def.id);
      if (tier < 1) continue;
      const produces = def.tiers[tier - 1].produces;
      if (!produces) continue;
      const before = this.needSlot(produces.need).stock;
      this.addStock(produces.need, produces.amount);
      const gained = this.needSlot(produces.need).stock - before;
      report.produced[produces.need] = (report.produced[produces.need] ?? 0) + gained;
    }

    // 1.5. Apply mission reward (only on win), after production, before drain.
    if (ctx.outcome === 'win' && ctx.missionReward) {
      this.applyRewardInternal(ctx.missionReward);
      report.rewardApplied = ctx.missionReward;
    }

    // 2. Drain — subtract drainPerCycle; record per-need unmet demand for casualties.
    const deficits: Record<ConsumableNeed, number> = {
      [NeedKind.FOOD]: 0,
      [NeedKind.WATER]: 0,
      [NeedKind.MEDICINE]: 0,
    };
    for (const need of CONSUMABLE_NEEDS) {
      const slot = this.needSlot(need);
      const drain = this.getDrainPerCycle(need);
      const stockBefore = slot.stock;
      slot.stock = Math.max(0, slot.stock - drain);
      report.drained[need] = drain;
      if (slot.stock <= 0 && stockBefore < drain) {
        deficits[need] = drain - stockBefore; // unmet demand this cycle
      }
    }

    // 3. Horde growth, then walls suppression.
    this.state.hordeStrength = Math.max(
      0,
      this.state.hordeStrength + HORDE_GROWTH_PER_CYCLE - this.getWallsSuppression()
    );
    report.hordeStrengthAfter = this.state.hordeStrength;
    report.campDefense = this.getCampDefense();

    // 4. Casualty assessment.
    report.deaths.fromFood = deficits[NeedKind.FOOD] > 0 ? Math.ceil(deficits[NeedKind.FOOD] / LETHALITY[NeedKind.FOOD]) : 0;
    report.deaths.fromWater = deficits[NeedKind.WATER] > 0 ? Math.ceil(deficits[NeedKind.WATER] / LETHALITY[NeedKind.WATER]) : 0;
    report.deaths.fromMedicine = deficits[NeedKind.MEDICINE] > 0 ? Math.ceil(deficits[NeedKind.MEDICINE] / LETHALITY[NeedKind.MEDICINE]) : 0;

    if (this.state.hordeStrength > report.campDefense) {
      report.breached = true;
      report.deaths.fromBreach = Math.ceil((this.state.hordeStrength - report.campDefense) / BREACH_LETHALITY);
    }

    const totalDeaths =
      report.deaths.fromFood + report.deaths.fromWater + report.deaths.fromMedicine + report.deaths.fromBreach;

    // 5. Apply deaths.
    if (totalDeaths > 0) {
      const actual = Math.min(this.state.survivors, totalDeaths);
      this.state.survivors -= actual;
      this.state.totalSurvivorsLost += actual;
    }

    // 5b. Regrowth (only if no casualties this cycle).
    if (totalDeaths === 0) {
      const regrowth = this.getBarracksRegrowth();
      if (regrowth > 0) {
        const cap = this.getSurvivorCap();
        const gained = Math.max(0, Math.min(cap, this.state.survivors + regrowth) - this.state.survivors);
        this.state.survivors += gained;
        report.regrowth = gained;
      }
    }

    // 6. Lose check.
    if (this.state.survivors <= 0) {
      this.state.survivors = 0;
      this.state.extinct = true;
    }
    report.survivorsAfter = this.state.survivors;
    report.extinct = this.state.extinct;

    // 7. Persist + record idempotency token. A dry-run projection computes the
    // report but commits NOTHING — no cycle increment, no idempotency token, and
    // crucially no save() (which would otherwise persist the projected cycle to
    // localStorage even though projectNextCycle restores in-memory state).
    if (ctx.dryRun) {
      return report;
    }
    this.state.cyclesSurvived += 1;
    this.state.lastResolvedRunId = ctx.runId ?? null;
    this.lastReport = report;
    this.save();
    return report;
  }

  /**
   * Non-committing projection of the next cycle from current state, for the
   * Camp "Next cycle projection" UI (§10.3). Runs the same math as advanceCycle
   * (win + no reward) without mutating persisted state.
   */
  projectNextCycle(): CycleReport {
    const snapshot = JSON.stringify(this.state);
    const savedReport = this.lastReport;
    // dryRun: computes the report off the live state without persisting or
    // bumping the cycle/idempotency token. We still restore the in-memory state
    // afterwards because the production/drain math mutates this.state in place.
    const report = this.advanceCycle({ outcome: 'win', runId: '__projection__', missionReward: undefined, dryRun: true });
    this.state = JSON.parse(snapshot);
    this.lastReport = savedReport;
    return report;
  }

  // ---- survivors (Expedition seam, §7) ----
  addSurvivors(n: number): void {
    this.state.survivors += Math.max(0, Math.floor(n));
    this.save();
  }

  removeSurvivors(n: number): void {
    this.state.survivors = Math.max(0, this.state.survivors - Math.max(0, Math.floor(n)));
    this.state.totalSurvivorsLost += Math.max(0, Math.floor(n));
    if (this.state.survivors <= 0) {
      this.state.survivors = 0;
      this.state.extinct = true;
    }
    this.save();
  }

  resetCamp(): void {
    // Keeps zs2_bp_points untouched — a wipe, not a bankruptcy (§6.3).
    this.state = defaultCampState();
    this.lastReport = null;
    this.save();
  }
}

// Helper: read a numeric field off the owned tier of a building.
function getBuildingTierField(
  id: BuildingId,
  tier: number,
  field: 'defenseValue' | 'hordeSuppression' | 'survivorCapBonus' | 'survivorRegrowth'
): number | undefined {
  const def = CAMP_BUILDINGS.find(b => b.id === id);
  if (!def || tier < 1 || tier > def.tiers.length) return undefined;
  return def.tiers[tier - 1][field];
}
