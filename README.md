# kyocera-toner-auto-accept

Automatically clears the **"Non-genuine Toner. Press [Help]."** prompt that some
Kyocera ECOSYS printers show after every power cycle when a non-Kyocera toner
cartridge is installed — by driving the printer's **own remote operation panel**
from any computer on the same network. No firmware changes, no chips, no hardware.

> Developed and tested against an **ECOSYS M5526cdw** (firmware `2R7_2000.003.306`).
> It should work on close relatives (e.g. M5521) and may work on other ECOSYS
> models with small tweaks. **See the disclaimer at the bottom — use at your own risk.**

---

## The problem

If you run an ECOSYS with a compatible (aftermarket) toner, the printer reads the
cartridge as "non-genuine" **on every boot** and stops with a blocking prompt. You
have to walk to the panel and tap **Status → Next → Accept** each time the power
blips before it will print again. There is no setting to make that acknowledgement
permanent, and no public way to patch it out of the firmware (the firmware is
encrypted and signature-checked).

## What this does

It does exactly what you'd do at the panel, but automatically and remotely:

1. Checks the printer's status over **SNMP**.
2. **Only if** the panel reads *exactly* `Non-genuine Toner`, it logs into the
   printer's web UI, starts the built-in **Remote Operation** panel, and connects
   to it with a headless browser.
3. Taps **Status → Next → Accept**, then confirms via SNMP that the printer is
   back to **Ready**.

When the printer is already Ready, it does a cheap SNMP check and exits — so it's
safe to run on a timer.

### Two safety gates

- **It only acts on the exact toner prompt.** Any other state (a real error, a
  paper jam, Ready, sleep) and it does nothing.
- **It confirms the orange "Non-genuine Toner" dialog is actually on screen** before
  tapping Next/Accept. If it can't confirm, it aborts and leaves the panel untouched
  rather than tap blindly.

Nothing is sent anywhere except to your printer. No telemetry. No cloud.

---

## Requirements

- **Node.js 18+**
- **Google Chrome, Chromium, or Microsoft Edge** installed (the tool reuses it;
  it does *not* download a browser).
- The printer and the computer on the **same network**.
- The printer's **web admin** login (factory default is `Admin` / `Admin`).
- **Remote Operation** enabled on the printer
  (*Command Center RX → Device Information / Remote Operation → Remote Operation: On*).
  It usually is by default.

Works on **macOS, Windows and Linux**. (Developed and verified on macOS; the
Windows/Linux paths are implemented but community-tested — reports welcome.)

---

## Install

```bash
git clone https://github.com/<you>/kyocera-toner-auto-accept.git
cd kyocera-toner-auto-accept
npm install
cp config.example.json config.json
```

Then edit **`config.json`**:

```json
{
  "host": "192.168.1.50",     // your printer's IP address
  "username": "Admin",         // web admin username
  "password": "Admin",         // web admin password
  "snmpCommunity": "public",   // SNMP read community (default "public")
  "chromePath": "",            // leave blank to auto-detect, or set a full path
  "headless": true
}
```

`config.json` is git-ignored so your printer address and password never get
committed. You can also override any value with environment variables:
`KYO_HOST`, `KYO_USER`, `KYO_PASS`, `KYO_SNMP_COMMUNITY`, `CHROME_PATH`.

---

## Usage

Run it whenever the printer is stuck on the toner prompt:

```bash
npm run accept        # or: node index.js
```

- Printer Ready → prints "nothing to do" and exits 0.
- Toner prompt up → acknowledges it and confirms Ready (exit 0), or reports it
  couldn't (exit 1).

Add `--debug` to save step-by-step screenshots into `debug/`, or `--show` to watch
a visible browser window (handy on other models — see Troubleshooting).

### Run it automatically after every outage

Pick your platform. Each example runs the check periodically; it's cheap when idle.

**macOS (launchd)** — create `~/Library/LaunchAgents/com.example.kyocera-accept.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.kyocera-accept</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/full/path/to/kyocera-toner-auto-accept/index.js</string>
  </array>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>/tmp/kyocera-accept.log</string>
  <key>StandardErrorPath</key><string>/tmp/kyocera-accept.log</string>
</dict></plist>
```
```bash
launchctl load ~/Library/LaunchAgents/com.example.kyocera-accept.plist
```

