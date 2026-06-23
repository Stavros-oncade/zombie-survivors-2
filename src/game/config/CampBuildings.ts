// src/game/config/CampBuildings.ts
// Authored camp-facility catalog. Pattern after BLUEPRINTS (BlueprintSystem.ts)
// and MISSIONS (Missions.ts). Costs in blueprint points; numbers are v1 balance.
// See docs/specs/outer-loop-survivor-camp.md §5.
import { BuildingDef, BuildingId, NeedKind } from '../types/CampTypes';

export const CAMP_BUILDINGS: BuildingDef[] = [
  { id: BuildingId.FARM, name: 'Farm', description: 'Grows food each cycle.', tiers: [
      { tier: 1, cost: 3,  produces: { need: NeedKind.FOOD, amount: 4 } },
      { tier: 2, cost: 6,  produces: { need: NeedKind.FOOD, amount: 8 } },
      { tier: 3, cost: 10, produces: { need: NeedKind.FOOD, amount: 14 } },
    ] },
  { id: BuildingId.WELL, name: 'Well', description: 'Draws water each cycle.', tiers: [
      { tier: 1, cost: 3,  produces: { need: NeedKind.WATER, amount: 4 } },
      { tier: 2, cost: 6,  produces: { need: NeedKind.WATER, amount: 8 } },
      { tier: 3, cost: 10, produces: { need: NeedKind.WATER, amount: 14 } },
    ] },
  { id: BuildingId.INFIRMARY, name: 'Infirmary', description: 'Produces and stores medicine.', tiers: [
      { tier: 1, cost: 4,  produces: { need: NeedKind.MEDICINE, amount: 2 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 10 } },
      { tier: 2, cost: 7,  produces: { need: NeedKind.MEDICINE, amount: 4 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 20 } },
      { tier: 3, cost: 11, produces: { need: NeedKind.MEDICINE, amount: 7 }, capacityBonus: { need: NeedKind.MEDICINE, amount: 35 } },
    ] },
  { id: BuildingId.WALLS, name: 'Walls', description: 'Hold back the horde; suppress pressure.', tiers: [
      { tier: 1, cost: 4,  defenseValue: 10, hordeSuppression: 1 },
      { tier: 2, cost: 8,  defenseValue: 25, hordeSuppression: 2 },
      { tier: 3, cost: 13, defenseValue: 45, hordeSuppression: 4 },
    ] },
  { id: BuildingId.WAREHOUSE, name: 'Warehouse', description: 'Stores more food and water.', tiers: [
      // capacityBonus applies to BOTH food and water; CampSystem special-cases WAREHOUSE.
      { tier: 1, cost: 3,  capacityBonus: { need: NeedKind.FOOD, amount: 20 } },
      { tier: 2, cost: 6,  capacityBonus: { need: NeedKind.FOOD, amount: 40 } },
      { tier: 3, cost: 10, capacityBonus: { need: NeedKind.FOOD, amount: 70 } },
    ] },
  { id: BuildingId.BARRACKS, name: 'Barracks', description: 'Houses survivors; slow regrowth.', tiers: [
      { tier: 1, cost: 5,  survivorCapBonus: 15, survivorRegrowth: 1 },
      { tier: 2, cost: 9,  survivorCapBonus: 22, survivorRegrowth: 2 },
      { tier: 3, cost: 14, survivorCapBonus: 30, survivorRegrowth: 3 },
    ] },
];

export function getBuildingDef(id: BuildingId): BuildingDef | undefined {
  return CAMP_BUILDINGS.find(b => b.id === id);
}
