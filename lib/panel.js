'use strict';
// Drives the Kyocera remote operation panel over a headless Chrome session to
// acknowledge the "Non-genuine Toner" prompt (Status -> Next -> Accept).
//
// A real browser is required: the embedded web server rejects plain HTTP clients
// (returns HTTP 500 without a live browser session), so puppeteer-core drives an
// installed Chrome. No browser extension or external binary is needed.
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Panel button coordinates (viewport pixels at 1600x760). Tuned for ECOSYS
// M5526cdw / M5521 class panels. Other models may need adjustment — run with
// --debug to capture screenshots and re-measure.
const VIEWPORT = { width: 1600, height: 760 };
const TAP_STATUS = { x: 352, y: 356 };   // on-screen "Status" button (bottom-left of touchscreen)
const TAP_NEXT = { x: 688, y: 340 };     // "Next >"
const TAP_ACCEPT = { x: 688, y: 340 };   // "Accept"

async function login(frame, username, password) {
  await frame.evaluate((u, p) => {
    const f = document.createElement('form');
    f.method = 'POST'; f.action = '/startwlm/login.cgi';
    const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
    add('failhtmfile', '/startwlm/Start_Wlm.htm');
    add('okhtmfile', '/startwlm/Start_Wlm.htm');
    add('func', 'authLogin');
    add('arg03_LoginType', '_mode_off');
    add('arg04_LoginFrom', '_wlm_login');
    add('arg01_UserName', u);
    add('arg02_Password', p);
    add('arg05_AccountId', '');
    add('arg06_DomainName', '');
    document.body.appendChild(f); f.submit();
  }, username, password);
}

// Request a remote-panel session: fetch a fresh nonce, POST set.cgi. Opens the
// VNC listener on port 9061 and mints the panel 'token' cookie.
async function startRemotePanel(frame) {
  return await frame.evaluate(async () => {
    const g = new XMLHttpRequest();
    g.open('GET', '/js/jssrc/model/dvcinfo/dvcrmtpnl/DvcConfig_RemotePanel.model.htm', false);
    g.send(null);
    const nonce = (g.responseText.match(/hiddenvalue['"]?\s*=\s*['"]([^'"]*)['"]/) || [])[1];
    if (!nonce) return 'no-nonce';
    for (const type of ['0', '1']) {
      const body = new URLSearchParams({
        okhtmfile: '/dvcinfo/dvcrmtpnl/DvcConfig_RemotePanel_Rslt.htm',
        failhtmfile: '/dvcinfo/dvcrmtpnl/DvcConfig_RemotePanel_Err.htm',
        arg01_Type: type, func: 'requestRemotePanel', hidden: nonce,
      }).toString();
      const p = new XMLHttpRequest();
      p.open('POST', '/dvcinfo/dvcrmtpnl/set.cgi', false);
      p.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      p.send(body);
      if (/arg1=ok/.test(p.responseText) || !/used|restrict/.test(p.responseText)) return 'ok-type' + type;
    }
    return 'in-use';
  });
}

// Average luminance of the whole panel canvas (to detect when the framebuffer has painted).
async function canvasLuminance(page) {
  return await page.evaluate(() => {
    const c = document.getElementById('noVNC_canvas') || document.querySelector('canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d');
    try {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 97) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
      return +(s / n).toFixed(1);
    } catch (_) { return -2; }
  });
}

// SAFETY GATE: confirm the orange "Non-genuine Toner. [Y]" dialog title bar is on
// screen before tapping Next/Accept. Samples a viewport region mapped into the
// canvas's own pixel space, so an unrelated screen can never trigger a blind tap.
async function tonerDialogVisible(page) {
  return await page.evaluate(() => {
    const c = document.getElementById('noVNC_canvas') || document.querySelector('canvas');
    if (!c) return false;
    const ctx = c.getContext('2d');
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width, sy = c.height / r.height;
    const vx0 = 300, vy0 = 120, vx1 = 700, vy1 = 138; // orange title strip, viewport coords
    const x = Math.round((vx0 - r.left) * sx), y = Math.round((vy0 - r.top) * sy);
    const w = Math.max(1, Math.round((vx1 - vx0) * sx)), h = Math.max(1, Math.round((vy1 - vy0) * sy));
    try {
      const d = ctx.getImageData(x, y, w, h).data;
      let orange = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        n++;
        if (R > 180 && G > 80 && G < 190 && B < 100) orange++;
      }
      return (orange / n) > 0.25;
    } catch (_) { return false; }
  });
}

async function tap(page, pt) {
  await page.mouse.move(pt.x, pt.y); await sleep(150);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(2500);
}

// Main entry: open the panel and acknowledge the toner prompt. The caller is
// responsible for having confirmed (via SNMP) that the prompt is actually up.
// Returns { acknowledged, note }.
async function acknowledge(cfg, log = () => {}) {
  const profileDir = path.join(os.tmpdir(), 'kyocera-toner-accept-profile');
  const base = `https://${cfg.host}/`;
  const browser = await puppeteer.launch({
    executablePath: cfg.chromePath,
    headless: cfg.headless === false ? false : 'new',
    userDataDir: profileDir,
    args: ['--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });
  const shot = async (name) => { if (cfg.debug) { try { await page.screenshot({ path: path.join(cfg.debugDir, name + '.png') }); } catch (_) {} } };
  let page;
  let acknowledged = false, note = '';
  try {
    page = await browser.newPage();
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    await login(page.frames().find((f) => f.url().includes('Start_Wlm.htm')) || page.mainFrame(), cfg.username, cfg.password);
    await sleep(3500);
    log('remote panel:', await startRemotePanel(page.frames()[0]));
    await sleep(1500);
    await page.goto(`${base}noVNC/vnc_auto.html?host=${cfg.host}&port=9061`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const s = await page.evaluate(() => (document.getElementById('noVNC_status') || {}).textContent || '');
      if (/Connected/i.test(s)) { log('panel:', s); break; }
    }
    // wait for the (possibly dimmed) framebuffer to paint
    for (let i = 0; i < 20; i++) { if ((await canvasLuminance(page)) > 25) break; await sleep(1500); }
    await sleep(1500);
    await shot('01-home');

    // Reach the Non-genuine Toner dialog via the Status button, with retries to
    // absorb the boot modal (auto-clears within ~30s) and transient frames.
    let dialog = false;
    for (let attempt = 1; attempt <= 5 && !dialog; attempt++) {
      await tap(page, TAP_STATUS);
      await shot('02-status');
      dialog = await tonerDialogVisible(page);
      log('attempt', attempt, 'dialog visible:', dialog);
      if (!dialog) await sleep(5000);
    }

    if (!dialog) { note = 'toner dialog not recognised; left panel untouched'; }
    else {
      await tap(page, TAP_NEXT);   await shot('03-next');
      await tap(page, TAP_ACCEPT); await shot('04-accept');
      acknowledged = true;
    }
  } finally {
    await browser.close();
  }
  return { acknowledged, note };
}

module.exports = { acknowledge };
