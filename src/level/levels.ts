import { TILE_INDEX } from '../art/placeholders';

export type LevelSource = {
  name: string;
  tileWidth: number;
  tileHeight: number;
  legend: Record<string, number>;
  rows: string[];
};

/**
 * Milestone 1 level. 48 x 16 tiles of 32px = 1536 x 512 world pixels,
 * about 3.2 screens wide and 1.9 screens tall at 480x270.
 *
 * Legend:
 *   .  empty          #  solid          =  one-way platform
 *   P  player spawn
 *
 * Height budget, from the constants in config/movement.ts:
 *   jump apex  3.5 tiles  -> a 3-tile ledge is comfortable, a 4-tile one is impossible
 *   min hop    1.2 tiles  -> the tap-to-hold expressive range
 *   gap reach  3.55 tiles at full run, flat
 *
 * Every feature below tests exactly one thing. See the comments on each row.
 */
export const LEVEL_01: LevelSource = {
  name: 'feel-test-01',
  tileWidth: 32,
  tileHeight: 32,
  legend: {
    '.': -1, // -1 is how Phaser's Parse2DArray marks an empty cell
    '#': TILE_INDEX.SOLID,
    // One-way cells render and collide via the static platform group, NOT the
    // tilemap layer, so they are empty here. Drawing them in both places would
    // double-render them at two different sizes.
    '=': -1,
    P: -1,
  },
  rows: [
    '................................................', //  0
    '................................................', //  1
    '................................................', //  2
    '................................................', //  3
    '................................................', //  4
    '................................................', //  5
    '................................................', //  6
    '................................................', //  7
    '................................................', //  8
    '.....##.........................................', //  9  low ceiling (bonk test)
    '....................=====.......................', // 10  one-way, 3 tiles up
    '.....##.......................#########.....====', // 11  plateau + one-way
    '..P.........................###########.........', // 12  spawn + step-up
    '##########..###########################...######', // 13  pits
    '##########..###########################...######', // 14
    '##########..###########################...######', // 15
  ],
};
