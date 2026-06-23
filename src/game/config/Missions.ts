import { EnemyType } from '../types/GameTypes';
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
