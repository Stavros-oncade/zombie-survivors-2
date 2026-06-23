// src/game/types/ReconTypes.ts
// Data model for the "Long Recon" FTL/StS route map (Design Doc 3 of 6).
// See docs/specs/outer-loop-route-map.md. Pure data — no Phaser dependency.
//
// A recon node IS a Mission (we do not fork the Mission System): the generator
// selects an authored Mission per run node and scales it per layer at launch.
// ReconMap is immutable (pure function of `seed`); ReconRunState is the only
// mutable, persisted thing (resume = regen map from seed + replay clearedNodeIds).
import { CharacterId, DefensiveSkillId, KillstreakPerkId } from './GameTypes';

/** Node-type catalog (§7). Drives generation weighting, difficulty, and node art. */
export enum ReconNodeKind {
  COMBAT = 'combat',     // standard mission (KILL_COUNT / SURVIVE_TIME / KILL_TYPE / HOLD_ZONE…)
  ELITE  = 'elite',      // KILL_ELITES mission, harder
  CACHE  = 'cache',      // light combat (COLLECT_DROPS) with an outsized loot reward
  SHOP   = 'shop',       // NO run: spend accumulated currency on camp/loadout upgrades
  EVENT  = 'event',      // NO run: rest/heal/risk-reward choice node (FTL-style event)
  BOSS   = 'boss',       // SLAY_BOSS; always the single terminal node
  START  = 'start',      // layer-0 staging node (auto-cleared, no run)
}

/** True when entering this node launches a Game run; false = handled on the map. */
export const NODE_LAUNCHES_RUN: Record<ReconNodeKind, boolean> = {
  [ReconNodeKind.COMBAT]: true,
  [ReconNodeKind.ELITE]:  true,
  [ReconNodeKind.CACHE]:  true,
  [ReconNodeKind.SHOP]:   false,
  [ReconNodeKind.EVENT]:  false,
  [ReconNodeKind.BOSS]:   true,
  [ReconNodeKind.START]:  false,
};

/** Rewards a node grants on clear. Accumulated by ReconSystem, paid out at the end (§9). */
export interface ReconReward {
  blueprintPoints?: number;     // -> BlueprintSystem.addPoints
  campResources?: number;       // -> survivor camp resources (food/water/medicine split)
  specialBlueprintId?: string;  // -> guaranteed unlock id (rare, on CACHE/BOSS)
}

/** One node in the layered DAG. Carries its Mission and the difficulty it is scaled to. */
export interface ReconNode {
  id: string;                   // stable within a recon, e.g. 'n_2_1' (layer 2, slot 1)
  kind: ReconNodeKind;
  layer: number;                // 0..(layers-1); 0 = start, last = boss
  slot: number;                 // index within the layer (for UI x-position)
  missionId?: string;           // resolved Mission id for run nodes (undefined for SHOP/EVENT/START)
  difficultyTier: number;       // 1..N, scales with layer (§8); injected into the Mission at launch
  reward: ReconReward;          // payout for clearing this node
  next: string[];               // ids of nodes in layer+1 this node connects to (out-edges)
  eventId?: string;             // authored event/shop variant (SHOP/EVENT only)
}

/** A generated expedition: the immutable graph + metadata. */
export interface ReconMap {
  id: string;                   // unique recon instance id (timestamp+seed)
  seed: number;                 // generation seed (deterministic regen / resume)
  name: string;                 // e.g. 'Downtown Sweep'
  layers: number;               // total layers including start(0) and boss(last)
  nodes: ReconNode[];           // all nodes, flat
  startNodeId: string;          // the single layer-0 entry node
  bossNodeId: string;           // the single terminal node
  requiredClears: number;       // X nodes to traverse start->boss (== layers)
  baseReward: ReconReward;      // completion bonus paid on reaching boss clear (§9)
}

/**
 * The minimal serializable snapshot of the player carried node-to-node. Value-only
 * (no live Phaser objects) so it survives scene restarts and localStorage round-trips.
 */
export interface ReconCarryState {
  maxHealth: number;            // Player.getStats().maxHealth
  currentHealth: number;        // Player.health at node clear; rest nodes can restore
  level: number;                // ExperienceSystem.getCurrentLevel()
  totalXP: number;              // banked XP so leveling continues across nodes
  unlockedWeaponIds: string[];  // WeaponSystem unlocked ids
  upgradeIds: string[];         // in-run upgrades chosen (UpgradeSystem) to re-apply
  relicIds: string[];           // relics acquired (RelicSystem) to re-apply
}

/** The once-chosen expedition loadout, frozen at recon start so the build is stable. */
export interface ReconLoadout {
  characterId: CharacterId;
  defensiveSkillId: DefensiveSkillId;
  killstreakPerkId: KillstreakPerkId;
}

/** Live progress through a recon (the FTL "run-state"). Persisted between nodes (§5,§10). */
export interface ReconRunState {
  mapId: string;
  seed: number;
  name: string;
  currentNodeId: string;        // node just cleared (or start before first move)
  clearedNodeIds: string[];     // path taken so far (for map rendering + resume)
  availableNodeIds: string[];   // out-edges of currentNode the player may pick next
  activeNodeId: string | null;  // node currently being run (selected, not yet cleared)
  carry: ReconCarryState;
  loadout: ReconLoadout;
  pending: { blueprintPoints: number; campResources: number; specialBlueprintIds: string[] };
  status: 'active' | 'won' | 'failed';
}

/** Effect applied by a non-run SHOP/EVENT node resolved on the map. */
export interface MapNodeEffect {
  healFraction?: number;        // restore this fraction of maxHealth toward full
  spendBlueprintPoints?: number;// debit from pending (a hedge against forfeit-on-death)
  grantBlueprintPoints?: number;// add to pending
  grantWeaponId?: string;       // unlock a weapon id into carry
}

/** Summary returned by completeRecon()/failRecon() for the GameOver presentation. */
export interface ReconPayout {
  outcome: 'won' | 'failed';
  blueprintPoints: number;      // BP actually banked (full on win, salvage on fail)
  campResources: number;
  specialBlueprintIds: string[];
  nodesCleared: number;
  totalNodes: number;
  reconName: string;
}
