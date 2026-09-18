/**
 * The runtime art: what the textures are called, and what each tile index in
 * the tileset means.
 *
 * These were exported from src/art/placeholders.ts while the art was generated
 * at boot. The art is now sliced from the concept sheet by scripts/slice-art.mjs
 * into public/art/, so this module is just the contract between that slicer,
 * BootScene, and the level.
 *
 * The `ph-` prefix went with the placeholders — it meant "placeholder", and it
 * would have been a lie.
 */
export const TEX = {
  hero: 'hero',
  /**
   * A 4-cell strip, each cell TILE_W x TILE_H. Loaded as a spritesheet rather
   * than an image because the one-way ledge addresses it BY FRAME, and a plain
   * image registers no frames — Phaser then logs "has no frame" and silently
   * draws the whole strip.
   */
  tiles: 'tiles',
} as const;

/**
 * Which cell of the tileset each kind of terrain uses.
 *
 * A cell is a collision tile: TILE_W x TILE_H, which is a 2x3 group of the
 * art's bricks (see config/game.ts). The composition lives in the ASSET, not
 * here — slice-art.mjs bakes the bricks into each cell — so this is only about
 * which baked cell to ask for.
 *
 * SURFACE and INTERIOR exist as separate indices because one index can only
 * have one appearance. Without the split, every ground row shows a snow cap,
 * because the whole floor is the same tile. buildLevel derives which is which
 * from the level data itself; a level author writes '#' and gets a snow cap
 * only where the sky is above it.
 *
 * ICE is the same idea for the slippery surface: it is the one cell whose top
 * brick carries no snow, which is exactly how the player can see the mechanic
 * before stepping on it.
 */
export const TILE_INDEX = {
  INTERIOR: 0, // plain ice, for a solid cell with a solid cell above it
  SURFACE: 1, // snow-capped, for the top row of a solid mass
  ONEWAY: 2, // a single brick row at the top of the cell; the rest is empty
  ICE: 3, // the slippery surface — no snow cap
} as const;
