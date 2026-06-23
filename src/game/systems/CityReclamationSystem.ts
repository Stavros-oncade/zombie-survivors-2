// src/game/systems/CityReclamationSystem.ts
// The City Reclamation meta layer — a static, localStorage-backed system mirroring
// BlueprintSystem / CampSystem storage discipline (crash-proof JSON read with safe
// seed fallback). See docs/specs/outer-loop-city-reclamation.md §8, §10.
//
// Adds ZERO per-frame cost to the in-run loop: all work happens between runs, driven
// by a single entry point (applyJobWin) called at the WIN edge (GameOver). No live
// scene is required — it reads/writes localStorage directly.
import { BlueprintSystem } from './BlueprintSystem';
import { CampSystem } from './CampSystem';
import {
  CITIES,
  FIRST_CITY_ID,
  INFESTATION,
  ADJACENCY_BLEED,
  DIFFICULTY_BONUS_PER_TIER,
  getCityById,
  getZoneById,
  getJob,
} from '../config/Cities';
import {
  CityReclamationSave,
  CityDef,
  ZoneDef,
  ZoneState,
  ZoneState_Live,
} from '../types/CityTypes';

const STORAGE_SAVE = 'zs2_city_reclaim_v1';
const STORAGE_REVEALED = 'zs2_revealed_blueprints';
// Phase-4 weapon hook: minting an id here auto-unlocks the matching CITY_SPECIAL weapon
// (WeaponCatalog.isCityBlueprintOwned + BlueprintSystem.isCityBlueprintOwned read this).
const STORAGE_CITY_BLUEPRINTS = 'zs2_city_blueprints_v1';
const SCHEMA_VERSION = 1;

/** Meta-events City Reclamation emits when a live scene emitter is provided. */
export interface ReclamationEvents {
  zone_cleared: { zoneId: string; cityId: string };
  vendor_unlocked: { vendorId: string };
  city_reclaimed: { cityId: string; nextCityId?: string };
}

/** Result of a single applyJobWin, for the GameOver summary line. */
export interface JobWinResult {
  applied: boolean;
  zoneId: string;
  infestationBefore: number;
  infestationAfter: number;
  directDrop: number;
  zoneCleared: boolean;
  newState: ZoneState;
  cityReclaimed?: { cityId: string; nextCityId?: string };
}

/** Optional sink so a live MetaMap/Camp scene can listen; null in the static GameOver path. */
type Emitter = { emit: (event: string, payload: unknown) => void } | null;

export class CityReclamationSystem {
  /* ───────────────── persistence (crash-proof, mirrors BlueprintSystem) ───────────────── */
  private static load(): CityReclamationSave {
    const raw = localStorage.getItem(STORAGE_SAVE);
    if (raw) {
      try {
        const s = JSON.parse(raw) as CityReclamationSave;
        if (s && s.version === SCHEMA_VERSION && s.zones && typeof s.zones === 'object') {
          // Top-up migration: ensure every zone of the current city has live state. This
          // self-heals a save written against an older zone layout (e.g. the pre-grid zone
          // ids), which would otherwise leave the new blocks with no live state — no Safe
          // Block seeded, so nothing on the frontier and nothing clickable.
          const city = getCityById(s.currentCityId);
          if (city && city.zones.some((z) => !s.zones[z.id])) {
            this.seedCityZones(s, s.currentCityId);
            this.persist(s);
          }
          return s;
        }
      } catch {
        /* fall through to seed */
      }
    }
    const seeded = this.seedDefault();
    this.persist(seeded);
    return seeded;
  }

