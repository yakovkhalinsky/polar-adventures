import Phaser from 'phaser';
import { TILE_W, TILE_H } from '../config/game';

export const TEX = {
  hero: 'ph-hero',
  tiles: 'ph-tiles',
} as const;

/**
 * Tile indices into the placeholder tileset. When the sliced concept art
 * lands, these values change and nothing else does.
 */
export const TILE_INDEX = {
  INTERIOR: 0, // plain rock fill
  SOLID: 1,
  ONEWAY: 2,
  ICE: 3, // reserved for the first real mechanic
} as const;

/**
 * Taken from assets/concepts/ASSET-LOG.md so the placeholder already reads
 * against the real art direction. The green scarf is not decoration: it exists
 * to break the white-on-white silhouette against snow, and it belongs in the
 * placeholder for exactly the same reason it is in the concept art.
 */
const PAL = {
  furHi: '#F2F5F8',
  furLo: '#9FB3C8',
  // Limbs. A value step below furLo so the legs read as separate masses —
  // otherwise they sit directly under the same-coloured torso shading and the
  // lower half becomes one undifferentiated block.
  furDeep: '#8395AA',
  // The snout. DARK, like the concept art's — an earlier version drew it in
  // furLo, which read as a pale smudge rather than a muzzle.
  muzzle: '#6E7A8B',
  eye: '#1B2430',
  // Deliberately the same value as `eye`: the character carries ONE dark
  // colour, so the rim and the features agree. It has its own key so the two
  // can diverge later without a hunt.
  outline: '#1B2430',
  scarf: '#3AAE52',
  scarfHi: '#6FD98A',
  snow: '#EAF2F8',
  rock: '#5A6B80',
  rockLo: '#3E4C5E',
  plank: '#8A6A44',
  plankHi: '#B08A5C',
  ice: '#8FD8E8',
} as const;

/** Creates a canvas texture, replacing any same-keyed texture from a hot reload. */
function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) throw new Error(`failed to create canvas texture "${key}"`);
  return tex;
}

/**
 * Textures are drawn with Canvas 2D rather than Phaser Graphics so there is no
 * renderer interaction at all — and every edge is guaranteed to be a hard
 * pixel edge, since `fillRect` does not antialias.
 */
function makePainter(ctx: CanvasRenderingContext2D, originX: number) {
  return (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(originX + x, y, w, h);
  };
}

/**
 * Draws a 1px rim around everything already painted on the canvas.
 *
 * This runs as a pass over the pixels rather than being drawn as rects, because
 * an outline is a property of the SILHOUETTE rather than of any one shape.
 * Hand-drawing it would mean re-deriving every edge by hand and keeping the two
 * in sync forever.
 *
 * It is the single biggest readability win here. The concept art draws the bear
 * with a near-black rim, and the fur highlight is #F2F5F8 against snow at
 * #EAF2F8 — a few percent apart, so the head and legs vanish into a snow tile
 * without it. The scarf breaks up the middle of the silhouette but cannot carry
 * the top and bottom on its own.
 *
 * Requires the art to be inset at least 1px from the canvas edge, or the rim
 * gets clipped and the silhouette reads as broken. smoke.mjs asserts that
 * inset, so adding art at row 0 fails loudly instead of silently clipping.
 */
function outlineSilhouette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  const { data } = ctx.getImageData(0, 0, width, height);
  const opaque = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    data[(y * width + x) * 4 + 3] >= 8;

  const edges: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (opaque(x, y)) continue;
      // 4-connected, not 8. Every shape below is an axis-aligned rect, so the
      // silhouette is rectilinear and 4-connectivity cannot leave a diagonal
      // gap; 8-connectivity would only make the rim look fatter at corners.
      if (
        opaque(x - 1, y) ||
        opaque(x + 1, y) ||
        opaque(x, y - 1) ||
        opaque(x, y + 1)
      ) {
        edges.push(x, y);
      }
    }
  }

  ctx.fillStyle = color;
  for (let i = 0; i < edges.length; i += 2) {
    ctx.fillRect(edges[i], edges[i + 1], 1, 1);
  }
}

