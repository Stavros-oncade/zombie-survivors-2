// src/game/systems/CityMapGenerator.ts
// Pure, seeded, deterministic generator for a City Reclamation block-grid (§2, §13.11).
// Given the same {cityId, seed, cols, rows, anchors} it ALWAYS yields the identical
// ZoneDef[] — the contract the persisted save relies on (zones are keyed by ZoneDef.id,
// and baseInfestation is re-seeded into live state on first visit, so the grid MUST be
// stable across reloads). Mirrors ReconMapGenerator's seeded discipline; NEVER reads
// Math.random().
//
// The grid is a fully-packed rectangle of blocks. Adjacency is purely the orthogonal
// grid neighbours (up/down/left/right) — that is what makes a block "openable" the moment
// any neighbour is cleared (CityReclamationSystem.isZoneOpen). A handful of authored
// "anchor" cells carry the real rewards (vendors, facilities, the city-special blueprint);
// every other cell is a generic combat/hold block scaled by distance from the safe start.
import { mulberry32, pick } from '../utils/Rng';
import { MissionConditionKind } from '../types/MissionTypes';
import { INFESTATION } from '../config/Cities';
import { ZoneDef, ZoneJobDef, ZoneRewards } from '../types/CityTypes';

/** Where an anchor wants to land on the grid. */
export type AnchorPlacement = 'start' | 'farthest' | 'inner';

/** A designer-authored special cell to weave into the generated grid. */
export interface CityAnchor {
  name: string;
  placement: AnchorPlacement;
  rewards: ZoneRewards;
  /** Infestation a single win removes (defaults to "clears in one win"). */
  infestationReward?: number;
  baseInfestation?: number;
  /** Force a job kind; otherwise seeded kill/hold. */
  jobKind?: 'kill' | 'hold';
}

export interface CityGridOpts {
  cityId: string;
  seed: number;
  cols: number;
  rows: number;
  /** Start cell (the pre-cleared Safe Block). Defaults to {col:0,row:middle}. */
  start?: { col: number; row: number };
  anchors: CityAnchor[];
  /** Generic-block name pool (themed per biome). */
  blockNames?: readonly string[];
}

const DEFAULT_BLOCK_NAMES = [
  'Tenements', 'Back Alley', 'Plaza', 'Transit Hub', 'Parking Deck', 'Storefronts',
  'Rowhouses', 'Warehouse', 'City Park', 'Substation', 'Overpass', 'Canal Walk',
  'Checkpoint', 'Rooftops', 'Underpass', 'Depot', 'Courtyard', 'Bus Yard',
] as const;

interface Cell { col: number; row: number; dist: number; }

