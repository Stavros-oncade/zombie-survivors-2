# Outer Loop — Overview & Index

Status: Draft / design index
Target: `zombie-survivors-2` (Phaser 3 + TypeScript)

The game today is an endless single-run survivor shooter. The **outer loop** wraps runs in a
meta layer: a fantasy of leading the human remnant — taking jobs, preparing expeditions,
keeping a camp alive, and reclaiming the world city by city. Each short run is an "expedition"
launched from this layer; its outcome feeds resources, progression, and pressure back into it.

All systems reuse the existing `Mission` / `MissionCondition` model
(`src/game/types/MissionTypes.ts`), `MissionSystem` per-run runtime
(`src/game/systems/MissionSystem.ts`), and the `BlueprintSystem` localStorage meta-currency
(`src/game/systems/BlueprintSystem.ts`). No existing run code is replaced — the outer loop sits
*around* it and hands a run-config into the `Game` scene.

## The six specs

| # | Doc | Role in the loop |
| --- | --- | --- |
| 1 | [outer-loop-job-board.md](outer-loop-job-board.md) | Picks the next mission: 3 offers wrapping a `Mission` with modifiers + a four-currency reward bundle. Entry point to the loop. |
| 2 | [outer-loop-survivor-camp.md](outer-loop-survivor-camp.md) | The stakes: food/water/medicine/horde-strength needs that missions feed; extinction lose-state; blueprint-upgradable facilities; survivors as a labor pool. |
| 3 | [outer-loop-route-map.md](outer-loop-route-map.md) | "Long Recon" — a branching FTL/StS DAG of mission nodes with carried run-state. Appears as one Job Board offer. |
| 4 | [outer-loop-city-reclamation.md](outer-loop-city-reclamation.md) | The macro map: cities → zones with infestation that missions lower, unlocking vendors/facilities and special blueprints. Multi-city escalation. |
| 5 | [outer-loop-expedition-loadout.md](outer-loop-expedition-loadout.md) | **(High priority)** Pre-mission prep: assign supplies, survivors, perks, risk modifiers. Extends the existing `Loadout` scene. |
| 6 | [outer-loop-weapon-unlocks.md](outer-loop-weapon-unlocks.md) | New weapons unlocked as level-up rewards and via blueprints/city special blueprints; declarative weapon registry. |

## Loop flow

```
            City Reclamation (4) ─ surfaces zone missions ─┐
                                                            ▼
   Survivor Camp (2) ◄── rewards ── Job Board (1) ── 3 offers ──► pick
        │  spend blueprints              │                         │
        │  to upgrade                    ├─ normal mission ───────┐│
        ▼                                ├─ Long Recon (3) ─ DAG ─┤│
   facilities / survivors                └─ Zone clear (4) ───────┤│
        │                                                         ▼▼
        └──────── survivors + supplies ──► Expedition Loadout (5) ──► Game run
                                                                        │
                                            outcome (win/loss, casualties, resources, infestation)
                                                                        │
                                                                        └──► back to Camp (2) + City (4)
```

## Dependency / build order

The specs cross-reference each other; suggested implementation order minimizes rework:

1. **Job Board (1)** + **Survivor Camp (2)** first — they define the reward currencies
   (`CampReward` widening of `Mission.reward`) and the meta-stakes every other system pays into.
2. **Expedition Loadout (5)** — extends the existing `Loadout` scene; needs the camp's survivor
   pool and the board's run-config handoff.
3. **Weapon Unlocks (6)** — mostly self-contained (registry + blueprint gating); slots into
   level-up and loadout. Can proceed in parallel.
4. **City Reclamation (4)** — the macro map that generates board missions and reveals special
   blueprints (consumed by 6).
5. **Long Recon / Route Map (3)** — most complex (carried run-state across nodes); build last,
   once single-mission launch/return is solid.

## Shared contracts to lock down first

- **Reward bundle**: the four-currency `CampReward` (blueprints, campaign progress, horde-pressure
  relief, camp resources) — defined in (2), produced by (1)/(3)/(4), consumed by (2).
- **Run-config handoff**: the `ExpeditionPlan` / run-modifier payload passed into `Game` via
  scene-start data — defined in (5), referenced by (1) and (3).
- **Meta events**: `zone_cleared` / `vendor_unlocked` / `city_reclaimed` (from 4) and
  win/casualty resolution (from 2/5) — the seams every other system listens on.
