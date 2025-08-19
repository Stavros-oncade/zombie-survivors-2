# Art & Content Style Guide

This guide defines the visual rules, technical limits, and export requirements for all asset categories used by the game. It complements `public/content.manifest.json` and AGENTS.md.

Use this guide when producing new content or reviewing third‑party submissions. If an asset cannot meet these constraints, flag it in the PR with rationale and measured size.

## General Rules

- Formats: Prefer WebP (lossy) for raster. PNG only when alpha edges degrade noticeably.
- Color space: sRGB. Remove ICC profiles and metadata. 72–96 DPI is fine; DPI is ignored at runtime.
- Transparency: Use premultiplied‑safe edges; no matte halos. Avoid semi‑transparent soft glows that bloat size.
- Padding: Keep tight to content. Add only minimal padding for rotations (projectiles) or glow spill.
- Alignment: Pixel‑perfect at 1×. Center graphics so rotations and tweens look balanced.
- Naming: Lowercase, snake_case. Organize by folder: `icons/`, `weapons/`, `enemies/`, `pickups/`, `vfx/`, `ui/`.
- Size budgets: Respect the caps below. Over‑budget assets must be reworked before acceptance.
- Consistency: Use a simple, readable style with bold shapes and limited gradients. Avoid photo‑realism.

## Palette & Effects (Global)

- Player: 
a pixel art character in a cyberpunk style. The player character is designed with the following key features:
	•	Hair & Face: Bright blue mohawk hairstyle and a blue visor or face paint covering one eye, giving a futuristic look.
	•	Clothing: Wears a long brown trench coat over a dark outfit, typical of dystopian or cyberpunk themes.
	•	Accessories: Blue gloves and matching boots, reinforcing the neon-punk aesthetic.
	•	Pose & Weapon: The character is crouched in a dynamic stance, holding a futuristic handgun pointed forward, ready for action.


- Enemies:
  - Basic: 
  
  a pixel art zombie character designed in a retro, arcade-like style. Here are the main features:
	•	Skin & Face: The zombie has bright green, decaying skin with exaggerated features, glowing yellow-orange eyes, and an open mouth, giving it a menacing undead look.
	•	Clothing: It wears a torn blue jacket over a dark shirt and ragged purple pants, consistent with the classic zombie trope of a once-human figure now disheveled and ruined.
	•	Pose: The zombie is hunched forward, arms outstretched with claw-like hands, in a classic “shambling” stance that suggests it’s slowly advancing toward the player.
	•	Lighting & Style: Neon green and purple highlights give the sprite a vibrant, eerie glow, enhancing its creepy atmosphere while keeping the retro pixel-art aesthetic.

  - Fast: 
  a pixel art fast zombie enemy, distinct from the shambling type you shared earlier. Here’s a breakdown:
	•	Appearance: The creature still has the signature green decaying skin and glowing orange eyes, but its expression is fiercer, with an open mouth suggesting aggression or a growl.
	•	Clothing: Similar to the basic zombie, it wears a blue jacket and dark red pants, but the overall look is tighter and more streamlined, matching its faster nature.
	•	Pose: Unlike the hunched, slow stance of the basic zombie, this one is in a running position, leaning forward with bent arms and legs, ready to sprint.
	•	Impression: The design conveys speed and urgency — a threatening, high-mobility enemy that likely chases the player quickly rather than staggering toward them.

  - Tank: 

  a pixel art tank zombie, a bulkier and more intimidating enemy compared to the previous ones. Here are its defining traits:
	•	Build & Stance: The zombie is heavily muscular and broad, with an imposing upper body and thick arms. Its stance is hunched yet grounded, showing brute strength rather than speed.
	•	Skin & Face: Green, decayed skin with glowing orange-yellow eyes. Its face is stern and menacing, emphasizing raw power instead of agility.
	•	Clothing: Wears a torn blue shirt (open, showing its chest) and ragged dark red pants. The ripped clothing highlights its oversized physique.
	•	Pose: Arms are bent forward, fists ready, suggesting it’s about to smash or grapple the player rather than run. The posture gives the impression of a heavy-hitting enemy.
	•	Style & Role: The sprite is designed as a “tank” class enemy in games — slow-moving but extremely strong, serving as a high-health threat that demands a different strategy to defeat.
  
