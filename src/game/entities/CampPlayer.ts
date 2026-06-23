import { GameConstants } from '../config/GameConstants';
import { readMovementDirection } from '../utils/MovementInput';

// The player avatar inside the Survivor Camp plaza. Deliberately decoupled from
// the combat Player (no ExperienceSystem, no health/damage/death) — the camp is a
// safe hub. Movement intent is read via the SAME readMovementDirection() helper the
// combat Player uses, so the two control schemes can never drift apart.
export class CampPlayer extends Phaser.Physics.Arcade.Sprite {
    private walkSpeed: number = GameConstants.PLAYER.MOVEMENT_SPEED;
    // Stripped-down dash: a brief velocity burst with NO cooldown (spammable).
    private static readonly DASH_SPEED = 600;
    private static readonly DASH_DURATION_MS = 140;
    private dashUntil: number = 0;
    private dashDir: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, -1);
    // Last non-zero facing, so an idle dash still goes somewhere sensible.
    private lastDir: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, -1);

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 'player');
    }

    /** Add to the scene + physics world and size the body (mirrors Player.enablePhysics). */
    public spawn(): this {
        this.scene.add.existing(this);
        this.scene.physics.add.existing(this);
        this.setScale(0.5);
        this.setCollideWorldBounds(true);
        const scaleFactor = 0.5;
        if (this.body instanceof Phaser.Physics.Arcade.Body) {
            this.body.setSize(
                this.texture.source[0].width * scaleFactor,
                this.texture.source[0].height * scaleFactor
            );
        }
        return this;
    }

    /** Trigger a dash in the current movement direction (or last facing if idle). */
    public dash(): void {
        const now = this.scene.time.now;
        this.dashUntil = now + CampPlayer.DASH_DURATION_MS;
        this.dashDir.copy(this.lastDir);
    }

    public update(
        cursors?: Phaser.Types.Input.Keyboard.CursorKeys,
        wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key },
        initialTouchPoint?: Phaser.Math.Vector2 | null,
        currentTouchPoint?: Phaser.Math.Vector2 | null
    ): void {
        const dir = readMovementDirection(cursors, wasdKeys, initialTouchPoint, currentTouchPoint);
        if (dir.lengthSq() > 0) {
            this.lastDir.copy(dir);
        }

        const now = this.scene.time.now;
        if (now < this.dashUntil) {
            // Dash overrides normal walk velocity for its short window.
            this.setVelocity(this.dashDir.x * CampPlayer.DASH_SPEED, this.dashDir.y * CampPlayer.DASH_SPEED);
            if (this.dashDir.x !== 0) this.setFlipX(this.dashDir.x < 0);
        } else {
            this.setVelocity(dir.x * this.walkSpeed, dir.y * this.walkSpeed);
            if (dir.x !== 0) this.setFlipX(dir.x < 0);
        }
    }
}
