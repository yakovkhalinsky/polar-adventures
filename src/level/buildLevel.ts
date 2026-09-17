import Phaser from 'phaser';
import { TILE_SIZE } from '../config/game';
import { TEX, TILE_INDEX } from '../art/placeholders';
import type { Surface } from '../config/movement';
import type { LevelSource } from './levels';

export type BuiltLevel = {
  map: Phaser.Tilemaps.Tilemap;
  solidLayer: Phaser.Tilemaps.TilemapLayer;
  oneWayGroup: Phaser.Physics.Arcade.StaticGroup;
  spawn: Phaser.Math.Vector2;
  /**
   * What is under a world point. This lives on the built level rather than on
   * the hero so that the tile-index -> surface mapping stays in the one file
   * that knows the level format; the hero never holds a TilemapLayer.
   */
  surfaceAt: (worldX: number, worldY: number) => Surface;
};

/**
 * Turns the hand-authored ASCII level into a tilemap plus a one-way platform
 * group.
 *
 * This is the ONLY file that knows the level format. Swapping in Tiled JSON
 * later means changing this file and deleting levels.ts — the scene only ever
 * sees the BuiltLevel shape.
 */
export function buildLevel(
  scene: Phaser.Scene,
  src: LevelSource,
): BuiltLevel {
  const width = src.rows[0].length;
  const height = src.rows.length;

  let spawnTile: { x: number; y: number } | null = null;
  const oneWay: boolean[][] = [];

  // ---- validate and convert ---------------------------------------------
  // Hand-authored ASCII has no compiler. A row typo'd to 47 characters would
  // otherwise produce a map with a silently ragged right edge, which reads as
  // a mysterious hole in the geometry much later. This check is worth more
  // than the rest of the file.
  const data: number[][] = src.rows.map((row, y) => {
    if (row.length !== width) {
      throw new Error(
        `Level "${src.name}" row ${y} is ${row.length} chars, expected ${width}`,
      );
    }

    oneWay[y] = [];

    return [...row].map((ch, x) => {
      const value = src.legend[ch];
      if (value === undefined) {
        throw new Error(
          `Level "${src.name}" row ${y} col ${x}: unknown char "${ch}"`,
        );
      }
      oneWay[y][x] = ch === '=';
      if (ch === 'P') spawnTile = { x, y };
      return value;
    });
  });

  const foundSpawn = spawnTile as { x: number; y: number } | null;
  if (!foundSpawn) throw new Error(`Level "${src.name}" has no 'P' spawn`);

  // ---- tilemap -----------------------------------------------------------
  // The creator (not the factory) accepts a raw 2-D array of tile indices.
  const map = scene.make.tilemap({
    data,
    tileWidth: src.tileWidth,
    tileHeight: src.tileHeight,
  });

  // The map is ARRAY_2D, not TILED_JSON, so there is no gid offset to match:
  // tile index 0 is the first 32x32 cell of the texture, index 1 the second,
  // and so on. (Tiled maps are 1-based, which is why Tiled tutorials use
  // setCollision([1,2,3]).)
  const tileset = map.addTilesetImage(
    'placeholder',
    TEX.tiles,
    TILE_SIZE,
    TILE_SIZE,
  );
  if (!tileset) throw new Error('placeholder tileset failed to attach');

  const created = map.createLayer(0, tileset);
  if (!created) throw new Error('createLayer(0) returned null');

  // Phaser 4 types createLayer as returning TilemapLayer | TilemapGPULayer.
  // The GPU variant is opt-in (the `gpu` argument defaults to false) and is a
  // SIBLING class rather than a subclass, so this narrowing is exact. The
  // guard exists so that a future change to the default fails loudly here,
  // rather than silently handing back a layer whose per-tile collision flags
  // behave differently.
  if (!(created instanceof Phaser.Tilemaps.TilemapLayer)) {
    throw new Error('expected a CPU TilemapLayer, got a GPU-accelerated layer');
  }
  const layer = created;

  // Solids collide on all four faces. Applied before anything else, because
  // setCollision sets all four flags and would clobber a one-way override.
  //
  // ICE MUST BE LISTED HERE. setCollision is a whitelist by index, not "make
  // everything solid" — a tile index left out has all four collide flags false,
  // so the hero falls straight through it and `blocked.down` never becomes true
  // there, which silently makes the surface undetectable rather than merely
  // non-solid.
  layer.setCollision([TILE_INDEX.SOLID, TILE_INDEX.ICE]);

  // ---- one-way platforms -------------------------------------------------
  // Deliberately kept OUT of the tilemap. Tile-level one-way does work, but it
  // depends on call ordering (a later layer-wide setCollision wipes it) and
  // cannot represent a moving platform at all, which is the next thing that
  // will want this behaviour. As standalone static bodies the mechanism is
  // explicit and robust.
  const oneWayGroup = scene.physics.add.staticGroup();

  for (let y = 0; y < height; y++) {
    let runStart = -1;
    // <= width so a run reaching the right edge still flushes
    for (let x = 0; x <= width; x++) {
      const isOneWay = x < width && oneWay[y][x];

      if (isOneWay && runStart === -1) {
        runStart = x;
      } else if (!isOneWay && runStart !== -1) {
        // Collapse a horizontal run into ONE stretched body: fewer bodies, and
        // no chance of catching on the seam between two adjacent planks.
        const len = x - runStart;
        const plat = oneWayGroup.create(
          (runStart + len / 2) * TILE_SIZE,
          y * TILE_SIZE + TILE_SIZE / 2,
          TEX.tiles,
          TILE_INDEX.ONEWAY,
        );

        plat.setDisplaySize(len * TILE_SIZE, TILE_SIZE);
        // A static body caches its size at creation, so it must be refreshed
        // after a display-size change or it keeps the original 32x32.
        plat.refreshBody();

        // THE one-way idiom. GetOverlapY gates "land on top" on
        // (body.checkCollision.down && plat.checkCollision.up), and gates
        // "pass through from below" on (body.checkCollision.up &&
        // plat.checkCollision.down). Killing down/left/right and leaving up
        // true is therefore a complete and exact one-way platform.
        //
        // The common forum answer — a processCallback testing
        // `player.body.velocity.y > 0` — has a real bug: at the apex of a jump
        // velocity.y is exactly 0, so the test fails for one frame and you can
        // clip straight through a thin platform.
        const pb = plat.body as Phaser.Physics.Arcade.StaticBody;
        pb.checkCollision.down = false;
        pb.checkCollision.left = false;
        pb.checkCollision.right = false;

        runStart = -1;
      }
    }
  }

  // ---- surface probe -----------------------------------------------------
  /**
   * `nonNull = true` matters: for an in-bounds blank cell getTileAt returns
   * null by default and the Tile object (with `index === -1`) only when asked.
   * Passing it collapses "blank cell" and "nothing there" into one `index`
   * test instead of a null-guard plus a comparison.
   */
  const surfaceAt = (worldX: number, worldY: number): Surface => {
    const tile = layer.getTileAt(
      layer.worldToTileX(worldX),
      layer.worldToTileY(worldY),
      true,
    );
    return tile && tile.index === TILE_INDEX.ICE ? 'ice' : 'rock';
  };

  return {
    map,
    solidLayer: layer,
    oneWayGroup,
    spawn: new Phaser.Math.Vector2(
      (foundSpawn.x + 0.5) * TILE_SIZE,
      (foundSpawn.y + 0.5) * TILE_SIZE,
    ),
    surfaceAt,
  };
}
