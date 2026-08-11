# Boot states — instant boot to the main screen (play + demo)

Instead of scripting past each title's date/time/language/name setup on **every**
boot, capture a per-title **main-screen boot state once**, then load it at mount:
"apply the memory state + current time, then power on." Applies to both the
playable path and the tile/drawer previews. Also cleanly solves the titles whose
setup screens re-prompt every boot (the RTC is volatile — see below).

## What a boot state is
The compact, **ROM-excluded** volatile machine state at a title's main screen
(~**14 KB**, vs the 2 MB full save state). Included: RAM (incl. GDRAM/tilemap/
OAM), I/O registers, CPU regs, timers, IRQ flags, LCD controller + persistence
counters, EEPROM, and the cycle counter. **Excluded** (loaded/rebuilt separately):
the cartridge ROM, BIOS, `.minc` colour data, the trace ring, and the audio /
framebuffer / IR ring buffers (transient — reset on load; the screen repaints and
audio refills within a few frames on resume).

⚠ **Content boundary (important):** a boot state is a snapshot of RAM/GDRAM at
the title, so it **embeds the game's title-screen graphics** — it is *game-derived
content*, not our clean-room code. Treat it like the ROMs: `web/pm-states.json`
is **gitignored and must never be committed or shipped**. Generate it locally
(below), or have the browser **capture it on first play** and cache it in
IndexedDB. Only the module + wasm (our code) ship.

## Core ABI
- `pm_boot_state_save() -> size` — serialise the current state into the scratch buffer.
- `pm_boot_state_ptr()` / `pm_boot_state_max()` — scratch buffer for JS I/O.
- `pm_boot_state_load(len)` — deserialise (resets the transient audio/IR buffers).

## Module API
```js
// (a) Instant boot to main screen from a captured state:
const dev = new PokemonMiniDevice(el, { bootState: base64OrU8 /*, demoMode:true for demo tiles*/ });
await dev.mount(); dev.loadRom(rom); dev.loadBios(bios);   // auto-loads the state at boot

// (b) Hybrid: render the live ~4 s slot-in animation first, THEN snap to main screen:
const dev = new PokemonMiniDevice(el, { /* no bootState */ });
await dev.mount(); dev.loadRom(rom); dev.loadBios(bios);   // live boot runs
// ...after N live frames, the HOST calls:
await dev.loadBootState(blob);                              // snaps to the main screen

// (c) Generate a state in-browser (capture-on-first-play), then cache it:
const blob = dev.captureBootState();   // fast-runs demoScript to the main screen; returns Uint8Array (~14 KB)
```
`loadBootState(blob)` (blob = base64 or Uint8Array): loads the snapshot, **re-seeds
the RTC to the current host time**, applies the EEPROM rule, and resumes.

## EEPROM rule (player progress is never lost)
The captured state carries a *clean* main-screen EEPROM. On load:
- **Play path:** if the player has their own per-title EEPROM save in IndexedDB
  (`eeprom:<saveKey>`), it is **restored over** the captured EEPROM — the player's
  save wins. The title screen re-reads it when the player continues/loads.
- **Demo tile:** set `demoMode: true` → the clean captured EEPROM is kept (no
  player save is applied), so previews are deterministic.

## Generating `pm-states.json` (local only)
`node test/capture-states.mjs` boots each title (real BIOS+ROM at
`PM_CONTENT_DIR`), runs its `demo-scripts.json` macro to the main screen,
snapshots the boot state, verifies it reloads to the main screen, and writes the
**gitignored** `web/pm-states.json` (`titleId → { rom, lands, size, state:base64 }`).

## Per-title results (all captured + verified to reload to the main screen)

| Title | Boot-state size | Reloads to |
|---|---|---|
| Zany Cards | 13,883 B | title (START/RECEIVE) |
| Pinball | 13,883 B | title (PRESS A BUTTON) |
| Puzzle Collection | 13,883 B | attract/gameplay |
| Puzzle Vol.2 | 13,883 B | title (GAME START) |
| Party mini | 13,883 B | main menu |
| Tetris | 13,883 B | title (START/OPTIONS) |
| Race mini | 13,883 B | game-select menu |
| Pichu Bros. | 13,883 B | title |
| Togepi | 13,883 B | game intro/opening |
| Breeder mini | 13,883 B | title (START) |

**10/10 boot straight to their main screen**, RTC current, player saves preserved.

## How each main screen was reached during capture
The `demo-scripts.json` macros drive each title to its main screen once (see
`docs/DEMO_BOOT.md`). **Breeder** — the previously-unresolved multi-charset
name-entry grid — was solved: clear the date (A×7), **fill the name to full
length** (A×5 — its `→OK` only confirms a full name), then Down×5 / Right×9 onto
`→OK` and A. That reaches its title, and the snapshot makes it instant thereafter.
