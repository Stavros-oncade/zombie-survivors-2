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

## Content Manifest Rules

All runtime assets must be declared in a content manifest and loaded via the Preloader – not hardcoded in scenes. This keeps bundle size small, enables CDN delivery, and makes missing assets explicit.

- Manifest location
  - Path in this repo: `public/content.manifest.json`
  - Optional override via env: `VITE_ASSET_MANIFEST_URL` (defaults to `/content.manifest.json`).
  - Later, the URL may come from Oncade remote config; code should already support this with the env override.

- Loading policy
  - Only `Preloader` may enqueue runtime assets; scenes should never call `this.load.image(...)` with file paths.
  - Scenes must reference assets by key (e.g., `this.add.image(x,y,'player')`) and assume Preloader has loaded them.
  - If an asset may be missing, scenes must guard with `this.textures.exists(key)` and degrade gracefully.
  - Fallbacks are allowed only in Preloader (e.g., simple generated placeholders for icons).

- Adding / changing assets
  - Do not add direct file paths to code. Update `public/content.manifest.json` instead.
  - Each entry must include: `id`, `type` (image|spritesheet|atlas|audio|font), `category`, `status` (`present` or `missing`), `urls` (relative or CDN path), `sizeKB` (target cap), optional `pixel` metadata, `description`, and `guidelines`.
  - If the binary is not yet available, add the entry with `status: "missing"` and a clear description/guidelines. Preloader will not attempt to load it; the UI should keep working via placeholders.
  - When adding new local files, place them under `public/assets/` and point `urls.png` (or `urls.webp`) at that path. Preferred format is WebP when quality allows.

- Size guidance (hard caps unless justified)
  - `relic_icon` and other small icons: ≤ 8–12 KB, 48×48 px (1x). Transparent background; high contrast.
  - `projectile`: ≤ 6–8 KB, 16–32 px. Crisp edges; avoid heavy blurs.
  - `enemy` (single static): ≤ 32–40 KB (up to 60 KB for special cases). Distinct silhouette.
  - `vfx` (single sprite): ≤ 20–30 KB. Prefer procedural/tweened effects.
  - `background`: prefer CDN; target ≤ 200–300 KB.
  - General: prefer WebP; trim transparent padding; strip metadata.

- CDN and versioning
  - Manifest may specify `cdnBaseUrl` so `urls` can be relative. Use hashed filenames for CDN when we adopt CI uploads.
  - Bump the manifest `version` when changing URLs or adding substantial new content.

- Forbidden
- No hard-coded asset URLs or file paths in scenes/systems.
- No direct asset loads outside `Preloader` (except generated textures used strictly as placeholders).

Note on URL handling in manifest loader
- Do not force a leading `/` on manifest paths. Vite in this repo builds with `base: './'`, so relative URLs (e.g., `assets/title.png`) must remain relative. Only prepend `cdnBaseUrl` if provided in the manifest. For CDN use, set `cdnBaseUrl` and keep `urls` relative to it.
- Procedural placeholders (e.g., generated `enemy_ranged`) can mask missing content; verify `this.textures.exists(key)` after preload and prefer real assets from the manifest.

- Testing
  - When adding or changing manifest entries, run the game and watch the Preloader logs; verify that `this.textures.exists(key)` is true in the first scene that uses each key.
  - If an entry is `present` but fails to load, revert to `missing` and file a follow-up to supply the asset.
