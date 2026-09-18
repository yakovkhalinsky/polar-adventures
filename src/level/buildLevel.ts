import Phaser from 'phaser';
import { TEX, TILE_INDEX } from '../art/tileset';
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

  // ---- autotile -----------------------------------------------------------
  // '#' means "solid", but a solid cell has two appearances: snow-capped where
  // the sky is above it, plain fill where it is buried. Deriving that from the
  // rows rather than asking the level author to write two characters keeps the
  // level readable and keeps the rule in the one file that knows the format.
  //
  // Read from `src.rows`, NOT from `data`: by the time this runs `data` holds
  // the already-rewritten indices, and testing those would make the pass
  // depend on the order it walks the grid.
  //
  // Only SURFACE is remapped. Ice has no buried variant because it is authored
  // as a surface — the level puts '~' on the top row and rock underneath — and
  // a buried ice cell has to keep index ICE anyway, since that index is what
  // `surfaceAt` reads to decide the hero is on something slippery. Its art and
  // its physics are the same decision.
  const solidChar = (ch: string) => ch === '#' || ch === '~';
  const covered = (x: number, y: number) => y > 0 && solidChar(src.rows[y - 1][x]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y][x] === TILE_INDEX.SURFACE && covered(x, y)) {
        data[y][x] = TILE_INDEX.INTERIOR;
      }
    }
  }

  // ---- tilemap -----------------------------------------------------------
  // The creator (not the factory) accepts a raw 2-D array of tile indices.
  const map = scene.make.tilemap({
    data,
    tileWidth: src.tileWidth,
    tileHeight: src.tileHeight,
  });

  // The map is ARRAY_2D, not TILED_JSON, so there is no gid offset to match:
  // tile index 0 is the first cell of the texture, index 1 the second, and so
  // on — no 1-based offset the way Tiled maps have. (Tiled maps are 1-based,
  // which is why Tiled tutorials use setCollision([1,2,3]).)
  const tileset = map.addTilesetImage(
    'tiles',
    TEX.tiles,
    src.tileWidth,
    src.tileHeight,
  );
  if (!tileset) throw new Error('tileset failed to attach');

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
  // EVERY SOLID INDEX MUST BE LISTED. setCollision is a whitelist by index, not
  // "make everything solid" — a tile index left out has all four collide flags
  // false, so the hero falls straight through it and `blocked.down` never
  // becomes true there, which silently makes the surface undetectable rather
  // than merely non-solid.
  //
  // INTERIOR is the dangerous one to forget. It used to be that the bulk of the
  // ground was SURFACE; now the autotile pass above turns every buried cell into
  // INTERIOR, so leaving it out drops the hero through most of the floor while
  // the top row still looks solid.
  layer.setCollision([
    TILE_INDEX.INTERIOR,
    TILE_INDEX.SURFACE,
    TILE_INDEX.ICE,
  ]);

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
        // no chance of catching on the seam between two adjacent ledges.
        const len = x - runStart;
        const runWidth = len * src.tileWidth;

        // A TileSprite, not a plain sprite with setDisplaySize. The ledge art
        // is one brick row wide, so stretching it across a run would stretch
        // the bricks with it — a 6-cell run would be laid in 210px bricks
        // against the ground's 35px ones. A TileSprite repeats the cell at 1:1,
        // which is also why it is the full cell height: with the texture's own
        // height matching, it tiles horizontally only.
        //
        // The body stays full cell height with its top on the cell boundary, so
        // the landing surface and the one-way idiom below are unchanged. The
        // art occupies only the top brick row; the rest of the cell is
        // transparent and, being one-way, is never touched anyway.
        const plat = scene.add.tileSprite(
          (runStart + len / 2) * src.tileWidth,
          y * src.tileHeight + src.tileHeight / 2,
          runWidth,
          src.tileHeight,
          TEX.tiles,
          TILE_INDEX.ONEWAY,
        );
        // Adding to a StaticGroup enables a static body on the child, so this
        // is what creates the body — do not also call physics.add.existing.
        //
        // No refreshBody() here, unlike the sprite this replaced. That call
        // existed because the body was created at 70x66 and then the sprite was
        // resized to the run's width. This TileSprite is CONSTRUCTED at its
        // final size, so the body is already right. (It also has no
        // refreshBody to call: that lives on the Arcade sprite components, not
        // on every GameObject, and a TileSprite is not one.)
        oneWayGroup.add(plat);

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
    // The BOTTOM-CENTRE of the spawn tile — i.e. where the hero's feet go, not
    // its middle. That distinction never mattered while the hero was exactly
    // one tile tall, so `(row + 0.5)` put the feet on the ground for free. With
    // a 124px hero in a 66px tile it spawns buried, and tilemap separation
    // pushes it the wrong way — through the floor — instead of out.
    spawn: new Phaser.Math.Vector2(
      (foundSpawn.x + 0.5) * src.tileWidth,
      (foundSpawn.y + 1) * src.tileHeight,
    ),
    surfaceAt,
  };
}
