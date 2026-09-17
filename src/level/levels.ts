import { TILE_INDEX } from '../art/placeholders';

export type LevelSource = {
  name: string;
  tileWidth: number;
  tileHeight: number;
  legend: Record<string, number>;
  rows: string[];
};

/**
 * Milestone 1 level, rescaled to the assets' native pixel scale.
 * 64 x 24 tiles of 70x67 = 4480 x 1608 world pixels, about 36 x 13
 * hero-heights — close to the 48 x 16 the old 32px-tile level covered.
 *
 * Legend:
 *   .  empty          #  solid          =  one-way platform
 *   ~  ice            P  player spawn
 *
 * Height budget, from the constants in config/movement.ts. These are quoted in
 * COLLISION TILES (67px) because that is what the rows below are counted in,
 * but the design targets are in HERO HEIGHTS (124px), since that is what the
 * hero actually is:
 *   jump apex  3.5 hero-heights = 6.5 tiles -> a 6-tile ledge is comfortable,
 *                                              a 9-tile one is impossible
 *   min hop    1.2 hero-heights = 2.3 tiles -> the tap-to-hold range
 *   gap reach  6.6 tiles at full run, flat
 *
 * Every feature below tests exactly one thing, and each is sized against those
 * numbers rather than against the old level's tile counts — a "3 tile ledge"
 * meant 3 hero-heights when the hero was one tile tall, and means 1.6 now.
 */
export const LEVEL_01: LevelSource = {
  name: 'feel-test-01',
  tileWidth: 70,
  tileHeight: 67,
  legend: {
    '.': -1, // -1 is how Phaser's Parse2DArray marks an empty cell
    '#': TILE_INDEX.SOLID,
    '~': TILE_INDEX.ICE,
    // One-way cells render and collide via the static platform group, NOT the
    // tilemap layer, so they are empty here. Drawing them in both places would
    // double-render them at two different sizes.
    '=': -1,
    P: -1,
  },
  rows: [
    '................................................................', //  0
    '................................................................', //  1
    '................................................................', //  2
    '................................................................', //  3
    '................................................................', //  4
    '................................................................', //  5
    '................................................................', //  6
    '................................................................', //  7
    '................................................................', //  8
    '................................................................', //  9
    '................................................................', // 10
    '..........................................................######', // 11  out of reach (bonk test)
    '..........................................................######', // 12
    '..........................................................######', // 13
    '............................#######...............======..######', // 14  plateau top + one-way
    '............................#######.......................######', // 15
    '............................#######.....======............######', // 16  one-way, 4 tiles up
    '....####....................#######.......................######', // 17  low ceiling (bonk test)
    '............................#######.......................######', // 18
    '..P.........................#######.......................######', // 19  spawn
    // Ice at the SURFACE only (row 20), cols 16-27, sitting on rock below.
    // Placed after the pit so the rock-friction check still runs on rock, and
    // clear of the plateau wall (col 28) so a slide is never cut short.
    '##########....##~~~~~~~~~~~~####################################', // 20  pits + ice
    '##########....##################################################', // 21
    '##########....##################################################', // 22
    '##########....##################################################', // 23
  ],
};
