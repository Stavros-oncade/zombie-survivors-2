// src/game/systems/ReconSystem.ts
// Singleton owner of the Long Recon FTL run-state (§11). Outlives scene transitions
// (RouteMap <-> Game) and is the ONLY writer of localStorage key 'zs2_recon_v1'.
// Holds no live Phaser objects — pure data + localStorage. Mirrors the storage
// discipline of BlueprintSystem / CampSystem (crash-proof JSON read, safe fallback).
import { mulberry32 } from '../utils/Rng';
import { generateReconMap } from './ReconMapGenerator';
import { resolveMission, getMissionById } from '../config/Missions';
import { Mission, MissionCondition } from '../types/MissionTypes';
import { BlueprintSystem } from './BlueprintSystem';
import { CampSystem } from './CampSystem';
import { JobBoardSystem } from './JobBoardSystem';
import { ReconConfig, RECON_DIFFICULTY } from '../config/ReconConfig';
import {
  ReconMap,
  ReconNode,
  ReconNodeKind,
  ReconCarryState,
  ReconLoadout,
  ReconRunState,
  ReconPayout,
  MapNodeEffect,
} from '../types/ReconTypes';

const STORAGE_KEY = 'zs2_recon_v1';
const CITY_BLUEPRINT_KEY = 'zs2_city_blueprints_v1';

export class ReconSystem {
  private static instance: ReconSystem;
  private state: ReconRunState | null = null;
  private map: ReconMap | null = null;

  private constructor() {
    this.hydrate();
  }

  static getInstance(): ReconSystem {
    return (ReconSystem.instance ??= new ReconSystem());
  }

