/**
 * The palette. One source of truth for every pixel the game draws.
 *
 * The old pipeline started from a JPEG illustration carrying 1,500-2,200
 * distinct colours per sprite and reduced it afterwards with `quantise()`. This
 * one draws in the palette directly, so quantisation has nothing to do: the art
 * cannot leave these colours, and the build asserts that rather than trusting
 * it. That is why hero and terrain now agree — they are drawn from one list.
 *
 * Ramps are ordered DARKEST FIRST, because that is the order the shading code
 * indexes them in. A ramp is deliberately 3-4 tones: flat-shaded 16-bit art
 * reads on the strength of its outline and silhouette, not its gradients, and
 * procedural shading past ~4 tones goes muddy.
 */

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

/**
 * Named ramps. `RAMP.fur[0]` is the deepest shade in the family and
 * `RAMP.fur.at(-1)` the brightest highlight.
 */
export const RAMP = {
  /**
   * The navy outline. Not part of a ramp's shading — it is painted as a
   * separate pass around the whole silhouette, and it is what holds the bear
   * against snow (scripts/smoke.mjs wants >=300 pixels darker than luminance
   * 80). Deliberately one tone: a shaded outline stops reading as an outline.
   */
  ink: ['#1A1C26'],
  outline: ['#333747'],

  /**
   * Warm cream fur, ending on the shipping bear's measured #E5D9B1 highlight.
   *
   * The ramp is a smooth warm progression on purpose. An earlier version went
   * `#8E9090, #ACAEA6, #D2CB9E, #E5D9B1` — two neutrals then two creams — and
   * because the shading is a four-step lookup, the jump between index 1 and 2
   * landed as a hard grey band across the middle of the body. A ramp is only as
   * good as its worst adjacent pair.
   */
  fur: ['#9FA09B', '#C4BCA6', '#D9D0B2', '#E5D9B1'],

  /**
   * The same fur one step darker, for the limbs on the far side of the body.
   *
   * This is the standard 16-bit depth trick and it does more work than the
   * outline does: when every limb is drawn from one ramp, a far arm reads as a
   * lump of the torso rather than as a limb behind it, because the only thing
   * separating them is a 1px line.
   */
  furFar: ['#868782', '#9FA09B', '#C4BCA6', '#D9D0B2'],

  /** Snow is near-white and only ever shades to a cold blue-grey. */
  snow: ['#C3D2E0', '#EAF2F8', '#FFFFFF'],

  /**
   * Ice. Must stay far from `rock` — that gap is the game's only mechanic being
   * visible, and the build asserts a mean per-channel separation of >= 4 on the
   * top brick of the ice cell vs the fill cell.
   *
   * `ice[2]` is the base, and it is deliberately only ~28 luminance levels above
   * `rock[1]`. The first attempt used a much brighter base (luminance 206 against
   * rock's 130) and in a composited scene the ice patch read as a glowing band
   * that pulled the eye off the hero — a surface you slide on, not a light
   * source. Distinction comes from hue and from texture, not from brightness.
   */
  ice: ['#37697C', '#4E8CA3', '#6FAEC6', '#A5D8E8'],

  /**
   * The rock the level is made of, and the fill below the snow line. Mid-tone on
   * purpose: darker than this and the ground reads as a black band under the
   * snow; lighter and it stops separating from the snow above it.
   */
  rock: ['#5A6673', '#78848F', '#94A0AB'],
};

/** Flat colours that are not ramps. */
export const FLAT = {
  eye: '#1A1C26',
  nose: '#3A3D4A',
};

/**
 * Every colour that may appear in the shipped art, as `r,g,b` keys — the
 * allow-list the build checks its output against. Duplicates collapse, which is
 * fine: `ink` and `eye` are the same navy on purpose.
 */
export const paletteKeys = new Set(
  [...Object.values(RAMP), ...Object.values(FLAT)]
    .flat()
    .map((h) => hex(h).join(',')),
);

export const paletteList = [...paletteKeys].map((k) => {
  const [r, g, b] = k.split(',').map(Number);
  return { r, g, b, hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
});

/** `RAMP.fur` -> `[[r,g,b], ...]`, ready to index. */
export const rgb = Object.fromEntries(
  Object.entries(RAMP).map(([k, ramp]) => [k, ramp.map(hex)]),
);

/** Picks a tone out of a ramp by a 0..1 shade, where 1 is the highlight. */
export function tone(ramp, shade) {
  const i = Math.round(shade * (ramp.length - 1));
  return ramp[Math.max(0, Math.min(ramp.length - 1, i))];
}

/** `[r,g,b]` for a flat colour name. */
export const flatRgb = Object.fromEntries(Object.entries(FLAT).map(([k, v]) => [k, hex(v)]));
