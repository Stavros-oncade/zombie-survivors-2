// src/game/systems/JobBoardSystem.ts
// The Job Board meta layer — a static, localStorage-backed system mirroring
// BlueprintSystem's storage discipline (crash-proof JSON read with safe fallback).
// See docs/specs/outer-loop-job-board.md (§4 generation/refresh, §5 balancing,
// §8 persistence).
//
// The board is PURELY ADDITIVE over the mission system: it selects which Mission
// feeds the run, layers run modifiers + a four-currency reward bundle on top, and
// routes two special offer kinds to other scenes. It never touches MissionSystem.
import { BlueprintSystem } from './BlueprintSystem';
import { LoadoutManager } from './LoadoutManager';
import {
  JobBoardState,
  JobLaunchKind,
  JobModifier,
  JobModifierKind,
  JobOffer,
  JobReward,
} from '../types/JobBoardTypes';
import { Mission, MissionCondition, MissionConditionKind } from '../types/MissionTypes';
import { CampReward } from '../types/CampTypes';
import { JobBoardConfig, difficultyTier } from '../config/JobBoardConfig';
import {
  JOB_TEMPLATES,
  JobTemplate,
  ModifierOption,
  pickFlavor,
  pickTitle,
} from '../config/JobTemplates';
import { mulberry32, Rng, randInt, weightedSampleWithoutReplacement } from '../utils/Rng';

const STORAGE_KEY = 'zs2_jobboard_v1';

/** Progression tier that gates harder/special templates. Currently fixed at 0
 *  (no campaign progression sink wired). Bump when campaign/city land. */
function currentTier(): number {
  return 0;
}