  private static persist(save: CityReclamationSave): void {
    for (const z of Object.values(save.zones)) {
      z.infestation = Math.min(INFESTATION.MAX, Math.max(INFESTATION.MIN, z.infestation));
      z.state = this.deriveZoneState(z.infestation);
    }
    try {
      localStorage.setItem(STORAGE_SAVE, JSON.stringify(save));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }

  /** Fresh save: first city, every zone at baseInfestation; baseInfestation<=threshold pre-cleared. */
  private static seedDefault(): CityReclamationSave {
    const save: CityReclamationSave = {
      version: SCHEMA_VERSION,
      currentCityId: FIRST_CITY_ID,
      zones: {},
      reclaimedCityIds: [],
      grantedRewardKeys: [],
    };
    this.seedCityZones(save, FIRST_CITY_ID);
    return save;
  }

  /** Initialize ZoneState_Live for a city from ZoneDef.baseInfestation (§7.1). */
  private static seedCityZones(save: CityReclamationSave, cityId: string): void {
    const city = getCityById(cityId);
    if (!city) return;
    for (const z of city.zones) {
      if (save.zones[z.id]) continue; // never clobber existing live state
      const infestation = Math.min(INFESTATION.MAX, Math.max(INFESTATION.MIN, z.baseInfestation));
      const state = this.deriveZoneState(infestation);
      save.zones[z.id] = {
        infestation,
        state,
        cleared: state === ZoneState.CLEARED,
        jobsCompleted: [],
      };
      // A pre-cleared start zone still grants its (vendor) reward exactly once.
      if (state === ZoneState.CLEARED) this.applyZoneCleared(save, z, null);
    }
  }

  /* ───────────────── derived state ───────────────── */
  static deriveZoneState(infestation: number): ZoneState {
    if (infestation <= INFESTATION.CLEARED_THRESHOLD) return ZoneState.CLEARED;
    if (infestation <= INFESTATION.CONTESTED_THRESHOLD) return ZoneState.CONTESTED;
    return ZoneState.INFESTED;
  }

  /* ───────────────── core entry point (called at the WIN edge, §6) ───────────────── */
  /**
   * Apply a winning run that satisfied (zoneId, jobId). Pure localStorage mutation.
   * Idempotency: re-calling on an already-cleared zone is a no-op (the `cleared` latch).
   * Note: a repeated win on a not-yet-cleared zone DOES re-apply the drop (grindable).
   * @param emitter optional live-scene emitter for meta-events (null in static GameOver path).
   */
  static applyJobWin(zoneId: string, jobId: string, difficulty = 1, emitter: Emitter = null): JobWinResult {
    const save = this.load();
    const zoneDef = getZoneById(zoneId);
    const job = getJob(zoneId, jobId);
    const live = save.zones[zoneId];

    const fail: JobWinResult = {
      applied: false, zoneId, infestationBefore: live?.infestation ?? 0,
      infestationAfter: live?.infestation ?? 0, directDrop: 0,
      zoneCleared: live?.cleared ?? false, newState: live?.state ?? ZoneState.INFESTED,
    };
    if (!zoneDef || !job || !live) return fail;
    if (live.cleared) return fail; // already done — no double-drop

    const before = live.infestation;

    // 1. direct reduction + difficulty bonus (§3.2)
    const bonus = Math.max(0, (difficulty - 1) * DIFFICULTY_BONUS_PER_TIER);
    const directDrop = job.infestationReward + bonus;
    live.infestation = Math.max(INFESTATION.MIN, live.infestation - directDrop);

    // 2. adjacency bleed — each neighbor loses a fraction of the direct drop (§3.2)
    for (const nId of zoneDef.adjacency) {
      const n = save.zones[nId];
      if (n && !n.cleared) {
        n.infestation = Math.max(INFESTATION.MIN, n.infestation - directDrop * ADJACENCY_BLEED);
      }
    }

    // 3. one-shot job bookkeeping + per-job bonus points
    if (!job.repeatable && !live.jobsCompleted.includes(jobId)) live.jobsCompleted.push(jobId);
    if (job.bonusBlueprintPoints) BlueprintSystem.addPoints(job.bonusBlueprintPoints);

    // 4. re-derive + handle clear edges (target + neighbors can both clear in one win)
    const cityResult = this.reconcileClears(save, emitter);

    this.persist(save);

    const after = save.zones[zoneId].infestation;
    return {
      applied: true, zoneId, infestationBefore: before, infestationAfter: after,
      directDrop, zoneCleared: save.zones[zoneId].cleared,
      newState: save.zones[zoneId].state, cityReclaimed: cityResult,
    };
  }

  private static reconcileClears(save: CityReclamationSave, emitter: Emitter): JobWinResult['cityReclaimed'] {
    for (const [zoneId, live] of Object.entries(save.zones)) {
      live.state = this.deriveZoneState(live.infestation);
      if (live.state === ZoneState.CLEARED && !live.cleared) {
        live.cleared = true;
        live.infestation = 0;
        const zoneDef = getZoneById(zoneId);
        if (zoneDef) this.applyZoneCleared(save, zoneDef, emitter);
      }
    }
    return this.maybeReclaimCity(save, emitter);
  }

  /** §5.2 — grant ZoneRewards exactly once (idempotent via grantedRewardKeys). */
  private static applyZoneCleared(save: CityReclamationSave, zone: ZoneDef, emitter: Emitter): void {
    const key = `zone:${zone.id}`;
    if (save.grantedRewardKeys.includes(key)) return;
    const r = zone.rewards;
    if (r.blueprintPoints) BlueprintSystem.addPoints(r.blueprintPoints);
    (r.cityBlueprintIds ?? []).forEach((id) => this.mintCityBlueprint(id));
    (r.blueprintIds ?? []).forEach((id) => this.revealBlueprint(id));
    (r.vendorIds ?? []).forEach((id) => emitter?.emit('vendor_unlocked', { vendorId: id }));
    if (r.hordePressureDelta) this.adjustRegionalPressure(r.hordePressureDelta);
    save.grantedRewardKeys.push(key);
    emitter?.emit('zone_cleared', { zoneId: zone.id, cityId: zone.cityId });
  }

  /** §7.1 — if every zone in the current city is CLEARED, reclaim it. */
  private static maybeReclaimCity(save: CityReclamationSave, emitter: Emitter): JobWinResult['cityReclaimed'] {
    const city = getCityById(save.currentCityId);
    if (!city) return undefined;
    const allCleared = city.zones.every((z) => save.zones[z.id]?.cleared);
    if (!allCleared) return undefined;
    return this.applyCityReclaimed(save, city, emitter);
  }

  private static applyCityReclaimed(
    save: CityReclamationSave,
    city: CityDef,
    emitter: Emitter
  ): JobWinResult['cityReclaimed'] {
    const key = `city:${city.id}`;
    if (save.grantedRewardKeys.includes(key)) return undefined;
    (city.reward.cityBlueprintIds ?? []).forEach((id) => this.mintCityBlueprint(id));
    (city.reward.blueprintIds ?? []).forEach((id) => this.revealBlueprint(id));
    if (city.reward.blueprintPoints) BlueprintSystem.addPoints(city.reward.blueprintPoints);
    if (!save.reclaimedCityIds.includes(city.id)) save.reclaimedCityIds.push(city.id);
    save.grantedRewardKeys.push(key);
    if (city.reward.unlocksCityId) {
      save.currentCityId = city.reward.unlocksCityId;   // advance the campaign
      this.seedCityZones(save, city.reward.unlocksCityId); // copy baseInfestation into live state
    }
    emitter?.emit('city_reclaimed', { cityId: city.id, nextCityId: city.reward.unlocksCityId });
    return { cityId: city.id, nextCityId: city.reward.unlocksCityId };
  }

  /** Lower regional horde pressure via the Camp system (negative delta => relief). */
  private static adjustRegionalPressure(delta: number): void {
    if (delta < 0) {
      CampSystem.getInstance().applyMissionReward({ hordePressureReduction: -delta });
    }
    // A positive delta (re-infestation, v2) would raise horde strength; not used in v1.
  }

  /* ───────────────── city-special blueprint mint (Phase-4 weapon hook) ───────────────── */
  /** Write an id into zs2_city_blueprints_v1 so the matching CITY_SPECIAL weapon unlocks. */
  private static mintCityBlueprint(id: string): void {
    const arr = this.readCityBlueprintIds();
    if (!arr.includes(id)) {
      arr.push(id);
      try { localStorage.setItem(STORAGE_CITY_BLUEPRINTS, JSON.stringify(arr)); } catch { /* non-fatal */ }
    }
    // City specials are also surfaced in the Blueprints scene via the reveal ledger.
    this.revealBlueprint(id);
  }

  private static readCityBlueprintIds(): string[] {
    const raw = localStorage.getItem(STORAGE_CITY_BLUEPRINTS);
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? (a as string[]) : []; } catch { return []; }
  }

