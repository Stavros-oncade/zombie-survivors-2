/**
 * Utility functions for handling images in the game
 */

/**
 * Creates a sprite with a constrained size
 * @param scene The Phaser scene
 * @param x The x position
 * @param y The y position
 * @param texture The texture key
 * @param width The desired width
 * @param height The desired height
 * @returns The created sprite with constrained size
 */
export function createConstrainedSprite(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    width: number,
    height: number
): Phaser.GameObjects.Sprite {
    const sprite = scene.add.sprite(x, y, texture);
    sprite.setDisplaySize(width, height);
    return sprite;
} 