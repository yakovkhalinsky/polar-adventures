/**
 * Movement verification.
 *
 * Boots the real game and measures the movement constants against the claims
 * made in src/config/movement.ts. This is the milestone's actual acceptance
 * criterion — "it boots" says nothing about whether the jump is 3.5 hero-heights.
 *
 * Every number here is in game pixels at the RESCALED size: 960x540 internal,
 * 70x66 collision tiles, a 95x124 hero. The design targets are unchanged — the
 * jump is still 3.5 hero-heights and the run still 5 hero-heights per second.
 *
 * Phaser steps Arcade physics at a fixed 60Hz by default, so these numbers are
 * framerate-independent and safe to assert.
 *
 * Usage: npm run verify
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 5198;
const URL = `http://localhost:${PORT}/`;

const CHROME_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) {
  console.error('No Chromium/Chrome binary found.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('dev server did not come up');
}

const vite = spawn(
  'npx',
  ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let browser;
const results = [];

try {
  await waitForServer();

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.game && window.game.isBooted && window.game.scene.isActive('Level'),
    { timeout: 20_000 },
  );

  // Install a per-frame recorder driven by the scene's own update event, so
  // samples line up with physics steps rather than with whatever Node happens
  // to poll.
  await page.evaluate(() => {
    const scene = window.game.scene.getScene('Level');
    const rec = { on: false, ys: [], minY: Infinity, vxs: [], vyAtJump: [] };
    window.__rec = rec;
    window.__begin = () => {
      rec.on = true;
      rec.ys = [];
      rec.minY = Infinity;
      rec.vxs = [];
    };
    window.__end = () => {
      rec.on = false;
      const ys = rec.ys;
      return {
        minY: rec.minY,
        maxY: ys.length ? Math.max(...ys) : NaN,
        firstY: ys.length ? ys[0] : NaN,
        lastY: ys.length ? ys[ys.length - 1] : NaN,
        yRange: ys.length ? Math.max(...ys) - Math.min(...ys) : NaN,
        maxVx: rec.vxs.length ? Math.max(...rec.vxs.map(Math.abs)) : NaN,
        frames: ys.length,
      };
    };
    scene.events.on('update', () => {
      if (!rec.on) return;
      const p = scene.player;
      if (!p) return;
      rec.ys.push(p.y);
      rec.vxs.push(p.body.velocity.x);
      rec.minY = Math.min(rec.minY, p.y);
    });
  });

  /** Put the hero back at spawn, on the ground, at rest, and let it settle. */
  const reset = async () => {
    await page.evaluate(() => window.game.scene.getScene('Level').player.respawn());
    await sleep(500);
  };

  const playerX = () =>
    page.evaluate(() => window.game.scene.getScene('Level').player.x);

  /**
   * Run right from spawn and jump the 4-tile pit at columns 10-13, leaving the
   * hero on the ice patch (columns 16-27) at full speed with ArrowRight still
   * held. Polls position rather than sleeping a fixed time, so it stays correct
   * if the tuning constants change.
   */
  const runOntoIce = async () => {
    const deadline = Date.now() + 8000;
    await page.keyboard.down('ArrowRight');
    while ((await playerX()) < 640 && Date.now() < deadline) await sleep(30);
    await page.keyboard.down('ArrowUp');
    await sleep(420);
    await page.keyboard.up('ArrowUp');
    while ((await playerX()) < 1250 && Date.now() < deadline) await sleep(30);
  };

  const baseline = await page.evaluate(() => {
    const scene = window.game.scene.getScene('Level');
    const p = scene.player;
    // Read the tile height off the built map rather than writing 67 (or 66)
    // here: the level's world geometry is what the jump is measured against,
    // and a literal in this file drifts the moment the grid changes.
    return { x: p.x, y: p.y, groundTop: 20 * scene.level.map.tileHeight };
  });

  // ---- 1. standing stability -------------------------------------------
  // The design decision this guards: gravity is left ON while grounded rather
  // than zeroed. If that were wrong, the body would oscillate on a 2-frame
  // cycle and this range would be large.
  await reset();
  await page.evaluate(() => window.__begin());
  await sleep(1000);
  const standing = await page.evaluate(() => window.__end());
  results.push([
    'standing still: y is stable (no shimmer)',
    standing.yRange < 1.0,
    `y range ${standing.yRange.toFixed(3)}px over ${standing.frames} frames`,
  ]);

  // ---- 2. full-hold jump apex ------------------------------------------
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowUp');
  await sleep(900);
  await page.keyboard.up('ArrowUp');
  const fullJump = await page.evaluate(() => window.__end());
  const fullApex = baseline.y - fullJump.minY;
  results.push([
    'held jump apex ~434px (3.5 hero-heights)',
    Math.abs(fullApex - 434) <= 24,
    `apex ${fullApex.toFixed(1)}px (${(fullApex / 124).toFixed(2)} hero-heights)`,
  ]);

  // ---- 3. tap jump has a floor -----------------------------------------
  // The claim in movement.ts is that the clamp guarantees a MINIMUM hop,
  // unlike a multiplier whose result depends on release timing. So a very
  // short tap must still clear 1.22 hero-heights (151px), and be less than a hold.
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowUp');
  await sleep(25);
  await page.keyboard.up('ArrowUp');
  await sleep(900);
  const tapJump = await page.evaluate(() => window.__end());
  const tapApex = baseline.y - tapJump.minY;
  results.push([
    'tap jump has a floor (>= 151px)',
    tapApex >= 151,
    `apex ${tapApex.toFixed(1)}px (${(tapApex / 124).toFixed(2)} hero-heights)`,
  ]);
  results.push([
    'tap jump is strictly shorter than held jump',
    tapApex < fullApex - 39,
    `tap ${tapApex.toFixed(1)}px vs held ${fullApex.toFixed(1)}px`,
  ]);

  // ---- 4. run-up to top speed ------------------------------------------
  // 620px/s at 5038px/s^2 = 0.123s to reach top speed.
  await reset();
  await page.evaluate(() => window.__begin());
  await page.keyboard.down('ArrowRight');
  await sleep(500);
  const runUp = await page.evaluate(() => window.__end());
  await page.keyboard.up('ArrowRight');
  results.push([
    'run reaches max speed 620px/s',
    Math.abs(runUp.maxVx - 620) <= 2,
    `max |vx| ${runUp.maxVx}px/s over ${runUp.frames} frames`,
  ]);

  // ---- 5. ground friction stops crisply --------------------------------
  // Release at full speed: drag is 5813px/s^2, so it should stop in ~0.11s.
  // Sample how far it travels after release.
  await reset();
  await page.keyboard.down('ArrowRight');
  await sleep(600); // reach top speed
  const beforeRelease = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  await page.keyboard.up('ArrowRight');
  await sleep(600); // well past the stop
  const afterStop = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  const slideDist = afterStop.x - beforeRelease.x;
  results.push([
    'ground friction stops crisply (< 124px slide)',
    Math.abs(slideDist) < 124 && Math.abs(afterStop.vx) < 1,
    `slid ${slideDist.toFixed(1)}px, final vx ${afterStop.vx.toFixed(1)}`,
  ]);

  // ---- 6. one-way platform: pass through from below --------------------
  // Columns 40-45 at row 16 are a one-way platform. Walking under it and
  // jumping must NOT be blocked. This is the case the common
  // processCallback + velocity.y > 0 idiom gets wrong at the apex.
  const oneWay = await page.evaluate(() => {
    const scene = window.game.scene.getScene('Level');
    const plats = scene.children.list.filter(
      (c) => c.body && c.body.physicsType === 1 && c.displayWidth > 32,
    );
    return plats.map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      w: p.displayWidth,
      up: p.body.checkCollision.up,
      down: p.body.checkCollision.down,
      left: p.body.checkCollision.left,
      right: p.body.checkCollision.right,
    }));
  });
  const allCorrectFlags = oneWay.every(
    (p) => p.up === true && !p.down && !p.left && !p.right,
  );
  results.push([
    'one-way platforms have exactly the right collision faces',
    allCorrectFlags,
    JSON.stringify(oneWay),
  ]);

  // ---- 7. surface detection ---------------------------------------------
  // Sample inside the ground row the level puts at row 20 — just below its top
  // edge, so the probe is unambiguously inside the tile. x=1500 is inside the
  // ice patch (columns 16-27), x=80 is the rock at spawn.
  const surfaces = await page.evaluate(() => {
    const s = window.game.scene.getScene('Level');
    const y = 20 * s.level.map.tileHeight + 4;
    return { ice: s.level.surfaceAt(1500, y), rock: s.level.surfaceAt(80, y) };
  });
  results.push([
    'surfaceAt distinguishes ice from rock',
    surfaces.ice === 'ice' && surfaces.rock === 'rock',
    `x=1500 -> ${surfaces.ice}, x=80 -> ${surfaces.rock}`,
  ]);

  // ---- 8. ice keeps you sliding -----------------------------------------
  // The whole point of the mechanic. Released at top speed, rock stops in
  // ~13px (check 5); ice must coast dramatically further. Asserted as a
  // relationship, not an exact distance, so ICE.* can be tuned by feel without
  // rewriting this test.
  await reset();
  await runOntoIce();
  const iceRelease = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  await page.keyboard.up('ArrowRight');
  await sleep(2500); // ice drag is 465px/s^2, so 620px/s takes ~1.33s to stop
  const iceStop = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    return { x: p.x, vx: p.body.velocity.x };
  });
  const iceSlide = iceStop.x - iceRelease.x;
  results.push([
    'ice: released at speed, the hero keeps sliding (>= 232px)',
    iceSlide >= 232 && Math.abs(iceStop.vx) < 1,
    `slid ${iceSlide.toFixed(1)}px from vx ${iceRelease.vx.toFixed(0)} ` +
      `at x=${iceRelease.x.toFixed(0)}, final vx ${iceStop.vx.toFixed(1)}`,
  ]);

  // ---- 9. surface tuning must not leak into the air ---------------------
  // Guards a hazard that is easy to write by accident: `isTurning` is evaluated
  // BEFORE `grounded`, so a carelessly folded ternary makes a mid-air turn read
  // the surface's turn constant — over ice, 700px/s^2 instead of TURN_ACCEL's
  // 2600. The hero would handle differently in the air depending on what it had
  // jumped off, which is exactly what the design forbids.
  //
  // This pokes the state directly rather than doing it behaviourally, and it
  // has to: while airborne the ground probe samples empty air, so surfaceAt
  // returns 'rock' and a real mid-air jump can never exercise the ice branch.
  // Calling tick() with each surface forced is the only way to compare them.
  const leak = await page.evaluate(() => {
    const p = window.game.scene.getScene('Level').player;
    const turning = { left: true, right: false, jumpDown: false, jumpPressed: false };
    const airborne = () => {
      p.body.blocked.down = false; // force the air branch
      p.body.setVelocityX(160); // moving right, input says left -> isTurning
      p.body.setVelocityY(-100);
    };
    airborne();
    p.tick(16, turning, 'ice');
    const onIce = Math.abs(p.body.acceleration.x);
    airborne();
    p.tick(16, turning, 'rock');
    const onRock = Math.abs(p.body.acceleration.x);
    p.respawn();
    return { onIce, onRock };
  });
  results.push([
    'air tuning ignores the surface underfoot',
    leak.onIce === leak.onRock && leak.onIce >= 8000,
    `mid-air turn accel: ${leak.onIce} over ice vs ${leak.onRock} over rock ` +
      `(ICE.TURN would be 2713, AIR_ACCEL 2906, TURN_ACCEL 10075)`,
  ]);

  // ---- report ----------------------------------------------------------
  console.log(`\nbaseline: spawn y=${baseline.y}, ground top=${baseline.groundTop}`);
  console.log('\n--- movement verification ---');
  let failed = 0;
  for (const [name, ok, detail] of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`        ${detail}`);
    if (!ok) failed++;
  }
  console.log(
    failed === 0
      ? `\nall ${results.length} movement checks passed`
      : `\n${failed} of ${results.length} movement checks FAILED`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error('verify-feel threw:', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
}