/**
 * 95x124 hero — the size the FLUX art actually needs.
 *
 * The art is inset 1px inside the canvas on every side (x8..88, y4..122) so
 * outlineSilhouette has room to draw. Do not push a shape out to the edge.
 *
 * The hero FACES RIGHT: the eye and the snout are both right of the head's
 * centre line. `Player` mirrors the whole sprite with setFlipX, so facial
 * features on opposite sides would be wrong in both orientations — smoke.mjs
 * asserts they stay on the same side.
 */
export function makePlaceholderHero(scene: Phaser.Scene): void {
  const W = 95;
  const H = 124;
  const tex = canvasTexture(scene, TEX.hero, W, H);
  const px = makePainter(tex.context, 0);

  // Draw order is load-bearing: each mass paints over the one before it, so the
  // torso hides the top of the legs and the head hides the top of the torso.
  px(12, 47, 74, 58, PAL.furHi); // torso       y47-104
  px(12, 86, 74, 19, PAL.furLo); // torso underside shading
  px(14, 100, 23, 22, PAL.furDeep); // left leg  y100-122, drawn AFTER the
  px(58, 100, 23, 22, PAL.furDeep); // right leg     shading so its top row shows

  px(16, 4, 19, 19, PAL.furHi); // left ear      y4-22
  px(59, 4, 19, 19, PAL.furHi); // right ear
  px(18, 8, 59, 47, PAL.furHi); // head          x18-76, y8-54
  // Muzzle sits at y28-44, leaving fur below it: flush against the scarf band
  // it would read as a chin rather than a snout.
  px(52, 28, 24, 17, PAL.muzzle); // muzzle    x52-75 — under the eye, right
  // Nose is held in from the muzzle's edge. At the very edge it merges with the
  // outline, which is the same colour.
  px(64, 28, 8, 8, PAL.eye); // nose
  px(52, 20, 8, 8, PAL.eye); // eye             x52-59, right of centre

  px(8, 47, 81, 17, PAL.scarf); // scarf band
  px(8, 47, 81, 5, PAL.scarfHi); // scarf highlight
  px(57, 64, 19, 31, PAL.scarf); // scarf tail

  outlineSilhouette(tex.context, W, H, PAL.outline);

  tex.refresh(); // push the 2D canvas to the GPU
}

/**
 * Four tiles in a 280x67 strip, at the collision tile size (TILE_W x TILE_H).
 *
 * The tilemap renderer does NOT need texture frames — it computes tile UVs
 * from `Tileset.texCoordinates` against the whole texture. But any ordinary
 * sprite that references this texture by tile index DOES, and without frames
 * Phaser logs "has no frame" and silently falls back to the entire strip.
 * That is exactly what happens to the one-way platform sprites, so the
 * frames below are load-bearing, not tidiness.
 */
export function makePlaceholderTiles(scene: Phaser.Scene): void {
  const W = TILE_W;
  const H = TILE_H;
  const TILE_COUNT = 4;
  const tex = canvasTexture(scene, TEX.tiles, W * TILE_COUNT, H);
  const ctx = tex.context;

  const col = (index: number) => makePainter(ctx, index * W);
  const px = (
    c: number,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ) => col(c)(x, y, w, h, color);

  // 0: plain interior rock
  px(0, 0, 0, W, H, PAL.rockLo);

  // 1: snow-capped solid ground
  px(1, 0, 0, W, H, PAL.rock);
  px(1, 0, 0, W, 17, PAL.snow);
  px(1, 0, 17, W, 4, PAL.furLo);
  px(1, 13, 33, 13, 9, PAL.rockLo);
  px(1, 44, 46, 17, 9, PAL.rockLo);

  // 2: one-way plank. The canvas starts transparent, so simply not drawing
  //    above and below the plank is what makes the rest see-through.
  px(2, 0, 13, W, 17, PAL.plank);
  px(2, 0, 13, W, 4, PAL.plankHi);
  px(2, 0, 25, W, 5, PAL.rockLo);

  // 3: ice, the slippery surface
  px(3, 0, 0, W, H, PAL.ice);
  px(3, 0, 0, W, 9, PAL.snow);

  // One frame per tile, registered by tile index so `sprite.setFrame(2)` and
  // `group.create(x, y, TEX.tiles, 2)` both resolve to a single tile.
  for (let i = 0; i < TILE_COUNT; i++) {
    tex.add(i, 0, i * W, 0, W, H);
  }

  tex.refresh();
}
