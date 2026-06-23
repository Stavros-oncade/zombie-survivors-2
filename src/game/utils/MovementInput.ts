// Shared movement-input reader. Both the combat Player and the camp CampPlayer
// consume this so their controls can never silently drift apart (e.g. if the
// player movement is later customized). Pure input → normalized direction; no
// Phaser scene state is touched.

/**
 * Read the current movement intent from keyboard (cursors + WASD) and an optional
 * virtual-joystick touch pair, returning a normalized direction vector. A zero
 * vector means "no input this frame".
 */
export function readMovementDirection(
    cursors?: Phaser.Types.Input.Keyboard.CursorKeys,
    wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key },
    initialTouchPoint?: Phaser.Math.Vector2 | null,
    currentTouchPoint?: Phaser.Math.Vector2 | null
): Phaser.Math.Vector2 {
    const direction = new Phaser.Math.Vector2(0, 0);

    // Handle keyboard input (arrow keys)
    if (cursors) {
        if (cursors.left && cursors.left.isDown) {
            direction.x = -1;
        } else if (cursors.right && cursors.right.isDown) {
            direction.x = 1;
        }
        if (cursors.up && cursors.up.isDown) {
            direction.y = -1;
        } else if (cursors.down && cursors.down.isDown) {
            direction.y = 1;
        }
    }

    // WASD overrides/augments the arrow keys (matches original Player behavior).
    if (wasdKeys) {
        if (wasdKeys.left && wasdKeys.left.isDown) {
            direction.x = -1;
        } else if (wasdKeys.right && wasdKeys.right.isDown) {
            direction.x = 1;
        }
        if (wasdKeys.up && wasdKeys.up.isDown) {
            direction.y = -1;
        } else if (wasdKeys.down && wasdKeys.down.isDown) {
            direction.y = 1;
        }
    }

    // Handle touch input (virtual joystick): vector from initial touch to current.
    if (initialTouchPoint && currentTouchPoint) {
        const touchDirection = new Phaser.Math.Vector2(
            currentTouchPoint.x - initialTouchPoint.x,
            currentTouchPoint.y - initialTouchPoint.y
        );
        touchDirection.normalize();
        direction.add(touchDirection);
    }

    direction.normalize();
    return direction;
}
