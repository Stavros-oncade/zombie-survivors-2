import { Cameras, Scene } from 'phaser';

// Reusable scene-transition helpers. Every scene change in the game used to be a
// bare scene.start() instant cut; these two functions give a symmetric camera
// fade instead. transitionTo() fades the CURRENT camera out to a color and then
// swaps scenes; the destination scene calls fadeIn() at the top of create() to
// fade back from the SAME color. Matching colors makes the hand-off seamless.
//
// Assets are all loaded upfront in the Preloader, so these fades are not hiding a
// download — they exist purely to soften the cut (and, into the Game scene, to
// mask the synchronous create() hitch). Keep durations short.

export interface TransitionOpts {
  /** Fade color as 0xRRGGBB. Defaults to black. */
  color?: number;
  /** Fade duration in ms. Defaults to 300. */
  duration?: number;
}

// On-brand fade colors.
export const FADE_BLACK = 0x000000;
export const FADE_NIGHT = 0x0a0d14; // = GameConfig.FOG.SHROUD_COLOR — deploying into the dark city.

const DEFAULT_DURATION = 300;

// Guard against a second transition firing from the same scene mid-fade (e.g. a
// keypress landing on the same frame as a button tap). Phaser reuses scene
// instances across start(), so the entry is cleared the moment the fade finishes.
const exiting = new WeakSet<Scene>();

function rgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** Fade `scene`'s camera out to `color`, then start `key` (passing `data`). */
export function transitionTo(scene: Scene, key: string, data?: object, opts: TransitionOpts = {}): void {
  if (exiting.has(scene)) return;
  exiting.add(scene);
  const { color = FADE_BLACK, duration = DEFAULT_DURATION } = opts;
  const [r, g, b] = rgb(color);
  const cam = scene.cameras.main;
  cam.once(Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    exiting.delete(scene);
    scene.scene.start(key, data);
  });
  cam.fadeOut(duration, r, g, b);
}

/** Fade `scene`'s camera IN from `color`. Call at the top of create(). */
export function fadeIn(scene: Scene, opts: TransitionOpts = {}): void {
  const { color = FADE_BLACK, duration = DEFAULT_DURATION } = opts;
  const [r, g, b] = rgb(color);
  scene.cameras.main.fadeIn(duration, r, g, b);
}
