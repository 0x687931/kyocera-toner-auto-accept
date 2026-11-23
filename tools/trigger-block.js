#!/usr/bin/env node
'use strict';
// TEST HELPER — reproduces the "Non-genuine Toner" prompt by cold-restarting the
// printer over SNMP, so you can verify the tool without waiting for a real power cut.
//
// WARNING: this REBOOTS your printer. Do not run it while a print/scan/fax job is
// active. It performs a normal power-cycle reset (preserves all saved settings);
// it is NOT a factory reset.
const path = require('path');
const fs = require('fs');
const { readConsole, coldRestart } = require('../lib/snmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const file = path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(file)) { console.error('Create config.json first (copy config.example.json).'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const host = process.env.KYO_HOST || cfg.host;
  const community = process.env.KYO_SNMP_COMMUNITY || cfg.snmpCommunity || 'public';

  console.log(`Cold-restarting ${host} to reproduce the toner prompt (this reboots the printer)...`);
  try { await coldRestart(host, community); }
  catch (e) { console.error('SNMP reset failed:', e.message, '\n(Your printer may have SNMP write disabled — in that case just power-cycle it by hand.)'); process.exit(3); }

  process.stdout.write('waiting for the printer to come back up');
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    process.stdout.write('.');
    let msg = '';
    try { msg = await readConsole(host, community); } catch (_) { continue; }
    if (/Non-genuine Toner/i.test(msg)) { console.log(`\nBlock is up: "${msg}"\nNow run:  npm run accept`); process.exit(0); }
    if (/Ready/i.test(msg)) { console.log(`\nPrinter came up Ready ("${msg}") — no block appeared this time.`); process.exit(0); }
  }
  console.log('\nTimed out waiting for the printer.');
  process.exit(1);
})();