export class JobBoardSystem {
  // ── persistence (crash-proof, mirrors BlueprintSystem.readUnlockedArray) ──
  private static safeRead(): JobBoardState | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.version !== 1 ||
        !Array.isArray(parsed.offers) ||
        parsed.offers.length !== JobBoardConfig.OFFERS_PER_BOARD
      ) {
        return null;
      }
      return parsed as JobBoardState;
    } catch {
      return null;
    }
  }

  private static save(s: JobBoardState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // storage full / unavailable — non-fatal, state stays for this session.
    }
  }

  /** Safe-read; regenerate a fresh board if missing/corrupt. */
  static getState(): JobBoardState {
    let s = this.safeRead();
    if (!s) {
      s = this.freshBoard(0);
      this.save(s);
    }
    return s;
  }

  /** Current 3 offers (generates on first call). */
  static getOffers(): JobOffer[] {
    return this.getState().offers;
  }

  /** Build a brand-new generation-`generation` board with a fresh seed. */
  private static freshBoard(generation: number): JobBoardState {
    const seed = (Date.now() ^ (generation * 0x9e3779b1)) & 0xffffffff;
    return {
      version: 1,
      seed,
      generation,
      offers: this.generateBoard(seed, generation, currentTier()),
      acceptedOfferId: null,
      rerollsRemaining: JobBoardConfig.FREE_REROLLS_PER_BOARD,
    };
  }

  /**
   * Reroll the whole board: new seed, SAME generation, decrement free rerolls or
   * debit blueprint points for a paid reroll. Returns false if unaffordable.
   */
  static reroll(): boolean {
    const s = this.getState();
    if (s.rerollsRemaining <= 0) {
      // Paid reroll: debit blueprint points.
      if (BlueprintSystem.getPoints() < JobBoardConfig.REROLL_BP_COST) return false;
      BlueprintSystem.setPoints(BlueprintSystem.getPoints() - JobBoardConfig.REROLL_BP_COST);
    } else {
      s.rerollsRemaining -= 1;
    }
    s.seed = (s.seed * 1103515245 + 12345) & 0xffffffff;
    s.offers = this.generateBoard(s.seed, s.generation, currentTier());
    s.acceptedOfferId = null;
    this.save(s);
    return true;
  }

  /** True when the player can reroll (free reroll left or can afford a paid one). */
  static canReroll(): boolean {
    const s = this.getState();
    return s.rerollsRemaining > 0 || BlueprintSystem.getPoints() >= JobBoardConfig.REROLL_BP_COST;
  }

  /** Persist the chosen offer + mirror its mission id to LoadoutManager (§6.2). */
  static setAcceptedOffer(offer: JobOffer): void {
    const s = this.getState();
    s.acceptedOfferId = offer.id;
    this.save(s);
    LoadoutManager.getInstance().setMissionId(offer.mission.id);
  }

  /** Clear any accepted offer (e.g. when launching a City Reclamation zone job, which
   *  carries its own mission + reward and must not inherit a stale board offer). */
  static clearAcceptedOffer(): void {
    const s = this.getState();
    if (s.acceptedOfferId !== null) {
      s.acceptedOfferId = null;
      this.save(s);
    }
  }

  static getAcceptedOffer(): JobOffer | null {
    const s = this.getState();
    if (!s.acceptedOfferId) return null;
    return s.offers.find((o) => o.id === s.acceptedOfferId) ?? null;
  }

  /**
   * Consume the board after a run resolves (win OR lose): generation++, fresh
   * seed, new 3 offers, rerolls reset, accept cleared (§4.3). Idempotent enough:
   * always advances; callers gate on the run actually being over.
   */
  static onRunResolved(): void {
    const s = this.getState();
    const next = this.freshBoard(s.generation + 1);
    this.save(next);
  }

  // ─────────────────────── generation (§4.1) ───────────────────────
  static generateBoard(seed: number, generation: number, tier: number): JobOffer[] {
    const rng = mulberry32(seed);
    const eligible = JOB_TEMPLATES.filter((t) => (t.minTier ?? 0) <= tier);
    const want = JobBoardConfig.OFFERS_PER_BOARD;

    let picked = weightedSampleWithoutReplacement(rng, eligible, () => 1, want);

    // Guarantee variety: at most one special (LONG_RECON/CITY_RECLAMATION).
    picked = this.enforceAtMostOneSpecial(picked, eligible, rng);

    let offers = picked.map((tmpl, i) => this.instantiate(tmpl, rng, tier, generation, i));

    // Guarantee a low-friction option: ensure >=1 offer below EASY_CAP.
    offers = this.ensureAtLeastOneEasy(offers, eligible, rng, tier, generation);

    return offers;
  }

  private static enforceAtMostOneSpecial(
    picked: JobTemplate[],
    eligible: JobTemplate[],
    rng: Rng
  ): JobTemplate[] {
    const isSpecial = (t: JobTemplate) => (t.launchKind ?? JobLaunchKind.GAME_RUN) !== JobLaunchKind.GAME_RUN;
    const specials = picked.filter(isSpecial);
    if (specials.length <= 1) return picked;
    const normals = eligible.filter((t) => !isSpecial(t) && !picked.includes(t));
    const result = picked.slice();
    // Replace extra specials (keep the first) with fresh normals.
    let keptOne = false;
    for (let i = 0; i < result.length; i++) {
      if (isSpecial(result[i])) {
        if (!keptOne) { keptOne = true; continue; }
        const replacement = normals.length ? normals.splice(randInt(rng, 0, normals.length - 1), 1)[0] : undefined;
        if (replacement) result[i] = replacement;
      }
    }
    return result;
  }

  private static ensureAtLeastOneEasy(
    offers: JobOffer[],
    eligible: JobTemplate[],
    rng: Rng,
    tier: number,
    generation: number
  ): JobOffer[] {
    if (offers.some((o) => o.difficulty < JobBoardConfig.EASY_CAP)) return offers;
    // Find an easy-leaning template not already represented and re-instantiate
    // the hardest slot from it with no modifiers (forces a low difficulty).
    const usedIds = new Set(offers.map((o) => o.mission.id.split('::')[0]));
    const easyTemplates = eligible
      .filter((t) => (t.launchKind ?? JobLaunchKind.GAME_RUN) === JobLaunchKind.GAME_RUN)
      .filter((t) => t.baseDifficulty <= 2)
      .filter((t) => !usedIds.has(t.id));
    const tmpl = easyTemplates.length
      ? easyTemplates[randInt(rng, 0, easyTemplates.length - 1)]
      : eligible.filter((t) => (t.launchKind ?? JobLaunchKind.GAME_RUN) === JobLaunchKind.GAME_RUN)
          .sort((a, b) => a.baseDifficulty - b.baseDifficulty)[0];
    if (!tmpl) return offers;
    // Replace the hardest offer with a modifier-free instance of the easy template.
    let hardestIdx = 0;
    for (let i = 1; i < offers.length; i++) if (offers[i].difficulty > offers[hardestIdx].difficulty) hardestIdx = i;
    const easyOffer = this.instantiate(tmpl, rng, tier, generation, hardestIdx, /*forceNoModifiers*/ true);
    offers[hardestIdx] = easyOffer;
    return offers;
  }

  /** Instantiate one offer from a template (§4.1 instantiate). */
  static instantiate(
    tmpl: JobTemplate,
    rng: Rng,
    tier: number,
    generation: number,
    index: number,
    forceNoModifiers = false
  ): JobOffer {
    const condition = tmpl.buildCondition(rng, tier);
    const modifiers = forceNoModifiers ? [] : this.rollModifiers(tmpl.modifierTable, rng, tier);

    const missionId = `${tmpl.id}::${generation}_${index}`;
    const mission: Mission = {
      id: missionId,
      name: pickTitle(rng, tmpl),
      description: this.describeCondition(condition),
      condition,
      // Per §2: the board supersedes Mission.reward; leave it undefined so no
      // double-pay can happen via the legacy GameOver path.
      reward: undefined,
      difficulty: tmpl.baseDifficulty,
    };

    const difficulty = this.computeDifficulty(mission, modifiers);
    const budget = this.rewardBudget(difficulty);
    const reward = this.splitReward(budget, tmpl);

    return {
      id: `${generation}_${index}_${tmpl.id}`,
      title: mission.name,
      flavor: pickFlavor(rng, tmpl),
      mission,
      modifiers,
      reward,
      difficulty,
      rewardBudget: budget,
      launch: { kind: tmpl.launchKind ?? JobLaunchKind.GAME_RUN },
      expiresAtRunCount: generation,
    };
  }

  private static rollModifiers(table: ModifierOption[], rng: Rng, tier: number): JobModifier[] {
    if (!table.length) return [];
    // 0..MAX_MODIFIERS, biased up by tier.
    const maxCount = Math.min(JobBoardConfig.MAX_MODIFIERS, table.length);
    const count = Math.min(maxCount, randInt(rng, 0, 1 + Math.floor(tier / 1)));
    if (count <= 0) return [];
    const chosen = weightedSampleWithoutReplacement(rng, table, (o) => o.weight, count);
    return chosen.map((opt) => opt.make(rng, tier));
  }

  // ─────────────────────── difficulty (§5.1) ───────────────────────
  static computeDifficulty(mission: Mission, modifiers: JobModifier[]): number {
    let base = (mission.difficulty ?? this.estimateFromCondition(mission.condition)) * 10; // 10..50
    base *= this.targetScale(mission.condition); // 0.8..1.6
    const mod = this.modifierDifficulty(modifiers);
    return Math.max(1, Math.min(100, Math.round(base + mod)));
  }

  private static estimateFromCondition(c: MissionCondition): number {
    switch (c.kind) {
      case MissionConditionKind.SLAY_BOSS: return 5;
      case MissionConditionKind.FLAWLESS_WINDOW: return 4;
      case MissionConditionKind.PURGE_TYPE: return 4;
      case MissionConditionKind.KILL_TYPE: return 3;
      case MissionConditionKind.HOLD_ZONE: return 3;
      case MissionConditionKind.KILL_ELITES: return 3;
      case MissionConditionKind.SURVIVE_TIME: return 2;
      case MissionConditionKind.COLLECT_DROPS: return 2;
      case MissionConditionKind.KILL_COUNT: return 1;
      default: return 2;
    }
  }

  /** Bigger target within a condition = harder, mapped to ~0.8..1.6. */
  private static targetScale(c: MissionCondition): number {
    let raw = 1;
    switch (c.kind) {
      case MissionConditionKind.KILL_COUNT: raw = c.target / 200; break;
      case MissionConditionKind.KILL_TYPE: raw = c.target / 30; break;
      case MissionConditionKind.KILL_ELITES: raw = c.target / 2; break;
      case MissionConditionKind.COLLECT_DROPS: raw = c.target / 15; break;
      case MissionConditionKind.SURVIVE_TIME: raw = c.seconds / 240; break;
      case MissionConditionKind.FLAWLESS_WINDOW: raw = c.seconds / 60; break;
      case MissionConditionKind.HOLD_ZONE: raw = c.holdSeconds / 30; break;
      case MissionConditionKind.PURGE_TYPE: raw = c.target / 20; break;
      default: raw = 1;
    }
    return Math.max(0.8, Math.min(1.6, raw));
  }

  private static modifierDifficulty(modifiers: JobModifier[]): number {
    let sum = 0;
    for (const m of modifiers) {
      switch (m.kind) {
        case JobModifierKind.ENEMY_DENSITY: sum += (m.multiplier - 1) * 25; break;
        case JobModifierKind.ELITE_CADENCE: sum += (90000 / m.intervalMs - 1) * 18; break;
        case JobModifierKind.BOSS_TIMING: sum += Math.max(0, (300 - m.spawnAtSeconds) / 300) * 30; break;
        case JobModifierKind.HAZARD_FIELD: sum += m.patchCount * (m.hazard === 'fire' ? 5 : 4); break;
        case JobModifierKind.TIME_LIMIT: sum += this.timeLimitDifficulty(m.seconds); break;
        case JobModifierKind.ENEMY_BUFF:
          sum += ((m.hpMultiplier ?? 1) - 1) * 20 + ((m.speedMultiplier ?? 1) - 1) * 25;
          break;
        case JobModifierKind.SCARCITY: sum += (1 - m.dropRateMultiplier) * 15; break;
        case JobModifierKind.TYPE_INFESTATION: sum += 3; break;
      }
    }
    return sum;
  }

  private static timeLimitDifficulty(seconds: number): number {
    // Tighter = harder, clamped 8..30.
    const t = Math.max(60, Math.min(300, seconds));
    return Math.round(8 + ((300 - t) / 240) * 22);
  }

  // ─────────────────────── reward (§5.2) ───────────────────────
  static rewardBudget(difficulty: number): number {
    return Math.ceil(JobBoardConfig.BASE_BUDGET + difficulty * JobBoardConfig.BUDGET_PER_DIFF);
  }

  /** Split the budget across the 4 currencies by template emphasis. */
  static splitReward(budget: number, tmpl: JobTemplate): JobReward {
    const emphasis = tmpl.rewardEmphasis;
    const totalW = Object.values(emphasis).reduce((s, w) => s + (w ?? 0), 0) || 1;
    const ex = JobBoardConfig.EXCHANGE_RATES;
    const camp: CampReward = {};
    let campaignPoints = 0;

    const partOf = (key: keyof typeof emphasis) => budget * ((emphasis[key] ?? 0) / totalW);

    // (a) blueprints
    const bp = Math.round(partOf('blueprints') * ex.blueprints);
    if (bp > 0) camp.blueprintPoints = bp;

    // (b) campaign
    const cp = Math.round(partOf('campaign') * ex.campaign);
    if (cp > 0) campaignPoints = cp;

    // (c) horde relief
    const horde = Math.round(partOf('horde') * ex.hordeRelief);
    if (horde > 0) camp.hordePressureReduction = horde;

    // (d) camp resources — distribute across food/water/medicine. KILL/SUPPLY
    // jobs lean food; default spreads evenly.
    const resBudget = Math.round(partOf('resources') * ex.resources);
    if (resBudget > 0) {
      this.distributeResources(resBudget, camp);
    }

    return { camp, campaignPoints: campaignPoints || undefined };
  }

  private static distributeResources(units: number, camp: CampReward): void {
    // Spread resources across food/water/medicine; keep it simple.
    const food = Math.ceil(units * 0.5);
    const water = Math.ceil(units * 0.3);
    const medicine = units - food - water;
    if (food > 0) camp.food = (camp.food ?? 0) + food;
    if (water > 0) camp.water = (camp.water ?? 0) + water;
    if (medicine > 0) camp.medicine = (camp.medicine ?? 0) + medicine;
  }

  // ─────────────────────── objective formatting (static, no runtime) ───────────────────────
  static describeCondition(c: MissionCondition): string {
    switch (c.kind) {
      case MissionConditionKind.KILL_COUNT: return `Kill ${c.target} enemies.`;
      case MissionConditionKind.SURVIVE_TIME: return `Survive ${this.fmtTime(c.seconds)}.`;
      case MissionConditionKind.KILL_TYPE: return `Kill ${c.target} ${c.enemyType} enemies.`;
      case MissionConditionKind.HOLD_ZONE: return `Hold the zone for ${c.holdSeconds}s${c.continuous ? ' (continuous)' : ''}.`;
      case MissionConditionKind.KILL_ELITES: return `Slay ${c.target} elite${c.target > 1 ? 's' : ''}.`;
      case MissionConditionKind.SLAY_BOSS: return `Slay the boss.`;
      case MissionConditionKind.FLAWLESS_WINDOW: return `Survive ${c.seconds}s without being hit.`;
      case MissionConditionKind.COLLECT_DROPS: return `Collect ${c.target} pickups.`;
      case MissionConditionKind.PURGE_TYPE: return `Exterminate ${c.target} ${c.enemyType} and leave none.`;
      default: return 'Complete the objective.';
    }
  }

  private static fmtTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /** Human-readable modifier labels for the board UI (§7.1). */
  static describeModifier(m: JobModifier): string {
    switch (m.kind) {
      case JobModifierKind.ENEMY_DENSITY: return `+${Math.round((m.multiplier - 1) * 100)}% density`;
      case JobModifierKind.ELITE_CADENCE: return `Elites every ${Math.round(m.intervalMs / 1000)}s`;
      case JobModifierKind.BOSS_TIMING: return `Boss at ${this.fmtTime(m.spawnAtSeconds)}`;
      case JobModifierKind.HAZARD_FIELD: return `${m.hazard === 'fire' ? 'Fire' : 'Toxic'} fields ×${m.patchCount}`;
      case JobModifierKind.TIME_LIMIT: return `Time limit ${this.fmtTime(m.seconds)}`;
      case JobModifierKind.ENEMY_BUFF: {
        const parts: string[] = [];
        if (m.hpMultiplier) parts.push(`+${Math.round((m.hpMultiplier - 1) * 100)}% HP`);
        if (m.speedMultiplier) parts.push(`+${Math.round((m.speedMultiplier - 1) * 100)}% spd`);
        return `Buffed enemies (${parts.join(', ')})`;
      }
      case JobModifierKind.SCARCITY: return `${Math.round(m.dropRateMultiplier * 100)}% drops`;
      case JobModifierKind.TYPE_INFESTATION: return `${m.enemyType} infestation`;
    }
  }

  /** Human-readable reward bundle for the board / loadout UI. */
  static describeReward(r: JobReward): string {
    const parts: string[] = [];
    const c = r.camp;
    if (c.blueprintPoints) parts.push(`${c.blueprintPoints} BP`);
    if (r.campaignPoints) parts.push(`${r.campaignPoints} Campaign`);
    if (c.hordePressureReduction) parts.push(`-${c.hordePressureReduction} Horde`);
    if (c.food) parts.push(`${c.food} Food`);
    if (c.water) parts.push(`${c.water} Water`);
    if (c.medicine) parts.push(`${c.medicine} Med`);
    if (c.survivorsRescued) parts.push(`${c.survivorsRescued} Survivors`);
    return parts.length ? parts.join(' · ') : 'No reward';
  }

  static tierBadge(difficulty: number): { label: string; color: string } {
    return difficultyTier(difficulty);
  }
}
