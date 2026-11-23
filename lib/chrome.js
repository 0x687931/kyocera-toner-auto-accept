'use strict';
// Locate an installed Chrome / Chromium / Edge binary across macOS, Windows and Linux.
// puppeteer-core does NOT ship a browser, so we reuse whatever the user already has.
const fs = require('fs');
const { execSync } = require('child_process');

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}

function which(cmd) {
  try {
    const q = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    const out = execSync(q, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out.split(/\r?\n/)[0] || null;
  } catch (_) { return null; }
}

function candidates() {
  const plat = process.platform;
  if (plat === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  if (plat === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const la = process.env['LOCALAPPDATA'] || '';
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      la ? `${la}\\Google\\Chrome\\Application\\chrome.exe` : null,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean);
  }
  // linux and others
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
}

// Order of preference: explicit override -> CHROME_PATH env -> known install paths -> PATH lookup.
function findChrome(override) {
  if (exists(override)) return override;
  if (exists(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const c of candidates()) if (exists(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge']) {
    const w = which(name);
    if (exists(w)) return w;
  }
  return null;
}

module.exports = { findChrome };
