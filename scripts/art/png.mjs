/**
 * Image I/O. Every pixel this repo reads or writes goes through ImageMagick.
 *
 * These three functions were lifted out of scripts/slice-art.mjs unchanged when
 * the art source changed from a FLUX JPEG to procedural drawing. They were
 * always source-agnostic — `loadRGBA` decodes anything magick can read and
 * `writePng` encodes raw RGBA — so only their home moved. `quantise` is kept
 * because the verification harness still reads committed PNGs with it, but the
 * new pipeline draws in a fixed palette and no longer needs it; see
 * scripts/art/palette.mjs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch {
  console.error(
    'ImageMagick not found. The art scripts shell out to `magick` for decode ' +
      'and PNG encode.\nInstall it (Arch: `pacman -S imagemagick`), or use the ' +
      'already-committed PNGs in public/art/.',
  );
  process.exit(2);
}

/** Reads any image into raw non-premultiplied RGBA. */
export function loadRGBA(file) {
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', file])
    .toString()
    .trim()
    .split(' ')
    .map(Number);
  const buf = execFileSync('magick', [file, '-depth', '8', 'rgba:-'], {
    maxBuffer: 1 << 28,
  });
  return { w, h, buf };
}

/** Writes raw RGBA out as a PNG, via ImageMagick's raw reader. */
export function writePng(file, w, h, buf) {
  execFileSync(
    'magick',
    // -depth 8 explicitly: this machine's magick is a Q16 build, and 8-bit
    // output is its default for raw input rather than a guarantee. Sixteen-bit
    // PNGs would load fine and double the file size for nothing.
    //
    // -strip keeps the output byte-reproducible; see the note in quantise().
    ['-size', `${w}x${h}`, '-depth', '8', 'rgba:-', '-strip', '-depth', '8', file],
    { input: buf },
  );
}

/**
 * Reduces an image to a small palette, in place.
 *
 * `png:color-type=6` forces truecolour-with-alpha output. Without it the
 * encoder is free to emit a palette PNG, which is fine for the opaque tiles but
 * would mangle a keyed alpha channel.
 *
 * NOTE on reproducibility: `-colors` is deterministic for a given ImageMagick
 * build, but the choice of palette is not specified across versions. Re-running
 * this is only guaranteed to reproduce the committed PNGs on a matching magick;
 * otherwise expect the same art in slightly different colours.
 */
export function quantise(file, colors) {
  const tmp = `${file}.tmp.png`;
  try {
    execFileSync('magick', [
      file,
      '-colors',
      String(colors),
      '-dither',
      'None',
      '-define',
      'png:color-type=6',
      tmp,
    ]);
    // -strip drops the tEXt chunks magick writes by default, which carry
    // date:create / date:modify / date:timestamp. Without it the output is
    // pixel-identical run to run but never byte-identical, so the committed
    // PNGs churn on every rebuild and a real change is invisible in the diff.
    execFileSync('magick', [tmp, '-strip', '-depth', '8', file]);
  } finally {
    // In a finally, so a failed quantise does not leave a stray .tmp.png next to
    // the real asset.
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}