  // ─────────────────────── persistence (§10) ───────────────────────
  private hydrate(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ReconRunState;
      if (!parsed || parsed.status !== 'active' || typeof parsed.seed !== 'number') {
        return; // not an active recon — silently drop
      }
      // Regenerate the immutable map from the stored seed (§10 determinism).
      this.map = generateReconMap({ seed: parsed.seed, name: parsed.name });
      this.state = parsed;
    } catch {
      // Corrupt blob — treat as no active recon.
      this.state = null;
      this.map = null;
    }
  }

  private persist(): void {
    if (!this.state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // storage full / unavailable — non-fatal.
    }
  }

  private clear(): void {
    this.state = null;
    this.map = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // ─────────────────────── lifecycle ───────────────────────
  /** Begin a fresh recon from a generated map + the once-chosen loadout. Persists. */
  startRecon(map: ReconMap, loadout: ReconLoadout): void {
    this.map = map;
    const start = map.nodes.find(n => n.id === map.startNodeId)!;
    this.state = {
      mapId: map.id,
      seed: map.seed,
      name: map.name,
      currentNodeId: map.startNodeId,
      clearedNodeIds: [map.startNodeId], // start node is auto-cleared staging
      availableNodeIds: start.next.slice(),
      activeNodeId: null,
      carry: this.freshCarry(loadout),
      loadout,
      pending: { blueprintPoints: 0, campResources: 0, specialBlueprintIds: [] },
      status: 'active',
    };
    this.persist();
  }

  /** True while an expedition is in progress (gates the Game branch in §5). */
  isActive(): boolean {
    return !!this.state && this.state.status === 'active';
  }

  private freshCarry(_loadout: ReconLoadout): ReconCarryState {
    // Fresh recon starts with full default HP / level 1 / no carried unlocks; the
    // first node's Game.create() captures the real maxHealth after loadout applies.
    return {
      maxHealth: 0,        // 0 = "use the run's computed maxHealth" (see getCarry usage in Game)
      currentHealth: 0,
      level: 1,
      totalXP: 0,
      unlockedWeaponIds: [],
      upgradeIds: [],
      relicIds: [],
    };
  }

  // ─────────────────────── map / navigation ───────────────────────
  getMap(): ReconMap {
    if (this.map) return this.map;
    if (this.state) {
      this.map = generateReconMap({ seed: this.state.seed, name: this.state.name });
      return this.map;
    }
    throw new Error('[ReconSystem] getMap() with no active recon');
  }

  getRunState(): ReconRunState | null { return this.state; }
  getNode(id: string): ReconNode | undefined { return this.getMap().nodes.find(n => n.id === id); }
  getCurrentNodeId(): string { return this.state!.currentNodeId; }
  getActiveNodeId(): string { return this.state!.activeNodeId ?? this.state!.currentNodeId; }
  getClearedNodeIds(): string[] { return this.state?.clearedNodeIds ?? []; }

  getAvailableNextNodes(): ReconNode[] {
    if (!this.state) return [];
    return this.state.availableNodeIds
      .map(id => this.getNode(id))
      .filter((n): n is ReconNode => !!n);
  }

  /** Validate the node is reachable, then mark it the active (selected) node. */
  selectNextNode(nodeId: string): boolean {
    if (!this.state) return false;
    if (!this.state.availableNodeIds.includes(nodeId)) return false;
    this.state.activeNodeId = nodeId;
    this.persist();
    return true;
  }

  isBossNode(nodeId: string): boolean {
    return this.getMap().bossNodeId === nodeId;
  }

  // ─────────────────────── carry-state bridge (§5) ───────────────────────
  getCarry(): ReconCarryState { return this.state!.carry; }
  getLoadout(): ReconLoadout { return this.state!.loadout; }

  /** The tier-scaled Mission for the node about to launch (§8). */
  getActiveNodeMission(): Mission {
    const node = this.getNode(this.getActiveNodeId());
    if (!node || !node.missionId) {
      // Should not happen for run nodes; fall back to default.
      return resolveMission(undefined);
    }
    const base = getMissionById(node.missionId) ?? resolveMission(node.missionId);
    return this.scaleMission(base, node.difficultyTier);
  }

  getActiveNodeTier(): number {
    return this.getNode(this.getActiveNodeId())?.difficultyTier ?? 1;
  }

  // ─────────────────────── node resolution ───────────────────────
  /** Run node WON: accrue node reward into pending, store carry, advance available set. */
  completeNode(nodeId: string, carry: ReconCarryState): void {
    if (!this.state) return;
    const node = this.getNode(nodeId);
    if (!node) return;

    // Idempotency: a node clears at most once (guards a same-frame double-fire).
    if (this.state.clearedNodeIds.includes(nodeId)) {
      this.state.carry = carry;
      this.persist();
      return;
    }

    this.state.carry = carry;
    this.accrue(node);
    this.state.clearedNodeIds.push(nodeId);
    this.state.currentNodeId = nodeId;
    this.state.activeNodeId = null;
    this.state.availableNodeIds = node.next.slice();
    this.persist();
  }

  /** SHOP/EVENT resolved on the map (no run): apply effects, mark cleared, advance. */
  resolveMapNode(nodeId: string, effect: MapNodeEffect): void {
    if (!this.state) return;
    const node = this.getNode(nodeId);
    if (!node || this.state.clearedNodeIds.includes(nodeId)) return;

    const carry = this.state.carry;
    if (effect.healFraction && carry.maxHealth > 0) {
      carry.currentHealth = Math.min(
        carry.maxHealth,
        carry.currentHealth + Math.round(effect.healFraction * carry.maxHealth)
      );
    }
    if (effect.spendBlueprintPoints) {
      this.state.pending.blueprintPoints = Math.max(0, this.state.pending.blueprintPoints - effect.spendBlueprintPoints);
    }
    if (effect.grantBlueprintPoints) {
      this.state.pending.blueprintPoints += effect.grantBlueprintPoints;
    }
    if (effect.grantWeaponId && !carry.unlockedWeaponIds.includes(effect.grantWeaponId)) {
      carry.unlockedWeaponIds.push(effect.grantWeaponId);
    }
    // Node-type reward still accrues (the node's own ReconReward, e.g. small BP).
    this.accrue(node);
    this.state.clearedNodeIds.push(nodeId);
    this.state.currentNodeId = nodeId;
    this.state.availableNodeIds = node.next.slice();
    this.persist();
  }

  private accrue(node: ReconNode): void {
    if (!this.state) return;
    const r = node.reward;
    if (r.blueprintPoints) this.state.pending.blueprintPoints += r.blueprintPoints;
    if (r.campResources) this.state.pending.campResources += r.campResources;
    if (r.specialBlueprintId && !this.state.pending.specialBlueprintIds.includes(r.specialBlueprintId)) {
      this.state.pending.specialBlueprintIds.push(r.specialBlueprintId);
    }
  }

  // ─────────────────────── terminal (§9) ───────────────────────
  /** Boss cleared: bank pending + baseReward into camp/blueprints EXACTLY ONCE. */
  completeRecon(): ReconPayout {
    const state = this.state;
    const map = this.getMap();
    if (!state) {
      return { outcome: 'won', blueprintPoints: 0, campResources: 0, specialBlueprintIds: [], nodesCleared: 0, totalNodes: 0, reconName: '' };
    }
    state.status = 'won';
    const base = map.baseReward;
    const bp = state.pending.blueprintPoints + (base.blueprintPoints ?? 0);
    const resources = state.pending.campResources + (base.campResources ?? 0);
    const specials = state.pending.specialBlueprintIds.slice();
    if (base.specialBlueprintId) specials.push(base.specialBlueprintId);

    // Bank: BP -> BlueprintSystem; resources -> camp (split into food/water/medicine).
    if (bp > 0) BlueprintSystem.addPoints(bp);
    if (resources > 0) this.bankResources(resources);
    this.grantSpecialBlueprints(specials);
    // Consume the board (recon resolved) + clear the accepted recon offer so the
    // next Job Board open regenerates fresh offers (mirrors the normal run flow).
    JobBoardSystem.clearAcceptedOffer();
    JobBoardSystem.onRunResolved();

    const payout: ReconPayout = {
      outcome: 'won',
      blueprintPoints: bp,
      campResources: resources,
      specialBlueprintIds: specials,
      // Exclude the start node from the displayed cleared count.
      nodesCleared: state.clearedNodeIds.filter(id => id !== map.startNodeId).length,
      totalNodes: map.requiredClears - 1,
      reconName: state.name,
    };
    this.clear();
    return payout;
  }

  /** Death anywhere: forfeit pending to the salvage floor, clear run-state. */
  failRecon(): ReconPayout {
    const state = this.state;
    const map = this.map ? this.map : (this.state ? this.getMap() : null);
    if (!state || !map) {
      return { outcome: 'failed', blueprintPoints: 0, campResources: 0, specialBlueprintIds: [], nodesCleared: 0, totalNodes: 0, reconName: '' };
    }
    state.status = 'failed';
    const salvageBP = Math.floor(ReconConfig.salvageFraction * state.pending.blueprintPoints);
    if (salvageBP > 0) BlueprintSystem.addPoints(salvageBP);
    // Consume the board + clear the accepted recon offer (recon resolved).
    JobBoardSystem.clearAcceptedOffer();
    JobBoardSystem.onRunResolved();
    const payout: ReconPayout = {
      outcome: 'failed',
      blueprintPoints: salvageBP,
      campResources: 0,
      specialBlueprintIds: [],
      nodesCleared: state.clearedNodeIds.filter(id => id !== map.startNodeId).length,
      totalNodes: map.requiredClears - 1,
      reconName: state.name,
    };
    this.clear();
    return payout;
  }

  /** Abandon mid-recon from the map: salvage floor, same as a fail (§9 / §15.10). */
  abandonRecon(): ReconPayout {
    return this.failRecon();
  }

  // ─────────────────────── difficulty (§8) ───────────────────────
  /** Deep-clone a Mission and bump the condition's target/seconds per its kind. */
  scaleMission(m: Mission, tier: number): Mission {
    const t = Math.max(1, tier);
    const cloned: Mission = JSON.parse(JSON.stringify(m));
    cloned.id = `${m.id}::recon_t${t}`;
    const c = cloned.condition as MissionCondition;
    const killMult = 1 + RECON_DIFFICULTY.killCountPerTier * (t - 1);
    const surviveBonus = RECON_DIFFICULTY.surviveSecPerTier * (t - 1);
    switch (c.kind) {
      case 'kill_count':
      case 'kill_type':
      case 'kill_elites':
      case 'collect_drops':
      case 'purge_type':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).target = Math.max(1, Math.round((c as any).target * killMult));
        break;
      case 'survive_time':
      case 'flawless_window':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).seconds = Math.round((c as any).seconds + surviveBonus);
        break;
      case 'hold_zone':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).holdSeconds = Math.round((c as any).holdSeconds + surviveBonus);
        break;
      default:
        break;
    }
    return cloned;
  }

  /** Spawn-director multipliers to apply at node launch (§8.2). */
  getSpawnScaling(tier: number): { densityMult: number; eliteIntervalMult: number } {
    const t = Math.max(1, tier);
    return {
      densityMult: 1 + RECON_DIFFICULTY.spawnRatePerTier * (t - 1),
      eliteIntervalMult: Math.max(0.4, 1 - RECON_DIFFICULTY.eliteCadencePerTier * (t - 1)),
    };
  }

  // ─────────────────────── banking helpers ───────────────────────
  private bankResources(units: number): void {
    // Split camp resources across food/water/medicine, mirroring JobBoardSystem.
    const food = Math.ceil(units * 0.5);
    const water = Math.ceil(units * 0.3);
    const medicine = Math.max(0, units - food - water);
    CampSystem.getInstance().applyMissionReward({ food, water, medicine });
  }

  private grantSpecialBlueprints(ids: string[]): void {
    if (!ids.length) return;
    // Write to the city-special blueprint store using the same safe-array pattern.
    let arr: string[] = [];
    try {
      const raw = localStorage.getItem(CITY_BLUEPRINT_KEY);
      arr = raw ? (JSON.parse(raw) as string[]) : [];
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    for (const id of ids) if (!arr.includes(id)) arr.push(id);
    try { localStorage.setItem(CITY_BLUEPRINT_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
  }

  // Re-export for callers that want a deterministic seed without importing Rng.
  static seededSeed(): number {
    return (Date.now() ^ Math.floor(mulberry32(Date.now())() * 0xffffffff)) >>> 0;
  }

  // Expose node-kind helper for the scene UI without re-importing types.
  static isRunKind(kind: ReconNodeKind): boolean {
    return kind === ReconNodeKind.COMBAT || kind === ReconNodeKind.ELITE ||
           kind === ReconNodeKind.CACHE || kind === ReconNodeKind.BOSS;
  }
}
