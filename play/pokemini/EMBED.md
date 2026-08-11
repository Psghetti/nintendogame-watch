# Embedding the Pokémon mini device (`PokemonMiniDevice`)

A self-contained, multi-instance-safe module that mounts a working Pokémon mini
into any host page. This is **our clean-room code** (module + `pokemini.wasm`) and
is distributable. **No ROM or BIOS is bundled** — the host supplies those bytes
(from its own IndexedDB / user upload); they stay local and are never uploaded.

## Files to drop in
Copy these three files (e.g. into `play/pokemini/`):

| File | What it is |
|---|---|
| `pm-embed.js` | the module (ES module, `export class PokemonMiniDevice`) |
| `audio-worklet.js` | the `pm-sink` AudioWorklet (drains the band-limited square) |
| `pokemini.wasm` | the freestanding wasm32 core (~36 KB) |

By default the module resolves `pokemini.wasm` at `../build/pokemini.wasm` and the
worklet at `./audio-worklet.js` **relative to `pm-embed.js`**. If your layout
differs, pass `wasmUrl` / `workletUrl` in the options (absolute or page-relative
URLs both work).

**Serving:** `.wasm` must be served as `application/wasm`. Audio uses an
AudioWorklet (no SharedArrayBuffer requirement — samples are posted to the
worklet), so cross-origin isolation is **not** required, but is harmless if on.

## Minimal usage
```js
import { PokemonMiniDevice } from "./pm-embed.js";

const dev = new PokemonMiniDevice(containerEl, {
  scale: 2.6,            // device pixel scale (device is 198×254 * scale)
  color: "purple",       // self-made bezel colour: purple|blue|green|red|black
});
await dev.mount();        // builds bezel + canvas, wires input/audio/saves/rewind

// hand it the host-supplied bytes (Uint8Array); nothing is bundled:
dev.loadBios(biosU8);     // the user's BIOS dump
dev.loadRom(romU8);       // the .min ROM
// (the device auto-boots + auto-sets the clock once both are loaded)

// later:
dev.pause(); dev.start(); dev.reset();
dev.teardown();           // cancels rAF, closes audio, flushes save, removes DOM
```

You can also hand content at mount time: `await dev.mount({ bios: biosU8, rom: romU8 })`.
If you omit both, the module falls back to reading keys `"bios"` and `"rom"` from
the shared `pokemini` IndexedDB store (the debug harness uses the same keys).

## Options (constructor `opts`)
| Option | Default | Meaning |
|---|---|---|
| `scale` | `2.6` | integer-ish pixel scale of the whole device |
| `color` | `"purple"` | self-made SVG bezel colour to match the catalogue tile |
| `bezelImage` | `null` | **host-supplied bezel image** (URL or dataURI). When set, it is used as the shell and the LCD canvas overlays the window rect (positioned per the 198×254 / 96×64@51,58 proportions). The self-made SVG is the fallback when this is omitted. |
| `saveKey` | ROM hash | IndexedDB key suffix for this title's EEPROM save (`eeprom:<key>`). Defaults to a hash of the ROM, so saves are **per-title**. |
| `datetimeSeconds` | host now | seed value for the console RTC (see Date/time below) |
| `wasmUrl` / `workletUrl` | relative | override asset locations |

## Console colour vs. host bezel art
- **Colour only:** pass `color: "blue"` (etc.) to tint the original self-made SVG
  bezel. No external asset needed.
- **Real bezel art:** pass `bezelImage: "<url or dataURI>"` to use the catalogue's
  translucent console artwork as the shell. The module positions the LCD canvas
  at the documented window rect. The image is host-owned; the module ships no
  third-party art (the self-made SVG is the only bundled bezel).

## Auto date/time (host clock) — and an important hardware note
On boot the module calls `pm_set_datetime()` with the host's current time
(`new Date()`), which seeds the console **RTC second counter** and starts it
(`STRUN`). Override with `datetimeSeconds`, or call `dev.setDateTime(seconds)`.

**Hardware reality (derived, not assumed):** the Pokémon mini's RTC is a **24-bit
second counter** (registers `$2009–$200B`) — a ~194-day *elapsed* counter, **not
an absolute date/time clock**. There is **no console-level "clock configured"
flag** in RAM/registers/EEPROM. Consequently:
- Seeding the RTC gives games a running, host-derived clock (real-hardware-like),
  but the **absolute date is a per-game concept**: titles that use a calendar
  (e.g. **Pokémon Party mini**) keep their own base and show an interactive
  **set/confirm clock screen at boot** (dismissed with the **B** button). That
  screen is the *game's* behaviour; it is **not** gated on any console state we
  can seed, so it cannot be skipped purely device-side.
- Titles that don't use a calendar (e.g. Zany Cards) boot straight to their title.

So: the auto date/time hook is wired and correct for the console clock, but "no
game ever shows a date prompt" is not achievable via a device-level flag on this
hardware. See the open question raised with the coordinator for how Party-style
clock screens should be handled (accept the one-tap confirm, an optional per-game
auto-confirm macro, or per-title EEPROM date-base injection).

## Multi-instance & teardown
Each `PokemonMiniDevice` instantiates its **own** wasm instance (own linear
memory), so N devices on one page are fully independent (this is how the IR
two-instance link works). `teardown()` releases everything (rAF, AudioContext,
DOM, and a final EEPROM flush). Always call it before removing the container.

## What persists
- **EEPROM saves**: per-title, to IndexedDB key `eeprom:<saveKey>`, flushed
  periodically and on page unload; restored on next mount of the same ROM.
- BIOS/ROM: only if the host chooses to cache them in IndexedDB — the module
  never fetches them from the network.

## Runtime API surface (methods)
`mount(content?)`, `loadBios(u8)`, `loadRom(u8)`, `loadColor(u8)` (`.minc`),
`setDateTime(seconds?)`, `start()`, `pause()`, `reset()`, `teardown()`.
Keyboard when the device element is focused: **←↑↓→** D-pad, **Z**=A, **X**=B,
**C**=C, **P**=Power, **K**=shake, **Backspace**=rewind.
