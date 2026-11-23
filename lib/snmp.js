'use strict';
// Minimal SNMP helpers (pure JavaScript via the net-snmp package, so no system
// snmpget/snmpset binaries are required on any platform).
const snmp = require('net-snmp');

// Front-panel console message, e.g. "Ready." or "Non-genuine Toner. Press [Help]."
const CONSOLE_OID = '1.3.6.1.2.1.43.16.5.1.2.1.1';
// prtGeneralReset (RFC 3805). 4 = powerCycleReset (cold restart). Used ONLY by the
// optional test helper to reproduce the toner prompt; the main tool never writes.
const RESET_OID = '1.3.6.1.2.1.43.5.1.1.3.1';

function readConsole(host, community = 'public') {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, { timeout: 3000, retries: 1 });
    session.get([CONSOLE_OID], (err, varbinds) => {
      session.close();
      if (err) return reject(err);
      const vb = varbinds[0];
      if (snmp.isVarbindError(vb)) return reject(new Error(snmp.varbindError(vb)));
      resolve(vb.value.toString().trim());
    });
  });
}

// Cold-restart the printer over SNMP. This reproduces the Non-genuine Toner prompt
// for testing. It is a WRITE and reboots the device — used only by tools/trigger-block.js.
function coldRestart(host, community = 'public') {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, { timeout: 3000, retries: 0 });
    const vb = { oid: RESET_OID, type: snmp.ObjectType.Integer, value: 4 };
    session.set([vb], (err) => {
      session.close();
      if (err) return reject(err);
      resolve(true);
    });
  });
}

module.exports = { readConsole, coldRestart, CONSOLE_OID, RESET_OID };