- Ranged: Slimmer stance with a forward‑lean/aiming pose. Blue/cyan accents (armband, visor, wrist device). Hands together or one arm extended to suggest firing. Distinct from basic by silhouette (less bulk) and a small “tech” motif; avoid large guns to keep fantasy‑agnostic. Keep muzzle/charge highlight minimal to stay within projectile readability.
- Carrier: Bulky torso with visible sacs/backpack‑like growths on back or sides. Slightly hunched. The sacs should read as “payload” (green/olive hues) without gore. Clearly different from Tank by asymmetry and the rounded growths. Convey “slow, spawns minions on death”.
- Toxic: Heavier build (tank‑adjacent) with bright toxic green highlights (pustules, tubing, chest canister). Avoid skull‑and‑crossbones or text; rely on color and shapes. Keep glow areas small so the silhouette stays sharp. Coordinates with toxic gas VFX color.
- Elite: A little taller than basic with a sharper, more angular silhouette. Add restrained red accents (arm/shoulder bands or subtle glow) to distinguish status. Avoid excessive bulk—looks agile and dangerous rather than heavy. Details should read at 64–96px; keep edges crisp for glow treatment.
- Weapons/VFX:
  - Piercing: cyan core.
  - Inferno/Evolved: orange/red core.
  - Explosions: yellow–orange with small white hot core.
- Icons: flat color or subtle gradient; dark 1–2px outline where needed for small sizes.

## Categories & Requirements

### Enemy Art Style (High‑Level)
- Role by silhouette: Each enemy must be identifiable at a glance by overall shape before color. Use shape language to telegraph behavior:
  - Fast = slim, forward‑leaning.
  - Tank = wide, heavy torso/arms, grounded.
  - Ranged = slimmer, aiming/extended arm pose.
  - Carrier = bulky with asymmetrical growths/sacs.
  - Toxic = tank‑adjacent mass with contained highlight areas.
  - Elite = slightly taller, sharper angles (agile, dangerous).
- Readability at gameplay scale: Designs must read clearly at 64–96 px height; avoid fine interior linework. Favor bold forms and clean negative space.
- Color accents as labels: Use limited accent hues to reinforce type (cyan/blue for ranged, olive/green for carrier, toxic green for toxic, restrained red for elite). Base bodies remain desaturated to prevent clash with pickups/projectiles.
- Minimal glow: Effects should be small and concentrated to keep silhouettes crisp. Any glow must not exceed the size budget or blur the silhouette edges.
- Consistent lighting: Single simple light source; flat or subtle ramp. Avoid noisy texture and heavy gradients.
- No gore or text: Communicate with shapes and color only; keep ratings and localization safe.
- Animation posture: Idle/approach poses should reinforce role (e.g., ranged with steady arm; fast with run‑lean; tank with braced stance).
- Contrast vs background: Ensure edges and accent colors remain legible against both warm/cool backdrops. Add a 1–2 px darker rim where needed.

### Background (category: `background`)
- Use: World backdrop.
- Size cap: ≤ 300 KB (CDN target), current local is larger (optimize when moving to CDN).
- Dimensions: Scalable; design for 1920×1080 and 1024×768. Avoid tiny repeating patterns that shimmer.
- Style: Soft, low‑contrast. Do not compete with gameplay elements. No text.
- Format: WebP preferred.

### Player (category: `player`)
- Use: Top‑down player sprite.
- Size cap: ≤ 32 KB.
- Dimensions: 64–96 px height target at 1×.
- Silhouette: Clear head/torso orientation; readable at a glance.
- Transparency: Clean edges; minimal halo.

