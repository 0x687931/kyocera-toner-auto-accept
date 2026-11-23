#!/usr/bin/env node
'use strict';
// Entry point: if the printer is showing the "Non-genuine Toner" prompt, drive the
// remote panel to acknowledge it and confirm the printer returns to Ready.
// Safe to run on a schedule: when the printer is Ready it just does a cheap SNMP
// check and exits (exit code 0). It only ever acts on the exact toner prompt.
const fs = require('fs');
const path = require('path');
const { findChrome } = require('./lib/chrome');
const { readConsole } = require('./lib/snmp');
const { acknowledge } = require('./lib/panel');

const TONER_TEXT = 'Non-genuine Toner';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  if (!fs.existsSync(file)) {
    console.error('No config.json found. Copy config.example.json to config.json and set your printer address.');
    process.exit(2);
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('config.json is not valid JSON:', e.message); process.exit(2); }

  // environment overrides (handy for scheduled jobs / CI)
  cfg.host = process.env.KYO_HOST || cfg.host;
  cfg.username = process.env.KYO_USER || cfg.username || 'Admin';
  cfg.password = process.env.KYO_PASS || cfg.password || 'Admin';
  cfg.snmpCommunity = process.env.KYO_SNMP_COMMUNITY || cfg.snmpCommunity || 'public';
  cfg.chromePath = findChrome(process.env.CHROME_PATH || cfg.chromePath);

  if (!cfg.host) { console.error('config: "host" (printer IP address) is required.'); process.exit(2); }
  if (!cfg.chromePath) {
    console.error('Could not find Google Chrome / Chromium. Install it, or set "chromePath" in config.json (or CHROME_PATH env).');
    process.exit(2);
  }
  return cfg;
}

(async () => {
  const cfg = loadConfig();
  cfg.debug = process.argv.includes('--debug');
  cfg.headless = cfg.headless !== false && !process.argv.includes('--show');
  if (cfg.debug) {
    cfg.debugDir = path.join(__dirname, 'debug');
    fs.mkdirSync(cfg.debugDir, { recursive: true });
  }

  let before;
  try { before = await readConsole(cfg.host, cfg.snmpCommunity); }
  catch (e) { console.error('Could not read printer status over SNMP:', e.message); process.exit(3); }
  log('printer console =', JSON.stringify(before));

  if (!before.includes(TONER_TEXT)) {
    log('Not the non-genuine toner prompt — nothing to do.');
    process.exit(0);
  }

  log('Non-genuine toner prompt detected — acknowledging via remote panel...');
  let result;
  try { result = await acknowledge(cfg, log); }
  catch (e) { console.error('Panel automation failed:', e.message); process.exit(4); }

  await sleep(2500);
  let after = '';
  try { after = await readConsole(cfg.host, cfg.snmpCommunity); } catch (_) {}
  const cleared = !after.includes(TONER_TEXT);
  log('printer console =', JSON.stringify(after), '| acknowledged:', result.acknowledged, result.note ? '| ' + result.note : '');
  log(cleared ? 'RESULT: printer is READY.' : 'RESULT: still blocked.');
  process.exit(cleared ? 0 : 1);
})();
