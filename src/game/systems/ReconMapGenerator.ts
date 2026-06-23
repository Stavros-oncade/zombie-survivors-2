// src/game/systems/ReconMapGenerator.ts
// Pure, seeded, deterministic layered-DAG generator for the Long Recon map (§4).
// Given the same seed it ALWAYS yields the identical map (the contract that lets
// §10 resume by storing only {seed, clearedNodeIds}). NEVER reads Math.random().
import { mulberry32, randInt, pick, Rng } from '../utils/Rng';
import { MISSIONS } from '../config/Missions';
import { MissionConditionKind } from '../types/MissionTypes';
import { ReconConfig, RECON_NAMES } from '../config/ReconConfig';
import { ReconMap, ReconNode, ReconNodeKind, ReconReward } from '../types/ReconTypes';

interface GenOpts {
  seed: number;
  name?: string;
  layers?: number;
  minWidth?: number;
  maxWidth?: number;
}

// Mission-id pools per node kind (drawn from the authored MISSIONS catalog).
function combatMissionIds(): string[] {
  const kinds = [
    MissionConditionKind.KILL_COUNT,
    MissionConditionKind.SURVIVE_TIME,
    MissionConditionKind.KILL_TYPE,
    MissionConditionKind.HOLD_ZONE,
  ];
  return MISSIONS.filter(m => kinds.includes(m.condition.kind)).map(m => m.id);
}
const ELITE_MISSION_ID = 'm_kill_elites_2';
const CACHE_MISSION_ID = 'm_collect_15';
const BOSS_MISSION_ID = 'm_slay_boss';

function weightedKind(rng: Rng): ReconNodeKind {
  const weights = ReconConfig.kindWeights;
  const entries = Object.entries(weights) as [ReconNodeKind, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [kind, w] of entries) {
    r -= w;
    if (r <= 0) return kind;
  }
  return ReconNodeKind.COMBAT;
}

/** Scale a node's reward by its difficulty tier and kind (§4.7). */
function nodeReward(kind: ReconNodeKind, tier: number, rng: Rng): ReconReward {
  const r = ReconConfig.reward;
  const baseBP = r.combatBPPerTier * tier;
  const baseRes = r.combatResourcesPerTier * tier;
  switch (kind) {
    case ReconNodeKind.ELITE:
      return { blueprintPoints: Math.round(baseBP * r.elitePremium), campResources: Math.round(baseRes * r.elitePremium) };
    case ReconNodeKind.CACHE: {
      const reward: ReconReward = {
        blueprintPoints: Math.round(baseBP * r.cachePremium),
        campResources: Math.round(baseRes * r.cachePremium),
      };
      // ~40% of caches grant a guaranteed special blueprint unlock.
      if (rng() < 0.4) reward.specialBlueprintId = `recon_cache_${tier}`;
      return reward;
    }
    case ReconNodeKind.BOSS:
      return { blueprintPoints: baseBP, campResources: baseRes };
    case ReconNodeKind.COMBAT:
    default:
      return { blueprintPoints: baseBP, campResources: baseRes };
  }
}

function missionForKind(kind: ReconNodeKind, rng: Rng, combatPool: string[]): string | undefined {
  switch (kind) {
    case ReconNodeKind.COMBAT: return pick(rng, combatPool);
    case ReconNodeKind.ELITE:  return ELITE_MISSION_ID;
    case ReconNodeKind.CACHE:  return CACHE_MISSION_ID;
    case ReconNodeKind.BOSS:   return BOSS_MISSION_ID;
    default: return undefined; // SHOP / EVENT / START have no run mission
  }
}