### Enemies (category: `enemy`)
- Use: Basic/Tank/Fast plus variants (Ranged/Carrier/Toxic/Elite).
- Size cap: ≤ 32–40 KB (≤ 60 KB for special cases like elite with higher detail).
- Dimensions: 64–128 px height at 1×. Tank > Basic > Fast in visual mass.
- Silhouette: Distinct per type; avoid relying only on color.
- Style: Flat shading or subtle gradients; no harsh noise.

### Projectiles (category: `projectile`)
- Use: Bullets/bolts for weapons and enemies.
- Size cap: ≤ 6–8 KB.
- Dimensions: 16–32 px at 1×.
- Visual: High contrast; crisp edges; center‑aligned. Add tiny glow only if size remains within cap.

### VFX (category: `vfx`)
- Use: Explosions, flashes, impact sprites (single frames preferred; animate via tweens in code).
- Size cap: ≤ 20–30 KB per sprite.
- Dimensions: Context‑appropriate; explosions ~80–160 px radius.
- Visual: Simple shapes and gradients. Avoid multi‑frame sheets unless justified.

### UI & Logo (category: `ui`)
- Use: Title/logo and UI decorations.
- Size cap: Logo ≤ 200 KB (CDN); other UI ≤ 24 KB per element.
- Transparency: Trim padding; no embedded text beyond the logo itself.
- Style: Matches game palette; avoid busy textures.

### Pickups (category: `pickup`)
- Use: Health, XP, Damage, Speed, Bomb, Blueprint Drop.
- Size cap: ≤ 8 KB each.
- Dimensions: 32–48 px box at 1×.
- Visual: Iconic, readable shapes; transparent background.

### Relic Icons (category: `relic_icon`)
- Use: Permanent run modifiers.
- Size cap: ≤ 8–12 KB.
- Dimensions: 48×48 px (1×). Provide 96×96 only if still ≤ 12 KB.
- Visual: Flat/simple; bold silhouette. Examples:
  - greed: coin/laurel; celerity: wing/boot; arsenal: crossed blades; warp_coils: coils; vitality: heart/shield; sharpshooter: reticle; overclock: gauge/lightning.

### Upgrade Icons (category: `upgrade_icon`)
- Use: Level‑up options.
- Size cap: ≤ 8 KB.
- Dimensions: 48×48 px (1×).
- Visual: Mirror relic icon style; distinct motif per upgrade (piercing, explosive, projectile speed, weapon damage/speed, movement speed, health).

### Fonts (type: `font`) — future
- Prefer web fonts hosted on CDN or bitmap fonts with tight atlases. Keep total font payload minimal (< 100 KB if used).

### Audio (type: `audio`) — future
- Short SFX: < 50 KB each (Ogg/MP3). Looping music kept separate and streamed if possible.

## Export & Delivery

- WebP quality: Start ~70–80; adjust to meet caps and visual fidelity. PNG when alpha fringing appears.
- Strip metadata and color profiles; avoid EXIF.
- Filenames: `category/name.webp` (e.g., `icons/relic_greed.webp`).
- Update `public/content.manifest.json` with `status: "present"` when the asset is delivered, and set a realistic `sizeKB` cap.
- When moving to CDN, keep `cdnBaseUrl` in the manifest and retain relative `urls` so code paths don’t change.

## QA Checklist (Per Asset)

- [ ] Within size cap for its category
- [ ] Readable at gameplay scale (check 1× and 0.75×)
- [ ] Clean alpha edges (no matte halos)
- [ ] Centered/aligned for rotations/tweens
- [ ] Matches palette and style
- [ ] Manifest updated: id, urls, status, description, guidelines

## Don’ts

- Don’t embed text labels (localization, scaling issues).
- Don’t exceed caps to “fix later.” Rework shape, contrast, or simplify.
- Don’t ship assets that rely on fine details only visible at 2×+ scale.

## Notes

- For anything animated, prefer code‑driven tweens and particle systems over frame sequences.
- If an asset’s visual identity conflicts with gameplay readability, gameplay wins — increase contrast and simplify.