function manhattan(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function zoneId(cityId: string, col: number, row: number): string {
  return `${cityId}_z_${col}_${row}`;
}

function killJob(id: string, name: string, infestationReward: number, target: number): ZoneJobDef {
  return { id, name, infestationReward, repeatable: true, condition: { kind: MissionConditionKind.KILL_COUNT, target } };
}

function holdJob(id: string, name: string, infestationReward: number, holdSeconds: number): ZoneJobDef {
  return {
    id, name, infestationReward, repeatable: true,
    condition: { kind: MissionConditionKind.HOLD_ZONE, location: { x: 512, y: 384 }, radius: 200, holdSeconds, continuous: false },
  };
}

/** Infestation rises with distance from the safe start so the player expands outward. */
function baseInfestationFor(dist: number, maxDist: number): number {
  if (dist <= 0) return INFESTATION.MIN; // start cell -> auto-cleared
  const t = maxDist > 0 ? dist / maxDist : 0;
  // 45 (frontier) -> 100 (deepest). Always > CLEARED_THRESHOLD so nothing auto-clears.
  return Math.round(45 + t * 55);
}

/** Build the single job for a cell, scaled so one win clears it (block = one run). */
function jobForCell(
  id: string, name: string, base: number, kind: 'kill' | 'hold'
): ZoneJobDef {
  // Reward clears the cell in one win; a difficulty bonus (applyJobWin) over-clears, fine.
  const reward = Math.max(10, base);
  if (kind === 'hold') {
    const seconds = 30 + Math.round((base / 100) * 30); // 30..60s, deeper holds longer
    return holdJob(`${id}_j1`, name, reward, seconds);
  }
  const target = 80 + Math.round((base / 100) * 160); // 80..240 kills, deeper is more
  return killJob(`${id}_j1`, name, reward, target);
}

/**
 * Generate the city's block-grid. Deterministic in (cityId, seed, cols, rows, anchors).
 * Adjacency = orthogonal grid neighbours that exist.
 */
export function generateCityGrid(opts: CityGridOpts): ZoneDef[] {
  const { cityId, cols, rows, anchors } = opts;
  const rng = mulberry32(opts.seed >>> 0);
  const start = opts.start ?? { col: 0, row: Math.floor(rows / 2) };
  const names = opts.blockNames ?? DEFAULT_BLOCK_NAMES;

  // 1. Enumerate cells with their distance from the start.
  const cells: Cell[] = [];
  let maxDist = 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dist = manhattan({ col, row }, start);
      maxDist = Math.max(maxDist, dist);
      cells.push({ col, row, dist });
    }
  }

  // 2. Resolve anchor placements onto concrete cells (deterministic, no double-booking).
  const taken = new Set<string>();
  const cellKey = (c: { col: number; row: number }) => `${c.col},${c.row}`;
  const anchorAt = new Map<string, CityAnchor>();

  const claim = (cell: Cell, anchor: CityAnchor) => {
    taken.add(cellKey(cell));
    anchorAt.set(cellKey(cell), anchor);
  };

  // 'start' anchors take the start cell; 'farthest' takes the deepest free cell;
  // 'inner' anchors are sampled from the mid-distance free cells.
  const startCell = cells.find((c) => c.col === start.col && c.row === start.row)!;
  for (const a of anchors.filter((a) => a.placement === 'start')) claim(startCell, a);

  for (const a of anchors.filter((a) => a.placement === 'farthest')) {
    const free = cells.filter((c) => !taken.has(cellKey(c)));
    const deepest = free.reduce((best, c) => (c.dist > best.dist ? c : best), free[0]);
    claim(deepest, a);
  }

  for (const a of anchors.filter((a) => a.placement === 'inner')) {
    const free = cells
      .filter((c) => !taken.has(cellKey(c)) && c.dist > 0 && c.dist < maxDist)
      .sort((x, y) => x.dist - y.dist || x.col - y.col || x.row - y.row);
    if (!free.length) continue;
    // Bias toward the middle of the free band for a spread-out feel.
    const idx = Math.floor(rng() * free.length);
    claim(free[idx], a);
  }

  // 3. Emit a ZoneDef per cell.
  const zones: ZoneDef[] = [];
  for (const c of cells) {
    const id = zoneId(cityId, c.col, c.row);
    const adjacency: string[] = [];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c.col + dc, nr = c.row + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) adjacency.push(zoneId(cityId, nc, nr));
    }

    const anchor = anchorAt.get(cellKey(c));
    if (anchor) {
      const base = anchor.baseInfestation ?? (anchor.placement === 'start' ? INFESTATION.MIN : baseInfestationFor(c.dist, maxDist));
      const isStart = anchor.placement === 'start' || base <= INFESTATION.CLEARED_THRESHOLD;
      const kind = anchor.jobKind ?? (rng() < 0.5 ? 'kill' : 'hold');
      const job = isStart ? undefined : jobForCell(id, `${anchor.name}: Reclaim`, anchor.infestationReward ?? base, kind);
      zones.push({
        id, name: anchor.name, cityId, grid: { col: c.col, row: c.row },
        adjacency, baseInfestation: base, jobs: job ? [job] : [], rewards: anchor.rewards,
      });
      continue;
    }

    // Generic block.
    const base = baseInfestationFor(c.dist, maxDist);
    const kind: 'kill' | 'hold' = rng() < 0.5 ? 'kill' : 'hold';
    const name = pick(rng, names);
    zones.push({
      id, name, cityId, grid: { col: c.col, row: c.row },
      adjacency, baseInfestation: base,
      jobs: [jobForCell(id, `${name}: Reclaim`, base, kind)],
      rewards: { blueprintPoints: 1, hordePressureDelta: -2 },
    });
  }

  return zones;
}
