/* Model loading without any file editing: (A) a model chosen in Settings is remembered in IndexedDB and loads on every visit;
   (B) a bundled assets/models/yuji.glb is detected automatically and wins over the remembered one; (C) with neither, the 2D
   art stays. Uses fixture models generated from the original stand-in rig (tests/browser/char3d-fixture.js) — two variants
   with different stance offsets, so the test can tell which source was loaded. No third-party model is used.
   needs: python3 -m http.server 8123 (from the game folder). The test serves a temporary copy of the game on :8124 with a
   fixture as assets/models/yuji.glb and deletes it afterwards. run: node tests/browser/char3d-load.js */
const { launch } = require('./_pw');
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const res = []; const ok = (n, c, extra) => { res.push({ n, c: !!c, extra }); console.log((c ? 'PASS ' : 'FAIL ') + n + (c || !extra ? '' : '  ' + extra)); };

(async () => {
  const br = await launch();
  const errs = [];
  const page = async (ctx, url) => {
    const pg = await ctx.newPage(); await pg.setViewportSize({ width: 1280, height: 720 });
    pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*404/.test(m.text())) errs.push(m.text()); });
    await pg.goto(url);
    await pg.waitForFunction(() => window.JJK && JJK.Char3D && JJK.Char3D.ready, null, { timeout: 30000 });
    return pg;
  };
  const info = (pg) => pg.evaluate(() => { const r = JJK.Char3D.registry.yuji, t = r.supplied; return { origin: r.origin, source: r.source, saved: r.saved, status: JJK.Char3D.status(), clips: t ? t.clipCount : 0, useClips: t ? t.useClips : false, offset: t && t.clipInfo ? +t.clipInfo.idle.C.x.toFixed(2) : null, mode: JJK.Char3D.mode }; });
  const battle = async (pg) => {
    await pg.evaluate(() => __jjk.UI.show('menu')); await pg.waitForTimeout(300);
    await pg.locator('.menu-wrap button', { hasText: /^\s*PLAY/ }).first().click(); await pg.waitForTimeout(300);
    await pg.locator('button:has-text("START BATTLE")').click(); await pg.waitForTimeout(700);
    await pg.evaluate(() => { const b = __battle.battle; b.addYen(5000); const s = [...b.geo.slots.values()].find((x) => x.type === 'G'); b.place('yuji', s.c, s.r); });
    await pg.waitForTimeout(800);
    return pg.evaluate(() => ({ snap: JJK.Char3D.snapshot(), sprite2d: [...JJK.Char3D.views].every((v) => !v.handled.has('yuji')) }));
  };
  const openSettings = async (pg) => { await pg.evaluate(() => __jjk.UI.show('settings')); await pg.waitForTimeout(400); };

  // fixture models: "remembered" (stance offset 0.1 m) and "bundled" (offset 0.3 m)
  const gen = await br.newContext(); const gp = await page(gen, 'http://localhost:8123/index.html');
  const mk = (off) => gp.evaluate(async (off) => { const fx = await import('/tests/browser/char3d-fixture.js'); const b = new Uint8Array(await fx.buildClipGLB({ offset: off })); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }, off);
  const remembered = Buffer.from(await mk(0.1), 'base64'), bundled = Buffer.from(await mk(0.3), 'base64');
  await gen.close();
  ok('fixtures built (' + (remembered.length / 1024).toFixed(0) + ' KB / ' + (bundled.length / 1024).toFixed(0) + ' KB)', remembered.length > 100000 && bundled.length > 100000);

  // ---------------------------------------------------------------- C: nothing supplied -> 2D Yuji
  const c1 = await br.newContext(); let pg = await page(c1, 'http://localhost:8123/index.html');
  let I = await info(pg);
  ok('C. no bundled or saved model: Auto mode keeps the 2D art (' + I.status + ')', I.mode === 'auto' && !I.origin && /keeping the 2D art/.test(I.status));
  let B = await battle(pg);
  ok('C. a placed Yuji is drawn with his original 2D sprite', B.snap.length === 0 && B.sprite2d);

  // ---------------------------------------------------------------- A: choose a file in Settings -> remembered across visits
  await openSettings(pg);
  ok('A. Settings shows the model picker and "no model saved"', await pg.isVisible('[data-char3d=file]') && /No model saved/.test(await pg.textContent('[data-char3d=saved]')));
  await pg.setInputFiles('[data-char3d=file]', { name: 'not-a-model.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('this is not a glb') });
  await pg.waitForTimeout(800);
  I = await info(pg);
  ok('A. an invalid file is rejected with a message and nothing is saved', /Could not use not-a-model\.glb/.test(I.status + await pg.textContent('[data-char3d=status]')) && !I.saved && !I.origin);
  await pg.setInputFiles('[data-char3d=file]', { name: 'yuji_itadori.glb', mimeType: 'model/gltf-binary', buffer: remembered });
  await pg.waitForFunction(() => /Saved/.test(document.querySelector('[data-char3d=status]').textContent), null, { timeout: 30000 });
  I = await info(pg);
  ok('A. choosing the file applies it immediately and saves it (' + I.source + ', ' + I.clips + ' clips, auto-configured)', I.origin === 'saved' && I.source === 'yuji_itadori.glb' && I.clips === 7 && I.useClips && I.saved && I.saved.name === 'yuji_itadori.glb');
  await pg.reload(); await pg.waitForFunction(() => JJK.Char3D.ready, null, { timeout: 30000 });
  I = await info(pg);
  ok('A. after a reload the saved model loads by itself (' + I.status + ')', I.origin === 'saved' && I.offset === 0.08 && /saved in this browser/.test(I.status));
  B = await battle(pg);
  ok('A. Yuji is 3D in battle with the saved model, driven by its clips', B.snap.length === 1 && B.snap[0].kind === 'glb' && B.snap[0].clips);
  await pg.evaluate(() => __battle.startWave()); await pg.evaluate(() => __battle.setSpeed(2));
  await pg.waitForFunction(() => { const s = JJK.Char3D.snapshot()[0]; return s && s.counts.punchL + s.counts.punchR > 1; }, null, { timeout: 45000 }).catch(() => {});
  const fought = await pg.evaluate(() => JJK.Char3D.snapshot()[0].counts);
  ok('A. the saved model punches on real hits (L ' + fought.punchL + ' / R ' + fought.punchR + ')', fought.punchL + fought.punchR > 1);
  // a second context = a different browser profile: nothing remembered there
  const other = await br.newContext(); const op = await page(other, 'http://localhost:8123/index.html');
  ok('A. storage is per browser profile (another profile still has the 2D art)', !(await info(op)).origin); await other.close();

  // ---------------------------------------------------------------- B: bundled assets/models/yuji.glb wins automatically
  // published layout: the game in a sub-folder, like a GitHub Pages project site (https://<user>.github.io/<repo>/)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jjk-autodetect-')), site = path.join(tmp, 'my-jjk-repo');
  fs.mkdirSync(site); execSync('cp -r ' + JSON.stringify(ROOT) + '/. ' + JSON.stringify(site));
  fs.writeFileSync(path.join(site, 'assets/models/yuji.glb'), bundled);
  const srv = spawn('python3', ['-m', 'http.server', '8124'], { cwd: tmp, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const PUB = 'http://localhost:8124/my-jjk-repo/';
  try {
    // a brand-new player: fresh browser profile, no settings, no storage, plain URL
    const fresh = await br.newContext(); const fp = await page(fresh, PUB);
    I = await info(fp);
    ok('B. published sub-folder site: a fresh player gets the bundled model with no action (' + I.status + ')', I.mode === 'auto' && I.origin === 'bundled' && I.source === 'assets/models/yuji.glb' && I.offset === 0.28 && I.clips === 7 && I.useClips);
    B = await battle(fp);
    ok('B. fresh player: Yuji is 3D in battle with all 7 clips available', B.snap.length === 1 && B.snap[0].kind === 'glb' && B.snap[0].clips);
    await fp.evaluate(() => { __battle.startWave(); __battle.setSpeed(2); });
    await fp.waitForFunction(() => { const s = JJK.Char3D.snapshot()[0]; return s && s.counts.punchL + s.counts.punchR > 1; }, null, { timeout: 45000 }).catch(() => {});
    const pc = await fp.evaluate(() => JJK.Char3D.snapshot()[0].counts);
    ok('B. fresh player: bundled model punches on real hits (L ' + pc.punchL + ' / R ' + pc.punchR + ')', pc.punchL + pc.punchR > 1);
    await fresh.close();
    // remember a different file in this profile: the bundled one must still win
    const c2 = await br.newContext(); let p2 = await page(c2, PUB);
    await openSettings(p2);
    await p2.setInputFiles('[data-char3d=file]', { name: 'yuji_itadori.glb', mimeType: 'model/gltf-binary', buffer: remembered });
    await p2.waitForFunction(() => /Saved/.test(document.querySelector('[data-char3d=status]').textContent), null, { timeout: 30000 });
    I = await info(p2);
    ok('B. saving a model while a bundled one exists keeps the bundled one active', I.origin === 'bundled' && I.offset === 0.28 && I.saved && /takes priority/.test(await p2.textContent('[data-char3d=saved]')));
    await p2.reload(); await p2.waitForFunction(() => JJK.Char3D.ready, null, { timeout: 30000 });
    I = await info(p2);
    ok('B. after a reload: bundled first, saved model kept as a backup', I.origin === 'bundled' && I.offset === 0.28 && I.saved && I.saved.name === 'yuji_itadori.glb');
    await c2.close();
    // hosts that answer a missing file with "200 + HTML" (SPA fallbacks) must not break anything
    const c3 = await br.newContext();
    await c3.route('**/assets/models/yuji.glb', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Not here</title>' }));
    const p3 = await page(c3, PUB);
    I = await info(p3);
    ok('B. a host that returns an HTML page for the missing file: treated as "no model", 2D art kept', !I.origin && /keeping the 2D art/.test(I.status));
    await c3.close();
  } finally { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  ok('B. temporary copy with the fixture removed', !fs.existsSync(tmp) && !fs.existsSync(path.join(ROOT, 'assets/models/yuji.glb')));

  // ---------------------------------------------------------------- forget -> back to 2D
  await openSettings(pg);
  ok('A. "Forget saved model" is offered while a model is saved', await pg.isVisible('[data-char3d=forget]'));
  await pg.click('[data-char3d=forget]'); await pg.waitForTimeout(400);
  await pg.reload(); await pg.waitForFunction(() => JJK.Char3D.ready, null, { timeout: 30000 });
  I = await info(pg);
  ok('A. after forgetting, the next visit falls back to the 2D art', !I.origin && !I.saved && /keeping the 2D art/.test(I.status));
  B = await battle(pg);
  ok('A. Yuji is 2D again in battle', B.snap.length === 0 && B.sprite2d);
  await c1.close();

  ok('no JavaScript errors (an absent optional yuji.glb 404 is expected and ignored)', errs.length === 0, errs.slice(0, 4).join(' | '));
  await br.close();
  const failed = res.filter((r) => !r.c);
  console.log('\n' + (res.length - failed.length) + '/' + res.length + ' model-loading checks passed');
  if (failed.length) { console.log('FAILED:\n' + failed.map((f) => ' - ' + f.n + ' ' + (f.extra || '')).join('\n')); process.exit(1); }
})().catch((e) => { console.error('CHAR3D-LOAD CRASH', e); process.exit(2); });
