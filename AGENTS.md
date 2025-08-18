## Code Style Guidelines for Agents

These conventions keep the codebase safe, consistent, and scalable. Follow them when generating or editing code.

- Prefer enums and constants over string literals
  - Do not compare against raw strings for identifiers or modes (e.g., skills, perks, characters, spawn states, rarities).
  - Define TypeScript `enum`s or exported constant objects for any repeated or semantic identifiers.
  - Use those enums/consts end-to-end: types, comparisons, serialization (e.g., localStorage), and UI.

- Centralize identifiers
  - Put shared enums/types in `src/game/types/GameTypes.ts` unless there is a more specific module.
  - Keep display text (labels) separate from identifiers.

- Type everything that crosses module boundaries
  - Strongly type function params/returns and public APIs.
  - Avoid `any`. If unavoidable at a boundary, isolate and narrow ASAP.

- No mutation of private state from outside
  - Expose explicit methods instead of mutating private fields.
  - Example: use `setXPMultiplier()` instead of writing to a private property.

- Guard clauses and early returns
  - Check invalid/edge conditions first and return early to keep nesting shallow.

- Match existing formatting and keep edits focused
  - Don’t reformat unrelated code. Keep changes narrowly scoped to the task.

- Keep code readable
  - Use descriptive names; avoid abbreviations and 1–2 character identifiers.
  - Prefer clear multi-line code over clever one-liners.

- Don't cast to any to access private member variables.  Instead add appropriate accessors to classes
