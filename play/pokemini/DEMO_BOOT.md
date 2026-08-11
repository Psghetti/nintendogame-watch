# Demo-boot scripts (skip first-run setup screens)

Attract/preview tiles boot a title with **no player**, so titles that open on a
date/time, language, or name-entry setup screen look broken. This provides
**per-title demo-only auto-input** that walks a freshly-booted instance past its
setup screen(s) to the game's normal state (title / menu / attract).

**Demo-only** — kept off the normal playable path (per Peter's authenticity
call). It only runs when a `demoScript` is supplied.

## Consuming it (front-end)
The table is `web/demo-scripts.json`: `titleId → { rom, method, lands, script }`.
Pass the matching `script` to the device for a demo tile:

```js
import demoScripts from "./demo-scripts.json" assert { type: "json" };
const dev = new PokemonMiniDevice(el, { scale: 2, demoScript: demoScripts["pokemon-tetris"].script });
await dev.mount(); dev.loadBios(bios); dev.loadRom(rom);
// or later: dev.runDemoBoot(script)
```
The device applies the script by **PRC frame number** during its run loop and
`pm_set_keys`. For a real playable instance, simply omit `demoScript`.

## Script format
`script`: array of `{ frame, keys, hold }`.
- `frame` — PRC frame number at which to press (post-boot; setup screens appear ~900–1500).
- `keys` — logical button mask: `1`=A `2`=B `4`=C `8`=Up `16`=Down `32`=Left `64`=Right `128`=Power.
- `hold` — frames to hold before release.

(Note: a keypad bit-order bug — `$2052` had A/C swapped — was fixed while building
this; the games' confirm button is **A** = mask bit 0.)

## Per-title results

| Title | Method | Lands on | Notes |
|---|---|---|---|
| Zany Cards | none | title (START/RECEIVE) | no setup screen; boots straight in |
| Pinball | macro (A×8) | **title** ("PRESS A BUTTON") | ✓ verified |
| Puzzle Collection | macro (A×8) | **attract/gameplay** (Pichu + puzzle) | ✓ verified |
| Puzzle Collection Vol.2 | macro (A×8) | **title** ("GAME START") | ✓ verified |
| Party mini | macro (A×6) | **main menu** (OPTIONS/DELETE DATA) | ✓ verified (A×8 overshoots into OPTIONS) |
| Tetris | macro (A×10) | **title** (START/OPTIONS) | ✓ verified (clears LANGUAGE→SET CLOCK) |
| Race mini | macro | **game-select menu** | ✓ (date → name→END → menu) |
| Pichu Bros. mini | A×16 | **title** (Pichu Bros mini) | ✓ (date + name auto-confirm "A けってい") |
| Togepi's Adventure | A×22 | **intro / game opening** | ✓ (date + name; opens the game) |
| Breeder mini | A×8 (partial) | name-entry (game UI) | ⚠ unresolved — see below |

**9/10 titles reach a clean main/title/menu/attract with a verified macro.**

### Breeder mini — the one unresolved (SURFACED)
Breeder opens on `SET TIME` → a **multi-charset name-entry grid** (uppercase /
lowercase / **katakana**, with in-grid **charset-toggle** cells and a `◄???►`
preset-name selector). Input works fully (the date clears, the cursor moves,
letters enter, the toggle switches charset), but its **`→OK` cell wraps
unpredictably** — Right past the toggle wraps *up* to the preset selector, Left
from column 0 wraps up too — so no blind Down/Right count lands on `→OK`, and
A-spam only enters letters (unlike Pichu/Togepi, where A auto-confirms). Its
current script clears the date/time and reaches the name-entry screen (game art).
**Completing it needs a few seconds of interactive human navigation** (a person
can walk its grid to `→OK` trivially); capture the working sequence with
`test/demoboot.mjs --rom "…Breeder….min" --script '<json>'` (dumps a PNG per
attempt). Template that solved Race: date-clear → enter 1 char → navigate to
END/OK → confirm A.

## How these were derived
Runtime observation in `test/demoboot.mjs` against the real BIOS + ROMs (local,
gitignored, never committed): boot each title, dump the framebuffer, identify the
setup screen and the button that advances it, iterate the macro, and verify the
landing visually. No values guessed.