**Linux (cron)** — `crontab -e`:
```
*/2 * * * * /usr/bin/node /full/path/to/kyocera-toner-auto-accept/index.js >> /tmp/kyocera-accept.log 2>&1
```

**Windows (Task Scheduler)** — create a Basic Task that runs every few minutes:
```
Program:   node
Arguments: index.js
Start in:  C:\full\path\to\kyocera-toner-auto-accept
```

The computer has to be on and on the network for this to help after an outage.

---

## Testing

Reproduce the prompt without waiting for a real power cut (this **reboots** the
printer; don't run it mid-job):

```bash
npm run test-trigger   # cold-restarts the printer, waits for the prompt
npm run accept         # then clear it
```

If your printer has SNMP **write** disabled, the trigger won't work — just power-cycle
the printer by hand and run `npm run accept`.

---

## Troubleshooting / other models

The panel is driven by tapping fixed coordinates tuned for the **M5526cdw** touch
panel. On a different model the buttons may sit elsewhere. If the acknowledgement
doesn't land:

1. Run `node index.js --debug` while the prompt is up and look at `debug/*.png` to
   see what the tool sees.
2. Adjust the `TAP_STATUS`, `TAP_NEXT`, `TAP_ACCEPT` coordinates near the top of
   `lib/panel.js` to match your panel.
3. If the dialog's title bar isn't orange on your model, adjust `tonerDialogVisible`.

PRs adding verified coordinates for other models are very welcome.

---

## Security notes

- Your printer's admin password lives in `config.json`, which is **git-ignored**.
  Don't commit it. Use environment variables in shared/CI setups.
- The browser is launched with `--ignore-certificate-errors` because Kyocera
  printers use a self-signed certificate. That setting applies only to this
  throwaway browser profile, which connects **only to your printer**.
- The tool talks only to your printer on your LAN. It makes no other network calls.
- Change the printer's default `Admin`/`Admin` password and consider restricting
  SNMP — see your printer's Command Center RX security settings. (This tool only
  needs SNMP *read*; the test helper needs SNMP *write*, which you can leave off.)

---

## ⚠️ Disclaimer — read this (buyer beware)

This is an **independent, unofficial** project. It is **not** affiliated with,
endorsed by, or supported by Kyocera. "Kyocera" and "ECOSYS" are trademarks of
their respective owners, used here only to describe compatibility.

- **Use at your own risk.** It automates actions on your own equipment. You are
  responsible for deciding whether to run it and for the results.
- It **acknowledges a non-genuine-toner warning** so your printer will keep
  printing on the consumable you installed. Kyocera's panel text states the
  manufacturer "assumes no responsibility for damage caused by a non-genuine
  toner." Using third-party toner, and bypassing this prompt, **may affect your
  warranty, print quality, or hardware** — that's your call, not ours.
- No warranty of any kind. See `LICENSE` (MIT). The authors are **not liable** for
  any damage, downtime, warranty loss, data loss, or other consequences.
- Check your local laws, warranty terms, and any applicable service agreements
  before use. Only run this on **equipment you own or are authorised to manage**.
- It does **not** modify firmware, defeat any encryption, or alter counters,
  calibration, or network settings. It only presses the same on-screen buttons you
  would press yourself.

If any of that isn't acceptable to you, don't use it.

---

## How it works (for the curious)

The printer's embedded web server refuses plain HTTP automation (it returns HTTP
500 to anything without a live browser session), so a **real headless Chrome** is
used. After logging in, the tool asks the printer to start its built-in **Remote
Operation** panel (which opens a VNC listener on port 9061 and issues a session
token), connects to the printer's own noVNC viewer, waits for the panel to paint,
then taps the same **Status → Next → Accept** path a person would. SNMP is used
only to read the front-panel message (to decide whether to act) and, in the test
helper, to cold-restart the device.

## License

[MIT](LICENSE).
