declare interface ImportMetaEnv {
  readonly VITE_ASSET_MANIFEST_URL?: string;
  readonly VITE_ONCADE_API_KEY?: string;
  readonly VITE_ONCADE_GAME_ID?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace Phaser {
  interface Game {
    __onResize?: (this: Window, ev: UIEvent) => any;
  }
}


