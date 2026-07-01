import { EnemyType, SpawnState } from '../types/GameTypes';
import { Mission, MissionConditionKind } from '../types/MissionTypes';

// Authored mission catalog — one tuned entry per win-condition kind (§3).
// Pattern after BLUEPRINTS (BlueprintSystem.ts) and CHARACTERS (LoadoutManager.ts).
export const MISSIONS: Mission[] = [
  {
    id: 'm_kill_200',
    name: 'Cull the Horde',
    description: 'Kill 200 zombies.',
    difficulty: 1,
    condition: { kind: MissionConditionKind.KILL_COUNT, target: 200 },
    reward: { blueprintPoints: 2 },
    extraction: { enabled: true },
  },
  {
    id: 'm_survive_240',
    name: 'Hold the Line',
    description: 'Survive for 4:00. (Avoids the 5:00 boss spawn.)',
    difficulty: 2,
    condition: { kind: MissionConditionKind.SURVIVE_TIME, seconds: 240 },
    reward: { blueprintPoints: 2 },
  },
  {
    id: 'm_kill_toxic_30',
    name: 'Specialist',
    description: 'Kill 30 Toxic zombies.',
    difficulty: 3,
    condition: { kind: MissionConditionKind.KILL_TYPE, enemyType: EnemyType.TOXIC, target: 30 },
    reward: { blueprintPoints: 3 },
  },
  {
    id: 'm_hold_zone',
    name: 'Hold the Zone',
    description: 'Hold the marked zone for a cumulative 30 seconds.',
    difficulty: 3,
    condition: {
      kind: MissionConditionKind.HOLD_ZONE,
      location: { x: 512, y: 384 },
      radius: 200,
      holdSeconds: 30,
      continuous: false,
    },
    reward: { blueprintPoints: 3 },
    // Fog of War showcase (docs/specs/fog-of-war.md): the arena is dark, so the
    // off-screen hold zone must be found via the objective beacon (§5.2). PEAK
    // waves double as a blackout — the horde arrives when you can see least (§4.5).
    fog: { enabled: true, blackoutStates: [SpawnState.PEAK] },
    // Light Sources (docs/specs/fog-of-war-light-sources.md): a streetlight spine
    // from the player start (world center 1024,768) toward the hold zone (512,384)
    // — the zone streetlight is a literal sanctuary during the PEAK blackout. A
    // flickering trashcan fire marks an intersection; a carryable lantern near
    // spawn lets the player drop a light to hold the zone approach.
    lights: [
      { kind: 'streetlight', x: 512, y: 384 },
      { kind: 'streetlight', x: 730, y: 540 },
      { kind: 'streetlight', x: 920, y: 660 },
      { kind: 'trashcanFire', x: 1180, y: 980 },
      { kind: 'lantern', x: 1024, y: 900, carryable: true },
    ],
  },
  {
    id: 'm_kill_elites_2',
    name: 'Elite Hunter',
    description: 'Slay 2 elite zombies.',
    difficulty: 3,
    condition: { kind: MissionConditionKind.KILL_ELITES, target: 2 },
    reward: { blueprintPoints: 3 },
    extraction: { enabled: true },
  },
  {
    id: 'm_slay_boss',
    name: 'Kingslayer',
    description: 'Survive to 5:00 and slay the boss.',
    difficulty: 5,
    condition: { kind: MissionConditionKind.SLAY_BOSS },
    reward: { blueprintPoints: 5 },
  },
  {
    id: 'm_flawless_60',
    name: 'Untouchable',
    description: 'Survive 60 seconds without being hit.',
    difficulty: 4,
    condition: { kind: MissionConditionKind.FLAWLESS_WINDOW, seconds: 60, withoutBeingHit: true },
    reward: { blueprintPoints: 4 },
  },
  {
    id: 'm_collect_15',
    name: 'Scavenger',
    description: 'Collect 15 pickups.',
    difficulty: 2,
    condition: { kind: MissionConditionKind.COLLECT_DROPS, target: 15 },
    reward: { blueprintPoints: 2 },
    // Fog of War: pickups glint at the edge of your light — push into the dark to
    // find them (no spatial objective, so the beacon stays hidden — degrades
    // gracefully per §5.2). A slightly wider lantern to keep scavenging readable.
    fog: { enabled: true, revealRadius: 460 },
    // Light Sources: scattered lit islands give the open scavenge arena authored
    // landmarks to navigate between, plus a carryable flare near spawn to light a
    // dark pocket while you sweep it for pickups.
    lights: [
      { kind: 'streetlight', x: 760, y: 520 },
      { kind: 'streetlight', x: 1380, y: 560 },
      { kind: 'streetlight', x: 1300, y: 1080 },
      { kind: 'trashcanFire', x: 640, y: 1080 },
      { kind: 'flare', x: 1120, y: 820, carryable: true },
    ],
  },
  {
    id: 'm_purge_carrier_20',
    name: 'Extermination',
    description: 'Exterminate 20 Carriers and leave none standing.',
    difficulty: 4,
    condition: {
      kind: MissionConditionKind.PURGE_TYPE,
      enemyType: EnemyType.CARRIER,
      target: 20,
      requireBoardClearAtFinish: true,
    },
    reward: { blueprintPoints: 4 },
  },
  {
    id: 'm_supply_cache_demo',
    name: 'Search & Retrieve: Demo',
    description: 'Kill 100 zombies. Recover the supply caches scattered in the arena.',
    difficulty: 2,
    condition: { kind: MissionConditionKind.KILL_COUNT, target: 100 },
    reward: { blueprintPoints: 2, food: 10, water: 6, medicine: 4 },
    // Search & Retrieve (docs/specs/search-and-retrieve-supply-caches.md). Manual
    // QA only — no in-game mission picker exists outside the Job Board; reach this
    // via LoadoutManager.getInstance().setMissionId('m_supply_cache_demo') in the
    // browser console before starting a run with no offer accepted.
    supplyCache: { enabled: true, count: 3 },
  },
  // ── Mono-Weapon "Specialist" missions (docs/specs/mono-weapon-mission-mode.md) ──
  // Each locks the whole run to one curated weapon, pairing the weapon archetype with
  // the win condition (§5.3): a CROWD-CLEAR weapon on a horde/extraction objective, a
  // SINGLE-TARGET weapon on an elite objective. Opt-in mirrors `extraction`/`fog`.
  {
    id: 'm_mono_tesla_horde',
    name: 'Storm Caller',
    description: 'Specialist run: Tesla Arc only. Kill 150 zombies, then extract.',
    difficulty: 3,
    condition: { kind: MissionConditionKind.KILL_COUNT, target: 150 },
    reward: { blueprintPoints: 3 },
    // Tesla Arc chains between clustered enemies — a crowd-clear tool, so it is a fair
    // pairing for a kill-count horde AND the uncapped extraction swarm (§5.3 rule).
    extraction: { enabled: true },
    monoWeapon: { enabled: true, weaponId: 'tesla_arc' },
  },
  {
    id: 'm_mono_piercing_elites',
    name: 'Marksman',
    description: 'Specialist run: Piercing Shot only. Slay 2 elite zombies.',
    difficulty: 3,
    condition: { kind: MissionConditionKind.KILL_ELITES, target: 2 },
    reward: { blueprintPoints: 3 },
    // Piercing Shot has real single-target punch (and pierces the chaff between),
    // so it can break an elite wall — the fair pairing for KILL_ELITES (§5.3 rule).
    monoWeapon: { enabled: true, weaponId: 'piercing_shot' },
  },
];

export const DEFAULT_MISSION_ID = 'm_kill_200';

// Runtime-registered missions (City Reclamation zone jobs). These are NOT part of the
// authored catalog — they are built from a ZoneJobDef.condition when the player accepts
// a zone job, so resolveMission() can return the right win condition for the run. Kept
// separate from MISSIONS so the Loadout/Job-Board catalog UI stays the authored set.
const DYNAMIC_MISSIONS = new Map<string, Mission>();

export function registerMission(m: Mission): void {
  DYNAMIC_MISSIONS.set(m.id, m);
}

export function getMissionById(id: string): Mission | undefined {
  return MISSIONS.find(m => m.id === id) ?? DYNAMIC_MISSIONS.get(id);
}

export function resolveMission(id: string | undefined): Mission {
  return (id && getMissionById(id)) || getMissionById(DEFAULT_MISSION_ID) || MISSIONS[0];
}