export function generateReconMap(opts: GenOpts): ReconMap {
  const seed = opts.seed >>> 0;
  const rng = mulberry32(seed);
  const layers = opts.layers ?? ReconConfig.layers;
  const minWidth = opts.minWidth ?? ReconConfig.minWidth;
  const maxWidth = opts.maxWidth ?? ReconConfig.maxWidth;
  const name = opts.name ?? pick(rng, RECON_NAMES);
  const combatPool = combatMissionIds();

  // 1. Place layers as a 2D array of nodes.
  const layerNodes: ReconNode[][] = [];
  for (let L = 0; L < layers; L++) {
    if (L === 0) {
      layerNodes.push([mkNode('n_0_0', ReconNodeKind.START, 0, 0, rng, combatPool)]);
    } else if (L === layers - 1) {
      layerNodes.push([mkNode(`n_${L}_0`, ReconNodeKind.BOSS, L, 0, rng, combatPool)]);
    } else {
      const width = randInt(rng, minWidth, maxWidth);
      const row: ReconNode[] = [];
      for (let s = 0; s < width; s++) {
        row.push(mkNode(`n_${L}_${s}`, weightedKind(rng), L, s, rng, combatPool));
      }
      enforceLayerConstraints(row, rng);
      layerNodes.push(row);
    }
  }

  // Constraint: ensure ≥1 ELITE in the second half, ≥1 EVENT/SHOP somewhere inner.
  enforceGlobalConstraints(layerNodes, rng, combatPool);

  // 2. Wire edges (out-edges only to next layer) + coverage pass (§4.4).
  for (let L = 0; L < layers - 1; L++) {
    const cur = layerNodes[L];
    const nxt = layerNodes[L + 1];
    if (L === layers - 2) {
      // Penultimate layer: everyone -> boss.
      const bossId = nxt[0].id;
      cur.forEach(n => { n.next = [bossId]; });
    } else {
      for (const n of cur) {
        const targets = pickNextTargets(n, nxt, rng);
        n.next = targets.map(t => t.id);
      }
      // Coverage: any next-layer node with zero in-edges gets one from the nearest.
      for (const target of nxt) {
        const hasIn = cur.some(n => n.next.includes(target.id));
        if (!hasIn) {
          const nearest = cur.reduce((best, n) =>
            Math.abs(n.slot - target.slot) < Math.abs(best.slot - target.slot) ? n : best, cur[0]);
          nearest.next.push(target.id);
        }
      }
    }
  }

  const nodes = layerNodes.flat();
  const startNodeId = layerNodes[0][0].id;
  const bossNodeId = layerNodes[layers - 1][0].id;
  const baseReward: ReconReward = {
    blueprintPoints: ReconConfig.reward.bossBaseBP,
    campResources: ReconConfig.reward.bossBaseResources,
    specialBlueprintId: `recon_boss_${seed % 997}`,
  };

  return {
    id: `recon_${seed}`,
    seed,
    name,
    layers,
    nodes,
    startNodeId,
    bossNodeId,
    requiredClears: layers,
    baseReward,
  };
}

function mkNode(id: string, kind: ReconNodeKind, layer: number, slot: number, rng: Rng, combatPool: string[]): ReconNode {
  const tier = 1 + layer;
  return {
    id,
    kind,
    layer,
    slot,
    missionId: missionForKind(kind, rng, combatPool),
    difficultyTier: tier,
    reward: nodeReward(kind, tier, rng),
    next: [],
    eventId: kind === ReconNodeKind.EVENT ? 'field_medic' : kind === ReconNodeKind.SHOP ? 'supply_cache' : undefined,
  };
}

/** Never two SHOPs adjacent in the same layer (§4.3). */
function enforceLayerConstraints(row: ReconNode[], rng: Rng): void {
  const shops = row.filter(n => n.kind === ReconNodeKind.SHOP);
  if (shops.length > 1) {
    // Demote all but the first shop to COMBAT.
    for (let i = 1; i < shops.length; i++) {
      demote(shops[i], ReconNodeKind.COMBAT, rng);
    }
  }
}

/** Guarantee ≥1 ELITE in the back half and ≥1 EVENT/SHOP somewhere (§4.3). */
function enforceGlobalConstraints(layerNodes: ReconNode[][], rng: Rng, combatPool: string[]): void {
  const layers = layerNodes.length;
  const inner = layerNodes.slice(1, layers - 1).flat();
  const backHalf = layerNodes.slice(Math.ceil(layers / 2), layers - 1).flat();

  if (backHalf.length && !backHalf.some(n => n.kind === ReconNodeKind.ELITE)) {
    promote(pick(rng, backHalf), ReconNodeKind.ELITE, rng, combatPool);
  }
  if (inner.length && !inner.some(n => n.kind === ReconNodeKind.EVENT || n.kind === ReconNodeKind.SHOP)) {
    promote(pick(rng, inner), ReconNodeKind.EVENT, rng, combatPool);
  }
}

function demote(n: ReconNode, to: ReconNodeKind, rng: Rng): void {
  n.kind = to;
  n.missionId = missionForKind(to, rng, combatMissionIds());
  n.reward = nodeReward(to, n.difficultyTier, rng);
  n.eventId = undefined;
}

function promote(n: ReconNode, to: ReconNodeKind, rng: Rng, combatPool: string[]): void {
  n.kind = to;
  n.missionId = missionForKind(to, rng, combatPool);
  n.reward = nodeReward(to, n.difficultyTier, rng);
  n.eventId = to === ReconNodeKind.EVENT ? 'field_medic' : to === ReconNodeKind.SHOP ? 'supply_cache' : undefined;
}

/** Connect a node to 1–2 nodes in the next layer, biased toward the nearest slot. */
function pickNextTargets(node: ReconNode, nextLayer: ReconNode[], rng: Rng): ReconNode[] {
  const sorted = [...nextLayer].sort(
    (a, b) => Math.abs(a.slot - node.slot) - Math.abs(b.slot - node.slot)
  );
  const count = Math.min(sorted.length, randInt(rng, 1, 2));
  return sorted.slice(0, count);
}