  static getCityBlueprintIds(): string[] {
    return this.readCityBlueprintIds();
  }

  /* ───────────────── reveal ledger (read by Blueprints scene) ───────────────── */
  private static revealBlueprint(id: string): void {
    const arr = this.getRevealedBlueprintIds();
    if (!arr.includes(id)) {
      arr.push(id);
      try { localStorage.setItem(STORAGE_REVEALED, JSON.stringify(arr)); } catch { /* non-fatal */ }
    }
  }

  static getRevealedBlueprintIds(): string[] {
    const raw = localStorage.getItem(STORAGE_REVEALED);
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? (a as string[]) : []; } catch { return []; }
  }

  /* ───────────────── read API for the MetaMap scene ───────────────── */
  static getCurrentCity(): CityDef {
    return getCityById(this.load().currentCityId) ?? CITIES[0];
  }

  static getZoneLive(zoneId: string): ZoneState_Live | undefined {
    return this.load().zones[zoneId];
  }

  static getCityProgress(cityId: string): { cleared: number; total: number } {
    const city = getCityById(cityId);
    if (!city) return { cleared: 0, total: 0 };
    const save = this.load();
    const cleared = city.zones.filter((z) => save.zones[z.id]?.cleared).length;
    return { cleared, total: city.zones.length };
  }

  static isCityReclaimed(cityId: string): boolean {
    return this.load().reclaimedCityIds.includes(cityId);
  }

  /**
   * Whether a block is open to take: not yet cleared, and orthogonally adjacent to a
   * CLEARED block (the frontier-expansion rule, §13.11). The pre-cleared Safe Block seeds
   * the frontier; from there the player may pick ANY block touching cleared territory.
   * (adjacency on generated grids is exactly the up/down/left/right neighbours.)
   */
  static isZoneOpen(zoneId: string): boolean {
    const def = getZoneById(zoneId);
    if (!def) return false;
    const save = this.load();
    const live = save.zones[zoneId];
    if (!live || live.cleared) return false;
    return def.adjacency.some((nId) => save.zones[nId]?.cleared === true);
  }

  /** Total survivors-sheltered flavor count (= cleared zones across all cities). */
  static getClearedZoneCount(): number {
    return Object.values(this.load().zones).filter((z) => z.cleared).length;
  }

  /** Test/dev helper: wipe the save (does not touch BlueprintSystem points). */
  static reset(): void {
    try {
      localStorage.removeItem(STORAGE_SAVE);
      localStorage.removeItem(STORAGE_REVEALED);
      localStorage.removeItem(STORAGE_CITY_BLUEPRINTS);
    } catch { /* non-fatal */ }
  }
}
