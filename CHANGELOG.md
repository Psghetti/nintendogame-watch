# Changelog

All notable changes to this project are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

_Nothing yet — new changes land here, then move into a dated version on release._

## [1.2.0] — 2026-08-05

### Added
- **Super Mario Bros. Special** (YM-901-S, 1987) — the ultra-rare Table Top
  competition prize is now playable. It runs the standard Super Mario Bros. game
  (a byte-identical ROM) inside its gold flip-lid cabinet, with a live tile and
  drawer preview and a foam-aware drawer sheen (matte foam, glossy case/screen).
- **Ball (reissue)** (RGW-001, 2010) — the Club Nintendo reissue of the very
  first Game & Watch is now playable, running the original AC-01 ROM (the
  reissue's own firmware was never dumped; the added mute is covered by the
  built-in software mute).
- **Multi Screen save thumbnails now show BOTH LCD screens.** Stacked units
  (Zelda, Bomb Sweeper, Gold Cliff, DK-52…) get a two-screen thumbnail in a 4×2
  grid; side-by-side units (Mario Bros., Lifeboat…) a 2×3 grid — so a save slot
  finally shows what's actually happening on screen.

### Changed
- Save/load thumbnails are higher-resolution and reproduce each screen's exact
  in-game proportions — no more squish or blur.
- The on-screen emulator diagnostic counter (fps/frame/etc.) is hidden in normal
  play; it now appears only in **Developer Mode**.
- Removed the scrollbar from the save/load panel.

### Fixed
- Multi Screen arrow-key press art (Bomb Sweeper, Gold Cliff, Zelda) no longer
  balloons to full-screen — the d-pad highlights the pressed button instead.
- **Light mode:** Super Mario Bros. (Special) no longer shows a white border
  around the cut-out device, and the save panel's Load/Delete buttons are legible
  again (they were light-green/red on a light background).

## [1.1.0] — 2026-08-03

### Added
- **TFT twin audio now sounds like the real hardware.** The Mario/Zelda STM32H7
  twin plays through a software **small-speaker model**, so the wideband "crackle"
  of the raw firmware output is smoothed and the drums blend into percussion —
  matching the physical unit's tiny speaker. This is the one settled-on "Device"
  voicing; loading your own firmware is required for the twin to make any sound.
- **Visual Filmstrip Rewind** for the classic emulator — hold the ◄◄ button (next
  to Pause) or **Ctrl + ←** to scrub backward through play with a VHS scan-band
  effect, then release to resume. ~60s of instant, no-buffer history; the effect
  is pinned to the LCD glass and covers both screens on Multi Screen titles.
- **Content pack loader** (Settings → Content) — instead of running the builder,
  you can open a single **.zip** of your own dumps + segment SVGs + colour-unit
  flash, and the site identifies everything in-browser exactly as the builder does
  (ROMs/SVGs by SHA-256, colour units by size-pairing; nested .zip archives are
  recursed). It's stored in IndexedDB so it persists across visits, works for both
  the classic emulators and the Mario/Zelda TFT twin, and uploads nothing. If the
  pre-built content is installed it still takes precedence. When content is
  missing, a "Batteries not included" banner offers the pack directly; the
  "install it locally" (builder) option is shown only when served from
  localhost, since it can't affect a remote/GitHub Pages deployment.

### Fixed
- **Device drawer would not open** (all titles): clicking a tile paused the live
  previews and then threw before the drawer appeared. A stray variable rename had
  left `emLineChartSVG` referencing an undefined `color`; also repaired 10 CSS
  `transition` rules that had become invalid.
- **Selected top-nav item hover** now uses a lighter shade of the *current* accent
  colour instead of a hardcoded green, with a clearer light/dark difference.

### Performance
- Rewind history is now allocated only for the interactive play window, not for
  every live tile/drawer preview — opening the catalogue and drawer stays smooth.

## [1.0.0] — Initial public release

- First community release: **code only, no Nintendo content**. All ROMs, segment
  artwork and colour-unit firmware are rebuilt locally from your own dumps with
  `firmware/build_gnw_roms.ps1` (see `README.md`).
- 59 classic Game & Watch devices (SM5A / SM510 / SM511 / SM512 emulation),
  the STM32H7 TFT twin (Mario / Zelda), manual booklets, a series timeline,
  12-slot save states, and a local collection tracker.
- Non-commercial licensing (PolyForm Noncommercial 1.0.0 for code, CC BY-NC-SA
  4.0 for original assets) — see `licenses/`.

<!-- Note: set the real 1.0.0 tag/date when you cut it in git; left undated here
     rather than guess. Move items from [Unreleased] into a dated version section
     each time you push a new release. -->
