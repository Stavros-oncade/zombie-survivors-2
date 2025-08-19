import { Scene } from 'phaser';

interface AssetManifestEntry { id: string; type: string; status: string; urls?: { webp?: string; png?: string } }
interface AssetManifest { cdnBaseUrl?: string; entries?: AssetManifestEntry[] }
import { SceneKey } from '../config/SceneKeys';

export class Preloader extends Scene
{
    constructor ()
    {
        super(SceneKey.Preloader);
    }

    init ()
    {
        //  We loaded this image in our Boot Scene, so we can display it here
        this.add.image(512, 384, 'background');

        //  A simple progress bar. This is the outline of the bar.
        this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

        //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
        const bar = this.add.rectangle(512-230, 384, 4, 28, 0xffffff);

        //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
        this.load.on('progress', (progress: number) => {

            //  Update the progress bar (our bar is 464px wide, so 100% = 464px)
            bar.width = 4 + (460 * progress);

        });
    }

    preload ()
    {
        // Create loading bar
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
            font: '20px monospace',
            color: '#ffffff'
        });
        loadingText.setOrigin(0.5, 0.5);

        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

        // Loading progress events
        this.load.on('progress', (value: number) => {
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
        });

        // Phase 1: queue manifest only
        const manifestUrl = import.meta.env.VITE_ASSET_MANIFEST_URL || '/content.manifest.json';
        this.load.json('asset_manifest', manifestUrl);

        // When the manifest file completes, enqueue its assets into the same load cycle
        this.load.once('filecomplete-json-asset_manifest', () => {
            try {
                const manifest = this.cache.json.get('asset_manifest') as AssetManifest | undefined;
                const base = (manifest?.cdnBaseUrl || '').replace(/\/+$/, '');
                if (manifest && Array.isArray(manifest.entries)) {
                    (manifest.entries as AssetManifestEntry[]).forEach((e) => {
                        if (e.status !== 'present') return;
                        if (e.type === 'image' && e.urls) {
                            const path = e.urls.webp || e.urls.png;
                            if (!path) return;
                            const url = base ? `${base}/${path}` : path;
                            this.load.image(e.id, url);
                        }
                    });
                } else {
                    this.enqueueDefaultLocalAssets();
                }
            } catch (err) {
                console.warn('[Preloader] Failed to process manifest; falling back to local assets', err);
                this.enqueueDefaultLocalAssets();
            }
        });

        // Destroy progress UI when the full queue completes
        this.load.once('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
        });
    }

    private enqueueDefaultLocalAssets(): void {
        this.load.image('player', 'assets/player.png');
        this.load.image('enemy', 'assets/zombie.png');
        this.load.image('enemy_tank', 'assets/tank.png');
        this.load.image('enemy_fast', 'assets/enemy_fast.png');
        this.load.image('projectile', 'assets/plasma_bullet.png');
        this.load.image('logo', 'assets/title.png');
        this.load.image('pickup_health', 'assets/pickup_health.png');
        this.load.image('pickup_xp', 'assets/pickup_xp.png');
        this.load.image('pickup_dmg', 'assets/pickup_dmg.png');
        this.load.image('pickup_bomb', 'assets/pickup_bomb.png');
        this.load.image('pickup_speed', 'assets/pickup_speed.png');
    }

    create ()
    {
        //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
        //  For example, you can define global animations here, so we can use them in other scenes.

        //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
        // Generate placeholder textures so the UI and enemies can still render
        const ensureIcon = (key: string, color: number) => {
            if (this.textures.exists(key)) return;
            const g = this.add.graphics();
            g.fillStyle(color, 1);
            g.fillRoundedRect(0, 0, 48, 48, 6);
            g.generateTexture(key, 48, 48);
            g.destroy();
        };
        [
            ['relic_greed', 0xdaa520],
            ['relic_celerity', 0x00ffaa],
            ['relic_arsenal', 0xff4444],
            ['relic_warp_coils', 0x66ccff],
            ['relic_vitality', 0xff77aa],
            ['relic_sharpshooter', 0xffaa33],
            ['relic_overclock', 0xaa66ff],
            ['upgrade_piercing', 0x66ccff],
            ['upgrade_explosive', 0xff8844],
            ['upgrade_projectile', 0x66ccff],
            ['upgrade_weapon_damage', 0xff4444],
            ['upgrade_weapon_speed', 0xaa66ff],
            ['upgrade_speed', 0x00ffaa],
            ['upgrade_health', 0xff77aa]
        ].forEach(([k, c]) => ensureIcon(k as string, c as number));

        // Blueprint drop placeholder
        ensureIcon('blueprint_drop', 0x00bcd4);

        this.scene.start(SceneKey.MainMenu);
    }
}
        // Blueprint drop icon
        // this.load.image('blueprint_drop', 'assets/blueprint_drop.png');
