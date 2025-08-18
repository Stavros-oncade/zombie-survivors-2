import { Scene } from 'phaser';
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

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
        });

        // Load game assets
        this.load.image('player', 'assets/player.png');
        this.load.image('enemy', 'assets/zombie.png');
        this.load.image('enemy_tank', 'assets/tank.png');
        this.load.image('enemy_fast', 'assets/enemy_fast.png');
        // Optional ranged enemy sprite
        // this.load.image('enemy_ranged', 'assets/enemy_ranged.png');
        // Optional carrier enemy sprite
        // this.load.image('enemy_carrier', 'assets/enemy_carrier.png');
        // Toxic tank uses tank sprite; optional: distinct toxic sprite
        // this.load.image('enemy_toxic', 'assets/enemy_toxic.png');
        this.load.image('projectile', 'assets/plasma_bullet.png');
        this.load.image('logo', 'assets/title.png');
        this.load.image('pickup_health', 'assets/pickup_health.png');
        this.load.image('pickup_xp', 'assets/pickup_xp.png');
        this.load.image('pickup_dmg', 'assets/pickup_dmg.png');
        this.load.image('pickup_bomb', 'assets/pickup_bomb.png');
        this.load.image('pickup_speed', 'assets/pickup_speed.png');

        // Optional new assets (provide these files to improve visuals):
        // Weapons / VFX
        // this.load.image('proj_piercing', 'assets/proj_piercing.png');
        // this.load.image('proj_inferno', 'assets/proj_inferno.png');
        // this.load.image('explosion_small', 'assets/explosion_small.png');
        // Enemies
        // this.load.image('enemy_elite', 'assets/enemy_elite.png');
        // Relic icons
        // this.load.image('relic_greed', 'assets/relic_greed.png');
        // this.load.image('relic_celerity', 'assets/relic_celerity.png');
        // this.load.image('relic_arsenal', 'assets/relic_arsenal.png');
        // this.load.image('relic_warp_coils', 'assets/relic_warp_coils.png');
        // this.load.image('relic_vitality', 'assets/relic_vitality.png');
        // this.load.image('relic_sharpshooter', 'assets/relic_sharpshooter.png');
        // this.load.image('relic_overclock', 'assets/relic_overclock.png');
        // Upgrade icons
        // this.load.image('upgrade_piercing', 'assets/upgrade_piercing.png');
        // this.load.image('upgrade_explosive', 'assets/upgrade_explosive.png');
        // this.load.image('upgrade_projectile', 'assets/upgrade_projectile.png');
        // this.load.image('upgrade_weapon_damage', 'assets/upgrade_weapon_damage.png');
        // this.load.image('upgrade_weapon_speed', 'assets/upgrade_weapon_speed.png');
        // this.load.image('upgrade_speed', 'assets/upgrade_speed.png');
        // this.load.image('upgrade_health', 'assets/upgrade_health.png');
    }

    create ()
    {
        //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
        //  For example, you can define global animations here, so we can use them in other scenes.

        //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
        // Generate placeholder textures for any missing icons so the UI can still render
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
