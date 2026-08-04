/*
 * gnw.js — Game & Watch SM5A emulator (Vermin, Ball, ...)
 * For nintendogame.watch — personal use only.
 */
(function () {
'use strict';

// ─── Games registry ─────────────────────────────────────────────────────────
// Everything that differs between titles lives here — the CPU core, display,
// audio, and emulator plumbing below are all game-agnostic. ROMs are
// zero-padded to 2048 bytes and embedded as base64 (no server-side ROM file
// needed). clockRam offsets were found by tracing which RAM cells count up
// while holding the Time input in a headless simulation (see doco/).
// hotspot/screen percentages are of the device artwork's own canvas
// (measured via ImageMagick -trim on each button's pressed-state PNG, and
// from each game's MAME layout file for the screen-glass box).

/* The Crystal Screen units (Super Mario Bros. YM-801, Climber DR-802,
   Balloon Fight BF-803) are all the same see-through shell, so the parts of
   their layout that describe the SHELL rather than the game are shared here
   instead of being pasted into three entries that could then drift.

   Percentages of the MAME canvas (3273x1398), read off the "Unit Only" view
   of each unit's default.lay -- all three agree on every number below.
   Only the LCD panel bounds differ per title, so `screen` stays in each
   entry.

   bg is NOT the same box as `screen`, unlike every opaque-screened title in
   this file where the backing and the segments share one rect: MAME insets
   the backing slightly inside the panel (930,265,1414x864 vs the segments'
   ~885,239,1489x908) and that inset is visible, so they're kept apart. */
const CRYSTAL_SHELL = {
  bg:       { left: 28.415, top: 18.955, width: 43.202, height: 61.803 },  // 930,265,1414x864
  gradient: { left: 27.376, top: 16.381, width: 45.432, height: 67.167 },  // 896,229,1487x939
  // Alpha values are MAME's own, straight from the layout's <colour alpha>.
  bgOverlayAlpha: 0.1,   // the backing, drawn AGAIN over the segments
  gradientAlpha:  0.05,
  gradient2Alpha: 0.1,
};

/* Same shell -> same buttons, so all three Crystal titles share these.

   Derived the same way as every other title here (opaque bounding box of
   each button's own pressed-state PNG), but with one wrinkle worth
   recording: Balloon Fight's overlays are drawn with a much wider glow than
   Climber's and Super Mario Bros.', so a naive trim reads its d-pad at
   284x284 against their 156x156, and its Jump at 366 against their 201.
   They are the same physical buttons -- every centre matches exactly (Up
   463,788; Left 304,925; Jump 2826,996) and Time/Game trim identically on
   all three. So these use the tight bounds that two of the three agree on,
   rather than Balloon Fight's halo.

   No Alarm hotspot: the Crystal layouts model no alarm button (Time and
   Game are the only mode overlays), even though the shared ROM supports one
   -- inputRows still carries the bit so the ROM sees the port it expects. */
const CRYSTAL_HOTSPOTS = {
  time:  { left: 7.791,  top: 27.182, width: 6.966, height: 16.309 },  // 255,380,228x228
  gameA: { left: 13.657, top: 27.182, width: 6.966, height: 16.309 },  // 447,380,228x228
  up:    { left: 11.763, top: 50.787, width: 4.766, height: 11.159 },  // 385,710,156x156
  down:  { left: 11.763, top: 70.243, width: 4.766, height: 11.159 },  // 385,982,156x156
  left:  { left: 6.905,  top: 60.586, width: 4.766, height: 11.159 },  // 226,847,156x156
  right: { left: 16.652, top: 60.586, width: 4.766, height: 11.159 },  // 545,847,156x156
  jump:  { left: 83.288, top: 64.092, width: 6.141, height: 14.378 },  // 2726,896,201x201
};

/* The three Micro Vs. System units (Boxing BX-301, Donkey Kong 3 AK-302,
   Donkey Kong Hockey HK-303) are one shell with one input harness, so the
   parts that describe the harness rather than the game live here.

   Wiring is MAME's own microvs_shared port block, verbatim -- player 2 and
   player 1 mirrored across S1..S6 with the mode buttons together on S7.
   These are the first titles here that scan past S4 and the first with two
   players at all; reaching S7 needed the W register widened from 4 bits to
   the hardware's 8 (see SM510.shiftW). */
const MICROVS_INPUT_ROWS = [
  { p2fire: 4 },                             // S1: bit2 = P2 button
  { fire: 1 },                               // S2: bit0 = P1 button
  { p2down: 4, p2up: 8 },                    // S3
  { down: 1, up: 2 },                        // S4
  { p2right: 4, p2left: 8 },                 // S5
  { right: 1, left: 2 },                     // S6
  { time: 1, gameB: 2, gameA: 4, alarm: 8 }, // S7
];

/* Only the three mode buttons are clickable, and that's not an omission.

   MAME's Micro Vs. artwork draws the console ALONE -- the two detachable
   controllers appear only in the backdrop photograph, never on the unit --
   and it ships pressed-state art for Game A, Game B and Time and nothing
   else. So there is no button art to trim joystick hotspots out of (the way
   every other title's hotspots here were measured), and nothing on the case
   to click even if there were. MAME plays these from the keyboard for the
   same reason. Both players' sticks and buttons come from the keyboard and
   the on-screen control bar instead.

   Trimmed from each unit's real pressed-state PNGs; identical on all three,
   as you'd expect from one shell. Canvas 1474x807. */
const MICROVS_HOTSPOTS = {
  gameA: { left: 85.482, top: 24.040, width: 6.445, height: 11.896 },  // 1260,194,95x96
  gameB: { left: 85.482, top: 32.962, width: 6.445, height: 11.896 },  // 1260,266,95x96
  time:  { left: 85.482, top: 41.760, width: 6.445, height: 11.896 },  // 1260,337,95x96
};

/* Table Top cabinet controls, shared by Snoopy SM-73 and Popeye PG-74.

   The Table Top shell is ONE chassis -- measured, not assumed: across the
   Snoopy, Popeye and Donkey Kong Jr. cabinet art the joystick trims to the
   same blob (~136,725 45x107, centre 159,778), the action button to the same
   434,784 71x57, and the three mode pills to the same 333/391/451 at y=738,
   all on the same 634x1011 canvas. Only the marquee and the colours differ
   (Snoopy/Popeye are red where DK Jr is orange).

   Donkey Kong Jr. keeps its own hotspots rather than sharing these: same
   geometry, but its ROM reads a 4-way pad (btn1..btn4) where these two read
   only left/right plus one action button -- see their inherited inputRows.

   Measured the same way as GAMES.dkjrt's, and with the same caveat: this
   bundle ships no pressed-state art for the cabinet (see noPressedArt), so
   these come from colour-trimming the cabinet itself. The printed ◁ ▷ glyphs
   sit at y=818 either side of the stick, which is what puts the pivot there;
   the left/right boxes are a symmetric pair on that measured axis. There is
   no up/down arrow on this panel and the ROM reads neither. */
const TABLETOP_LR_HOTSPOTS = {
  left:  { left: 9.464,  top: 78.932, width: 10.410, height: 3.956 },
  right: { left: 30.284, top: 78.932, width: 10.410, height: 3.956 },
  jump:  { left: 68.454, top: 77.547, width: 11.199, height: 5.638 },  // 434,784 71x57
  gameA: { left: 52.524, top: 72.997, width: 5.363,  height: 1.780 },  // 333,738 34x18
  gameB: { left: 61.672, top: 72.997, width: 5.521,  height: 1.780 },  // 391,738 35x18
  time:  { left: 71.136, top: 72.997, width: 5.363,  height: 1.780 },  // 451,738 34x18
};

/* Mario's Cement Factory sits on the same shell with the same boxes -- its
   controls trim to the same pixels as Snoopy's and Popeye's -- but its action
   button is OPEN (it drops the cement bucket), not Hit/Punch. That's a
   different BUTTON_DEFS entry and a different bit in its own inputRows, so
   the geometry is reused while the name isn't. */
const TABLETOP_CM_HOTSPOTS = {
  left:  TABLETOP_LR_HOTSPOTS.left,
  right: TABLETOP_LR_HOTSPOTS.right,
  open:  TABLETOP_LR_HOTSPOTS.jump,   // same box on the case, different button
  gameA: TABLETOP_LR_HOTSPOTS.gameA,
  gameB: TABLETOP_LR_HOTSPOTS.gameB,
  time:  TABLETOP_LR_HOTSPOTS.time,
};

const GAMES = {
  vermin: {
    title: 'Vermin', subtitle: 'MT-03 · 1980',
    artPath: 'artwork/gnw_vermin/',
    svgPath: 'artwork/gnw_vermin/gnw_vermin.svg',
    clockRam: { hT: 64, hO: 65, mT: 66, mO: 67, sT: 68, sO: 69 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    hotspots: {
      left:  { left: 4.09,  top: 58.53, width: 18.05, height: 26.80 },
      right: { left: 77.91, top: 58.53, width: 18.05, height: 26.80 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    // inputRows[i] = the named buttons wired to hardware input row IN.i,
    // each mapped to the K-bit it sets on that row. Vermin/Ball only define
    // IN.0 (MAME's inp_fixed_last() makes it the sole, always-read row —
    // no R-based row selection needed since there's nothing else to
    // disambiguate it from). fixedRow says which row that is.
    inputRows: [ { time: 1, gameB: 2, gameA: 4 } ],
    fixedRow: 0,
  },

  ball: {
    title: 'Ball', subtitle: 'AC-01 · 1980',
    artPath: 'artwork/gnw_ball/',
    svgPath: 'artwork/gnw_ball/gnw_ball.svg',
    clockRam: { hT: 72, hO: 73, mT: 74, mO: 75, sT: 76, sO: 60 },
    screen: { left: 27.91, top: 23.26, width: 44.00, height: 44.12 },
    // Real hardware has two black "hiding line" masking strips printed into
    // the LCD glass near the left/right edges of the screen (visible at all
    // times, game running or not -- they hide the glass's internal wiring,
    // not a game element). MAME's own default.lay never draws them in its
    // photo-realistic views (Handheld_Game_Artwork/DarthMarino_Artwork) --
    // only its flat schematic "Backdrop_Only" view composites Background2.png
    // back in, since that view skips the real device photo entirely. Our
    // Unit.png IS the real device photo, but its screen cutout is blank
    // (confirmed by cropping it), so the lines never made it in from there
    // either -- Background2.png has to be drawn as its own layer on top.
    hideLines: true,
    hotspots: {
      left:  { left: 4.99,  top: 59.93, width: 16.26, height: 24.20 },
      right: { left: 78.72, top: 59.93, width: 16.26, height: 24.20 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    inputRows: [ { time: 1, gameB: 2, gameA: 4 } ],
    fixedRow: 0,
  },

  flagman: {
    title: 'Flagman', subtitle: 'FL-02 · 1980',
    artPath: 'artwork/gnw_flagman/',
    svgPath: 'artwork/gnw_flagman/gnw_flagman.svg',
    clockRam: { hT: 68, hO: 69, mT: 70, mO: 71, sT: 72, sO: 73 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    // No hammers at all — every button reads through K. The 4 flag-position
    // buttons (IN.1) and Game A/B/Time (IN.2) are genuinely separate hardware
    // rows selected by R (see SM5A.step()'s KTA case and hh_sm510.cpp's
    // piezo_input_w) — NOT a flat OR of one merged bitmask, despite each row
    // reusing the same bit positions internally.
    hotspots: {
      btn1:  { left: 5.75,  top: 55.93, width: 14.73, height: 21.87 },
      btn2:  { left: 79.93, top: 55.93, width: 14.73, height: 21.87 },
      btn3:  { left: 5.75,  top: 73.67, width: 14.73, height: 21.87 },
      btn4:  { left: 79.93, top: 73.67, width: 14.73, height: 21.87 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 } ],
  },

  fire: {
    title: 'Fire', subtitle: 'RC-04 · 1980',
    artPath: 'artwork/gnw_fires/',
    svgPath: 'artwork/gnw_fires/gnw_fires.svg',
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59 },
    // Same case mold as Vermin/Ball (2227x1500 canvas, identical button
    // positions) — this is the correct Silver-series Fire (gnw_fires,
    // driver rom "rc-04"). The previous romB64 here was actually from
    // gnw_fire ("Fire (Wide Screen)", rom "fr-27"), a different, later
    // release with a different ROM/case — that mismatch was the root
    // cause of Fire's "shows all segments, can't start game" bug.
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    hotspots: {
      left:  { left: 4.09,  top: 58.53, width: 18.05, height: 26.80 },
      right: { left: 77.91, top: 58.53, width: 18.05, height: 26.80 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    // gnw_fires_state calls inp_fixed_last() just like Vermin/Ball — a
    // single, always-read input row, no R-based mux needed.
    inputRows: [ { time: 1, gameB: 2, gameA: 4 } ],
    fixedRow: 0,
  },

  judge: {
    title: 'Judge', subtitle: 'IP-05 · 1980',
    artPath: 'artwork/gnw_judge/',
    svgPath: 'artwork/gnw_judge/gnw_judge.svg',
    // RAM 2/3/6/7 are just a *display* buffer — traced live (instruction by
    // instruction): the ROM periodically copies a 6-digit block from 18-23
    // into 2-7 (18->2, 19->3, 20->4, 21->5, 22->6, 23->7) to refresh the
    // clock digits, discarding whatever we'd poked into 2/3/6/7 on its next
    // refresh. 18/19 (hour tens/ones) and 22/23 (minute tens/ones) are the
    // real, persistent counters — poking *those* instead lets the ROM's own
    // copy carry our value forward permanently, rather than fighting it.
    // 20/21 (seconds, presumably) aren't part of the visible display.
    clockRam: { hT: 18, hO: 19, mT: 22, mO: 23, sT: 100, sO: 101 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    // No hammers — P1/P2 each get a Hit and a Dodge button (a 2-player duel game),
    // a genuinely separate hardware row (IN.1) from Game A/B/Time (IN.2),
    // selected by R the same way as Flagman/Manhole/Lion. IN.1 bit
    // assignments from the MAME layout: 1=P1 Hit(bit3), 2=P2 Hit(bit1),
    // 3=P1 Dodge(bit2), 4=P2 Dodge(bit0).
    hotspots: {
      btn1:  { left: 5.75,  top: 55.93, width: 14.73, height: 21.87 },
      btn2:  { left: 79.93, top: 55.93, width: 14.73, height: 21.87 },
      btn3:  { left: 5.75,  top: 73.67, width: 14.73, height: 21.87 },
      btn4:  { left: 79.93, top: 73.67, width: 14.73, height: 21.87 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, { btn1: 8, btn2: 2, btn3: 4, btn4: 1 } ],
  },

  manhole: {
    title: 'Manhole', subtitle: 'MH-06 · 1981',
    artPath: 'artwork/gnw_manhole/',
    svgPath: 'artwork/gnw_manhole/gnw_manhole.svg',
    // pmBit: same clockRam addresses (54-59) and same hour-tens spare-bit
    // AM/PM convention as Popeye/Octopus/Parachute/Chef — see the pmBit
    // comment in _syncClockToNow().
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    // No hammers — 4 directional buttons (up/down on each side), a genuinely
    // separate hardware row (IN.1) from Game A/B/Time (IN.2), same scheme as
    // Flagman/Judge/Lion.
    hotspots: {
      btn1:  { left: 5.75,  top: 55.93, width: 14.73, height: 21.87 },
      btn2:  { left: 79.93, top: 55.93, width: 14.73, height: 21.87 },
      btn3:  { left: 5.75,  top: 73.67, width: 14.73, height: 21.87 },
      btn4:  { left: 79.93, top: 73.67, width: 14.73, height: 21.87 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, { btn1: 8, btn2: 2, btn3: 4, btn4: 1 } ],
  },

  helmet: {
    title: 'Helmet', subtitle: 'CN-07 · 1981',
    artPath: 'artwork/gnw_helmet/',
    svgPath: 'artwork/gnw_helmet/gnw_helmet.svg',
    // Same "only recognises GameA/GameB/Time from a fresh reset" ROM
    // behaviour as Manhole/Judge/Lion/Flagman — confirmed directly: holding
    // Game A across a normal frame-loop press (any phase, any duration up
    // to a full second) never changed CPU RAM at all versus not pressing it
    // at all, but holding it through the reset/reboot sequence does. Was
    // previously missed because _resetWithButtonHeld()/_needsMinHold() gate
    // on _hasQuadButtons() (a proxy that happens to match the other four
    // titles but not Helmet, which has no btn1-4 direction pad). See
    // needsResetForModeButtons in _needsMinHold()/_resetWithButtonHeld().
    needsResetForModeButtons: true,
    // Helmet ALSO needs hammersNeedQuickTap — it's the second title (with Chef)
    // to combine hotspots.left/right with needsResetForModeButtons, so without
    // this its Left/Right hit the mode-button 5s extended hold in _needsMinHold()/
    // _delayedRelease() and stay logically held ~5s after release; the ROM never
    // sees the movement button go back up, so left/right movement looks dead.
    // (The hammersNeedQuickTap comment in _needsMinHold() assumed only Chef hit
    // this combination — Helmet was missed.)
    hammersNeedQuickTap: true,
    // Reuses the lamp-test-dismiss auto-tap in startAttract() for a
    // different reason: Helmet's boot screen is frozen (not animating)
    // until a Time tap runs the debounce chain that re-arms the display's
    // TW commit opcode (see the inputRows comment below) — same brief
    // press-then-release mechanism as the lamp-test titles, so it reuses
    // this flag rather than adding a near-identical second code path.
    lampTestOnBoot: true,
    // pmBit: same clockRam addresses (54-59) and same hour-tens spare-bit
    // AM/PM convention as Popeye/Octopus/Parachute/Chef — see the pmBit
    // comment in _syncClockToNow().
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    hotspots: {
      left:  { left: 4.09,  top: 58.53, width: 18.05, height: 26.80 },
      right: { left: 77.91, top: 58.53, width: 18.05, height: 26.80 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    // Time/GameB/GameA are also mirrored onto row 0: confirmed via MAME
    // instruction-trace comparison that a KTA read of rows 0+1 (R=7) right
    // after a mode-button press must see a changed value there to pass a
    // debounce check that gates the display-refresh (TW) opcode ever firing
    // again - without this mirror our emulation always reads 0 on rows 0/1
    // (matching MAME's driver, which marks them factory-test/unused DIP
    // switches) and the debounce never detects a change, so the display
    // freezes after the initial press. Real hardware evidently does see a
    // transient signal there on any mode-button press; this reproduces that
    // observed effect without a known root hardware cause.
    inputRows: [ { time: 1, gameB: 2, gameA: 4 }, {}, { time: 1, gameB: 2, gameA: 4 } ],
  },

  lion: {
    title: 'Lion', subtitle: 'LN-08 · 1981',
    artPath: 'artwork/gnw_lion/',
    svgPath: 'artwork/gnw_lion/gnw_lion.svg',
    // pmBit: same clockRam addresses (54-59) and same hour-tens spare-bit
    // AM/PM convention as Popeye/Octopus/Parachute/Chef — see the pmBit
    // comment in _syncClockToNow().
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 27.84, top: 23.27, width: 44.23, height: 44.13 },
    // No hammers — 4 directional buttons, a genuinely separate hardware row
    // (IN.1) from Game A/B/Time (IN.2), same scheme as Flagman/Judge/Manhole.
    // MAME notes this game doesn't handle simultaneous button presses
    // correctly on real hardware either (BTANB, not our bug).
    hotspots: {
      btn1:  { left: 5.75,  top: 55.93, width: 14.73, height: 21.87 },
      btn2:  { left: 79.93, top: 55.93, width: 14.73, height: 21.87 },
      btn3:  { left: 5.75,  top: 73.67, width: 14.73, height: 21.87 },
      btn4:  { left: 79.93, top: 73.67, width: 14.73, height: 21.87 },
      gameA: { left: 45.80, top: 77.80, width: 12.21, height: 18.13 },
      gameB: { left: 56.35, top: 77.80, width: 12.21, height: 18.13 },
      time:  { left: 66.82, top: 77.80, width: 12.21, height: 18.13 },
    },
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, { btn1: 8, btn2: 2, btn3: 4, btn4: 1 } ],
  },

  pchute: {
    title: 'Parachute', subtitle: 'PR-21 · 1981',
    artPath: 'artwork/gnw_pchute/',
    svgPath: 'artwork/gnw_pchute/gnw_pchute.svg',
    // pmBit: verified via direct LCD-segment diffing — see the pmBit
    // comment in _syncClockToNow(). Same Wide Screen clock ROM as Octopus/
    // Popeye/Chef, same bit.
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    hotspots: {
      left:  { left: 4.02,  top: 58.58, width: 15.24, height: 25.21 },
      right: { left: 80.54, top: 58.58, width: 15.24, height: 25.21 },
      gameA: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      gameB: { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // Same shape as Ball/Vermin's hammers, but R-gated (no fixedRow) like
    // Manhole/Lion — Game A/B/Time live on inputRows[1], confirmed via
    // headless simulation (holding Time visibly switches the LCD out of
    // its attract/lamp-test pattern into a clock display).
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, {} ],
    // The B/BA hammer pins drive the opposite on-screen side from every
    // other hammer title (confirmed live: pressing the left hotspot moved
    // the right-side action) — swapHammers crosses them in _readInputs()/
    // _updateButtonArt() only, so hotspot positions and button art stay put.
    swapHammers: true,
    // Boots into a lamp-test screen like the quad-button titles, but has
    // no btn1-4 so _hasQuadButtons() misses it — lampTestOnBoot tells
    // startAttract() to tap Time to dismiss it (confirmed live: demo mode
    // otherwise never leaves the lamp test).
    lampTestOnBoot: true,
  },

  octopus: {
    title: 'Octopus', subtitle: 'OC-22 · 1981',
    artPath: 'artwork/gnw_octopus/',
    svgPath: 'artwork/gnw_octopus/gnw_octopus.svg',
    // pmBit: verified via direct LCD-segment diffing — see the pmBit
    // comment in _syncClockToNow(). Same Wide Screen clock ROM as
    // Parachute/Popeye/Chef, same bit.
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    hotspots: {
      left:  { left: 4.02,  top: 58.58, width: 15.24, height: 25.21 },
      right: { left: 80.54, top: 58.58, width: 15.24, height: 25.21 },
      gameA: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      gameB: { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // Same shape as Ball/Vermin's hammers, but R-gated (no fixedRow) like
    // Manhole/Lion — Game A/B/Time live on inputRows[1], confirmed via
    // headless simulation (holding Time visibly switches the LCD out of
    // its attract/lamp-test pattern into a clock display).
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, {} ],
    // Same B/BA reversal as Parachute — see swapHammers there.
    swapHammers: true,
    // Same lamp-test-on-boot as Parachute — see lampTestOnBoot there.
    lampTestOnBoot: true,
  },

  popeye: {
    title: 'Popeye', subtitle: 'PP-23 · 1981',
    artPath: 'artwork/gnw_popeye/',
    svgPath: 'artwork/gnw_popeye/gnw_popeye.svg',
    // pmBit: the hour-tens RAM cell only ever needs bit 0 for its own digit
    // (0 or 1) — this ROM repurposes bit 3 of that same nibble as the AM/PM
    // flag rather than spending a whole extra cell on it. Confirmed by
    // direct LCD-segment diffing: forcing this bit on/off with the clock
    // display showing (not lamp-test/attract) toggles exactly one segment
    // pair (5.1.1 off / 5.2.1 on) and nothing else — see the pmBit comment
    // in _syncClockToNow() for how it's applied. Same bit on Parachute/
    // Octopus/Chef (same underlying Wide Screen clock ROM).
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    hotspots: {
      left:  { left: 4.02,  top: 58.58, width: 15.24, height: 25.21 },
      right: { left: 80.54, top: 58.58, width: 15.24, height: 25.21 },
      gameA: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      gameB: { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // Same shape as Ball/Vermin's hammers, but R-gated (no fixedRow) like
    // Manhole/Lion — Game A/B/Time live on inputRows[1], confirmed via
    // headless simulation (holding Time visibly switches the LCD out of
    // its attract/lamp-test pattern into a clock display).
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4 }, {} ],
    // Same B/BA reversal as Parachute — see swapHammers there.
    swapHammers: true,
    // Same lamp-test-on-boot as Parachute — see lampTestOnBoot there.
    lampTestOnBoot: true,
    // Game A's own ROM never manages to commit its "active game" RAM cell
    // (0x30 <- 4) under our emulation: its mode-select dispatch is much
    // longer than Game B/Time's, and an unrelated write elsewhere in the
    // same dispatch collides with the RAM cell its own button-debounce
    // relies on, so the debounce never confirms and the commit never runs —
    // verified directly against a live MAME instruction trace, reproducible
    // at every button-press timing tried, not a one-off. Game B and Time
    // reliably commit via the exact same mechanism, so this is unique to
    // Game A's specific dispatch path. commitAssist performs the same RAM
    // write the ROM's own commit instruction would have made, held for as
    // long as Game A is the selected mode (see _frame()) — yieldsTo lets
    // Game B/Time's own working commit take back over if the player
    // switches modes.
    commitAssist: { holdButton: 'gameA', ramAddr: 0x30, value: 4, yieldsTo: ['gameB', 'time'] },
  },

  chef: {
    title: 'Chef', subtitle: 'FP-24 · 1981',
    artPath: 'artwork/gnw_chef/',
    svgPath: 'artwork/gnw_chef/gnw_chef.svg',
    // pmBit: same convention as Parachute/Octopus/Popeye, different
    // addresses (36-41 here vs their 54-59) — confirmed correct on its
    // own; a garbled/corrupted-looking display at PM hours turned out to
    // be a separate bug (Time held too long — see timeIsFastForward
    // below), not this bit.
    clockRam: { hT: 36, hO: 37, mT: 38, mO: 39, sT: 40, sO: 41, pmBit: 8 },
    // Same "only recognises GameA/GameB/Time from a fresh reset" behaviour
    // as Helmet/Manhole/Judge/Lion/Flagman — no btn1-4, so _hasQuadButtons()
    // misses it. See needsResetForModeButtons in _needsMinHold()/
    // _resetWithButtonHeld().
    needsResetForModeButtons: true,
    // See the timeIsFastForward comment in _needsMinHold(): a real user's
    // Time click must NOT get the same 5s extended hold GameA/GameB need,
    // or Chef's ROM treats it as a clock-set gesture and corrupts the
    // displayed digits.
    timeIsFastForward: true,
    // See the hammersNeedQuickTap comment in _needsMinHold(): the catch
    // mechanic needs a real, brief hammer tap.
    hammersNeedQuickTap: true,
    // See the modeButtonsRegisterQuickly comment in _needsMinHold(): now
    // that rMuxInvert (below) fixes real GameA/GameB registration, the old
    // 5s extended hold does more harm than good — it left Chef's own
    // "wait for the mode button to be released" gameplay-start check stuck
    // re-polling a stale hold for up to 5 real seconds.
    modeButtonsRegisterQuickly: true,
    // See the readInputRows() comment on SM5A for what this actually does
    // and why it's Chef-only rather than a universal SM5A fix — the real
    // root cause of Game A/Time getting permanently stuck on the boot lamp
    // tableau (never reaching gameplay, not just a slow-to-settle sweepFix
    // gap).
    rMuxInvert: true,
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    hotspots: {
      left:  { left: 4.02,  top: 58.58, width: 15.24, height: 25.21 },
      right: { left: 80.54, top: 58.58, width: 15.24, height: 25.21 },
      gameA: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      gameB: { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // Chef has no dedicated hammer pins — left/right and Game A/B/Time are
    // all K-line bits, confirmed against the real MAME driver source
    // (hh_sm510.cpp gnw_chef_state): IN.0 (row 0) is entirely unused,
    // IN.1 (row 1) has Right(0x04)/Left(0x08), IN.2 (row 2) has
    // Time(0x01)/GameB(0x02)/GameA(0x04)/Alarm(0x08). The previous config
    // here had left/right and the mode buttons each shifted one row off
    // from real hardware, which was consistent enough to look plausible
    // in isolated headless testing but left every button reading from the
    // wrong row against the actual ROM.
    inputRows: [ {}, { right: 4, left: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
    // Same lamp-test-on-boot as Parachute — see lampTestOnBoot there. Chef
    // has no fixedRow and no btn1-4, so it hits the same startAttract() gap.
    lampTestOnBoot: true,
    // No attractKick here (deliberately, after trying and removing one —
    // see git history): captured real MAME screenshots (video:snapshot)
    // of gnw_chef at boot, after 20s of pure idle with zero input, and
    // after holding Game A. Boot and 20s-idle are pixel-identical — the
    // "busy" all-4-chefs-plus-cat-plus-mouse tableau with the clock
    // ticking in the corner IS Chef's genuine, correct idle appearance on
    // real hardware, not a stuck lamp test. Holding Game A instead shows
    // a clean single/few-sprite walking animation with a live score —
    // matching our own emulator's behaviour exactly once the input-row and
    // SVG-rendering bugs were fixed. So Chef's plain Time-tap boot state
    // (once its clock is actually ticking) already matches the other
    // titles' demo intent; forcing it into Game A via a kick was actively
    // wrong, not a workaround for a missing feature.
    // Popeye/Fire's Game A commit-collision bug showed up here too, at first
    // masquerading as a much deeper problem: holding Game A used to send our
    // CPU's execution genuinely diverging from real hardware a couple of
    // frames in, eventually wandering into a CEND (sleep) real hardware's
    // ROM never calls at all while Game A is held. A whole mechanism
    // (`sweepFix`, since removed — see git history around 2026-07-09/10 for
    // the full investigation) force-corrected the RAM state every frame to
    // paper over this, at the cost of a multi-second real settle time (it
    // had to skip the normal fast reset boot-loop entirely to avoid
    // retriggering the divergence). Root cause turned out to be simpler and
    // upstream of all that: `readInputRows()`'s R-to-input-mux formula (see
    // the SM5A class) was wrong specifically for Chef, feeding a garbled
    // debounce read that sent the ROM down the diverging path in the first
    // place — see `rMuxInvert` below. With that fixed, Chef boots through
    // the same fast, un-skipped reset every other title uses, no ongoing
    // RAM correction needed.
  },

  mmouse: {
    title: 'Mickey Mouse', subtitle: 'MC-25 · 1981',
    artPath: 'artwork/gnw_mmouse/',
    svgPath: 'artwork/gnw_mmouse/gnw_mmouse.svg',
    // Same clockRam addresses as Chef (36-41) — confirmed independently two
    // ways: (1) the ROM's own natural boot-time default write (traced via a
    // raw cpu.step() loop with no external sync) writes ram[36]=1,ram[37]=2
    // at cycle ~192-193, matching the default "12" hour shown on real boot;
    // (2) after _syncClockToNow(), ram[36..41] read back exactly the real
    // wall-clock h/m/s digits. pmBit here is 2, not Popeye/Chef's 8 — this
    // ROM packs the hour-tens digit itself into just bit0 (always 0 or 1,
    // since 12-hour tens digit is only ever "0" or "1") and repurposes bit1
    // as AM/PM, not bit3. An earlier exhaustive single-bit-toggle scan
    // (every RAM cell x every bit, filtered for an "isolated 1-3 segment"
    // LCD change) missed this because the real AM/PM indicator spells out
    // "AM"/"PM" as text, lighting more than 3 segments at once — outside
    // that filter. Found instead by directly poking real MAME's RAM to
    // 11:59:57 and 12:59:57 and watching the natural noon/1PM rollover:
    // ram[36] (hT) went 1->3 exactly at the 11:59:59->12:00:00 boundary
    // (0001->0011: tens-digit bit0 unchanged, new bit1 appears) and 3->2 at
    // 12:59:59->1:00:00 (0011->0010: tens digit correctly drops to 0, PM
    // bit1 persists) — confirms bit1=2 is a stable, dedicated AM/PM flag.
    clockRam: { hT: 36, hO: 37, mT: 38, mO: 39, sT: 40, sO: 41, pmBit: 2 },
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    // No hammers. Instead of Chef/Popeye's simple left/right, real Mickey
    // Mouse has two independent 2-way levers (Left stick, Right stick),
    // each pressed up or down — 4 total directional inputs, all on IN.1 (a
    // K-row, not dedicated hammer pins), confirmed against the real MAME
    // driver source (hh_sm510.cpp gnw_mmouse_state): IN.1 bit0=Right/Down,
    // bit1=Right/Up, bit2=Left/Down, bit3=Left/Up. This maps naturally onto
    // the existing generic btn1-4 mechanism (Vermin/Ball/Judge/Manhole/
    // Lion's 4-corner-button titles) rather than needing a new control
    // shape: btn1/btn3 are the physical top/bottom buttons on the left
    // lever, btn2/btn4 the top/bottom buttons on the right lever — visually
    // confirmed against the artwork (two stacked red buttons per side, each
    // with an up/down arrow indicator, same 2x2 corner layout as Vermin's
    // quad pad). Because btn1-4 are present, _hasQuadButtons() already
    // covers the extended-hold logic and startAttract()'s auto Time-tap-
    // dismiss — no needsResetForModeButtons or lampTestOnBoot flags needed,
    // same as Judge/Manhole/Lion/Flagman.
    hotspots: {
      btn1:  { left: 4.62,  top: 58.23, width: 12.79, height: 17.86 },
      btn2:  { left: 82.38, top: 58.23, width: 13.02, height: 17.86 },
      btn3:  { left: 4.62,  top: 75.08, width: 12.79, height: 17.86 },
      btn4:  { left: 82.38, top: 75.08, width: 13.02, height: 17.86 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    // inputRows array index is NOT the same as the port's "IN.n" suffix —
    // that was the bug here originally (movement at index 1, mode buttons
    // at index 2, mirroring the driver source's IN.1/IN.2 comments
    // literally). The K-row mux's bit-to-port wiring is chosen by each
    // ROM's own software, not implied by MAME's port-naming convention;
    // Judge (a working, already-shipped title with the same K-line-for-
    // everything shape) puts mode buttons at index 1 and movement at index
    // 2, and empirically that's what this ROM needs too — verified by
    // direct LCD-array diffing: with movement-first (the original, wrong
    // order) a Time tap left the display almost entirely unchanged from the
    // boot lamp-test pattern; swapped to mode-buttons-first, the exact same
    // tap correctly clears it to a clean single-Mickey scene, matching real
    // MAME's own Time-tap screenshot.
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4, alarm: 8 }, { btn4: 1, btn2: 2, btn3: 4, btn1: 8 } ],
  },

  egg: {
    title: 'Egg', subtitle: 'EG-26 · 1981',
    artPath: 'artwork/gnw_egg/',
    svgPath: 'artwork/gnw_egg/gnw_egg.svg',
    // Licence-free reskin of Mickey Mouse sharing the exact same ROM (MAME
    // lists gnw_egg's "mc-25" as merge="mc-25" against gnw_mmouse — bit-
    // identical CPU data, only the SVG/artwork differ) — see mmouse's
    // clockRam/hotspots/inputRows comments, all identical here for the
    // same reasons, including pmBit:2 (same ROM, same AM/PM mechanism).
    clockRam: { hT: 36, hO: 37, mT: 38, mO: 39, sT: 40, sO: 41, pmBit: 2 },
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    hotspots: {
      btn1:  { left: 4.62,  top: 58.23, width: 12.79, height: 17.86 },
      btn2:  { left: 82.38, top: 58.23, width: 13.02, height: 17.86 },
      btn3:  { left: 4.62,  top: 75.08, width: 12.79, height: 17.86 },
      btn4:  { left: 82.38, top: 75.08, width: 13.02, height: 17.86 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4, alarm: 8 }, { btn4: 1, btn2: 2, btn3: 4, btn1: 8 } ],
  },

  fireatk: {
    title: 'Fire Attack', subtitle: 'ID-29 · 1982',
    artPath: 'artwork/gnw_fireatk/',
    svgPath: 'artwork/gnw_fireatk/gnw_fireatk.svg',
    // Only SM510 title so far — see the SM510 class comment for the CPU
    // itself. cpuType selects it in the GnwEmulator constructor; lcdCBits:2
    // tells GnwDisplay this SVG's title numbering uses a 4-value column
    // range (0-3) rather than the 2-value row range every SM5A title uses.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Fire Attack's own boot-init routine doesn't write its default "12:00"
    // into the persistent hour/minute/second counters until ~cycle 416
    // (confirmed via direct RAM-write tracing against a raw cpu.step()
    // loop) — later than the standard 300-cycle sync window every other
    // title completes within. Syncing at 300 landed before that write, so
    // the boot-default immediately clobbered the real time just written;
    // 450 comfortably clears it. See the bootSyncCycles comment in
    // _syncClockToNow().
    bootSyncCycles: 450,
    // Found by direct write-tracing (not guessed from Chef/Mickey's
    // addresses, which don't carry over — different ROM, different CPU
    // family entirely): after bumping bootSyncCycles clear of the boot-init
    // stomp, ram[20/21/22/23/24/25] read back the exact real wall-clock
    // h/m/s digits, confirmed to the second. pmBit:8 here IS a working
    // convention for this ROM (unlike Mickey Mouse/Egg, which don't have
    // one) — a single-bit toggle scan found bit3 of hT flips exactly 2
    // segments (lcd[2]/lcd[3], same bit position in each — one LCD cell
    // spanning both AM/PM-label columns), consistent with the same
    // spare-bit repurposing Popeye/Chef use.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Same case mold as Mickey Mouse/Egg (identical Unit.png dimensions,
    // 2611x1579, and identical screen/button pixel bounds when measured the
    // same way) — screen and hotspot percentages below are carried over
    // unchanged rather than re-measured from scratch.
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    // Labeled "HIT" rather than arrows on the real unit, but mechanically
    // identical to Mickey Mouse's two 2-way levers: IN.0/S1 bit0=Right/Down,
    // bit1=Right/Up, bit2=Left/Up, bit3=Left/Down (confirmed against the
    // real MAME driver source, hh_sm510.cpp gnw_fireatk_state — note the
    // Left/Up-Down bit order is swapped from Mickey Mouse's IN.1, this ROM's
    // own choice, not a copy-paste of that one). IN.1/S2 (Time/GameB/GameA/
    // Alarm) matches every other Wide Screen title's K-row layout exactly.
    hotspots: {
      btn1:  { left: 4.62,  top: 58.23, width: 12.79, height: 17.86 },
      btn2:  { left: 82.38, top: 58.23, width: 13.02, height: 17.86 },
      btn3:  { left: 4.62,  top: 75.08, width: 12.79, height: 17.86 },
      btn4:  { left: 82.38, top: 75.08, width: 13.02, height: 17.86 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    inputRows: [ { btn4: 1, btn2: 2, btn1: 4, btn3: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  firews: {
    title: 'Fire', subtitle: 'FR-27 · 1981',
    artPath: 'artwork/gnw_firews/',
    svgPath: 'artwork/gnw_firews/gnw_fire.svg',
    // Wide Screen remake of the Silver "fire" title already in this
    // registry (different key needed since that one's taken) — a larger,
    // wider redraw of the same burning-building game, released Dec 1981.
    // Same clockRam addresses as Popeye/Octopus/Parachute/Chef (54-59),
    // confirmed both via the ROM's own natural boot-time default write
    // (ram[54]=1, ram[55]=2 at cycle ~221-222, matching "12" default) and
    // via real-time sync readback. pmBit is 8, the same bit3-of-hT
    // convention Popeye/Chef use — an earlier attempt to verify this found
    // "zero segment change" and left it unset, but that test was against a
    // static single-bit toggle (filtered for an "isolated 1-3 segment"
    // change), which misses a real AM/PM indicator that spells "AM"/"PM"
    // as text across more segments than that. Confirmed instead by poking
    // real MAME's RAM to 11:59:57 and 12:59:57 and watching the natural
    // rollover: ram[54] went 1->9 exactly at 11:59:59->12:00:00 (new bit3
    // appears, tens-digit bit0 unchanged) and 9->8 at 12:59:59->1:00:00
    // (tens digit correctly drops, bit3/PM persists) — same verification
    // method that found Mickey Mouse/Egg's (different) pmBit:2.
    clockRam: { hT: 54, hO: 55, mT: 56, mO: 57, sT: 58, sO: 59, pmBit: 8 },
    // Same case mold as Mickey Mouse/Egg/Fire Attack (identical Unit.png
    // dimensions and screen pixel bounds when measured the same way).
    screen: { left: 25.01, top: 23.31, width: 49.90, height: 53.64 },
    // Missing on first ship: without this, startAttract()'s own guard
    // (`fixedRow === undefined && !_hasQuadButtons() && !lampTestOnBoot`)
    // returns immediately since this title has neither fixedRow nor
    // btn1-4 — the auto-demo timer never even gets scheduled, so nothing
    // ever dismisses the boot lamp-test pattern on its own. Same flag
    // every other hammer-based Wide Screen title (Popeye/Chef/Octopus/
    // Parachute) already has; just missed adding it here.
    lampTestOnBoot: true,
    // Simple dedicated Left/Right hammer pins (BA=Right, B=Left per the
    // real MAME driver source, hh_sm510.cpp gnw_fire_state — matches
    // GnwEmulator's un-swapped default, so no swapHammers flag needed,
    // unlike Popeye/Parachute) — same shape as Chef/Popeye/Octopus, not
    // Mickey Mouse's K-line quad buttons. Hotspot percentages measured
    // directly from this title's own artwork (same alpha/red-channel scan
    // method as Mickey Mouse), not copied from Chef's, since the visible
    // button size/position differs slightly on this casing.
    hotspots: {
      left:  { left: 3.89,  top: 59.25, width: 15.43, height: 23.81 },
      right: { left: 80.64, top: 59.21, width: 15.43, height: 23.94 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    // Mode buttons (Time/GameB/GameA/Alarm) at inputRows array index 1, NOT
    // matching the driver source's "IN.2" comment literally — see the
    // Mickey Mouse inputRows comment for why the array index isn't the
    // same thing as the port's IN.n suffix. Verified empirically here too:
    // mode-buttons-at-index-2 (naively matching "IN.2") left a Time tap
    // with zero effect on the LCD at all; index-1 correctly clears the
    // boot lamp-test pattern into a clean demo scene. Same convention as
    // Popeye/Octopus/Parachute/Chef, which are all hammer-pin titles from
    // the same clock-ROM generation.
    inputRows: [ {}, { time: 1, gameB: 2, gameA: 4, alarm: 8 }, {} ],
    // Same exact bug Popeye's Game A has (same clock-ROM family, same
    // address, same value): real MAME's own screenshot at this point (Time
    // dismiss, then Game A held) shows a clean single-scene view, but under
    // our emulation the display stayed stuck at the boot lamp-test pattern
    // no matter how the buttons were sequenced (tried holding Game A alone,
    // tapping a hammer during the hold, after release, needsResetForMode-
    // Buttons — none of it budged). Traced RAM writes during the Game A
    // hold and found ram[0x30] toggling repeatedly without settling;
    // brute-force testing candidate (address, value) pairs against known
    // "active game" RAM cells found forcing ram[0x30]=4 while Game A is
    // held reproduces the exact clean scene real hardware shows — same
    // debounce-collision class of bug as Popeye, same fix.
    commitAssist: { holdButton: 'gameA', ramAddr: 0x30, value: 4, yieldsTo: ['gameB', 'time'] },
  },

  tbridge: {
    title: 'Turtle Bridge', subtitle: 'TL-28 · 1982',
    artPath: 'artwork/gnw_tbridge/',
    svgPath: 'artwork/gnw_tbridge/gnw_tbridge.svg',
    cpuType: 'sm510',
    lcdCBits: 2,
    // Real MAME driver override (hh_sm510.cpp's gnw_tbridge_state
    // constructor, comment: "increase lcd decay: unwanted segments light
    // up") — both raised from the hh_sm510_state base-class default of
    // pivot:8/len:17 (see LCD_DECAY_DEFAULT in gnw.js) to pivot:25/len:25.
    // The only one of this project's 18 titles with a confirmed per-title
    // override in the local MAME source.
    lcdDecay: { pivot: 25, len: 25 },
    // Same clock-ROM family as Fire Attack (identical addresses 20-25),
    // confirmed via write-tracing: the ROM's own boot-init default ("12:00")
    // writes ram[20]=1, ram[21]=2 at cycle ~418-419, and after bumping
    // bootSyncCycles clear of that, ram[20..25] read back the exact real
    // wall-clock digits and stay stable. pmBit:8 confirmed via a real
    // AM/PM-style poke test (11:15 PM -> hT=9, matching bit3).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Same boot-init-writes-late issue as Fire Attack (also SM510, also this
    // clockRam family) — the "12:00" default write lands at cycle ~419,
    // after the standard 300-cycle sync window, so syncing at 300 gets
    // immediately clobbered. 450 clears it with the same margin Fire Attack
    // uses.
    bootSyncCycles: 450,
    screen: { left: 25.47, top: 25.33, width: 48.83, height: 50.35 },
    hotspots: {
      left:  { left: 4.89,  top: 60.13, width: 13.40, height: 21.52 },
      right: { left: 81.71, top: 60.13, width: 13.40, height: 21.52 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    // Array index DOES match the driver source's literal IN.0(movement)/
    // IN.1(mode) order here — verified empirically (LCD-diff before/after a
    // Time tap, not assumed from the port comments — see the Mickey Mouse
    // inputRows comment for why that distinction matters): this ordering
    // drops the boot lamp-test's lcdSum by ~3x on Time dismiss, the swapped
    // ordering barely changes it at all.
    inputRows: [ { right: 1, left: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
    // No fixedRow, no btn1-4, so needs both flags every other no-quad-button
    // hammer title (Chef/Popeye/Octopus/Parachute/Fire-FR27) needs: the
    // reset-vector-trick for mode buttons to register at all, and the
    // Time-tap auto-dismiss for startAttract()'s guard to actually schedule.
    needsResetForModeButtons: true,
    // Same combination that made Chef's Left/Right get the mode-button
    // extended hold by accident (see the hammersNeedQuickTap comment in
    // _needsMinHold()): no fixedRow + real hotspots.left/right means
    // _needsMinHold('left'/'right') returns true here too (confirmed
    // directly), which would leave a released hammer logically "held" for
    // up to 5 real seconds — the same "movement queues until the next
    // round" symptom Chef had. Excluded proactively rather than waiting for
    // a live repro, since the mechanism is identical.
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
  },

  stennis: {
    title: 'Snoopy Tennis', subtitle: 'SP-30 · 1982',
    artPath: 'artwork/gnw_stennis/',
    svgPath: 'artwork/gnw_stennis/gnw_stennis.svg',
    cpuType: 'sm510',
    lcdCBits: 2,
    // Same clock-ROM family as Fire Attack/Turtle Bridge (identical
    // addresses 20-25) — confirmed the same way: boot-init default write at
    // cycle ~415-416, ram[20..25] hold the exact real wall-clock digits
    // after bootSyncCycles clears that, pmBit:8 confirmed via an 11:15 PM
    // poke (hT=9).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Same boot-init-writes-late issue as Fire Attack/Turtle Bridge — the
    // "12:00" default write lands at cycle ~416, after the standard
    // 300-cycle sync window.
    bootSyncCycles: 450,
    screen: { left: 25.47, top: 25.33, width: 48.83, height: 50.35 },
    // Snoopy Tennis's own shape: a single Hit button (where Left normally
    // sits) plus a stacked Up/Down pair (where Right normally sits), not a
    // second hammer or a 4-way quad pad — see the new `hit`/`up`/`down`
    // BUTTON_DEFS entries and the play-updown-controls markup in
    // index.html, added specifically for this title.
    hotspots: {
      hit:   { left: 4.89,  top: 60.13, width: 13.40, height: 21.52 },
      up:    { left: 82.95, top: 54.27, width: 10.72, height: 13.30 },
      down:  { left: 82.95, top: 70.57, width: 10.72, height: 16.46 },
      gameA: { left: 82.11, top: 8.19,  width: 9.42,  height: 10.92 },
      gameB: { left: 82.11, top: 19.65, width: 9.42,  height: 10.92 },
      time:  { left: 82.11, top: 31.11, width: 9.42,  height: 10.92 },
    },
    // Array index matches the driver source's literal IN.0(movement)/
    // IN.1(mode) order here too — verified the same empirical way as Turtle
    // Bridge (LCD-diff before/after a Time tap): this ordering drops the
    // boot lamp-test's lcdSum by ~10x on dismiss, the swapped ordering
    // barely changes it.
    inputRows: [ { down: 1, up: 2, hit: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
    // Same reasoning as Turtle Bridge — no fixedRow, no btn1-4.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
  },

  manholews: {
    title: 'Manhole', subtitle: 'NH-103 · 1983',
    artPath: 'artwork/gnw_manholews/',
    svgPath: 'artwork/gnw_manholews/gnw_manholews.svg',
    // Real MAME driver comment (hh_sm510.cpp's gnw_manhole_state, distinct
    // from the already-shipped Gold-series Manhole (MH-06, key 'manhole'
    // here) which is a genuinely different, SM5A title): "there's also a
    // Gold Series version (MH-06). The two games are using different MCU
    // types so this version seems to be a complete rewrite." Confirmed via
    // the driver source directly: gnw_manholeg (MH-06) calls sm5a_common(),
    // gnw_manhole (NH-103, this title) calls sm510_common() -- not a port,
    // a different chip and a different ROM entirely.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Found by RAM-tracing while holding Time (real cell-by-cell increment
    // rate, not guessed from any other title's offsets -- this ROM shares no
    // clockRam family with Fire Attack/Turtle Bridge/Snoopy Tennis):
    // ram[15] increments every real second and rolls 9->0 every 10s (sO);
    // ram[14] increments every 10s and rolls at 60s (sT); ram[13] increments
    // every 60s (mO); ram[12] every 10 minutes (mT); ram[10]/[11] held at
    // 1/2 throughout (the "12" of the ROM's own 12:00:00 boot default,
    // matching hT/hO). pmBit:8 confirmed via a real noon rollover, not a
    // blind bit-scan: forced RAM to 11:59:55, stepped 6 real seconds past
    // the 12:00:00 crossing, and hT went from 1 to 9 (0b1001 = the same
    // tens-digit bit0 plus a newly-set bit3) -- the same bit3/8 AM/PM
    // convention as Popeye/Chef/Fire-FR27/Fire-Attack/Turtle-Bridge/
    // Snoopy-Tennis.
    clockRam: { hT: 10, hO: 11, mT: 12, mO: 13, sT: 14, sO: 15, pmBit: 8 },
    // Same boot-init-writes-late pattern as every other SM510 title here --
    // the "12:00" default write lands at cycle ~329 (traced via a raw
    // cpu.step() loop with no external sync), just past the standard
    // 300-cycle sync window syncClockToNow() waits for by default. 450
    // clears it with the same margin Fire Attack/Turtle Bridge/Snoopy
    // Tennis all use.
    bootSyncCycles: 450,
    // Screen glass cutout found via the same alpha-channel scan used for
    // every other title's Unit.png -- confirmed against 8 independent
    // scanlines (4 horizontal, 4 vertical) all agreeing on the exact same
    // pixel boundary before converting to percentages.
    screen: { left: 25.47, top: 24.89, width: 49.06, height: 51.36 },
    // Real physical shape: two independent 2-way levers (same as Mickey
    // Mouse/Egg -- confirmed identical IN.0 bit layout in the driver
    // source: bit0=Right/Down, bit1=Right/Up, bit2=Left/Up, bit3=Left/Down),
    // not hammers or a single quad pad. Maps onto the same generic btn1-4
    // mechanism: btn1/btn3 = left lever's up/down positions, btn2/btn4 =
    // right lever's up/down positions -- matching Mickey Mouse's own
    // btn1=Left-Up/btn3=Left-Down/btn2=Right-Up/btn4=Right-Down convention
    // so the two titles read the same way. Because btn1-4 are present,
    // _hasQuadButtons() already covers the extended-hold/attract-dismiss
    // logic (confirmed against Fire Attack, an SM510 title using the exact
    // same btn1-4 mechanism with zero extra flags) -- no
    // needsResetForModeButtons/lampTestOnBoot/hammersNeedQuickTap needed.
    // modeButtonsRegisterQuickly, however, IS needed here (unlike Fire
    // Attack): confirmed live and via a real-MAME PC/RAM trace (gnw_manhole,
    // MAME 0.288) that a genuine GameA tap makes the ROM's own "has the mode
    // button actually gone back up yet" gameplay-start check pass almost
    // immediately -- but our own extended min-hold (_needsMinHold(),
    // triggered by _hasQuadButtons() same as Chef) keeps GameA logically
    // held for a further 5 real seconds after release, so that ROM check
    // kept re-polling a stale hold instead, spinning through a narrow buzzer/
    // delay loop the whole time (visible as GameA taking several real
    // seconds to "start" versus MAME's instant response) -- same root cause
    // and same fix as Chef's own modeButtonsRegisterQuickly comment above.
    modeButtonsRegisterQuickly: true,
    // See noResetOnModeButtons in _resetWithButtonHeld(): NH-103's ROM does
    // NOT need the reset-vector trick at all (confirmed via real MAME -- a
    // genuine K-line change with no reset works fine) -- _hasQuadButtons()
    // blanket-applying that reset here could leave the CPU stuck CEND-halted
    // for the rest of a session once the EXCI bl-overflow fix (see exec())
    // changed exactly when the reset's raw boot-cycle burst lands.
    noResetOnModeButtons: true,
    // Hotspot percentages measured directly from Unit.png (2611x1579):
    // button rings found via a coordinate-grid overlay after plain color-
    // fuzz/-trim detection proved unreliable against the brushed-metal
    // chassis texture (see the two-tone left/right button columns and the
    // three stacked ovals in the artwork).
    hotspots: {
      btn1:  { left: 7.66,  top: 57.63, width: 8.04, height: 15.20 },
      btn3:  { left: 7.66,  top: 76.63, width: 8.04, height: 15.20 },
      btn2:  { left: 84.07, top: 57.63, width: 7.85, height: 14.88 },
      btn4:  { left: 84.07, top: 76.63, width: 7.85, height: 14.88 },
      gameA: { left: 84.07, top: 9.18,  width: 5.94, height: 7.28 },
      gameB: { left: 84.07, top: 21.22, width: 5.94, height: 7.28 },
      time:  { left: 84.07, top: 33.25, width: 5.94, height: 7.28 },
    },
    // Row order verified empirically, not assumed from the driver's IN.0/
    // IN.1 comments (see the Mickey Mouse inputRows comment for why that
    // distinction matters here too): held row1 bit0 for a sustained period
    // from a fresh boot and watched the LCD go from a lamp-test-like "many
    // segments on" pattern (34ff 48ff 38ff ...) to a sparse, clearly-
    // dismissed one (3000 4c00 3800 ...) -- row0 bit0 held the same way
    // left the display almost completely unchanged. Confirms row1 = IN.1
    // (mode buttons) here, matching the driver's own array order directly
    // for this title (not swapped, unlike some others in this project).
    inputRows: [ { btn4: 1, btn2: 2, btn1: 4, btn3: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  mariocm: {
    title: "Mario's Cement Factory", subtitle: 'ML-102 · 1983',
    artPath: 'artwork/gnw_mariocm/',
    svgPath: 'artwork/gnw_mariocm/gnw_mariocm.svg',
    // Real MAME driver comment (hh_sm510.cpp gnw_mariocm_state): "This is
    // the new wide screen version, there's also a tabletop version" (CM-72,
    // a genuinely different SM511 chip -- not implemented here, see
    // gnw_mariotj/Mario The Juggler's own note on why SM511 is a separate,
    // bigger undertaking).
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, held Time from a fresh boot):
    // ram[25] increments every real second and rolls 9->0 every 10s (sO);
    // ram[24] increments every 10s and rolls at 60s (sT); ram[22]/[23] are
    // minutes (static during this trace); ram[20]/[21] hold the ROM's own
    // "12:00" boot default until synced (hT/hO). Same clockRam family/
    // addresses as Fire Attack/Turtle Bridge/Snoopy Tennis/Manhole(NH-103) --
    // confirmed fresh here, not assumed. pmBit:8 confirmed via a real noon
    // rollover (poked 11:59:57, stepped past 12:00:00 -- hT went from 1 to 9,
    // the same bit3/8 AM/PM convention as the rest of this family).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init's own "12:00" default write lands at cycle ~402 (traced via
    // a raw cpu.step() loop, no external sync) -- past the standard 300-cycle
    // window, needs the same 450 override as the rest of this ROM family.
    bootSyncCycles: 450,
    // Same screen-glass box as every other New Wide Screen title measured so
    // far (Manhole NH-103) -- same case mold, confirmed via the same alpha-
    // channel scan on Unit.png, not assumed to match.
    screen: { left: 25.47, top: 24.89, width: 49.06, height: 51.36 },
    // Left/Right move Mario between conveyor belts; Open (its own dedicated
    // button, physically separate from Left/Right -- see Unit.png, it sits
    // where a hammer-style title's *other* hammer would be) drops the
    // cement bucket. No existing BUTTON_DEFS shape fit (not a second hammer,
    // not a mode button), so a new 'open' entry was added to BUTTON_DEFS/
    // index.html's markup, following the exact same pattern Snoopy Tennis's
    // hit/up/down used for its own new shape. Bound to Space on the keyboard
    // (KEY_TO_BUTTON) since every other letter/arrow key was already taken.
    // Bit layout taken from the real MAME driver source directly (IN.0:
    // bit0=Open/BUTTON1, bit1=Right, bit2=Left) -- Time's row/bit (row1
    // bit0) confirmed empirically (dismisses the boot lamp-test, matching
    // every other title in this family), Open/Left/Right cross-checked live.
    hotspots: {
      left:  { left: 3.83,  top: 66.18, width: 6.51,  height: 11.08 },
      right: { left: 12.06, top: 66.18, width: 6.51,  height: 11.08 },
      open:  { left: 82.73, top: 63.65, width: 10.34, height: 16.78 },
      gameA: { left: 83.11, top: 9.50,  width: 6.51,  height: 5.38 },
      gameB: { left: 83.11, top: 22.48, width: 6.51,  height: 5.38 },
      time:  { left: 83.11, top: 33.57, width: 6.51,  height: 5.38 },
    },
    // No fixedRow and real hotspots.left/right -- _needsMinHold('left'/
    // 'right') would return true without this (same shape as Chef pre-fix),
    // added proactively rather than waiting for a bug report, same as Turtle
    // Bridge's own hammersNeedQuickTap comment explains.
    hammersNeedQuickTap: true,
    // No fixedRow and no quad buttons (btn1-4) -- startAttract()'s guard
    // (`fixedRow === undefined && !_hasQuadButtons() && !lampTestOnBoot`)
    // would skip this title entirely without this flag, leaving the boot
    // lamp-test/attract tableau stuck forever with no auto Time-tap to
    // dismiss it. Same class of bug as Fire/FR-27's own missing
    // lampTestOnBoot (forgotten there once already) -- confirmed live here:
    // the lamp-test screen never advanced past ~900 frames without it.
    lampTestOnBoot: true,
    inputRows: [ { open: 1, right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  tfish: {
    title: 'Tropical Fish', subtitle: 'TF-104 · 1985',
    artPath: 'artwork/gnw_tfish/',
    svgPath: 'artwork/gnw_tfish/gnw_tfish.svg',
    cpuType: 'sm510',
    lcdCBits: 2,
    // Same clockRam family/addresses as Fire Attack/Turtle Bridge/Snoopy
    // Tennis/Manhole(NH-103)/Mario's Cement Factory -- confirmed fresh via
    // the same held-Time RAM trace, not assumed to carry over. pmBit:8
    // confirmed via the same real noon-rollover poke (11:59:57 -> hT 1->9).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init's own "12:00" default write (and the lamp-test's own segment
    // writes) don't settle until cycle ~588 here -- later than Mario's Cement
    // Factory's own ~402, needs a wider 650-cycle sync window.
    bootSyncCycles: 650,
    // Same screen-glass box as every other New Wide Screen title measured so
    // far -- same case mold, confirmed via the same alpha-channel scan.
    screen: { left: 25.47, top: 24.89, width: 49.06, height: 51.36 },
    // Two independent round buttons (Left bottom-left, Right bottom-right --
    // not a hammer pair sharing one housing like Mario's Cement Factory).
    // Row/bit layout: Time's row1 bit0 confirmed empirically (dismisses the
    // boot lamp-test). GameA/GameB are swapped here versus every other title
    // in this family (bit1=GameA/bit2=GameB, not bit2=GameA/bit1=GameB) --
    // taken from the real MAME driver source directly and cross-checked live,
    // per this project's standing rule not to assume a convention carries
    // over between ROMs (see Mickey Mouse/Fire-FR27's own inputRows history).
    hotspots: {
      left:  { left: 7.09,  top: 64.28, width: 8.43, height: 13.94 },
      right: { left: 83.11, top: 64.28, width: 8.24, height: 13.62 },
      gameA: { left: 83.11, top: 9.50,  width: 6.51, height: 5.38 },
      gameB: { left: 83.11, top: 22.48, width: 6.51, height: 5.38 },
      time:  { left: 83.11, top: 33.57, width: 6.51, height: 5.38 },
    },
    // No fixedRow and real hotspots.left/right -- same proactive fix as
    // Mario's Cement Factory/Turtle Bridge, see their own comments.
    hammersNeedQuickTap: true,
    // No fixedRow and no quad buttons -- same missing-auto-dismiss bug as
    // Mario's Cement Factory (see its own comment above) and Fire/FR-27
    // before it -- needed on every hammer-shaped title with no fixedRow.
    lampTestOnBoot: true,
    inputRows: [ { left: 1, right: 2 }, { time: 1, gameA: 2, gameB: 4, alarm: 8 } ],
  },

  dkjr: {
    title: 'Donkey Kong Jr.', subtitle: 'DJ-101 · 1982',
    artPath: 'artwork/gnw_dkjr/',
    svgPath: 'artwork/gnw_dkjr/gnw_dkjr.svg',
    cpuType: 'sm510',
    lcdCBits: 2,
    // Same clockRam family/addresses as the rest of this ROM family
    // (Fire Attack/Turtle Bridge/Snoopy Tennis/Manhole NH-103/Mario's
    // Cement Factory/Tropical Fish) -- confirmed fresh via a real-MAME
    // ground-truth RAM trace (gnw_dkjr, MAME 0.288), not assumed. pmBit:8
    // confirmed via the same real noon-rollover poke (11:59:57 -> hT 1->9).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 450,
    screen: { left: 25.47, top: 24.89, width: 49.06, height: 51.36 },
    // A genuine single 4-way D-pad cluster (one physical plus-shaped unit,
    // not two independent 2-way levers like Manhole/Mickey Mouse's own
    // btn1-4 usage) plus a dedicated Jump button opposite it. Reuses the
    // same btn1-4 mechanism regardless -- at the input-bit level a 4-way
    // pad and two independent levers are identical (4 independent digital
    // directions on one K-row), and hotspot position is fully data-driven,
    // so no new BUTTON_DEFS shape was needed for the pad itself (only for
    // Jump -- see BUTTON_DEFS.jump). Row/bit layout taken from the real
    // MAME driver source directly (IN.1: bit0=Right,bit1=Up,bit2=Left,
    // bit3=Down) and cross-checked live; Jump is IN.0 bit3 (its own row,
    // only one bit used), Time/GameB/GameA/Alarm on IN.2 (row2) -- this
    // title has three real K-rows, the first shipped title in this project
    // with more than two.
    hotspots: {
      jump: { left: 82.73, top: 64.28, width: 10.34, height: 16.78 },
      btn1: { left: 13.79, top: 68.40, width: 5.75,  height: 6.97 },
      btn2: { left: 8.62,  top: 61.43, width: 5.75,  height: 6.65 },
      btn3: { left: 3.64,  top: 68.40, width: 5.75,  height: 6.97 },
      btn4: { left: 8.62,  top: 76.31, width: 5.75,  height: 6.97 },
      gameA: { left: 83.11, top: 9.50,  width: 6.51, height: 5.38 },
      gameB: { left: 83.11, top: 22.48, width: 6.51, height: 5.38 },
      time:  { left: 83.11, top: 33.57, width: 6.51, height: 5.38 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- no needsResetForModeButtons/
    // lampTestOnBoot/hammersNeedQuickTap needed (same as Fire Attack/
    // Manhole NH-103). modeButtonsRegisterQuickly applied proactively from
    // the start this time (not discovered via a bug report) -- this exact
    // _hasQuadButtons()-driven 5s-extended-hold class of bug has now hit
    // two unrelated titles (Chef, Manhole NH-103), see the cross-cutting
    // mechanisms note above.
    modeButtonsRegisterQuickly: true,
    // noResetOnModeButtons: same fix as Manhole NH-103, same symptom --
    // confirmed live (a real GameA press left the game-area segments stuck
    // on the dense boot tableau indefinitely, clock digits ticking normally
    // the whole time since those are a direct RAM poke independent of the
    // ROM's own ongoing execution) and confirmed via the same bypass test
    // (a plain K-line GameA press with no cpu.reset() reaches real,
    // progressing gameplay). See _resetWithButtonHeld()'s own comment.
    noResetOnModeButtons: true,
    inputRows: [ { jump: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  smbn: {
    title: 'Super Mario Bros.', subtitle: 'YM-105 · 1988',
    artPath: 'artwork/gnw_smbn/',
    svgPath: 'artwork/gnw_smbn/gnw_smbn.svg',
    // First SM511 title in this project -- a genuinely different chip
    // family member from SM510 (sibling, not subclass -- see the SM511
    // class comment in gnw.js for the full real-hardware differences).
    // Boot-sequence PC trace cross-checked against real MAME 0.288
    // (gnw_smb, Crystal Screen -- same program+melody ROM as this New
    // Wide Screen release, confirmed via identical CRCs in the real MAME
    // driver source): 1000 consecutive instructions compared on a shared
    // anchor point, 0 mismatches, both interpreters converging on the
    // same idle loop.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically confirmed via a held-Time headless run (12+ continuous
    // hours simulated, sampling full RAM every 20 simulated minutes):
    // ram[38]/[39] (sT/sO) roll 0-5/0-9 every 10s/1s, ram[36]/[37] (mT/mO)
    // roll over cleanly at the 10-minute mark, and ram[34]/[35] (hT/hO)
    // show a genuine 12-hour rollover (12->1, not 12->13) confirming a
    // real 12-hour display. pmBit:2 confirmed the same way this project's
    // other pmBit titles were -- at the observed noon/midnight boundary,
    // hT's raw stored value jumped by exactly 2 (1->3, i.e. the base "1"
    // digit unchanged, a separate bit toggling) while hO simultaneously
    // read the same digit sequence as every non-PM hour transition.
    clockRam: { hT: 34, hO: 35, mT: 36, mO: 37, sT: 38, sO: 39, pmBit: 2 },
    // Real MAME ROM_REGION("maincpu:melody", 0x100) -- a genuinely
    // separate ROM the SM511 core reads through its own melody engine
    // (see SM511.clockMelody()), not part of the main program ROM at all.
    bootSyncCycles: 450,
    screen: { left: 25.45, top: 24.64, width: 48.71, height: 52.15 },
    // Real MAME driver source (hh_sm510.cpp gnw_smb_state, gnw_smb
    // INPUT_PORTS): S-port row select is a direct, unambiguous bit->IN.n
    // mapping on this chip (read_inputs() iterates `if (BIT(m_inp_mux,i))
    // ret |= m_inputs[i]->read()` -- no R-based complement/invert trick
    // like SM5A's own row-select wiring), so inRows[i] = IN.i is
    // source-confirmed, not an empirical guess the way most other
    // titles' row ordering has needed to be. IN.0: Time/Game/Alarm: bit0=
    // Time, bit1=Game (this title has only one Game mode, not GameA/
    // GameB), bit2=Alarm. IN.1: D-pad, bit0=Up, bit1=Right, bit2=Down,
    // bit3=Left -- a genuine 4-way D-pad like Donkey Kong Jr.'s, but
    // exposed here via dedicated up/down/left/right hotspots (matching
    // the real artwork's 4 separate button cutouts) rather than reused
    // btn1-4 corner buttons, since the real unit has 4 distinctly-shaped
    // individual buttons, not one 2x2 corner cluster. IN.2: bit0=Jump,
    // only bit used.
    hotspots: {
      up:    { left: 7.06,  top: 57.88, width: 8.62,  height: 14.33 },
      down:  { left: 7.06,  top: 73.45, width: 8.62,  height: 14.33 },
      left:  { left: 2.58,  top: 65.52, width: 8.62,  height: 14.33 },
      right: { left: 11.77, top: 65.52, width: 8.62,  height: 14.33 },
      jump:  { left: 81.28, top: 60.36, width: 14.47, height: 24.07 },
      alarm: { left: 82.77, top: 6.40,  width: 8.62,  height: 14.33 },
      time:  { left: 82.77, top: 17.86, width: 8.62,  height: 14.33 },
      gameA: { left: 82.77, top: 29.32, width: 8.62,  height: 14.33 },
    },
    // No fixedRow and no btn1-4 (this title's D-pad uses dedicated up/
    // down/left/right hotspots instead, see the inputRows comment above),
    // so it needs the same no-quad-button hammer-title flags every prior
    // title in that shape has needed until proven otherwise by real
    // testing -- applied proactively rather than waiting for a repro,
    // same reasoning as Turtle Bridge/Mario's Cement Factory/Tropical
    // Fish's own comments.
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { time: 1, gameA: 2, alarm: 4 }, { up: 1, right: 2, down: 4, left: 8 }, { jump: 1 } ],
  },

  climbern: {
    title: 'Climber', subtitle: 'DR-106 · 1988',
    artPath: 'artwork/gnw_climbern/',
    svgPath: 'artwork/gnw_climbern/gnw_climbern.svg',
    // Second SM511 title -- same input-port shape as Super Mario Bros
    // (Time/Game/Alarm on IN.0, a 4-way D-pad on IN.1, Jump alone on
    // IN.2), confirmed identical in the real MAME driver source. Boot-
    // sequence PC trace cross-checked against real MAME 0.288 (gnw_
    // climber, Crystal Screen -- same program+melody ROM as this New
    // Wide Screen release, confirmed via identical CRCs): 1000
    // consecutive instructions compared on a shared anchor point, 0
    // mismatches.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically confirmed the same way as Super Mario Bros -- a
    // continuous, isolated held-Time headless run (12+ hours
    // simulated). Same relative layout as Super Mario Bros, offset by
    // one RAM address (this program's own general-RAM usage before the
    // clock cells differs by 1 cell): sT/sO roll 0-5/0-9 every 10s/1s,
    // mT/mO roll over cleanly at the 10-minute mark, hT/hO show a
    // genuine 12-hour rollover (12->1) with the same pmBit:2 encoding
    // (a +2 jump in hT's raw stored value at the observed noon/
    // midnight boundary).
    clockRam: { hT: 35, hO: 36, mT: 37, mO: 38, sT: 39, sO: 40, pmBit: 2 },
    // Real MAME ROM_REGION("maincpu:melody", 0x100).
    bootSyncCycles: 450,
    screen: { left: 24.78, top: 23.18, width: 50.33, height: 53.58 },
    // Same S-port-direct-bit->IN.n wiring as Super Mario Bros (source-
    // confirmed, not empirical) -- IN.0: bit0=Time, bit1=Game, bit2=
    // Alarm. IN.1: bit0=Up, bit1=Right, bit2=Down, bit3=Left. IN.2:
    // bit0=Jump.
    hotspots: {
      up:    { left: 7.01,  top: 57.50, width: 9.00,  height: 14.88 },
      down:  { left: 7.01,  top: 72.89, width: 9.00,  height: 14.88 },
      left:  { left: 2.14,  top: 65.23, width: 9.00,  height: 14.88 },
      right: { left: 11.91, top: 65.23, width: 9.00,  height: 14.88 },
      jump:  { left: 80.08, top: 58.39, width: 16.70, height: 27.61 },
      alarm: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      gameA: { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // No fixedRow and no btn1-4 (dedicated up/down/left/right hotspots
    // instead, same shape as Super Mario Bros) -- same proactive flags
    // as every no-quad-button hammer-shaped title until proven
    // otherwise by real testing.
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { time: 1, gameA: 2, alarm: 4 }, { up: 1, right: 2, down: 4, left: 8 }, { jump: 1 } ],
  },

  bfightn: {
    title: 'Balloon Fight', subtitle: 'BF-107 · 1988',
    artPath: 'artwork/gnw_bfightn/',
    svgPath: 'artwork/gnw_bfightn/gnw_bfightn.svg',
    // Third SM511 title -- MAME driver source notes this PCB design is
    // shared with Climber's, and it shows: identical input-port shape
    // (Time/Game/Alarm on IN.0, D-pad on IN.1, a single action button --
    // 'Eject' here, reusing the jump hotspot shape -- on IN.2) and
    // identical button hotspot pixel positions in the real artwork.
    // Boot-sequence PC trace cross-checked against real MAME 0.288
    // (gnw_bfight, Crystal Screen -- same program+melody ROM as this
    // New Wide Screen release, confirmed via identical CRCs): 1000
    // consecutive instructions compared on a shared anchor point, 0
    // mismatches.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Hour/minute cells and pmBit ARE identical to Climber's, consistent
    // with the shared-PCB-design note above -- but the seconds are NOT, and
    // this entry claimed they were for a long time (sT:39, sO:40, copied
    // straight off Climber). Balloon Fight keeps its seconds BELOW the
    // hour/minute block, at 33/34; 39 and 40 are dead cells that never
    // changed once across 1300 simulated seconds of held-Time. Re-traced
    // against the real ROM, and cross-checked by reading the whole clock
    // back across a minute rollover: with 39/40 the seconds sit frozen at
    // 00 forever, with 33/34 they tick correctly.
    //
    // The bug was near-invisible, which is why it lasted: the display only
    // shows H:MM, so the wrong cells cost nothing visually -- but
    // _pokeClockRam() was writing the real seconds into the dead cells and
    // leaving the live counter at whatever boot left it, so a freshly
    // synced clock could roll its first minute up to 59s late.
    //
    // The lesson is the assumption, not the addresses: hT/hO/mT/mO really
    // are Climber's, so the block LOOKED like a contiguous ascending run
    // and the seconds were taken on faith rather than traced.
    clockRam: { hT: 35, hO: 36, mT: 37, mO: 38, sT: 33, sO: 34, pmBit: 2 },
    // Real MAME ROM_REGION("maincpu:melody", 0x100).
    bootSyncCycles: 450,
    screen: { left: 25.39, top: 21.91, width: 49.18, height: 56.68 },
    // Same S-port-direct-bit->IN.n wiring as Super Mario Bros/Climber
    // (source-confirmed) -- IN.0: bit0=Time, bit1=Game, bit2=Alarm.
    // IN.1: bit0=Up, bit1=Right, bit2=Down, bit3=Left. IN.2: bit0=Eject.
    hotspots: {
      up:    { left: 7.01,  top: 57.50, width: 9.00,  height: 14.88 },
      down:  { left: 7.01,  top: 72.89, width: 9.00,  height: 14.88 },
      left:  { left: 2.14,  top: 65.23, width: 9.00,  height: 14.88 },
      right: { left: 11.91, top: 65.23, width: 9.00,  height: 14.88 },
      jump:  { left: 80.08, top: 58.39, width: 16.70, height: 27.61 },
      alarm: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      gameA: { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // Real device's own label for this button -- it ejects air from the
    // balloon-pack to fly, not a jump -- unlike DKJr/Super Mario Bros./
    // Climber, which reuse the same internal `jump` hotspot/button
    // plumbing for a real jump button. See the jumpLabel handling in
    // _applyGameArtwork().
    jumpLabel: 'Eject',
    // No fixedRow and no btn1-4 -- same proactive flags as every no-
    // quad-button hammer-shaped title until proven otherwise by real
    // testing.
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { time: 1, gameA: 2, alarm: 4 }, { up: 1, right: 2, down: 4, left: 8 }, { jump: 1 } ],
  },

  /* ---- Crystal Screen trio (1986) --------------------------------------
     Super Mario Bros. YM-801, Climber DR-802, Balloon Fight BF-803 -- the
     see-through units. Each is the SAME silicon and the SAME ROM as its
     1988 New Wide Screen re-release above: bf-803.program is byte-identical
     to what bfightn already runs (sha256 38bfbb54...), dr-802 to climbern's,
     ym-801 to smbn's -- verified against the real MAME dumps, and MAME
     itself models the New Wide Screen machines as clones of these. So none
     of these three carries a ROM of its own; see the GAMES_SHARED_ROMS
     block below the GAMES literal, which copies it across rather than
     pasting a second (driftable) copy of the same 4KB blob.

     What IS new here is the display. Every other title in this project
     paints its segments onto an OPAQUE Background.png. A Crystal Screen is
     transparent: MAME's layout draws the backing, then the segments, then
     the SAME backing again at 10% ON TOP of them, then the case, then two
     glass-reflection gradients. That's what `crystal` below drives -- see
     _applyPanelLayers().

     Geometry is read straight off each unit's MAME default.lay "Unit Only"
     view (canvas 3273x1398), converted to percentages. All three share one
     Crystal shell, so bg/gradient are identical across them and only the
     LCD panel bounds differ slightly. */

  /* Each of these declares ONLY what its case changes. Everything internal
     -- cpuType, the ROM and melody, clockRam, lcdCBits, bootSyncCycles,
     inputRows, the boot/input behaviour flags, and Balloon Fight's 'Eject'
     button label -- is inherited from its New Wide Screen twin by
     GAMES_HW_TWINS below, because it IS the same machine. Don't re-declare
     any of that here: a hand-copied duplicate is only a chance to drift.

     Port wiring is worth one note since it's inherited rather than visible:
     each Crystal unit's own default.lay independently confirms the twin's
     masks -- IN.0 bit0=Time, bit1=Game; IN.1 bit0=Up, bit1=Right, bit2=Down,
     bit3=Left; IN.2 bit0=Jump/Eject. */

  smb: {
    title: 'Super Mario Bros.', subtitle: 'YM-801 · 1986',
    artPath: 'artwork/gnw_smb/',
    svgPath: 'artwork/gnw_smb/gnw_smb.svg',
    // default.lay: screen multiply bounds (891,247,1503x924).
    screen: { left: 27.223, top: 17.668, width: 45.921, height: 66.094 },
    panel: CRYSTAL_SHELL,
    hotspots: CRYSTAL_HOTSPOTS,
  },

  /* ---- Table Top: Super Mario Bros. Special YM-901-S (1987) -------------
     A cosmetic Table Top-form clone of the New Wide Screen Super Mario Bros
     (smbn): byte-identical program+melody ROM (sha256 d4a1eb9d... /
     05a26b5f..., the same blob smb/smbn already run), the same SM511 silicon,
     and the same LCD segment SVG -- it REUSES smbn's gnw_smbn.svg rather than
     carrying one of its own. Only the shell differs: a gold flip-lid Table Top
     cabinet given away as a 1987 competition prize (~10,000 made), the rarest
     of the three SMB Game & Watch variants. Everything internal (cpuType,
     clockRam, lcdCBits, bootSyncCycles, inputRows, the boot/input flags, the
     4-way D-pad + Jump wiring) is inherited from smbn via GAMES_HW_TWINS
     below -- this entry declares only what the case changes.

     Geometry MEASURED off the device photo (artwork/gnw_smbspecial/Unit.png,
     2223x3940 px): the `screen` rect is the black LCD aperture; the hotspots
     are the D-pad arms, the GAME/TIME/ALARM buttons and JUMP. All are a
     first-pass measurement -- expected to be visually fine-tuned. */
  smbspecial: {
    title: 'Super Mario Bros. Special', subtitle: 'YM-901-S · 1987',
    artPath: 'artwork/gnw_smbspecial/',
    svgPath: 'artwork/gnw_smbn/gnw_smbn.svg',   // reuse smbn's LCD segment art
    // Play-modal Unit.png is the TIGHTER "screen + control panel" crop
    // (C:\GW_Mame\SMB_Special.png, 2223x2161) with its white backdrop and
    // black LCD aperture knocked out to transparent. The tile + drawer show
    // the FULL flip-lid device instead (a static hero, not this live view) --
    // see other-super-mario-bros-special in STATIC_PREVIEW_IDS / its img key
    // in index.html.
    unitAspect: '2223 / 2161',
    // The Animation/ PNGs in this bundle were COPIED from smbn, whose shell is
    // a LANDSCAPE New Wide Screen -- pasting them onto this PORTRAIT tabletop
    // crop showed a foreign, wrong-orientation overlay. So we ship no pressed-
    // art (noPressedArt hides the img overlays) and instead glow the hotspot
    // itself on press (pressHighlight -> .play-hotspot.pressed CSS), the clean
    // feedback used where a cabinet has no usable pressed-state frames.
    noPressedArt: true,
    pressHighlight: true,
    // Black LCD aperture measured on the zoomed crop: px 721,742 842x549 of
    // 2223x2161 (verified with a red-overlay screenshot).
    screen: { left: 32.43, top: 34.34, width: 37.88, height: 25.40 },
    // PREVIEW-ART OVERRIDE (non-interactive tile + drawer stage only). The Play
    // modal keeps the fields above (the ZOOMED screen+panel crop). The catalogue
    // tile and the drawer's big device reveal instead show the FULL gold flip-lid
    // cabinet, still LIVE -- a taller portrait Unit.png (artwork/gnw_smbspecial_full/,
    // 2223x3940) whose white backdrop is knocked out and whose black LCD aperture
    // is punched to alpha, with the smbn segments composited into the cabinet's own
    // (smaller, lower) LCD rect. Only _mountPreviewInto (gnw.js) + tileEmuLayersHTML/
    // showDeviceStage (index.html) consult game.preview; every other title has no
    // .preview so is completely unaffected. LCD rect measured on the full cabinet
    // via connected-components: px 708,2351 869x571 of 2223x3940 (same ~1.52 LCD
    // aspect as the zoomed crop, so the wide smbn segments fill it identically).
    preview: {
      artPath: 'artwork/gnw_smbspecial_full/',
      svgPath: 'artwork/gnw_smbn/gnw_smbn.svg',
      unitAspect: '2223 / 3940',
      screen: { left: 31.85, top: 59.67, width: 39.09, height: 14.49 },
    },
    // Buttons measured on the same zoomed crop (d-pad arms / GAME / TIME /
    // ALARM / JUMP). First-pass -- expected to be visually fine-tuned.
    hotspots: {
      up:    { left: 30.00, top: 70.10, width: 4.27, height: 4.40 },
      down:  { left: 30.00, top: 78.16, width: 4.27, height: 4.40 },
      left:  { left: 25.73, top: 73.48, width: 4.27, height: 4.40 },
      right: { left: 34.28, top: 73.48, width: 4.27, height: 4.40 },
      jump:  { left: 67.43, top: 71.72, width: 7.38, height: 7.87 },
      alarm: { left: 56.14, top: 67.42, width: 2.70, height: 2.78 },
      time:  { left: 48.49, top: 67.05, width: 4.95, height: 3.33 },
      gameA: { left: 41.25, top: 66.96, width: 4.95, height: 3.24 },
    },
  },

  climber: {
    title: 'Climber', subtitle: 'DR-802 · 1986',
    artPath: 'artwork/gnw_climber/',
    svgPath: 'artwork/gnw_climber/gnw_climber.svg',
    // default.lay: screen multiply bounds (891,239,1492x918).
    screen: { left: 27.223, top: 17.096, width: 45.585, height: 65.665 },
    panel: CRYSTAL_SHELL,
    hotspots: CRYSTAL_HOTSPOTS,
  },

  bfight: {
    title: 'Balloon Fight', subtitle: 'BF-803 · 1986',
    artPath: 'artwork/gnw_bfight/',
    svgPath: 'artwork/gnw_bfight/gnw_bfight.svg',
    // default.lay: screen multiply bounds (885,239,1489x908).
    screen: { left: 27.038, top: 17.096, width: 45.494, height: 64.950 },
    panel: CRYSTAL_SHELL,
    hotspots: CRYSTAL_HOTSPOTS,
  },


  /* ---- Micro Vs. System (1984) ------------------------------------------
     Boxing BX-301, Donkey Kong 3 AK-302, Donkey Kong Hockey HK-303 -- the
     two-player units, each with a pair of detachable controllers.

     All three are SM511 (MAME: sm511_common), the core already here. The new
     thing is the INPUT SHAPE: these are the first titles on the site that
     scan more than four S lines, and the first with two players. MAME's own
     microvs_shared port block is the authority for the wiring below --
     player 2 and player 1 mirrored across S1..S6, mode buttons together on
     S7:

       S1 bit2 = P2 fire      S2 bit0 = P1 fire
       S3 bit2 = P2 down      S3 bit3 = P2 up
       S4 bit0 = P1 down      S4 bit1 = P1 up
       S5 bit2 = P2 right     S5 bit3 = P2 left
       S6 bit0 = P1 right     S6 bit1 = P1 left
       S7 bit0 = Time, bit1 = Game B, bit2 = Game A, bit3 = Alarm

     Reaching S7 at all needed a real CPU fix -- the W register was masked to
     4 bits here, where the hardware's is 8 (see SM510.shiftW's comment).
     With the 4-bit W these ROMs never saw Time and their clocks never
     started.

     clockRam was traced against the real ROMs (held Time, measured which
     cells count and at what ratio -- 1x/10x/60x/600x), then verified by
     reading the whole clock back across an hour rollover, and pmBit by
     poking 11:59:50 and watching the hour-tens nibble across 12:00. All
     three agree, which is what you'd expect from one PCB family: seconds
     and minutes sit BELOW the hour cells at 20..25, and the AM/PM flag is
     bit 3 (8), not the 2 every SM511 handheld here uses.

     Controllers: the joysticks are not clickable. MAME's artwork draws the
     console alone (Unit.png) with the two controllers only in the backdrop
     photo, and ships pressed-state art for Game A/Game B/Time and nothing
     else -- so there is no button art to derive joystick hotspots from, and
     nothing on the case to click. MAME plays these from the keyboard too.
     Hence hotspots for the three mode buttons only; both players' sticks
     and buttons come from the keyboard and the on-screen control bar. */

  boxing: {
    title: 'Boxing', subtitle: 'BX-301 · 1984',
    artPath: 'artwork/gnw_boxing/',
    svgPath: 'artwork/gnw_boxing/gnw_boxing.svg',
    cpuType: 'sm511',
    lcdCBits: 2,
    // Traced and verified against the real ROM -- see the series comment
    // above for the method. Identical across all three Micro Vs. titles.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 450,
    lampTestOnBoot: true,
    microVs: true,
    // The real unit's own name for the action button on each controller.
    fireLabel: 'Punch',
    // default.lay "Unit Only": screen multiply bounds.
    screen: { left: 19.742, top: 22.553, width: 60.787, height: 31.103 },
    // Boxing is the only Micro Vs. whose layout actually uses the panel
    // overlay: MAME draws its backing again at 10% over the segments and two
    // reflection gradients at 15%. Donkey Kong 3 and Hockey set those same
    // layers to alpha 0.0, i.e. off, so they declare no gradients at all.
    panel: {
      bg: { left: 18.860, top: 21.314, width: 62.280, height: 35.316 },
      gradient: { left: 19.607, top: 22.181, width: 60.855, height: 32.094 },
      gradientFiles: ['Gradient1.png', 'Gradient2.png'],
      bgOverlayAlpha: 0.1,
      gradientAlpha: 0.15,
      gradient2Alpha: 0.15,
    },
    hotspots: MICROVS_HOTSPOTS,
    inputRows: MICROVS_INPUT_ROWS,
  },

  dkong3: {
    title: 'Donkey Kong 3', subtitle: 'AK-302 · 1984',
    artPath: 'artwork/gnw_dkong3/',
    svgPath: 'artwork/gnw_dkong3/gnw_dkong3.svg',
    cpuType: 'sm511',
    lcdCBits: 2,
    // Traced and verified against the real ROM -- see the series comment
    // above for the method. Identical across all three Micro Vs. titles.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 450,
    lampTestOnBoot: true,
    microVs: true,
    // The real unit's own name for the action button on each controller.
    fireLabel: 'Spray',
    // default.lay "Unit Only": screen multiply bounds.
    screen: { left: 18.860, top: 23.544, width: 62.144, height: 30.855 },
    // No overlay/gradients: this unit's own default.lay sets both to
    // alpha 0.0. Only the backing box differs from the segment box.
    panel: {
      bg: { left: 19.742, top: 22.553, width: 60.787, height: 31.103 },
    },
    hotspots: MICROVS_HOTSPOTS,
    inputRows: MICROVS_INPUT_ROWS,
  },

  dkhockey: {
    title: 'Donkey Kong Hockey', subtitle: 'HK-303 · 1984',
    artPath: 'artwork/gnw_dkhockey/',
    svgPath: 'artwork/gnw_dkhockey/gnw_dkhockey.svg',
    cpuType: 'sm511',
    lcdCBits: 2,
    // Traced and verified against the real ROM -- see the series comment
    // above for the method. Identical across all three Micro Vs. titles.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 450,
    lampTestOnBoot: true,
    microVs: true,
    // The real unit's own name for the action button on each controller.
    fireLabel: 'Shoot',
    // default.lay "Unit Only": screen multiply bounds.
    screen: { left: 18.114, top: 20.446, width: 63.229, height: 34.820 },
    // No overlay/gradients -- alpha 0.0 in its own default.lay, same as
    // Donkey Kong 3.
    panel: {
      bg: { left: 19.810, top: 22.800, width: 60.380, height: 30.855 },
    },
    hotspots: MICROVS_HOTSPOTS,
    inputRows: MICROVS_INPUT_ROWS,
  },

  mariotj: {
    title: 'Mario The Juggler', subtitle: 'MB-108 · 1991',
    artPath: 'artwork/gnw_mariotj/',
    svgPath: 'artwork/gnw_mariotj/gnw_mariotj.svg',
    // Fourth SM511 title, and the last New Wide Screen unit (1991) --
    // ROM/melody CRCs confirmed against the real MAME driver source
    // (gnw_mariotj, hh_sm510.cpp) before use: mb-108.program (4096B,
    // f7118bb4), mb-108.melody (256B, d8cc1f74 -- MAME itself flags this
    // one BAD_DUMP/decap-needed, so treat any audio glitches here as a
    // possibly-bad source dump, not necessarily an emulator bug).
    cpuType: 'sm511',
    lcdCBits: 2,
    // Found via a headless held-Time trace (same methodology as every
    // other title): a clean, fully sequential 6-cell block, unlike most
    // other titles' scattered addresses. No pmBit -- tried forcing bits
    // 2/4/8 of hT while the clock was actively displaying and diffed
    // cpu.lcd against the unforced baseline (the same method used to
    // confirm pmBit elsewhere); zero segment difference on any bit, so
    // this ROM doesn't appear to implement an AM/PM indicator at all.
    clockRam: { hT: 24, hO: 25, mT: 26, mO: 27, sT: 28, sO: 29 },
    // Real MAME ROM_REGION("maincpu:melody", 0x100).
    // Boot-init's own default clock write settles by cycle ~350 here --
    // comfortably inside the standard 450 every other New Wide Screen
    // SM511 title already uses, so kept the same rather than a new value.
    bootSyncCycles: 450,
    screen: { left: 23.82, top: 21.34, width: 51.97, height: 56.87 },
    // Real input ports (source-confirmed, gnw_mariotj INPUT_PORTS_START):
    // IN.0 bit0=Right, bit3=Left (a 16-way joystick in MAME's abstraction,
    // but only Left/Right are wired -- no Up/Down at all, unlike DKJr/SMB/
    // Climber/Balloon Fight's D-pad shape). IN.1: bit0=Time, bit1=GameB,
    // bit2=GameA, bit3=Alarm (IPT_SERVICE2 -- a factory-test input with no
    // matching physical button anywhere in the real artwork's layout, so
    // deliberately not given a hotspot below, unlike every other mode
    // button here).
    hotspots: {
      left:  { left: 4.02,  top: 59.91, width: 15.24, height: 25.21 },
      right: { left: 80.55, top: 59.91, width: 15.24, height: 25.21 },
      gameA: { left: 82.31, top: 6.27,  width: 9.00,  height: 14.88 },
      gameB: { left: 82.31, top: 17.80, width: 9.00,  height: 14.88 },
      time:  { left: 82.31, top: 28.94, width: 9.00,  height: 14.88 },
    },
    // No fixedRow and real hotspots.left/right -- same proactive fix as
    // every prior hammer/lever-shaped title with this shape, until proven
    // otherwise by real testing.
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { right: 1, left: 8 }, { time: 1, gameB: 2, gameA: 4 } ],
  },

  ssparky: {
    title: 'Spitball Sparky', subtitle: 'BU-201 · 1984',
    artPath: 'artwork/gnw_ssparky/',
    // Known upfront (real Unit.png is 997x2094) so _applyGameArtwork can set
    // .play-device's aspect-ratio synchronously instead of waiting for the
    // image to load -- see _applyUnitAspectRatio's own comment for why: this
    // ratio is far enough from the CSS default (2227/1500) that the old
    // load-triggered correction alone visibly snapped the whole device box
    // a beat after the modal opened ("the CSS resizes the device a little",
    // reported live on this title and Crab Grab/both Multi Screen titles).
    unitAspect: '997 / 2094',
    svgPath: 'artwork/gnw_ssparky/gnw_ssparky.svg',
    // Real MAME ROM (gnw_ssparky, hh_sm510_full.cpp): bu-201.program, 4096B,
    // ae0d28e7 -- confirmed against the real driver source before use, same
    // as every other title here. Super Color's own chip, same CPU family
    // (plain SM510, no melody ROM) as Manhole/Helmet/Lion/Fire Attack/
    // Cement Factory -- the "Super Color" branding is a denser/tinted LCD
    // glass, not a different silicon part.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, natural run with no forced RAM
    // writes -- direct multi-cell pokes proved unreliable for this ROM, see
    // below): a clean sequential 6-cell block, boot defaults to 12:00:00 as
    // usual, and a genuine ~60-minute run confirmed a correct 12-hour
    // rollover (hT/hO went 1,2 -> 0,1 i.e. "12" -> "01") at exactly the
    // 3600s mark with mT/mO/sT/sO all rolling over in lockstep at the same
    // instant. No pmBit: hT never showed anything but 0 or 1 across the
    // entire natural run; a direct-bit-forcing cross-check (the method that
    // worked for other titles) was inconclusive here since forcing several
    // clock cells at once corrupts this ROM's own hidden carry state (a
    // forced 11:59:59 rolled to garbage like hT=9 instead of a clean 12:00),
    // so this is judged from the natural run's own evidence only.
    clockRam: { hT: 10, hO: 11, mT: 12, mO: 13, sT: 14, sO: 15 },
    // Boot-init's own default clock write lands by cycle ~425 here (traced
    // via a raw cpu.step() loop from a fresh boot) -- close enough to the
    // standard 450 that it's worth the extra headroom other tight-margin
    // titles already needed (see Donkey Kong Jr.'s own 650 override), so
    // bumped to 500 rather than leaving only ~25 cycles of slack.
    bootSyncCycles: 500,
    // Screen-glass box taken directly from the real MAME artwork's own
    // "Unit Only" view (default.lay): Background element bounds (188,444,
    // 622,1023) against the Unit element's own bounds (0,0,997,2094) --
    // same derivation Ball/every other title's screen rect uses (Background
    // bounds as a fraction of the full device photo), not guessed.
    screen: { left: 18.86, top: 21.20, width: 62.39, height: 48.85 },
    // Real input ports (source-confirmed, gnw_ssparky INPUT_PORTS_START):
    // IN.0: bit0=Left, bit1=Right, bit2=Shooter(BUTTON1) -- a single
    // two-way rocker switch (Left/Right) plus one dedicated round action
    // button, same shape as Cement Factory's Left/Right+Open. IN.1:
    // bit0=Time, bit1=GameB, bit2=GameA, bit3=Alarm -- unlike Mario The
    // Juggler's Alarm bit, this one DOES have a real physical pinhole
    // button in the artwork (confirmed visually on Unit.png, same small
    // dot styling as ACL), so it gets a real hotspot here, matching the
    // bfightn/smbn/climbern precedent rather than Mario The Juggler's.
    // No hotspot given for ACL/reset, same as every other title -- it's
    // keyboard-only (key 4), never a clickable hotspot, since it's a
    // destructive action.
    // Hotspot boxes hand-measured off the real Unit.png (997x2094) via a
    // pixel grid overlay (ImageMagick), not guessed -- this artwork set
    // has no MAME <group> of button elements/inputtags to read positions
    // from directly (no Animation frames either -- gnw_ssparky/Animation/*
    // was synthesized here from Unit.png crops, brightened ~400% (modulate)
    // in place to read as flush/pressed against the silver bezel, since no
    // real second "pressed" photo exists for this title -- a real photo-
    // sourced title would have these already. A subtler darken was tried
    // first and looked right in isolation, but was invisible once actually
    // composited over the real button (this plastic is already near-black,
    // so a ~40%-darker near-black patch reads as no change at all); a
    // 50%-negate-blend was tried next and technically failed twice more --
    // ImageMagick's plain `-negate` inverts alpha as well as RGB (an opaque
    // source pixel became fully transparent, so the "fix" was invisible for
    // an unrelated reason), and once THAT was fixed, blending any
    // already-near-neutral colour with its own negation collapses to a flat
    // (v+(255-v))/2 = 127.5 regardless of v -- true for every pixel at
    // once, so it erased all the button's own shading and looked like a
    // flat grey rectangle instead of a lit dome. A brightness lift keeps
    // each pixel's relative shading intact, so the button still reads as
    // round/domed, just lit up. Crop boxes for each overlay are the
    // button's own coloured surface only, found via pixel-brightness
    // scanlines (ImageMagick txt: output) rather than the hotspot's own
    // (deliberately generous, easy-to-tap) box -- an early pass reused the
    // hotspot's own padded bounds for the crop too, which visibly lit up
    // the surrounding chrome/silver bezel along with the button itself.
    // Sizing went through one more round after that: still too big (traced
    // against the user's own annotated screenshot -- its scale/offset
    // relative to Unit.png was itself derived from the shooter's real
    // center-to-center distance to the switch, a robust reference since
    // both are precisely known on both sides), and the round Shooter cap
    // was lighting up as a square (the crop's own bounding box) instead of
    // a circle -- fixed with an actual circular alpha mask (ImageMagick
    // -compose CopyOpacity against a drawn circle), not just a tighter
    // square crop, so a round button now visibly reads as round when lit,
    // matching the switch/pills staying plain rectangles since neither the
    // MAME artwork nor the user's own annotation suggested those needed
    // rounding. One more fix after that: the Game A/B/Time pill highlights
    // sat visibly above the real pills (the first pixel-scan's y sample
    // landed in an unrelated dark seam above the pills, not the pills
    // themselves) -- re-scanned a clean vertical column straight through a
    // pill's own center (avoiding that seam) and moved the crop down to
    // the pill's real top edge. Two more rounds after THAT, both against
    // the user's own annotated screenshots again: the pills were still too
    // far left (a whole pill-width off on Time, landing over Game B) and
    // square-cornered against a genuinely oval/stadium-shaped button --
    // fixed with a real x/y re-measurement (a 20px fine grid overlaid
    // directly on the pill row) plus a roundrectangle alpha mask (radius =
    // half the box height, same CopyOpacity technique as the Shooter's
    // circle) so a pill now visibly reads as a pill, not a square. Then
    // still slightly too high and too big on a final pass -- a 4x-zoomed
    // crop with a 5px-real grid pinned the pill's true outer edge more
    // precisely than the earlier 20px grid could, confirming the box
    // needed to shift down further and shrink again; landed on the pill's
    // real center with a box sized between its outer ring and inner face
    // rather than the full outer bounds. One more 2px-down nudge on the
    // pills after that (a precise correction the user gave directly, not
    // re-derived), plus the same fix for Crab Grab's own Up/Down rocker,
    // whose highlight width was still spilling past the red lever into
    // the surrounding chrome on both sides -- narrowed from 131 to 95
    // (per the user's own annotated screenshot, scaled against the
    // rocker's own already-known real height as the reference rather
    // than a cross-button distance) and nudged down 2px, matching the
    // pills. Note BUTTON_DEFS.alarm
    // reuses gameA's same 'Animation/Grey-Flat-1.png' filename (existing
    // convention, not new here) -- pressing Alarm shows Game A's synthesized
    // highlight instead of its own, a minor cosmetic quirk shared with any
    // other title that has both a real gameA and a real alarm hotspot.
    hotspots: {
      left:  { left: 9.03,  top: 75.45, width: 15.25, height: 9.55 },
      right: { left: 24.27, top: 75.45, width: 15.35, height: 9.55 },
      open:  { left: 70.71, top: 75.93, width: 18.56, height: 8.60 },
      gameA: { left: 39.72, top: 90.73, width: 11.94, height: 4.78 },
      gameB: { left: 52.26, top: 90.73, width: 11.94, height: 4.78 },
      time:  { left: 65.20, top: 90.73, width: 11.94, height: 4.78 },
      alarm: { left: 81.04, top: 92.07, width: 4.41,  height: 2.10 },
    },
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { open: 4, right: 2, left: 1 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  cgrab: {
    title: 'Crab Grab', subtitle: 'UD-202 · 1984',
    artPath: 'artwork/gnw_cgrab/',
    // See ssparky's own unitAspect comment -- same case mold, same 997x2094
    // real Unit.png.
    unitAspect: '997 / 2094',
    svgPath: 'artwork/gnw_cgrab/gnw_cgrab.svg',
    // Real MAME ROM (gnw_cgrab, hh_sm510_full.cpp): ud-202.program, 4096B,
    // 65e97963 -- confirmed against the real driver source before use.
    // Same Super Colour SM510 chip family as Spitball Sparky, no melody ROM.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, natural run, same method as
    // Spitball Sparky): a different clean sequential 6-cell block than
    // Sparky's (20-25 here vs 10-15 there) -- same chip family and case
    // mold, but each ROM places its own clock cells wherever its own code
    // wants, not assumed to match. A genuine ~62-minute run confirmed a
    // correct 12-hour rollover (hT/hO went 1,2 -> 0,1) at exactly the 3600s
    // mark with mT/mO/sT/sO all rolling over in lockstep. No pmBit: hT
    // never showed anything but 0 or 1 across the entire run.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25 },
    // Boot-init's own default clock write lands by cycle 399 here (traced
    // via a raw cpu.step() loop from a fresh boot) -- comfortable margin
    // under 450, kept at 500 anyway for extra headroom (harmless either way).
    bootSyncCycles: 500,
    // Screen-glass box from the real MAME artwork's own "Unit Only" view
    // (default.lay): Background bounds (224,444,550,1023) against the Unit
    // element's own bounds (0,0,997,2094) -- same derivation as every other
    // title's screen rect.
    screen: { left: 22.47, top: 21.20, width: 55.16, height: 48.85 },
    // Real input ports (source-confirmed, gnw_cgrab INPUT_PORTS_START):
    // IN.0: bit0=Right, bit1=Up, bit2=Left, bit3=Down -- a genuine 4-way
    // d-pad, but physically built as TWO separate 2-way rockers (Left/Right
    // bottom-left, Up/Down top-right), confirmed visually on Unit.png --
    // not a single cross-shaped pad. IN.1: bit0=Time, bit1=GameB, bit2=GameA,
    // bit3=Alarm -- same real physical Alarm pinhole as Spitball Sparky
    // (confirmed visually, identical case mold), gets a real hotspot.
    // No hotspot for ACL/reset, same as every other title.
    // Hotspot boxes hand-measured off the real Unit.png (997x2094) via a
    // pixel grid overlay (ImageMagick) -- this artwork set (unlike Spitball
    // Sparky's) has no Animation/ press-state frames either, so those were
    // synthesized the same way -- see Spitball Sparky's own comment for why
    // it's a ~400% brightness lift and not a darken or negate-blend.
    hotspots: {
      left:  { left: 9.03,  top: 75.45, width: 15.25, height: 9.55 },
      right: { left: 24.27, top: 75.45, width: 15.35, height: 9.55 },
      up:    { left: 70.71, top: 73.78, width: 18.05, height: 6.54 },
      down:  { left: 70.71, top: 80.32, width: 18.05, height: 6.59 },
      gameA: { left: 39.72, top: 90.73, width: 11.94, height: 4.78 },
      gameB: { left: 52.26, top: 90.73, width: 11.94, height: 4.78 },
      time:  { left: 65.20, top: 90.73, width: 11.94, height: 4.78 },
      alarm: { left: 81.04, top: 92.07, width: 4.41,  height: 2.10 },
    },
    hammersNeedQuickTap: true,
    lampTestOnBoot: true,
    inputRows: [ { right: 1, up: 2, left: 4, down: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  dkong: {
    title: 'Donkey Kong', subtitle: 'DK-52 · 1982',
    artPath: 'artwork/gnw_dkong/',
    // See ssparky's own unitAspect comment for why this is set upfront
    // (real Unit.png is 1767x2199).
    unitAspect: '1767 / 2199',
    // Multi Screen title: the real DK-52 is a single SM510 chip driving two
    // physically separate LCD panels (sm510_dualv in MAME's own driver),
    // not a different chip -- confirmed against the real driver source
    // (hh_sm510_full.cpp) before writing a single line of new dual-screen
    // plumbing. The CPU's lcd[] array is one shared flat array; svgPath
    // (top) and svgPath2 (bottom) each just reference their own screen's
    // real (A,B,C) segment addresses out of that same array, with no
    // overlap, so no CPU-level change was needed -- only a second
    // GnwDisplay/mount path (see GnwEmulator.mount()/_frame()) and a second
    // screen box (screen2) in the Play modal markup.
    svgPath: 'artwork/gnw_dkong/gnw_dkong_top.svg',
    svgPath2: 'artwork/gnw_dkong/gnw_dkong_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_dkong, hh_sm510_full.cpp): dk-52, 4096B,
    // 5180cbf8 -- confirmed against the real driver source (Node zlib.crc32)
    // before use. Plain SM510, no melody ROM.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, natural run at the real
    // 16384 instr/sec rate -- 32768Hz crystal / clkDiv 2). Unlike every
    // other title so far, this ROM's clock-tick routine only runs once
    // Time mode has actually been selected at least once (a plain natural
    // run with no button ever pressed leaves the whole clock block frozen
    // at zero indefinitely) -- traced by tapping the real Time K-line bit
    // once after boot, then letting it run free. sO/sT (64/65) confirmed
    // via a 0.1s-resolution probe: ram[64] increments cleanly every real
    // second, rolling into ram[65] at 9->0 exactly as expected. mO/mT
    // (66/67) and hO/hT (68/69) confirmed the same way at 1-minute
    // resolution over 15 real minutes: ram[66] counts a clean +1/minute,
    // rolling into ram[67] at 9->0; ram[67]/69/68 hold the ROM's own
    // default "12:00:00" boot value (hO:2, hT:1) exactly as every other
    // title's boot-init writes. This ROM also carries a second, apparently
    // unused duplicate clock block at 80-85 (identical mO/mT/hO/hT
    // behaviour, but with no working seconds counter of its own) -- likely
    // feeds a second on-screen digit group this build doesn't need;
    // 64-69 is the one that behaves like a genuine live RTC and is used
    // here. pmBit:2, NOT the more common bit3/8 convention (Fire Attack/
    // Turtle Bridge/Snoopy Tennis's family) -- shipped with pmBit:8 first
    // (unverified assumption) and it silently always showed AM regardless
    // of real time, reported live ("says 8:52 AM but its PM"). Re-derived
    // two ways: (1) forcing hT's own bit1 (value 2) produces a clean
    // 2-segment swap, ram[101] bit2 off / ram[101] bit3 on -- two adjacent
    // sub-segments of the same small AM/PM glyph, not a digit-shape
    // artifact (ram 101 is nowhere near hT's own address 69); (2) a real
    // natural 11:59->12:00 noon rollover (Time tapped, then run free, no
    // forced pokes) independently produced hT=3 (bit0 for the "1" tens-
    // digit + bit1 for PM) with zero intervention -- the same convention
    // already used for Mickey Mouse/Egg elsewhere in this project. Live-
    // verified afterward: a real afternoon browser time now shows PM
    // correctly instead of a permanent AM.
    clockRam: { hT: 69, hO: 68, mT: 67, mO: 66, sT: 65, sO: 64, pmBit: 2 },
    bootSyncCycles: 450,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top bounds (486,310,794,512) and Screen-Bottom
    // bounds (486,1353,794,512), both against the DK-52 element's own
    // bounds (0,0,1767,2199) -- same derivation as every other title's
    // screen rect, just twice (top/bottom share the same left/width, only
    // top differs).
    screen: { left: 27.51, top: 14.10, width: 44.94, height: 23.28 },
    screen2: { left: 27.51, top: 61.53, width: 44.94, height: 23.28 },
    // Real input ports (source-confirmed, gnw_dkong INPUT_PORTS_START):
    // IN.0 bit3=Jump (its own row, only one bit used); IN.1 bit0=Right,
    // bit1=Up, bit2=Left, bit3=Down -- a genuine single 4-way D-pad (one
    // physical plus-shaped rocker, confirmed visually on Unit.png, same
    // btn1-4 mechanism as Donkey Kong Jr.'s own pad -- see dkjr's comment
    // for why no new BUTTON_DEFS shape was needed); IN.2 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm -- Alarm/ACL are both non-
    // clickable LED indicators on the real unit (confirmed via a zoomed
    // grid crop of Unit.png, same as dkjr's own Alarm), so no hotspot for
    // either, same as dkjr.
    // Hotspot boxes hand-measured off the real Unit.png (1767x2199) via
    // pixel-level black-region detection (ImageMagick txt: dump + a Node
    // row/column threshold scan, not just a visual grid read) -- the D-pad
    // is one solid black cross with no gap between arms and center hub, so
    // each arm's box is the outer two-thirds of that arm (hub excluded),
    // matching the same logical-quadrant convention as dkjr's own pad.
    hotspots: {
      jump: { left: 83.36, top: 81.81, width: 6.96, height: 5.59 },
      btn1: { left: 15.51, top: 82.67, width: 4.30, height: 4.09 },
      btn2: { left: 10.41, top: 79.22, width: 5.09, height: 3.46 },
      btn3: { left: 6.11,  top: 82.67, width: 4.30, height: 4.09 },
      btn4: { left: 10.41, top: 86.77, width: 5.09, height: 3.46 },
      gameA: { left: 83.59, top: 56.66, width: 4.53, height: 2.18 },
      gameB: { left: 83.59, top: 61.76, width: 4.53, height: 2.36 },
      time:  { left: 83.59, top: 67.08, width: 4.53, height: 2.32 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as dkjr, applied
    // proactively from the start.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { jump: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  dkong2: {
    title: 'Donkey Kong II', subtitle: 'JR-55 · 1983',
    artPath: 'artwork/gnw_dkong2/',
    // See ssparky's own unitAspect comment for why this is set upfront
    // (real Unit.png is 1767x2199, same as DK-52's).
    unitAspect: '1767 / 2199',
    // Multi Screen title, same architecture as Donkey Kong (DK-52): a
    // plain SM510 (`Sharp SM510 label JR-55 53YC`) driving two physically
    // separate LCD panels via `sm510_dualv` in the real driver source --
    // confirmed against hh_sm510_full.cpp before assuming anything carried
    // over from DK-52. See GAMES.dkong's own comment for why no CPU-level
    // change is needed for a second screen.
    svgPath: 'artwork/gnw_dkong2/gnw_dkong2_top.svg',
    svgPath2: 'artwork/gnw_dkong2/gnw_dkong2_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_dkong2, hh_sm510_full.cpp): jr-55_560, 4096B,
    // 46aed0ae -- confirmed against the real driver source before use.
    // Plain SM510, no melody ROM.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, same held-Time-then-run-free
    // method as DK-52 -- this ROM's clock tick routine has the same
    // quirk, frozen at zero until Time mode has been entered at least
    // once). Different address family than DK-52's (10-15 there, 65-70
    // here) and a different internal ordering (mO/mT/hO/hT/sO/sT
    // ascending here, vs DK-52's sO/sT/mO/mT/hO/hT) -- neither assumed,
    // both independently confirmed: sO (69) via a 0.1s-resolution probe
    // (clean +1/real-second, rolling into sT at 9->0), mO/mT/hO/hT via a
    // 65-real-minute natural run (mO counts a clean +1/minute rolling
    // into mT at 9->0; hO/hT held the ROM's own default "12:00" boot
    // value, then rolled 12->1 cleanly at the 60-minute mark). This ROM
    // also carries the same apparently-unused duplicate mO/mT/hO/hT block
    // (81-84) DK-52 has at 80-85, with no working seconds counter of its
    // own -- not used here for the same reason. pmBit:2 (not the more
    // common bit3/8 family) confirmed the same way DK-52's correction
    // was found: a real natural 11:59:59->12:00:00 rollover produced
    // hT=3 (bit0 for the "1" tens-digit + bit1 for PM), not 9 -- verified
    // from the start this time rather than shipping an assumed bit3/8
    // guess (see DK-52's own clockRam comment for why that assumption
    // was wrong there).
    clockRam: { hT: 68, hO: 67, mT: 66, mO: 65, sT: 70, sO: 69, pmBit: 2 },
    bootSyncCycles: 450,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (492,304,793,513) and
    // Screen-Bottom "multiply" bounds (489,1354,787,507), both against the
    // Unit element's own bounds (0,0,1767,2199) -- same derivation as
    // DK-52's own screen boxes, independently re-measured (not copied --
    // this case mold's screen bounds differ from DK-52's by a few px).
    screen: { left: 27.84, top: 13.82, width: 44.88, height: 23.33 },
    screen2: { left: 27.68, top: 61.57, width: 44.54, height: 23.06 },
    // Real input ports (source-confirmed, gnw_dkong2 INPUT_PORTS_START):
    // identical shape to DK-52's -- IN.0 bit3=Jump; IN.1 bit0=Right,
    // bit1=Up, bit2=Left, bit3=Down (genuine single 4-way D-pad, same
    // btn1-4 mechanism); IN.2 bit0=Time, bit1=GameB, bit2=GameA,
    // bit3=Alarm (Alarm/ACL both non-clickable LED indicators, confirmed
    // visually on this Unit.png too, no hotspot for either).
    // Hotspot boxes hand-measured off this title's own real Unit.png
    // (1767x2199, same canvas size as DK-52 but a different case mold/
    // photo) via the same pixel-level black-region threshold scan --
    // the D-pad's own measured pixel bounds came back numerically
    // identical to DK-52's (108-350 x, 242-484 y, same arm widths),
    // consistent with the two titles sharing the same physical
    // controller-assembly mold; Game A/B/Time/Jump were re-measured
    // independently and differ slightly in y-position from DK-52's own.
    hotspots: {
      jump: { left: 83.36, top: 81.81, width: 6.96, height: 5.59 },
      btn1: { left: 15.51, top: 82.67, width: 4.30, height: 4.09 },
      btn2: { left: 10.41, top: 79.22, width: 5.09, height: 3.46 },
      btn3: { left: 6.11,  top: 82.67, width: 4.30, height: 4.09 },
      btn4: { left: 10.41, top: 86.77, width: 5.09, height: 3.46 },
      gameA: { left: 83.59, top: 56.66, width: 4.53, height: 2.18 },
      gameB: { left: 83.59, top: 61.94, width: 4.53, height: 2.18 },
      time:  { left: 83.59, top: 67.21, width: 4.53, height: 2.18 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as DK-52.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { jump: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  ghouse: {
    title: 'Green House', subtitle: 'GH-54 · 1982',
    artPath: 'artwork/gnw_ghouse/',
    // See ssparky's own unitAspect comment for why this is set upfront
    // (real Unit.png is 1767x2199, same canvas size as both Donkey Kong
    // titles, though this is a genuinely different case mold -- see the
    // hotspots comment below for why nothing else was assumed to carry
    // over).
    unitAspect: '1767 / 2199',
    // Multi Screen title, same architecture as Donkey Kong (DK-52)/Donkey
    // Kong II (JR-55): a plain SM510 (`Sharp SM510 label GH-54 52ZD`)
    // driving two physically separate LCD panels via `sm510_dualv` in the
    // real driver source -- confirmed against hh_sm510_full.cpp before
    // assuming anything carried over. See GAMES.dkong's own comment for
    // why no CPU-level change is needed for a second screen.
    svgPath: 'artwork/gnw_ghouse/gnw_ghouse_top.svg',
    svgPath2: 'artwork/gnw_ghouse/gnw_ghouse_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_ghouse, hh_sm510_full.cpp): gh-54, 4096B,
    // 4df12b4d -- confirmed against the real driver source before use.
    // Plain SM510, no melody ROM.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, same held-Time-then-run-free
    // method as both Donkey Kong titles). Unlike either of them, this
    // ROM's clockRam is the same clean sequential 20-25 block used by
    // Donkey Kong Jr./Fire Attack/Turtle Bridge/Snoopy Tennis/Manhole
    // NH-103/Mario's Cement Factory/Tropical Fish/Super Mario Bros./
    // Climber/Balloon Fight/Mario The Juggler -- confirmed fresh (mO at
    // 23 counts a clean +1/minute rolling into mT at 22 every 10; hT/hO
    // at 20/21 held the ROM's own default "12:00" boot value, then rolled
    // 12->1 cleanly at the 60-minute mark; sO at 25 confirmed via a
    // 0.1s-resolution probe, clean +1/real-second rolling into sT at 24),
    // not assumed to match just because the address family is a familiar
    // one. pmBit:8 (the hT bit3 convention, not DK-52/DKII's own bit1)
    // confirmed the same way DK-52's original wrong guess was corrected:
    // a real natural 11:59:59->12:00:00 rollover produced hT=9 (bit0 for
    // the "1" tens-digit + bit3 for PM), matching the majority convention
    // this specific 20-25 address family already uses elsewhere in this
    // project -- verified, not assumed, even though it happened to match.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 450,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (467,298,839,546) and
    // Screen-Bottom "multiply" bounds (467,1340,833,553), both against the
    // Unit element's own bounds (0,0,1767,2199) -- independently
    // re-measured from this title's own default.lay, not copied from
    // either Donkey Kong title (close but not identical).
    screen: { left: 26.43, top: 13.55, width: 47.48, height: 24.83 },
    screen2: { left: 26.43, top: 60.94, width: 47.14, height: 25.15 },
    // Real input ports (source-confirmed, gnw_ghouse INPUT_PORTS_START):
    // identical shape to both Donkey Kong titles -- IN.0 bit3=Spray (the
    // real device's own action-button label, functionally the same
    // dedicated action button as Jump); IN.1 bit0=Right, bit1=Up,
    // bit2=Left, bit3=Down (genuine single 4-way D-pad, same btn1-4
    // mechanism); IN.2 bit0=Time, bit1=GameB, bit2=GameA, bit3=Alarm
    // (Alarm/ACL both non-clickable LED indicators, confirmed visually on
    // this Unit.png too, no hotspot for either).
    // Hotspot boxes hand-measured off this title's own real Unit.png
    // (1767x2199, same canvas size as both Donkey Kong titles but a
    // genuinely different case mold/photo -- teal D-pad and Spray button,
    // not black plastic) via the same pixel-level threshold-scan
    // technique, adapted for a teal-on-white colour scheme instead of
    // black-on-white (the D-pad's own measured pixel bounds came back
    // close to but not identical to DK-52/DKII's -- confirming this is a
    // related but distinct mold, not assumed to be a shared part this
    // time). Game A/B/Time landed at pixel-identical positions to both
    // Donkey Kong titles' own (same crop, same measured bounds) -- that
    // part of the control cluster does appear to be a shared assembly.
    hotspots: {
      jump: { left: 83.64, top: 81.90, width: 6.68, height: 5.32 },
      btn1: { left: 15.22, top: 82.95, width: 4.25, height: 3.36 },
      btn2: { left: 10.87, top: 79.58, width: 4.36, height: 3.36 },
      btn3: { left: 6.57,  top: 82.95, width: 4.30, height: 3.36 },
      btn4: { left: 10.87, top: 86.31, width: 4.36, height: 3.50 },
      gameA: { left: 83.59, top: 56.66, width: 4.53, height: 2.18 },
      gameB: { left: 83.59, top: 61.94, width: 4.53, height: 2.18 },
      time:  { left: 83.59, top: 67.21, width: 4.53, height: 2.18 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as both Donkey Kong
    // titles.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { jump: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  bombsweep: {
    title: 'Bomb Sweeper', subtitle: 'BD-62 · 1987',
    // The D-pad's synthesized pressed crops (Animation/1-4-Flat.png, 76x75) get
    // stretched full-screen by the full-frame overlay -- glow the d-pad hotspots
    // instead. Game A/B/Time keep their real full-frame pressed art.
    highlightButtons: ['btn1', 'btn2', 'btn3', 'btn4'],
    artPath: 'artwork/gnw_bsweep/',
    // Real Unit.png is 1767x2199, same canvas size as every other Multi
    // Screen title so far (DK-52/DK-II/Green House) despite this being a
    // genuinely different case mold (photo/artwork differ) -- see
    // ssparky's own unitAspect comment for why this is set upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD like DK-52/DK-II/Green House -- but a
    // genuinely different chip this time: real MAME driver
    // (hh_sm510_full.cpp, gnw_bsweep_state) configures `sm512_dualv`, not
    // `sm510_dualv`. Confirmed via the real driver C++ class hierarchy
    // before writing a single line of new CPU code that SM512 is a true
    // subclass of SM511 (not a sibling chip that merely resembles it) --
    // see the SM512 class's own header comment above for the full
    // reasoning. First title in this project to use it.
    svgPath: 'artwork/gnw_bsweep/gnw_bsweep_top.svg',
    svgPath2: 'artwork/gnw_bsweep/gnw_bsweep_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_bsweep, hh_sm510_full.cpp): bd-62.program, 4096B,
    // f3ac66ea; bd-62.melody, 256B, addc0368 (BAD_DUMP/decap-needed per
    // MAME itself, same caveat as every other melody dump in this
    // project) -- both confirmed via sha1sum against the real driver's
    // own CRC/SHA1 comments before use.
    cpuType: 'sm512',
    lcdCBits: 2,
    // Empirically traced (headless SM512 sim via the project's Node/vm
    // harness technique). One real gotcha found here: SM511/SM512 default
    // clkDiv is 4 (8192Hz), not SM510's fixed 2 (16384Hz) -- a wrong
    // hardcoded HZ assumption in the trace script itself initially made a
    // genuine 1-per-minute counter look like it ticked every 30 "seconds"
    // instead of every 60; recomputing HZ from the real cpu.clkDiv (same
    // as _frame()'s own "refresh cpuHz every frame" comment already
    // warns) fixed the trace. Clean sequential 6-cell block at 16-21
    // (hT,hO,mT,mO,sT,sO), confirmed via a real natural run: sO (21)
    // ticks +1/real-second rolling into sT (20) at 9->0; mO (19) ticks
    // +1/real-minute rolling into mT (18) at 9->0; hO/hT held the ROM's
    // own "12:00" boot default then rolled 12->1 cleanly at the 60-minute
    // mark. This ROM also carries two further duplicate hT/hO/mT/mO
    // blocks (64-67 and a partial one near 68-70) that mirror 16-19
    // within about one real second of a direct poke to 16-19 (confirmed
    // live in the trace harness) -- almost certainly feeding the second
    // physical screen's own digit-decode pass, same shape as DK-52's own
    // "apparently unused duplicate clock block" but here shown to
    // actually resync from the primary block rather than being truly
    // unused, so poking only the one block (16-21) is sufficient exactly
    // like every other clockRam entry in this file. pmBit:2 (the Mickey
    // Mouse/DK-52/DK-II convention, not the more common bit3/8 family) --
    // confirmed both directions via real natural 11:59:59->12:00:00
    // rollovers (hT 1->3 crossing into PM, and 3->1 crossing back into AM
    // twelve hours later), not assumed from either convention.
    clockRam: { hT: 16, hO: 17, mT: 18, mO: 19, sT: 20, sO: 21, pmBit: 2 },
    // This ROM's boot-init RAM writes land later than the usual 300-cycle
    // default (confirmed complete by cycle 700 via a 100-cycle-resolution
    // trace, nothing earlier) -- same class of gap as Fire Attack's own
    // bootSyncCycles bump, a comfortable margin above the observed
    // completion point rather than the bare minimum.
    bootSyncCycles: 750,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (432,270,893,613) and
    // Screen-Bottom "multiply" bounds (430,1328,893,587), both against the
    // Unit element's own bounds (0,0,1767,2199) -- same derivation as
    // every other Multi Screen title's screen box.
    screen: { left: 24.45, top: 12.28, width: 50.54, height: 27.88 },
    screen2: { left: 24.34, top: 60.39, width: 50.54, height: 26.69 },
    // Real input ports (source-confirmed, gnw_bsweep INPUT_PORTS_START):
    // IN.0 bit0=Left, bit1=Up, bit2=Right, bit3=Down (a genuine single
    // 4-way D-pad, same btn1-4 mechanism as DK-52/DK-II/Green House --
    // this title has no separate action button at all, matching its own
    // premise of tracing a route through a minefield); IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm (Alarm is a non-clickable LED
    // indicator next to Game A, confirmed visually on Unit.png same as
    // the other three Multi Screen titles, so no hotspot for it either).
    // Hotspot boxes hand-measured off this title's own Unit.png (a
    // genuinely different case mold/photo than any prior Multi Screen
    // title -- the D-pad sits bottom-left here, not centered) via
    // ImageMagick color-isolation + -trim on the D-pad's own red pixels
    // (this title's MAME artwork bundle has no button-element group and
    // no per-button Animation art for the pad at all, same gap as
    // Spitball Sparky/Crab Grab -- only Game A/B/Time have real pressed-
    // state art, isolated the same -trim way). D-pad cross bbox measured
    // at (116,1751)-(345,1976)px of the 1767x2199 canvas, split into
    // thirds per arm (hub excluded) -- the exact same outer-third
    // convention as DK-52/DK-II's own D-pad hotspots. btn1-4's own
    // pressed-state art (Animation/1-4-Flat.png, required by BUTTON_DEFS
    // but absent from the real MAME artwork bundle) was synthesized the
    // same way as Spitball Sparky/Crab Grab -- cropped straight from
    // Unit.png at each arm's own hotspot box, brightness-lifted in place.
    // This D-pad's red plastic is already bright (~85% value on the pure
    // color) so the usual 400% modulate clipped straight to white, and
    // even Green House's already-reduced 200% (itself a fix for a bright
    // teal button) still washed out to near-white here -- checked
    // visually at 150/200/250% before picking 150%, the highest value
    // that still reads as "the same red, lit up" rather than pale pink.
    hotspots: {
      btn1: { left: 6.57,  top: 83.04, width: 4.32, height: 3.41 },
      btn2: { left: 10.89, top: 79.63, width: 4.32, height: 3.41 },
      btn3: { left: 15.21, top: 83.04, width: 4.32, height: 3.41 },
      btn4: { left: 10.89, top: 86.45, width: 4.32, height: 3.41 },
      gameA: { left: 81.44, top: 54.07, width: 8.77, height: 7.41 },
      gameB: { left: 81.44, top: 59.25, width: 8.77, height: 7.41 },
      time:  { left: 81.44, top: 64.48, width: 8.77, height: 7.41 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as DK-52/DK-II/Green
    // House. None of those three needed noResetOnModeButtons (only
    // Donkey Kong Jr. did, for its own specific CEND-halt bug) so it's
    // deliberately not set here either -- add it only if live testing
    // shows the same stuck-after-GameA symptom.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  gcliff: {
    title: 'Gold Cliff', subtitle: 'MV-64 · 1988',
    // Same synthesized d-pad crops as Bomb Sweeper -- glow the d-pad hotspots;
    // Game/Continue/Time/Jump keep their real full-frame pressed art.
    highlightButtons: ['btn1', 'btn2', 'btn3', 'btn4'],
    artPath: 'artwork/gnw_gcliff/',
    // Real Unit.png is 1767x2199, same canvas as every other late Multi
    // Screen title -- see ssparky's own unitAspect comment for why this
    // is set upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD. Real MAME driver (hh_sm510_full.cpp,
    // gnw_gcliff_state) confirms `sm512_dualv`, same SM512 chip Bomb
    // Sweeper needed a new CPU class for -- no new engine work required
    // here, just the standard per-title bring-up.
    svgPath: 'artwork/gnw_gcliff/gnw_gcliff_top.svg',
    svgPath2: 'artwork/gnw_gcliff/gnw_gcliff_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_gcliff, hh_sm510_full.cpp): mv-64.program, 4096B,
    // 2448a3bf; mv-64.melody, 256B, cb938709 (BAD_DUMP/decap-needed, same
    // caveat as every melody dump in this project) -- both confirmed via
    // sha1sum against the real driver's own CRC/SHA1 comments before use.
    cpuType: 'sm512',
    lcdCBits: 2,
    // Empirically traced (headless SM512 sim, same Node/vm harness as
    // Bomb Sweeper, clkDiv read live rather than hardcoded this time).
    // Same clean sequential clockRam block (16-21) and same pmBit:2 as
    // Bomb Sweeper -- confirmed fresh via a real natural run/rollover,
    // not assumed from the shared button-cluster mold. Duplicate mirror
    // cells exist at 66/48-49/64-65/68-69 (same shape as every other
    // title's redundant second digit-decode pass), left unpoked since
    // they resync from 16-21 on their own within a tick.
    clockRam: { hT: 16, hO: 17, mT: 18, mO: 19, sT: 20, sO: 21, pmBit: 2 },
    // Boot-init RAM writes complete by cycle 700 (100-cycle-resolution
    // trace, nothing later) -- same as Bomb Sweeper, same comfortable
    // margin above the observed completion point.
    bootSyncCycles: 750,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (463,290,841,567) and
    // Screen-Bottom "multiply" bounds (471,1342,820,550), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.20, top: 13.19, width: 47.60, height: 25.78 },
    screen2: { left: 26.66, top: 61.03, width: 46.41, height: 25.01 },
    // Real input ports (source-confirmed, gnw_gcliff INPUT_PORTS_START):
    // IN.0 bit0=Left, bit1=Up, bit2=Right, bit3=Down (genuine 4-way D-pad,
    // same btn1-4 mechanism/mold as Bomb Sweeper -- confirmed, not
    // assumed: color-isolating the D-pad's own red pixels landed on the
    // exact same (116,1751)-(345,1976)px bounding box as Bomb Sweeper's,
    // confirming the shared physical controller-assembly mold rather than
    // just a similar-looking one); IN.1 bit0=Jump (its own row, only one
    // bit used, same shape as Donkey Kong/DK-II/DKJr's own dedicated
    // jump button -- this one has real pressed-state art, Animation/
    // Jump-Flat.png, unlike Bomb Sweeper's D-pad); IN.2 bit0=Time,
    // bit1=Continue(START2), bit2=Game(START1), bit3=Alarm -- printed on
    // the real case as "GAME"/"CONTINUE" rather than "GAME A"/"GAME B",
    // but the same bit shape as every other title's gameA/gameB, so no
    // new BUTTON_DEFS needed, just relabeled hotspot semantics. Alarm has
    // no matching physical hotspot (LED indicator only, confirmed
    // visually next to GAME, same as Bomb Sweeper's Alarm).
    // Hotspot boxes: D-pad reused Bomb Sweeper's exact measured values
    // (confirmed identical bounding box, see above); Game/Continue/Time
    // hand-measured off this title's own Grey-Flat-1/2/3.png via -trim
    // and landed pixel-identical to Bomb Sweeper's too (same shared round-
    // button cluster assembly); Jump measured the same way off this
    // title's own real Jump-Flat.png (this case mold's Jump button sits
    // where Bomb Sweeper has no equivalent third button). btn1-4's own
    // pressed-state art (Animation/1-4-Flat.png) is absent from this
    // title's MAME artwork bundle too (only Game/Continue/Time/Jump have
    // real Animation frames) -- synthesized the exact same way as Bomb
    // Sweeper (same D-pad crop coordinates, same 150% brightness lift,
    // since it's confirmed to be the same red plastic/mold), not
    // reworked from scratch.
    hotspots: {
      btn1: { left: 6.57,  top: 83.04, width: 4.32, height: 3.41 },
      btn2: { left: 10.89, top: 79.63, width: 4.32, height: 3.41 },
      btn3: { left: 15.21, top: 83.04, width: 4.32, height: 3.41 },
      btn4: { left: 10.89, top: 86.45, width: 4.32, height: 3.41 },
      jump: { left: 80.19, top: 79.08, width: 13.30, height: 11.19 },
      gameA: { left: 81.44, top: 54.07, width: 8.77, height: 7.41 },
      gameB: { left: 81.44, top: 59.25, width: 8.77, height: 7.41 },
      time:  { left: 81.44, top: 64.48, width: 8.77, height: 7.41 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as Bomb Sweeper/DK-52/
    // DK-II/Green House. Not shipping noResetOnModeButtons proactively,
    // same reasoning as Bomb Sweeper (only Donkey Kong Jr. ever needed it,
    // for its own specific CEND-halt bug) -- add only if live testing
    // shows the same symptom.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { jump: 1 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  zelda: {
    title: 'Zelda', subtitle: 'ZL-65 · 1989',
    // ALL of Zelda's pressed crops (d-pad + Game/Continue/Time/Attack) are small
    // and stretch full-screen -- glow every button hotspot instead.
    highlightButtons: ['btn1', 'btn2', 'btn3', 'btn4', 'jump', 'gameA', 'gameB', 'time'],
    artPath: 'artwork/gnw_zelda/',
    // Real Unit.png (ZL-65.png in the source artwork bundle, renamed to
    // the usual Unit.png here for consistency) is 1767x2199, same canvas
    // as every other late Multi Screen title.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD, real MAME driver (hh_sm510_full.cpp,
    // gnw_zelda_state) confirms `sm512_dualv` -- same SM512 chip as Bomb
    // Sweeper/Gold Cliff, no new engine work needed. This is the last of
    // the four D-pad Multi Screen titles.
    svgPath: 'artwork/gnw_zelda/gnw_zelda_top.svg',
    svgPath2: 'artwork/gnw_zelda/gnw_zelda_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_zelda, hh_sm510_full.cpp): zl-65.program, 4096B,
    // b96aa64e; zl-65.melody, 256B, 3a281b0f (BAD_DUMP/decap-needed, same
    // caveat as every melody dump in this project) -- both confirmed via
    // sha1sum against the real driver's own CRC/SHA1 comments before use.
    cpuType: 'sm512',
    lcdCBits: 2,
    // Empirically traced (headless SM512 sim, same Node/vm harness as
    // Bomb Sweeper/Gold Cliff). Same clean sequential 6-cell block as
    // those two, but a genuinely DIFFERENT internal ordering this time --
    // not assumed from the shared button-cluster mold: 16=mO/17=mT/18=hO/
    // 19=hT/20=sO/21=sT (ascending mO/mT/hO/hT/sO/sT), vs Bomb Sweeper/
    // Gold Cliff's hT/hO/mT/mO/sT/sO. Same class of internal-ordering
    // divergence already seen between DK-52 and DK-II despite their own
    // shared mold, so re-verified fresh rather than copied. `pmBit:2`
    // confirmed via a real natural 11:59:59->12:00:00 rollover (hT
    // 1->3), same convention as Bomb Sweeper/Gold Cliff. Duplicate mirror
    // cells exist at 64/65 (mO/mT copies) -- left unpoked, same as the
    // other two titles' own redundant mirrors.
    clockRam: { hT: 19, hO: 18, mT: 17, mO: 16, sT: 21, sO: 20, pmBit: 2 },
    // Boot-init RAM writes complete by cycle 700 (100-cycle-resolution
    // trace, nothing later) -- same as Bomb Sweeper/Gold Cliff.
    bootSyncCycles: 750,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (462,286,843,591) and
    // Screen-Bottom "multiply" bounds (457,1332,853,575), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.15, top: 13.01, width: 47.71, height: 26.87 },
    screen2: { left: 25.86, top: 60.57, width: 48.27, height: 26.15 },
    // Real input ports (source-confirmed, gnw_zelda INPUT_PORTS_START):
    // IN.0 bit0=Left, bit1=Up, bit2=Right, bit3=Down (genuine 4-way
    // D-pad -- confirmed, not assumed, via the same red-pixel colour
    // isolation used for Bomb Sweeper/Gold Cliff, landing on the exact
    // same (116,1751)-(345,1976)px bounding box -- third title confirmed
    // sharing this physical controller-assembly mold); IN.1 bit0=Attack
    // (its own row, only one bit used -- reused the existing `jump`
    // BUTTON_DEFS/hotspot shape rather than adding a new one, same as
    // Gold Cliff reusing gameA/gameB for "Game"/"Continue" -- printed
    // label differs, bit shape and mechanism don't); IN.2 bit0=Time,
    // bit1=Continue(START2), bit2=Game(START1), bit3=Alarm, same shape
    // as Gold Cliff. Alarm has no matching physical hotspot (LED
    // indicator only, confirmed visually).
    // This title's MAME artwork bundle (unlike Bomb Sweeper/Gold Cliff)
    // has NO Animation/ folder at all -- not even Game/Continue/Time
    // press art existed, let alone the D-pad's. Every hotspot here was
    // hand-measured off Unit.png via ImageMagick colour/darkness
    // isolation (red pixels for the D-pad, near-black pixels within a
    // text-free sub-crop for the round buttons -- had to iterate the
    // crop window per button since neighbouring ALARM/ACL labels
    // contaminated a naive isolation), and every pressed-state image
    // was synthesized: D-pad quadrants reused Bomb Sweeper's exact
    // 150%-modulate treatment (confirmed same red plastic); Game/
    // Continue/Time/Attack are black plastic on this case (unlike Bomb
    // Sweeper/Gold Cliff's silver-cluster mold), so got the original
    // Spitball-Sparky-style 400% lift instead -- black has far more
    // headroom before clipping than the D-pad's already-bright red.
    hotspots: {
      btn1: { left: 6.57,  top: 83.04, width: 4.32, height: 3.41 },
      btn2: { left: 10.89, top: 79.63, width: 4.32, height: 3.41 },
      btn3: { left: 15.21, top: 83.04, width: 4.32, height: 3.41 },
      btn4: { left: 10.89, top: 86.45, width: 4.32, height: 3.41 },
      jump: { left: 83.36, top: 81.81, width: 7.02, height: 5.50 },
      gameA: { left: 83.59, top: 56.66, width: 9.11, height: 3.14 },
      gameB: { left: 83.59, top: 61.85, width: 9.23, height: 3.18 },
      time:  { left: 82.85, top: 66.67, width: 9.96, height: 3.32 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as Bomb Sweeper/Gold
    // Cliff. Not shipping noResetOnModeButtons proactively, same
    // reasoning as those two.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { jump: 1 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  opanic: {
    title: 'Oil Panic', subtitle: 'OP-51 · 1982',
    artPath: 'artwork/gnw_opanic/',
    // Real Unit.png is 1767x2199, same canvas as every other Multi
    // Screen title -- see ssparky's own unitAspect comment for why this
    // is set upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD -- same `sm510_dualv` architecture as
    // DK-52/DK-II/Green House, confirmed fresh via the real driver
    // source. First *hammer-shaped* Multi Screen title though: real
    // input ports (gnw_opanic INPUT_PORTS_START) read Left/Right through
    // plain IN.0 K-line bits (PORT_16WAY lever, bit0=Right/bit3=Left),
    // not a D-pad and not the BA/B analog hammer pins Vermin/Ball/
    // Popeye-family titles use -- so this is the Popeye/Octopus/
    // Parachute/Fire(WS) hammer shape (hotspots.left/right, no fixedRow,
    // no btn1-4), just wired to a second physical screen.
    svgPath: 'artwork/gnw_opanic/gnw_opanic_top.svg',
    svgPath2: 'artwork/gnw_opanic/gnw_opanic_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_opanic, hh_sm510_full.cpp): op-51, 4096B,
    // 31c288c9 -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use. Plain SM510, no melody ROM (single
    // ROM_REGION in the driver, same as DK-52/DK-II/Green House).
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, same Node/vm harness as
    // every other title). Clean sequential 6-cell block at 20-25
    // (hT,hO,mT,mO,sT,sO) -- a different address family than the SM512
    // titles' 16-21, confirmed fresh via a real natural run rather than
    // assumed from the shared "clean sequential block" pattern. `pmBit:8`
    // (the Popeye/Parachute/Octopus/Chef/Fire-family bit3/8 convention,
    // NOT the bit1/2 family the SM512 Multi Screen titles all use) --
    // confirmed via a real natural 11:59:59->12:00:00 rollover (hT
    // 1->9), not assumed from either convention.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // This ROM's boot-init RAM writes run in bursts through roughly
    // cycle 1200 (100-cycle-resolution trace) -- notably later than the
    // D-pad Multi Screen titles' ~700, and the idle/attract loop itself
    // has some inherent periodic RAM churn afterward that never fully
    // goes quiet, so 1200 was taken as "last real burst" rather than
    // "last RAM write of any kind." A comfortable margin above that.
    bootSyncCycles: 1300,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (468,290,842,567) and
    // Screen-Bottom "multiply" bounds (462,1368,839,537), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.48, top: 13.19, width: 47.65, height: 25.78 },
    screen2: { left: 26.15, top: 62.21, width: 47.48, height: 24.42 },
    // Real input ports (source-confirmed, gnw_opanic INPUT_PORTS_START):
    // IN.0 bit0=Right, bit3=Left (hammer/lever, own row); IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm, same shape as every other
    // title's mode-button row. Alarm has no matching physical hotspot
    // (LED indicator only, confirmed visually on Unit.png).
    // Hotspot boxes: this title's MAME artwork bundle (unlike the SM512
    // titles) has real pressed-state photos for every button -- Left-Flat/
    // Right-Flat/Grey-Flat-1/2/3 all exist -- so hotspots were measured
    // directly via ImageMagick -trim on each, the same original technique
    // Vermin/Ball/Popeye used, no synthesis needed.
    hotspots: {
      left:  { left: 6.00,  top: 78.72, width: 14.21, height: 11.96 },
      right: { left: 79.63, top: 78.72, width: 14.21, height: 11.96 },
      gameA: { left: 81.38, top: 54.21, width: 9.06,  height: 7.28 },
      gameB: { left: 81.38, top: 59.62, width: 9.06,  height: 7.28 },
      time:  { left: 81.38, top: 64.71, width: 9.06,  height: 7.28 },
    },
    // No fixedRow and no btn1-4 -- same proactive flags as every other
    // hammer-shaped title with this shape (Popeye/Octopus/Parachute/
    // Fire-WS): needsResetForModeButtons for GameA/GameB/Time to
    // register at all, lampTestOnBoot so startAttract() dismisses the
    // boot lamp-test screen on its own. Not shipping hammersNeedQuickTap
    // proactively -- per the cross-cutting note in gnw.js, none of this
    // shape's existing titles (Popeye/Octopus/Parachute/Fire-WS) actually
    // hit that bug in practice, only Chef/Turtle Bridge did; add it if
    // live testing shows a stuck-catch symptom.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    inputRows: [ { right: 1, left: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  mickdon: {
    title: 'Mickey & Donald', subtitle: 'DM-53 · 1982',
    artPath: 'artwork/gnw_mickdon/',
    // Real Unit.png is 1767x2199, same canvas as every other Multi
    // Screen title -- see ssparky's own unitAspect comment for why this
    // is set upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD, same `sm510_dualv` architecture as
    // DK-52/DK-II/Green House/Oil Panic, confirmed fresh via the real
    // driver source. Plain SM510, no melody ROM (single ROM_REGION,
    // same as those four). The driver also sets a custom
    // `write_r().set(piezo_r2_w)` R-pin hook not seen on the other
    // titles -- didn't need any gnw.js-side change for it (GnwAudio's
    // existing R-pin abstraction already handles it transparently), no
    // audible issue found live.
    svgPath: 'artwork/gnw_mickdon/gnw_mickdon_top.svg',
    svgPath2: 'artwork/gnw_mickdon/gnw_mickdon_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_mickdon, hh_sm510_full.cpp): dm-53_565, 4096B,
    // e21fc0f5 -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, same Node/vm harness as
    // every other title). Clean sequential 6-cell block, but ordered
    // sT/sO/hT/hO/mT/mO (71-76) this time -- seconds first, then hours,
    // then minutes -- a genuinely different internal ordering than any
    // prior title (all of which put hours first), confirmed via a real
    // natural run rather than assumed. `pmBit:2`, matching the original
    // Mickey Mouse (MC-25)'s own clockRam convention -- both are
    // Mickey-themed titles on otherwise unrelated hardware generations
    // (MC-25 is a single-screen title from a different ROM family
    // entirely), so this is coincidence rather than a shared firmware
    // base; still verified fresh via a real 11:59:59->12:00:00 rollover
    // (hT 1->3), not assumed from the name alone.
    clockRam: { hT: 73, hO: 74, mT: 75, mO: 76, sT: 71, sO: 72, pmBit: 2 },
    // Boot-init RAM writes complete by cycle 600 (100-cycle-resolution
    // trace, nothing later) -- a comfortable margin above that.
    bootSyncCycles: 700,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (474,307,804,537) and
    // Screen-Bottom "multiply" bounds (483,1334,804,518), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.83, top: 13.96, width: 45.50, height: 24.42 },
    screen2: { left: 27.34, top: 60.66, width: 45.50, height: 23.56 },
    // Real input ports (source-confirmed, gnw_mickdon INPUT_PORTS_START):
    // IN.0 bit0=Right, bit1=Up, bit2=Left, bit3=Down; IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm. Confirmed the array-index-vs-
    // IN.n-suffix question empirically (per the Mickey Mouse MC-25
    // lesson that this is never safe to assume) rather than copying
    // MC-25's own swapped order blind: a Time tap on inputRows[1] (the
    // natural IN.0/IN.1 order) correctly started the clock ticking in
    // the headless trace, so no swap needed here.
    // No dedicated jump/action button (unlike DK-52/DK-II/Gold Cliff/
    // Zelda) -- just four directions and the three mode buttons. But
    // this isn't a D-pad either: confirmed visually on Unit.png that the
    // real case has two visually distinct physical switches, not one
    // cross-shaped pad -- a tall vertical rocker under "MICKEY MOUSE"
    // (Up/Down only) and a wide horizontal rocker under "DONALD DUCK"
    // (Left/Right only), matching the real game's two-character premise
    // (Mickey climbs a ladder, Donald runs along a dock). Confirmed via
    // ImageMagick red-pixel isolation on each switch independently (two
    // separate crops, not one D-pad-shaped region) -- the two switches
    // aren't even vertically aligned with each other. This is the same
    // "two independent 2-way levers" shape as the original Mickey Mouse
    // MC-25 (btn1/btn3 = one lever's two positions, btn2/btn4 = the
    // other's), reusing the existing btn1-4 mechanism with no new
    // BUTTON_DEFS shape needed -- confirmed the mechanism doesn't care
    // whether the two "levers" share an axis (MC-25's own two vertical
    // levers) or are perpendicular to each other (this title's vertical+
    // horizontal pair), since hotspot position is fully data-driven.
    // btn1-4's own pressed-state art (Animation/1-4-Flat.png) doesn't
    // exist in this title's MAME artwork bundle (only Game/Continue/Time
    // have real Grey-Flat photos) -- synthesized the same way as the
    // Multi Screen D-pad titles, cropping each half of each switch
    // straight from Unit.png and applying the same 150% brightness lift
    // (this switch color, #BF0103, is similarly saturated to the D-pad
    // titles' red, so the same value read well without a fresh visual
    // check needed at a different percentage).
    hotspots: {
      btn1: { left: 86.42, top: 82.67, width: 6.28, height: 4.05 },
      btn2: { left: 10.58, top: 79.22, width: 5.04, height: 5.05 },
      btn3: { left: 80.14, top: 82.67, width: 6.28, height: 4.05 },
      btn4: { left: 10.58, top: 84.27, width: 5.04, height: 5.05 },
      gameA: { left: 81.38, top: 54.21, width: 9.06, height: 7.28 },
      gameB: { left: 81.38, top: 59.62, width: 9.06, height: 7.28 },
      time:  { left: 81.38, top: 64.71, width: 9.06, height: 7.28 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- no needsResetForModeButtons
    // or lampTestOnBoot needed, same as every other quad-button title.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  pinball: {
    title: 'Pinball', subtitle: 'PB-59 · 1983',
    artPath: 'artwork/gnw_pinball/',
    // Real Unit.png (PB-59.png in the source artwork bundle) is
    // 1767x2199, same canvas as every other Multi Screen title.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD -- but the first one on SM511, not
    // SM510 or SM512: real MAME driver (hh_sm510_full.cpp,
    // gnw_pinball_state) confirms `sm511_dualv`, confirmed fresh via the
    // driver source before assuming anything carried over from DK-52's
    // own `sm510_dualv`. No new dual-screen plumbing needed (that's
    // CPU-agnostic, added for DK-52), but this title's own real-time
    // requirements exposed a genuine SM511 CPU-core bug -- see clockRam
    // below and the SM511.step() comment itself.
    svgPath: 'artwork/gnw_pinball/gnw_pinball_top.svg',
    svgPath2: 'artwork/gnw_pinball/gnw_pinball_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_pinball, hh_sm510_full.cpp): pb-59.program,
    // 4096B, d29dab34; pb-59.melody, 256B, 5c9ccb55 (BAD_DUMP/decap-
    // needed, same caveat as every melody dump in this project) -- both
    // confirmed via sha1sum against the real driver's own CRC/SHA1
    // comments before use.
    cpuType: 'sm511',
    lcdCBits: 2,
    // **Found and fixed a genuine SM511 CPU-core bug while tracing this
    // title's clock.** This ROM genuinely changes clkDiv at runtime
    // (CLKHI/CLKLO, confirmed live: clkDiv alternates 4<->2 during the
    // normal sleep/wake cycle) -- the first title in this project found
    // doing that. SM511.step()'s gamma-tick detection used to check
    // `div === 0` after `div += clkDiv`, a batching optimization over
    // real MAME's own per-crystal-tick `m_div=(m_div+1)&0x7fff` (see
    // sm510base.cpp div_timer_cb, a genuinely separate hardware timer
    // decoupled from instruction execution). That's numerically
    // equivalent on a fixed clkDiv, but once clkDiv actually changes
    // mid-run, div's phase can drift far enough that a later wraparound
    // lands a few ticks PAST zero (confirmed via direct instrumentation:
    // 32764->4, 32766->2) instead of exactly on it, silently skipping
    // the gamma pulse forever -- confirmed live as a permanent CEND-halt
    // after exactly four normal ~1s wake cycles. Fixed by detecting the
    // wraparound itself (new value < old value) instead of requiring
    // exact equality with zero -- see SM511.step()'s own comment for the
    // full writeup. This was invisible on every prior SM511 title
    // (smbn/climbern/bfightn/mariotj) because none of them exercise
    // CLKHI/CLKLO to actually change clkDiv at runtime.
    // Once fixed: clean sequential 6-cell clockRam block at 20-25
    // (hT,hO,mT,mO,sT,sO), same address family as Bomb Sweeper's own
    // (a different chip/title entirely -- coincidence, reconfirmed
    // fresh, not assumed). `pmBit:8`, the Popeye/Chef/Oil-Panic-family
    // convention -- confirmed via a real 11:59:59->12:00:00 rollover.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init RAM writes (and this ROM's own idle-animation churn)
    // settle by ~cycle 1400 (100-cycle-resolution trace) -- a
    // comfortable margin above that, same class of gap as Oil Panic's
    // own later-than-usual boot burst.
    bootSyncCycles: 1400,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (450,288,868,593) and
    // Screen-Bottom "multiply" bounds (440,1332,884,598), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 25.47, top: 13.10, width: 49.12, height: 26.97 },
    screen2: { left: 24.90, top: 60.57, width: 50.03, height: 27.19 },
    // Real input ports (source-confirmed, gnw_pinball INPUT_PORTS_START):
    // IN.0 bit1=Right, bit2=Left (a hammer/lever pair like Popeye/
    // Octopus/Parachute/Oil Panic, but a DIFFERENT bit assignment than
    // Oil Panic's own bit0/bit3 -- verified fresh via the real port
    // list, not assumed to carry over just because both are hammer-
    // shaped Multi Screen titles); IN.1 bit0=Time, bit1=GameB, bit2=
    // GameA, bit3=Alarm, standard shape. Alarm has no matching physical
    // hotspot (LED indicator only, confirmed visually).
    // This title's MAME artwork bundle has no Animation/ folder at all
    // (same gap as Zelda) -- every hotspot was hand-measured off
    // Unit.png (grid-overlay + targeted colour/darkness isolation, since
    // the flipper buttons are near-black on a near-black case and
    // needed a value-difference check rather than a hue check), and
    // every pressed-state image was synthesized: the two flipper
    // buttons are dark plastic (~10% base brightness) so got the
    // original Spitball-Sparky-style 400% lift; Game A/B/Time are a
    // genuinely brighter mid-grey (#808080, ~50% brightness) on this
    // case, so 400% clipped them to a flat white disc with the texture
    // gone -- caught by viewing the synthesized crop before shipping
    // (same lesson as Green House's teal D-pad) and dropped to 160%,
    // which stays a readable lit grey.
    hotspots: {
      left:  { left: 8.21,  top: 80.72, width: 9.90, height: 7.73 },
      right: { left: 82.06, top: 80.72, width: 9.34, height: 7.50 },
      gameA: { left: 82.97, top: 56.21, width: 5.83, height: 3.14 },
      gameB: { left: 81.44, top: 61.16, width: 7.36, height: 3.14 },
      time:  { left: 81.49, top: 66.62, width: 7.30, height: 3.18 },
    },
    // No fixedRow and no btn1-4 -- same proactive flags as every other
    // hammer-shaped title with this shape (Oil Panic/Popeye/Octopus/
    // Parachute/Fire-WS): needsResetForModeButtons for GameA/GameB/Time
    // to register at all, lampTestOnBoot so startAttract() dismisses the
    // boot lamp-test screen on its own. **Live testing DID show the
    // stuck-catch symptom this comment used to say only Chef hit** -- a
    // real Left/Right flipper tap stayed logically held for several real
    // seconds before the ROM's own catch-detection would register the
    // next press, exactly Chef's own hammersNeedQuickTap writeup. Added
    // here for the same reason.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  bjack: {
    title: 'Black Jack', subtitle: 'BJ-60 · 1985',
    artPath: 'artwork/gnw_bjack/',
    // Real Unit.png is 1767x2199, same canvas as every other Multi
    // Screen title -- see ssparky's own unitAspect comment for why this
    // is set upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD, SM512 (same chip as Bomb Sweeper/
    // Gold Cliff/Zelda) -- confirmed fresh via the real driver source
    // (hh_sm510_full.cpp, gnw_bjack_state confirms `sm512_dualv`). No
    // new engine work needed.
    svgPath: 'artwork/gnw_bjack/gnw_bjack_top.svg',
    svgPath2: 'artwork/gnw_bjack/gnw_bjack_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_bjack, hh_sm510_full.cpp): bj-60.program,
    // 4096B, 8e74f633; bj-60.melody, 256B, 2619224e (BAD_DUMP/decap-
    // needed, same caveat as every melody dump in this project) -- both
    // confirmed via sha1sum against the real driver's own CRC/SHA1
    // comments before use.
    cpuType: 'sm512',
    lcdCBits: 2,
    // Empirically traced (headless SM512 sim, same Node/vm harness as
    // every other title -- built on the SM511/SM512-shared step() fixed
    // for Pinball's own gamma-tick bug, though this ROM never actually
    // changes clkDiv at runtime so wouldn't have hit that specific bug
    // either way). Clean sequential 6-cell block, but at completely
    // different (low) addresses than every prior title and in REVERSED
    // order: 0=sO,1=sT,2=mO,3=mT,4=hO,5=hT -- seconds first ascending,
    // hours last, confirmed via a real natural run (sO/sT tick cleanly,
    // mT rolls over at the 10-minute mark, hO/hT carry correctly at the
    // 60-minute mark). A separate, completely static (2,1)-shaped pair
    // at ram[8]/[9] looked like a plausible boot-default "12" at first
    // glance but never changed across a 15-simulated-hour run -- a red
    // herring, not the real clock, same lesson as DK-52's own "second,
    // apparently unused duplicate clock block". **No pmBit found**: the
    // real natural 11:59:59->12:00:00 rollover left hT unchanged (still
    // exactly 1, no extra bit appeared) -- checked directly rather than
    // assumed, matching Mario The Juggler's own "no pmBit" precedent
    // (some ROMs' clock families genuinely don't carry an AM/PM flag).
    clockRam: { hT: 5, hO: 4, mT: 3, mO: 2, sT: 1, sO: 0 },
    // Boot-init RAM writes settle by ~cycle 1400 (100-cycle-resolution
    // trace) with some low-level idle-animation churn continuing after
    // (same class of gap as Oil Panic/Pinball's own later-than-usual
    // boot burst) -- a comfortable margin above that.
    bootSyncCycles: 1500,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (466,285,838,576) and
    // Screen-Bottom "multiply" bounds (473,1352,827,555), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.37, top: 12.96, width: 47.42, height: 26.19 },
    screen2: { left: 26.77, top: 61.48, width: 46.80, height: 25.24 },
    // Real input ports (source-confirmed, gnw_bjack INPUT_PORTS_START):
    // a genuine 4-corner button cluster, not a D-pad or hammer pair --
    // IN.0 bit0=Double Down, bit1=Bet x10/Hit, bit2=Bet x1/Stand, bit3=
    // Enter (JOYSTICKLEFT_UP/DOWN + JOYSTICKRIGHT_DOWN/UP in MAME's own
    // port naming, but functionally four independent corner buttons on
    // this case, not two levers). IN.1 bit0=Time, bit1=GameB, bit2=
    // GameA, bit3=Alarm, standard shape -- this title has no ACL Alarm
    // hotspot label difference either, same as every prior title.
    // This is the first Multi Screen title whose MAME artwork bundle
    // has the button element bounds AND real per-button pressed-state
    // art for BOTH the corner buttons (1-4-Flat.png) and the round
    // mode buttons (Grey-Flat-1/2/3) -- no hand-measurement/synthesis
    // needed anywhere, just plain -trim on each real photo, the
    // original Vermin/Ball technique. The corner buttons landed as a
    // clean 2x2 grid (top-left/top-right/bottom-left/bottom-right),
    // confirmed via the .lay file's own inputtag/inputmask attributes
    // on each button element rather than inferred from position alone.
    hotspots: {
      btn1: { left: 6.96,  top: 76.17, width: 13.07, height: 11.05 },
      btn2: { left: 6.96,  top: 85.54, width: 13.07, height: 11.05 },
      btn3: { left: 80.31, top: 85.54, width: 13.07, height: 11.05 },
      btn4: { left: 80.31, top: 76.17, width: 13.07, height: 11.05 },
      gameA: { left: 81.44, top: 54.07, width: 8.77, height: 7.41 },
      gameB: { left: 81.44, top: 59.25, width: 8.77, height: 7.41 },
      time:  { left: 81.44, top: 64.48, width: 8.77, height: 7.41 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- no needsResetForModeButtons
    // or lampTestOnBoot needed, same as every other quad-button title.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  squish: {
    title: 'Squish', subtitle: 'MG-61 · 1986',
    artPath: 'artwork/gnw_squish/',
    // Real Unit.png is 1767x2199, same canvas as every other Multi Screen
    // title -- see ssparky's own unitAspect comment for why this is set
    // upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD, plain SM510 (real driver confirms
    // `sm510_dualv`, gnw_squish_state) -- no new engine work needed.
    svgPath: 'artwork/gnw_squish/gnw_squish_top.svg',
    svgPath2: 'artwork/gnw_squish/gnw_squish_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_squish, hh_sm510_full.cpp): mg-61, 4096B,
    // 79cd509c -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use.
    cpuType: 'sm510',
    // Missing here caused a real shipped bug caught live: with lcdCBits
    // left unset (defaults to 1 in GnwDisplay), any title whose SVG
    // titles use column values beyond 0/1 aliases -- (0<<1)|2 and (1<<1)|0
    // both land on lcd[2] -- silently corrupting whichever segments happen
    // to collide. This title's own SVG titles do use columns up to 3 (same
    // as every other Multi Screen title), so it needs the same lcdCBits:2
    // every other title in this family sets.
    lcdCBits: 2,
    // Real driver's own gnw_squish_state constructor overrides the base
    // hh_sm510_state decay default (`m_decay_pivot = 8`) to 17, with the
    // driver's own comment reading "increase lcd decay: unwanted segments
    // light up" -- a genuine per-title hardware quirk, not left at the
    // shared default like every other title so far (see LCD_DECAY_DEFAULT's
    // own comment for the one other confirmed override, Turtle Bridge).
    // m_decay_len isn't touched by this title's constructor, so only pivot
    // changes here, len stays the shared default (17).
    lcdDecay: { pivot: 17, len: 17 },
    // Empirically traced (headless SM510 sim, same Node/vm harness as every
    // other title). Clean sequential 6-cell block at 20-25 (hT/hO/mT/mO/
    // sT/sO), same address family as Oil Panic/Gold Cliff despite being a
    // different chip/title entirely (coincidence, reconfirmed fresh via a
    // real natural run through a full hour rollover: hT/hO cleanly rolled
    // 12->1 at the 1-hour mark). `pmBit:8` confirmed via a real 12-hour
    // rollover (hT read 1|8=9 exactly at the noon boundary, then 0|8=8 one
    // hour later for "1 PM" -- the Popeye/Chef/Oil-Panic-family convention).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Only RAM writes observed in a 3000-cycle boot trace are the hT/hO
    // boot-default "12" at cycles 1483/1485 -- mT/mO/sT/sO never get
    // written at all (already zero post-reset, which happens to already be
    // the correct boot default). Comfortable margin above 1485.
    bootSyncCycles: 1600,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (461,295,838,561) and
    // Screen-Bottom "multiply" bounds (468,1342,838,562), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 26.09, top: 13.42, width: 47.43, height: 25.51 },
    screen2: { left: 26.49, top: 61.03, width: 47.43, height: 25.56 },
    // Real input ports (source-confirmed, gnw_squish INPUT_PORTS_START):
    // IN.0 bit0=Down, bit1=Right, bit2=Up, bit3=Left -- a genuine 4-way,
    // but built as two SEPARATE physical rockers (a vertical Up/Down rocker
    // on the left side of the case, a horizontal Left/Right rocker on the
    // right side -- confirmed via Unit.png's own printed labels), same
    // "not really a D-pad despite MAME's generic JOYSTICK_* port naming"
    // lesson as Mickey & Donald. Reused the existing btn1-4 mechanism
    // (bit-order mapping: btn1=Down, btn2=Right, btn3=Up, btn4=Left) rather
    // than inventing new hotspot names, same as every other quad-direction
    // title. IN.1 bit0=Time, bit1=GameA, bit2=GameB, bit3=Alarm.
    // **This title's real MAME artwork bundle's own `Animation/1-4-Flat.png`
    // files turned out to be a mislabeled leftover from Black Jack's own
    // bundle** (confirmed via byte-identical MD5 hashes against gnw_bjack's
    // shipped Animation/1-4-Flat.png, and visually showing Black Jack's own
    // "Bet x10"/"Enter" button art, not this title's rocker switches) --
    // a genuine upstream MAME artwork-packaging error, not something to
    // trust blindly just because it shipped inside this title's own zip.
    // Hand-measured both rockers' pixel bounds via red-pixel isolation
    // instead (each rocker split into its own two halves: up/down halves of
    // the vertical rocker, left/right halves of the horizontal one) and
    // synthesized press art from those crops at 160% brightness (this red
    // plastic reads ~47% mean brightness, matching the Gold Cliff/Bomb
    // Sweeper D-pad family's own calibration, not Spitball Sparky's black-
    // plastic 400%). Grey-Flat-1/2/3 (Game B/Game A/Time) are genuine,
    // correct, unique-hash art for this title -- only the numbered D-pad
    // crops were contaminated; their measured position (81.44,54.07/
    // 59.25/64.48, 8.77x7.41) happens to pixel-match Black Jack's own mode-
    // button cluster too, but that's the same shared-mold coincidence
    // documented extensively elsewhere in this file, not more contamination
    // (confirmed via distinct MD5 hashes on the Grey-Flat crops themselves).
    hotspots: {
      btn1: { left: 10.64, top: 84.27, width: 4.98, height: 5.00 }, // Down
      btn2: { left: 86.42, top: 82.72, width: 6.23, height: 4.00 }, // Right
      btn3: { left: 10.64, top: 79.26, width: 4.98, height: 5.00 }, // Up
      btn4: { left: 80.19, top: 82.72, width: 6.23, height: 4.00 }, // Left
      gameB: { left: 81.44, top: 54.07, width: 8.77, height: 7.41 },
      gameA: { left: 81.44, top: 59.25, width: 8.77, height: 7.41 },
      time:  { left: 81.44, top: 64.48, width: 8.77, height: 7.41 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic -- same as every other quad-
    // direction Multi Screen title.
    modeButtonsRegisterQuickly: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameA: 2, gameB: 4, alarm: 8 } ],
  },

  sbuster: {
    title: 'Safe Buster', subtitle: 'JB-63 · 1988',
    artPath: 'artwork/gnw_sbuster/',
    // Real Unit.png is 1767x2199, same canvas as every other Multi Screen
    // title -- see ssparky's own unitAspect comment for why this is set
    // upfront.
    unitAspect: '1767 / 2199',
    // Multi Screen title, dual LCD, SM511 (real driver confirms
    // `sm511_dualv`, gnw_sbuster_state) -- same chip as Pinball, no new
    // engine work needed. This ROM never changes clkDiv at runtime (unlike
    // Pinball's own CLKHI/CLKLO usage), so it wouldn't have hit the
    // SM511/SM512 gamma-tick wraparound bug either way -- checked directly
    // rather than assumed safe.
    svgPath: 'artwork/gnw_sbuster/gnw_sbuster_top.svg',
    svgPath2: 'artwork/gnw_sbuster/gnw_sbuster_bottom.svg',
    dualScreen: true,
    // Real MAME ROM (gnw_sbuster, hh_sm510_full.cpp): jb-63.program, 4096B,
    // 231d358d; jb-63.melody, 256B, 28cb2914 (BAD_DUMP/decap-needed, same
    // caveat as every melody dump in this project) -- both confirmed via
    // sha1sum against the real driver's own CRC/SHA1 comments before use.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically traced (headless SM511 sim, same Node/vm harness as
    // every other title). Clean sequential 6-cell block at 16-21 (hT/hO/
    // mT/mO/sT/sO), same address family as Gold Cliff/Bomb Sweeper despite
    // being a different chip generation and title entirely (coincidence,
    // reconfirmed fresh via a real natural run through a full hour
    // rollover). `pmBit:2` confirmed via a real 12-hour rollover (hT read
    // 1|2=3 exactly at the noon boundary, then 0|2=2 one hour later for
    // "1 PM" -- the Mickey Mouse/Egg/Donkey Kong DK-52 convention, not the
    // Popeye/Oil-Panic-family bit3/8 used by this project's other SM511
    // title, Pinball -- confirmed fresh, not assumed to carry over just
    // because both are SM511).
    clockRam: { hT: 16, hO: 17, mT: 18, mO: 19, sT: 20, sO: 21, pmBit: 2 },
    // Boot-init RAM writes (hT/hO's own "12" default) complete by cycle
    // 329 in a 3000-cycle trace -- earliest-settling boot burst of any
    // title in this project so far. Comfortable margin above that.
    bootSyncCycles: 500,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Top "multiply" bounds (423,285,925,601) and
    // Screen-Bottom "multiply" bounds (419,1323,925,611), both against the
    // Unit element's own bounds (0,0,1767,2199).
    screen: { left: 23.94, top: 12.96, width: 52.35, height: 27.33 },
    screen2: { left: 23.71, top: 60.16, width: 52.35, height: 27.79 },
    // Real input ports (source-confirmed, gnw_sbuster INPUT_PORTS_START):
    // IN.0 bit0=Left, bit1=Right (PORT_16WAY, the same hammer/lever shape
    // as Oil Panic/Pinball, not a D-pad); IN.1 bit0=Time, bit1=GameB,
    // bit2=GameA, bit3=Alarm, standard shape. This is the first hammer-
    // shaped Multi Screen title whose MAME artwork bundle has real,
    // correctly-sized (1767x2199, matching Unit.png) pressed-state art for
    // BOTH the Left/Right levers and Game A/B/Time -- no hand-measurement
    // or synthesis needed anywhere, just plain -trim on each real crop
    // (and, learning from Pinball's own shipped bug, verified up front that
    // every crop here is already full-canvas-sized, not a tight button-only
    // crop, before trusting it).
    hotspots: {
      left:  { left: 6.00,  top: 78.72, width: 14.20, height: 11.96 },
      right: { left: 79.63, top: 78.72, width: 14.20, height: 11.96 },
      gameB: { left: 81.38, top: 54.21, width: 9.05,  height: 7.28 },
      gameA: { left: 81.38, top: 59.62, width: 9.05,  height: 7.28 },
      time:  { left: 81.38, top: 64.71, width: 9.05,  height: 7.28 },
    },
    // No fixedRow and no btn1-4 -- same proactive flags as every other
    // hammer-shaped title with this shape: needsResetForModeButtons for
    // GameA/GameB/Time to register at all, lampTestOnBoot so
    // startAttract() dismisses the boot lamp-test screen on its own.
    // **Shipping hammersNeedQuickTap proactively this time** -- Pinball
    // shipped without it (following Oil Panic's precedent) and a live user
    // report caught a real stuck-catch symptom (a flipper tap staying
    // logically held for several real seconds) that had to be fixed after
    // the fact; this title has the exact same shape (hotspots.left/right,
    // no fixedRow, needsResetForModeButtons), so applying the lesson up
    // front rather than waiting for the same bug report twice.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { left: 1, right: 2 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  dkjrp: {
    title: 'Donkey Kong Jr.', subtitle: 'CJ-93 · 1983',
    artPath: 'artwork/gnw_dkjrp/',
    // Real Unit.png is 2548x3625 -- a completely different canvas size
    // than every Multi Screen/Wide Screen title so far (those are all
    // 1767x2199) -- first Panorama-series title in this project, a
    // genuinely new case shape: a tall standing cabinet with an angled
    // mirror creating a "panorama" depth illusion over a single LCD,
    // confirmed via the real Unit.png photo (periscope-style screen
    // housing above a control panel), not a dual-screen clamshell.
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_dkjrp/gnw_dkjrp.svg',
    // Real driver source: "inverted lcd screen with custom segments" --
    // confirmed live too (segments trace as #fffffe in the raw SVG, not
    // the usual dark fill). See _applyGameArtwork()'s own lcdInverted
    // comment for why this needs a real code path, not just an asset
    // swap: the default mix-blend-mode:multiply rendering hides white
    // segments against a dark backdrop entirely. Background.png is
    // shipped as solid black here (not the real hardware's own colourful
    // multiply-tinted texture, which this project's simpler flat-backdrop
    // rendering model can't replicate) so the segments read clearly.
    lcdInverted: true,
    // Real MAME ROM (gnw_dkjrp, hh_sm510_full.cpp): cj-93.program, 4096B,
    // CRC a2cd5a91, SHA1 confirmed via sha1sum match. cj-93.melody's own
    // SHA1 in this local archive doesn't match the driver source's own
    // comment (which is itself already flagged BAD_DUMP/decap-needed, the
    // same caveat as every melody dump in this project) -- shipped anyway
    // since the program ROM (the actual game logic) matches exactly and
    // only the melody differs, consistent with how every other BAD_DUMP
    // melody in this project has been handled.
    cpuType: 'sm511',
    // SVG title columns go up to 3 (confirmed by scanning the raw file
    // before shipping, not discovered the hard way like Squish's own
    // shipped bug) -- needs lcdCBits:2, the same as every other Multi
    // Screen/Panorama title so far.
    lcdCBits: 2,
    // Empirically traced (headless SM511 sim, same Node/vm harness as
    // every other title). Clean sequential 6-cell block at 20-25 (hT/hO/
    // mT/mO/sT/sO) -- same address family as many prior titles despite
    // being a genuinely different case/chip generation, reconfirmed fresh
    // via a real natural run through a full hour rollover (12->1 exactly
    // at the 1-hour mark) and a full 12-hour rollover for pmBit (hT read
    // 1|8=9 exactly at the noon boundary, then 0|8=8 one hour later for
    // "1 PM" -- the Popeye/Chef/Oil-Panic/Pinball-family convention).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init RAM writes (hT/hO's own "12" default) complete by cycle
    // 401 in a 3000-cycle trace. Comfortable margin above that.
    bootSyncCycles: 500,
    // Screen-glass box from the real MAME artwork's own "Unit Only" view
    // (default.lay): the plain (non-blend) Screen bounds (632,1106,1301,
    // 666), against the Unit element's own bounds (0,0,2548,3625).
    // Panorama's own compositing chain layers a Reflection (multiply) and
    // a second "add"-blend screen copy plus Background/Gradient overlays
    // on top of this same box for the mirror-depth illusion -- unlike
    // Multi Screen's own "always pick the multiply-blend screen" rule,
    // there's no multiply-blend screen entry here at all, so the plain
    // first <screen> entry is what actually marks the real LCD glass
    // position; the other layers are cosmetic effects at nearly the same
    // box, not alternate screen positions.
    screen: { left: 24.80, top: 30.51, width: 51.06, height: 18.37 },
    // Real input ports (source-confirmed, gnw_dkjrp INPUT_PORTS_START): a
    // genuine THREE-row input matrix (IN.0/IN.1/IN.2), not the usual two
    // -- IN.0 bit3=Jump (its own row, only one bit used, same shape as
    // Donkey Kong/DK-II/DKJr's other own dedicated jump buttons); IN.1
    // bit0=Right/bit1=Up/bit2=Left/bit3=Down, a genuine 4-way D-pad (this
    // case's own "CONTROLLER" cross, confirmed via the real Unit.png
    // photo, not two separate rockers); IN.2 bit0=Time/bit1=GameB/bit2=
    // GameA/bit3=Alarm, standard shape. D-pad reused the existing btn1-4
    // mechanism (bit-order mapping: btn1=Right/btn2=Up/btn3=Left/btn4=
    // Down) rather than inventing new hotspot names. No Animation art
    // exists for the D-pad in the MAME bundle (only Jump/Game A/B/Time
    // have real pressed-state frames) -- hand-measured via red-pixel
    // isolation (this case's own plastic is bright red throughout, same
    // isolation technique as Bomb Sweeper/Gold Cliff's own D-pads) and
    // split into outer-third-per-arm quadrant hotspots, the same
    // convention those titles established.
    hotspots: {
      btn1: { left: 27.94, top: 65.63, width: 5.65,  height: 11.83 }, // Right
      btn2: { left: 16.64, top: 65.63, width: 16.95, height: 3.94 },  // Up
      btn3: { left: 16.64, top: 65.63, width: 5.65,  height: 11.83 }, // Left
      btn4: { left: 16.64, top: 73.52, width: 16.95, height: 3.94 },  // Down
      jump: { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77, height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77, height: 6.87 },
      time:  { left: 71.15, top: 83.06, width: 9.77, height: 6.87 },
    },
    // Because btn1-4 are present, _hasQuadButtons() already covers the
    // extended-hold/attract-dismiss logic, same as every other quad-
    // direction title. Not shipping modeButtonsRegisterQuickly proactively
    // -- that flag exists for a specific SM5A R-mux bug (see Chef's own
    // history), not confirmed relevant to SM511 titles; add only if live
    // testing shows GameA/GameB feels slow to start.
    inputRows: [ { jump: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  /* ---- Table Top: Donkey Kong Jr. CJ-71 (1983) --------------------------
     The upright cabinet. Runs dkjrp's ROM, and everything internal is
     inherited from it via GAMES_HW_TWINS -- but this pairing is a WEAKER
     claim than the Crystal ones, and the difference matters:

       Crystal/New Wide Screen: both dumps exist. Verified byte-identical by
         sha256 against the real MAME dumps. A fact.
       Table Top/Panorama:      CJ-71 WAS NEVER DUMPED. There is no second
         ROM to compare, so "same ROM" cannot be checked by anyone. It is
         MAME's own stated assumption -- its game list literally reads
         `CJ-93  p  SM511  Donkey Kong Jr. (assume same ROM & LCD as
         tabletop version)`, and marks CJ-71 `*` (undumped) with the chip
         itself only a guess (`SM511?`).

     It is a well-founded assumption -- re-shelling one board is exactly what
     Nintendo did for Crystal -> New Wide Screen, and the MAME artwork author
     acted on it too: the Table Top cabinets ship INSIDE gnw_dkjrp's own
     layout, built around the same LCD (views "Nintendo Table Top - ..." and
     "Coleco Table Top - ..."). But it is believed, not measured, and the
     site says so rather than implying a CJ-71 dump was read -- see
     sharedFirmware.verified in index.html.

     svgPath deliberately points at gnw_dkjrp's SVG rather than a copy: the
     shared LCD is the whole premise, so the two should be physically unable
     to disagree about it.

     lcdInverted is re-declared, not inherited -- HW_TWIN_CASE_SPECIFIC
     blocks it on purpose (it describes the panel, and Crystal vs NWS is
     exactly where twins differ). Here the LCD genuinely is the same one, so
     it's set explicitly. */
  dkjrt: {
    title: 'Donkey Kong Jr.', subtitle: 'CJ-71 · 1983',
    artPath: 'artwork/gnw_dkjrt/',
    // Unit.png here is the artwork bundle's own Unit-OnlyN.png ("N" =
    // Nintendo Table Top; there's a "C" = Coleco-branded variant too),
    // renamed on copy so artPath works like every other title.
    unitAspect: '634 / 1011',
    // The shared LCD -- see the block comment above.
    svgPath: 'artwork/gnw_dkjrp/gnw_dkjrp.svg',
    lcdInverted: true,
    // This cabinet's art has NO window cut for the LCD -- the screen rect is
    // 100% opaque black (the inside of the mirror hood), and MAME's layout
    // paints the unit first with the screen on top. See the .unit-behind CSS.
    unitBehindScreen: true,
    // The bundle draws button art only for the Panorama shell it lives in
    // (2548x3625), so this cabinet has none. Hotspots still work; pressing
    // just doesn't light anything up. See the loop in _applyGameArtwork.
    noPressedArt: true,
    // default.lay "Nintendo Table Top - Unit Only": screen 176,235,285x156
    // in a 634x1011 canvas.
    screen: { left: 27.760, top: 23.244, width: 44.953, height: 15.430 },
    // The "Zoom" view (default.lay): a 1920x1080 close-up of just the screen
    // hood + marquee -- Zoom-N.png (the Nintendo variant), screen 690,468,
    // 550x292. Makes the tiny LCD big enough to actually play (via keyboard).
    // Rect matches MAME's screen exactly (= the reflective LCD glass in the
    // artwork) so the emulation lines up with the drawn screen -- the zoom is
    // made large by the height-bound device sizing, NOT by inflating this rect.
    zoom: { unit: 'Zoom-N.png', aspect: '1920 / 1080', screen: { left: 35.938, top: 43.333, width: 28.646, height: 27.037 } },
    /* No pressed-state art exists for this cabinet -- the bundle's
       Grey-Flat/Jump-Flat overlays are drawn for the PANORAMA's 2548x3625
       canvas, not this one -- so these can't be trimmed the way every other
       title's hotspots were. They're measured off the cabinet art instead,
       which is weaker but still measurement rather than eyeballing:

         jump/gameA/gameB/time: found by colour. The JUMP button is the only
           other large orange blob besides the joystick (433,784 71x56), and
           the three mode buttons are the only three identical grey pills on
           the panel, evenly spaced at one height (332/390/449, y=738, 34x18).

         the D-pad: the real control is a single JOYSTICK, which has no
           per-direction graphic to find. But the panel PRINTS its axis, and
           those glyphs are measurable: the left arrow centres on x=96 and
           the right on x=228, both at y=818 -- symmetric about x=162, which
           is therefore the pivot -- and the down arrow at (159,855). No up
           arrow is visible because the stick is drawn upright and covers it.
           So the four zones below are a symmetric cross built on that
           measured pivot and axis; only their extent is chosen. Up is real
           (the shared ROM reads it -- see inputRows), it just isn't printed.

       btn1..btn4 are Right/Up/Left/Down, matching the names dkjrp's
       inherited inputRows already uses. */
    hotspots: {
      btn1: { left: 30.757, top: 78.932, width: 10.410, height: 3.956 }, // Right (arrow measured at x=228)
      btn2: { left: 20.347, top: 74.975, width: 10.410, height: 3.956 }, // Up (under the stick, no glyph)
      btn3: { left: 9.937,  top: 78.932, width: 10.410, height: 3.956 }, // Left (arrow measured at x=96)
      btn4: { left: 20.347, top: 82.888, width: 10.410, height: 3.956 }, // Down (arrow measured at 159,855)
      jump:  { left: 68.297, top: 77.547, width: 11.199, height: 5.539 }, // 433,784 71x56
      gameA: { left: 52.366, top: 72.997, width: 5.363,  height: 1.780 }, // 332,738 34x18
      gameB: { left: 61.514, top: 72.997, width: 5.521,  height: 1.780 }, // 390,738 35x18
      time:  { left: 70.820, top: 72.997, width: 5.521,  height: 1.780 }, // 449,738 35x18
    },
  },

  mmousep: {
    title: 'Mickey Mouse', subtitle: 'DC-95 · 1984',
    artPath: 'artwork/gnw_mmousep/',
    // Real Unit.png is 2548x3625, same Panorama-series canvas as Donkey
    // Kong Jr. (CJ-93) -- see that title's own unitAspect comment.
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_mmousep/gnw_mmousep.svg',
    // Real driver source: "inverted lcd screen with custom segments" --
    // see Donkey Kong Jr. Panorama's own lcdInverted comment for the full
    // writeup (a real rendering bug, not just an asset choice).
    lcdInverted: true,
    // Real MAME ROM (gnw_mmousep, hh_sm510_full.cpp): dc-95.program,
    // 4096B, dc-95.melody, 256B (BAD_DUMP/decap-needed, same caveat as
    // every melody dump in this project) -- both confirmed via sha1sum
    // against the real driver's own CRC/SHA1 comments before use.
    cpuType: 'sm511',
    // SVG title columns go up to 3 (checked proactively before shipping).
    lcdCBits: 2,
    // Empirically traced (headless SM511 sim). Same clean sequential
    // clockRam family as Donkey Kong Jr. Panorama (20-25, hT/hO/mT/mO/
    // sT/sO), reconfirmed fresh via a real natural run -- not assumed
    // just because both are Panorama titles. `pmBit:8` confirmed the same
    // way (a real 12-hour rollover).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init RAM writes (hT/hO's own "12" default) complete by cycle
    // 396 in a 3000-cycle trace. Comfortable margin above that.
    bootSyncCycles: 500,
    // Screen-glass box from the real MAME artwork's own "Unit Only" view
    // (default.lay), the plain (non-blend) Screen bounds -- same
    // reasoning as Donkey Kong Jr. Panorama's own screen comment for why
    // the plain entry (not a multiply-blend one, which doesn't exist
    // here) is the real LCD glass position.
    screen: { left: 23.67, top: 29.35, width: 53.38, height: 20.72 },
    // Real input ports (source-confirmed, gnw_mmousep INPUT_PORTS_START):
    // IN.0 bit1=Right, bit2=Left -- a hammer/lever pair, not a D-pad
    // (confirmed via the real Unit.png photo: a single horizontal rocker
    // labeled "CONTROLLER", not a cross). IN.1 bit0=Time/bit1=GameB/
    // bit2=GameA/bit3=Alarm, standard shape. Real Left-Flat/Right-Flat/
    // Grey-Flat-1/2/3 press art all exist in the MAME bundle (no
    // synthesis needed) -- measured via plain -trim.
    hotspots: {
      left:  { left: 15.35, top: 63.83, width: 20.88, height: 14.68 },
      right: { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77, height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77, height: 6.87 },
      time:  { left: 71.15, top: 83.06, width: 9.77, height: 6.87 },
    },
    // No fixedRow and real hotspots.left/right -- shipping
    // hammersNeedQuickTap proactively (learned from Pinball's own shipped
    // bug: this exact shape -- no fixedRow, needsResetForModeButtons --
    // reliably needs it, confirmed again for Safe Buster).
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  dkcirc: {
    title: 'Donkey Kong Circus', subtitle: 'MK-96 · 1984',
    artPath: 'artwork/gnw_dkcirc/',
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_dkcirc/gnw_dkcirc.svg',
    // Same inverted LCD as Mickey Mouse Panorama -- see Donkey Kong Jr.
    // Panorama's own lcdInverted comment for the full writeup.
    lcdInverted: true,
    // Real MAME driver source (gnw_dkcirc ROM_START) declares mk-96's own
    // program/melody with the EXACT SAME CRC/SHA1 as dc-95 (Mickey Mouse
    // Panorama) -- not an assumption, the driver's own comment says "DC-95
    // and MK-96 are the same game, it's assumed [only] that the latter was
    // for regions where Nintendo wasn't able to license from Disney," and
    // the ROM_START entries themselves are byte-identical, confirmed via
    // matching hashes -- the romB64/melodyB64 below are a byte-for-byte
    // copy of mmousep's own, not independently dumped. The screen SVG and
    // every art asset ARE genuinely this title's own, though (a real,
    // different physical case/LCD -- "same ROM as DC-95, LCD is
    // different" per the driver's own summary table) -- confirmed via a
    // real dedicated artwork bundle with its own distinct SVG hash.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Same ROM as Mickey Mouse Panorama (DC-95) -- see this title's own
    // comment above -- so the same clockRam/pmBit apply unchanged, not
    // re-traced separately since it's confirmed the identical program.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 500,
    // Screen-glass box from this title's own "Unit Only" view (default.lay)
    // -- genuinely different from Mickey Mouse Panorama's own box (a real,
    // different LCD glass, per the driver's own note), measured fresh
    // rather than copied.
    screen: { left: 23.35, top: 29.77, width: 53.34, height: 20.03 },
    // Same button-cluster mold as Mickey Mouse Panorama (confirmed: every
    // hotspot's own pixel-measured position from this title's own
    // Animation art landed identical to mmousep's), same hammer shape
    // (Left/Right only, no D-pad).
    hotspots: {
      left:  { left: 15.35, top: 63.83, width: 20.88, height: 14.68 },
      right: { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77, height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77, height: 6.87 },
      time:  { left: 71.15, top: 83.06, width: 9.77, height: 6.87 },
    },
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  mbaway: {
    title: "Mario's Bombs Away", subtitle: 'TB-94 · 1983',
    artPath: 'artwork/gnw_mbaway/',
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_mbaway/gnw_mbaway.svg',
    // Real driver source: "inverted lcd screen with custom segments" --
    // see Donkey Kong Jr. Panorama's own lcdInverted comment for the full
    // writeup.
    lcdInverted: true,
    // Real MAME ROM (gnw_mbaway, hh_sm510_full.cpp): tb-94.program, 4096B,
    // tb-94.melody, 256B (BAD_DUMP/decap-needed, same caveat as every
    // melody dump in this project) -- both confirmed via sha1sum against
    // the real driver's own CRC/SHA1 comments before use.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically traced. Same clean sequential clockRam family as every
    // other Panorama title this session (20-25, hT/hO/mT/mO/sT/sO,
    // pmBit:8), reconfirmed fresh via a real natural run + 12-hour
    // rollover rather than assumed just because they share a case family.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init RAM writes complete by cycle 427 in a 3000-cycle trace.
    bootSyncCycles: 500,
    screen: { left: 24.80, top: 30.51, width: 51.06, height: 18.37 },
    // Real input ports (source-confirmed, gnw_mbaway INPUT_PORTS_START):
    // a genuinely unusual shape -- IN.0 bit0=a single button toggling
    // between throwing a bomb Up or Down (confirmed via the real Unit.png
    // photo: one round button printed "UP/DOWN", not two), bit1=Right,
    // bit2=Left on the SAME row (a horizontal rocker printed
    // "CONTROLLER", left of the Up/Down button). IN.1 bit0=Time/bit1=
    // GameB/bit2=GameA/bit3=Alarm, standard shape. Reused the existing
    // "jump" internal key for the Up/Down button (same single-action-
    // button shape as every other title's own dedicated action button,
    // internal name doesn't need to match the printed label, same
    // convention Gold Cliff's own "Jump"-for-"GAME" established). Real
    // press art exists for Up/Down (UpDown-Flat.png) but NOT for Left/
    // Right -- hand-measured via red-pixel isolation (this case's own
    // plastic is bright red throughout, same technique as the D-pad
    // titles) and synthesized at 160% brightness (measured ~56% base,
    // same calibration class as Squish's own D-pad).
    hotspots: {
      left:  { left: 16.88, top: 69.46, width: 8.48,  height: 3.83 },
      right: { left: 25.35, top: 69.46, width: 8.48,  height: 3.83 },
      jump:  { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77,  height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77,  height: 6.87 },
      time:  { left: 71.15, top: 83.06, width: 9.77,  height: 6.87 },
    },
    // No fixedRow and real hotspots.left/right -- shipping
    // hammersNeedQuickTap proactively, same reasoning as this session's
    // other hammer-shaped Panorama titles.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { jump: 1, right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  lboat: {
    title: 'Life Boat', subtitle: 'TC-58 · 1983',
    artPath: 'artwork/gnw_lboat/',
    // Real Unit.png is 2068x1146 -- a genuinely different, wider canvas than
    // every prior Multi Screen title (all 1767x2199, tall clamshells) since
    // this is the first WIDE (left/right, sm510_dualh) Multi Screen title
    // ever built here -- see WIDE_MULTISCREEN_IDS' own comment in
    // index.html. See ssparky's own unitAspect comment for why this is set
    // upfront rather than left to the 'load'-handler correction alone.
    unitAspect: '2068 / 1146',
    // Plain SM510 (confirmed via the real driver source's own
    // `sm510_dualh(config, ...)` call -- 'dualh' for horizontal, vs every
    // prior Multi Screen title's `sm510_dualv`), driving two side-by-side
    // LCD panels off the same shared cpu.lcd[] array. No melody ROM (single
    // maincpu ROM_REGION in the driver, same as Oil Panic/DK-52/DK-II/
    // Green House).
    svgPath: 'artwork/gnw_lboat/gnw_lboat_left.svg',
    svgPath2: 'artwork/gnw_lboat/gnw_lboat_right.svg',
    dualScreen: true,
    // game.bgFile/bgFile2: this title's real MAME artwork bundle names its
    // two background images 'Background-Left.png'/'Background-Right.png'
    // (matching its genuinely left/right screen layout), not the
    // '-Top.png'/'-Bottom.png' every prior (vertically stacked) Multi
    // Screen title used -- see _applyGameArtwork()'s own comment for the
    // new override mechanism this title needed.
    bgFile: 'Background-Left.png',
    bgFile2: 'Background-Right.png',
    // Real MAME ROM (gnw_lboat, hh_sm510_full.cpp): tc-58, 4096B,
    // 1f88f6a2 -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use.
    cpuType: 'sm510',
    // Both screens' SVG segment titles use column (C) values up to 3 (left
    // screen: A in {0,1}, B in 0-8, C in 0-3; right screen continues B in
    // 9-15) -- confirmed via a fresh grep of both SVGs' own <title> tags,
    // not assumed from the shared Multi Screen convention. Required or
    // GnwDisplay's default cBits:1 silently aliases segments together (see
    // Squish's own shipped bug for what that looks like).
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, Node/vm harness). Clean
    // sequential 6-cell block at 10-15 (hT,hO,mT,mO,sT,sO) -- a new address
    // family, lower than every prior Multi Screen title's own 16-21/20-25
    // blocks, confirmed fresh via a real natural multi-hour run (traced sO
    // ticking every second with a clean carry into sT every 10s, mO/mT the
    // same at 60s/10min, and a real 12:00->01:00 hour rollover at the
    // 60-minute mark with hT/hO both changing in the same step). **No
    // pmBit** -- checked both ways per the cross-cutting note: forcing each
    // of bits 1/2/4/8 onto the hour-tens cell (addr10) produced zero cpu.lcd
    // change for all four, and the real natural 12->1 rollover only ever
    // touched the two BCD digit cells cleanly (hT 1->0, hO 2->1), no stray
    // bit anywhere -- matching the "No pmBit" precedent Mario The
    // Juggler/Black Jack already established, not a gap left unchecked.
    clockRam: { hT: 10, hO: 11, mT: 12, mO: 13, sT: 14, sO: 15 },
    // This ROM's boot-init RAM writes settle by roughly cycle 800
    // (100-cycle-resolution trace, last real burst at 700-800, nothing
    // after) -- a comfortable margin above that.
    bootSyncCycles: 900,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Left "multiply" bounds (221,211,608,411) and
    // Screen-Right "multiply" bounds (1230,198,611,425), both against the
    // Unit element's own bounds (0,0,2068,1146).
    screen: { left: 10.69, top: 18.41, width: 29.40, height: 35.86 },
    screen2: { left: 59.48, top: 17.28, width: 29.55, height: 37.09 },
    // Real input ports (source-confirmed, gnw_lboat INPUT_PORTS_START):
    // IN.0 bit0=Left, bit1=Right (hammer/lever, own row, PORT_16WAY) --
    // same hammer shape as Oil Panic/Pinball/Safe Buster, just wired to a
    // WIDE pair of screens instead of stacked ones. IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm, the usual mode-button row. Alarm
    // has no matching physical hotspot -- confirmed visually on Unit.png,
    // it's a small LED indicator next to ACL (reset), not a push-button,
    // same precedent as Oil Panic's own Alarm.
    // Hotspot boxes: Left/Right have real full-canvas pressed-state art
    // (Animation/Left-Flat.png/Right-Flat.png) -- measured directly via
    // ImageMagick -trim, the original Vermin/Ball/Popeye technique, no
    // synthesis needed. Game A/B/Time have NO press art in this title's
    // MAME bundle (unlike Oil Panic) -- hand-measured the real button
    // rims via ImageMagick connected-components colour isolation instead,
    // and synthesized their own Grey-Flat-1/2/3.png pressed-state art
    // (250% brightness lift + a rounded-rectangle alpha mask matching the
    // real oblong pill-button shape, this title's own case has narrow
    // vertical pill buttons here rather than the round discs most other
    // titles use).
    hotspots: {
      left:  { left: 9.19,  top: 68.32, width: 10.49, height: 18.94 },
      right: { left: 76.11, top: 68.32, width: 10.49, height: 18.94 },
      gameA: { left: 59.04, top: 65.80, width: 3.10,  height: 8.03 },
      gameB: { left: 64.02, top: 65.80, width: 3.10,  height: 8.03 },
      time:  { left: 68.76, top: 65.80, width: 3.10,  height: 8.03 },
    },
    // No fixedRow and no btn1-4 -- same proactive flags as every other
    // hammer-shaped Multi Screen title (Oil Panic/Pinball/Safe Buster):
    // needsResetForModeButtons for GameA/GameB/Time to register at all,
    // lampTestOnBoot so startAttract() dismisses the boot lamp-test screen
    // on its own. **hammersNeedQuickTap added after a real user report**:
    // shipped without it initially (most of this shape's titles don't need
    // it), but a real Left/Right press only ever registered once per round
    // -- the same stuck-extended-hold symptom Chef/Turtle Bridge/Pinball
    // all hit, where the hammer stays logically "held" long past the real
    // release, so the ROM's own next-press edge-check never sees a fresh
    // 0->1 transition until something else (a reset) clears it.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { left: 1, right: 2 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  mario: {
    title: 'Mario Bros.', subtitle: 'MW-56 · 1983',
    artPath: 'artwork/gnw_mario/',
    // Real Unit.png is 2068x1146, same WIDE canvas as Life Boat -- see
    // that title's own unitAspect comment for why this is set upfront.
    unitAspect: '2068 / 1146',
    // Plain SM510 (`sm510_dualh`, confirmed fresh via the real driver
    // source), no melody ROM -- same architecture as Life Boat.
    svgPath: 'artwork/gnw_mario/gnw_mario_left.svg',
    svgPath2: 'artwork/gnw_mario/gnw_mario_right.svg',
    dualScreen: true,
    // See Life Boat's own bgFile/bgFile2 comment -- this title's real
    // backgrounds are also named Background-Left.png/-Right.png, not
    // -Top.png/-Bottom.png.
    bgFile: 'Background-Left.png',
    bgFile2: 'Background-Right.png',
    // Real MAME ROM (gnw_mario, hh_sm510_full.cpp): mw-56, 4096B,
    // 385e59da -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use.
    cpuType: 'sm510',
    // Both screens' SVG segment titles use column (C) values up to 3 --
    // confirmed via a fresh grep of both SVGs' own <title> tags, same as
    // every other Multi Screen title.
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim, Node/vm harness). Same
    // clean sequential 6-cell block (20-25, hT/hO/mT/mO/sT/sO) as Life
    // Boat, confirmed fresh via a real natural multi-hour run (sO
    // ticking every second with a clean carry into sT every 10s, mO/mT
    // the same at 60s/10min, and a real 12:00->01:00 hour rollover at
    // the 60-minute mark). **No pmBit** -- checked both ways per the
    // cross-cutting note: forcing each of bits 1/2/4/8 onto the hour-
    // tens cell produced zero cpu.lcd change, and the real 12->1
    // rollover only ever touched the two BCD digit cells cleanly.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25 },
    // This ROM's boot-init RAM writes settle by roughly cycle 900-1000
    // (100-cycle-resolution trace; addresses that DO keep changing past
    // that point are a periodic attract-mode animation loop that never
    // fully quiets, same class of churn Oil Panic's own boot trace hit,
    // not further one-time boot-init writes) -- a comfortable margin
    // above the observed one-time-write completion point.
    bootSyncCycles: 1000,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Left "multiply" bounds (231,224,601,387) and
    // Screen-Right "multiply" bounds (1240,221,596,392), both against the
    // Unit element's own bounds (0,0,2068,1146).
    screen: { left: 11.17, top: 19.55, width: 29.06, height: 33.77 },
    screen2: { left: 59.96, top: 19.28, width: 28.82, height: 34.21 },
    // Real input ports (source-confirmed, gnw_mario INPUT_PORTS_START):
    // IN.0 bit0=JOYSTICKRIGHT_DOWN, bit1=JOYSTICKRIGHT_UP,
    // bit2=JOYSTICKLEFT_UP, bit3=JOYSTICKLEFT_DOWN -- NOT a hammer/lever
    // and NOT a single 4-way D-pad cluster either: confirmed via Unit.png
    // this is two independent vertical Up/Down rockers, one per player
    // (LUIGI under the left screen = the JOYSTICKLEFT bits, MARIO under
    // the right screen = JOYSTICKRIGHT), the same "two same-axis levers"
    // shape Mickey & Donald's own DM-53 established -- reused the
    // existing btn1-4 mechanism (bit-order mapping: btn1=Mario-Down,
    // btn2=Mario-Up, btn3=Luigi-Up, btn4=Luigi-Down). IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm, the usual mode-button row.
    // Alarm has no matching physical hotspot -- a small LED indicator
    // next to ACL, confirmed visually on Unit.png, same precedent as
    // every other WIDE Multi Screen title.
    // Hotspot boxes: this title's MAME artwork bundle has NO Animation/
    // press-state art at all (not even Game A/B/Time) and no
    // inputtag/inputmask elements in its own default.lay -- every single
    // hotspot was hand-measured off Unit.png (the two rockers via red-
    // pixel connected-components isolation, split top/bottom half at
    // the rocker's own midpoint; Game A/B/Time via the same dark-pixel
    // isolation Life Boat used) and confirmed pixel-identical to Life
    // Boat's own Game A/B/Time rim positions (x=1221/1324/1422, y=754,
    // 64x92) -- the shared WIDE-title control-cluster mold, reused
    // directly rather than re-measured from scratch. Every pressed-state
    // image was synthesized: the rockers at 150% brightness (bright
    // saturated red plastic, same value Bomb Sweeper/Gold Cliff/Zelda's
    // own red D-pads needed since 400% clips this brightness range to
    // white), Game A/B/Time at Life Boat's own 250% + rounded-rectangle
    // mask.
    hotspots: {
      btn1: { left: 80.76, top: 78.01, width: 3.53, height: 7.42 },
      btn2: { left: 80.76, top: 70.60, width: 3.53, height: 7.42 },
      btn3: { left: 10.54, top: 70.60, width: 3.53, height: 7.51 },
      btn4: { left: 10.54, top: 78.01, width: 3.53, height: 7.42 },
      gameA: { left: 59.04, top: 65.80, width: 3.10, height: 8.03 },
      gameB: { left: 64.02, top: 65.80, width: 3.10, height: 8.03 },
      time:  { left: 68.76, top: 65.80, width: 3.10, height: 8.03 },
    },
    // No fixedRow -- but btn1-4 IS present (a genuine two-rocker cluster,
    // reusing the D-pad mechanism), so _hasQuadButtons() already applies
    // the reset-vector trick to GameA/GameB/Time without needing
    // needsResetForModeButtons set explicitly (same as DK-52/DK-II/Green
    // House). lampTestOnBoot still needed proactively so startAttract()
    // dismisses the boot lamp-test screen on its own -- confirmed via the
    // same live-test result Cement Factory/Fire-FR27 both needed this
    // for.
    lampTestOnBoot: true,
    inputRows: [ { btn1: 1, btn2: 2, btn3: 4, btn4: 8 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  rshower: {
    title: 'Rain Shower', subtitle: 'LP-57 · 1983',
    artPath: 'artwork/gnw_rshower/',
    // Real Unit.png is 2068x1146, same WIDE canvas as Life Boat/Mario
    // Bros -- see Life Boat's own unitAspect comment.
    unitAspect: '2068 / 1146',
    // Plain SM510 (`sm510_dualh`, confirmed fresh), no melody ROM -- same
    // architecture as Life Boat/Mario Bros.
    svgPath: 'artwork/gnw_rshower/gnw_rshower_left.svg',
    svgPath2: 'artwork/gnw_rshower/gnw_rshower_right.svg',
    dualScreen: true,
    bgFile: 'Background-Left.png',
    bgFile2: 'Background-Right.png',
    // Real MAME ROM (gnw_rshower, hh_sm510_full.cpp): lp-57, 4096B,
    // 51a2c5c4 -- confirmed via sha1sum against the real driver's own
    // CRC/SHA1 comment before use.
    cpuType: 'sm510',
    lcdCBits: 2,
    // Empirically traced (headless SM510 sim). Same clean sequential
    // 6-cell block (20-25) and same "no pmBit" result as Life Boat/Mario
    // Bros, both re-confirmed fresh via this title's own real natural
    // multi-hour run and bit-forcing test rather than assumed from the
    // shared WIDE-title family.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25 },
    // Same boot-init timing shape as Mario Bros (settles ~1000-1100,
    // periodic attract-loop churn afterward that never fully quiets).
    bootSyncCycles: 1100,
    // Screen-glass boxes from the real MAME artwork's own "Unit Only" view
    // (default.lay): Screen-Left "multiply" bounds (225,201,619,423) and
    // Screen-Right "multiply" bounds (1224,194,625,423), both against the
    // Unit element's own bounds (0,0,2068,1146).
    screen: { left: 10.88, top: 17.54, width: 29.93, height: 36.91 },
    screen2: { left: 59.19, top: 16.93, width: 30.22, height: 36.91 },
    // Real input ports (source-confirmed, gnw_rshower INPUT_PORTS_START) --
    // this title's shape is genuinely unique among every Multi Screen
    // title so far: THREE real K-line rows, not two. IN.0 bit1=Time,
    // bit2=BUTTON1 (the real driver source's own comment names it "L/R" --
    // confirmed via Unit.png this is a single round action button labeled
    // "L/R"/"MOVE", toggling which side of the split screen the umbrella-
    // catcher is on). IN.1 bit1=GameB, bit2=GameA, bit3=Alarm (Alarm has
    // no matching physical hotspot, same precedent as Life Boat/Mario
    // Bros). IN.2 is a genuine single 4-way D-pad (bit0=Right, bit1=Up,
    // bit2=Left, bit3=Down, confirmed via Unit.png's own "CONTROLLER"
    // cross), reusing the existing btn1-4 mechanism. The single action
    // button reuses the existing internal `jump` key (same convention as
    // DK Jr Panorama/Cement Factory/Gold Cliff's own dedicated action
    // button) with a custom jumpLabel since it isn't really a jump.
    // Verified the inputRows array-index-vs-IN.n mapping empirically
    // (the Time tap immediately drove real clock ticking when placed at
    // array index 0, matching IN.0's own bit1) rather than assumed from
    // the driver source comments alone, per the project's own standing
    // "don't assume, verify" lesson.
    // Hotspot boxes: this title's MAME artwork bundle has real full-
    // canvas pressed-state art ONLY for the Move button (Animation/
    // Move-Flat.png, measured via plain -trim, no synthesis needed) --
    // the D-pad and Game A/B/Time have none. D-pad hand-measured via red-
    // pixel connected-components isolation on the full cross, split into
    // thirds per arm (hub excluded) -- the exact same convention Bomb
    // Sweeper/Gold Cliff/Zelda's own D-pads used. Game A/B/Time confirmed
    // pixel-identical to Life Boat/Mario Bros' own shared rim positions
    // (x=1221/1324/1422, y=754, 64x92), reused directly. Synthesized
    // press art: D-pad at 150% brightness (bright saturated red, same as
    // Mario Bros' own rockers), Game A/B/Time at Life Boat's own 250% +
    // rounded-rectangle mask.
    hotspots: {
      btn1: { left: 13.69, top: 75.48, width: 3.10, height: 5.32 },
      btn2: { left: 10.54, top: 70.16, width: 3.10, height: 5.32 },
      btn3: { left: 7.45,  top: 75.48, width: 3.10, height: 5.32 },
      btn4: { left: 10.54, top: 80.72, width: 3.10, height: 5.32 },
      jump: { left: 76.55, top: 69.02, width: 9.96, height: 17.89 },
      gameA: { left: 59.04, top: 65.80, width: 3.10, height: 8.03 },
      gameB: { left: 64.02, top: 65.80, width: 3.10, height: 8.03 },
      time:  { left: 68.76, top: 65.80, width: 3.10, height: 8.03 },
    },
    // jumpLabel: the real case prints "L/R"/"MOVE", not "Jump" -- same
    // per-game label override Balloon Fight's own "Eject" button uses on
    // the identical shared jump/hotspot plumbing.
    jumpLabel: 'Move',
    // btn1-4 present -- _hasQuadButtons() already applies the reset-
    // vector trick to GameA/GameB/Time without needing
    // needsResetForModeButtons set explicitly, same as every other
    // D-pad-shaped Multi Screen title. lampTestOnBoot still needed
    // proactively so startAttract() dismisses the boot lamp-test screen
    // on its own.
    lampTestOnBoot: true,
    inputRows: [ { time: 2, jump: 4 }, { gameB: 2, gameA: 4, alarm: 8 }, { btn1: 1, btn2: 2, btn3: 4, btn4: 8 } ],
  },

  snoopyp: {
    title: 'Snoopy', subtitle: 'SM-91 · 1983',
    artPath: 'artwork/gnw_snoopyp/',
    // Real Unit.png is 2548x3625, the same Panorama-series canvas as
    // DK Jr./Mickey Mouse/DK Circus/Bombs Away -- see dkjrp's own
    // unitAspect comment.
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_snoopyp/gnw_snoopyp.svg',
    // Real driver source: "inverted lcd screen with custom segments",
    // confirmed live too (raw SVG fill is #ffffff, not the usual dark
    // fill) -- same family as every other Panorama title so far. See
    // dkjrp's own lcdInverted comment for the full mechanism.
    lcdInverted: true,
    // Real MAME ROM (gnw_snoopyp, hh_sm510_full.cpp): sm-91.program,
    // 4096B, 893bd7e3; sm-91.melody, 256B, 09360aaf (BAD_DUMP/decap-
    // needed per MAME itself, same caveat as every other melody dump in
    // this project) -- both confirmed via sha1sum against the real
    // driver's own CRC/SHA1 comments before use. Artwork bundle supplied
    // directly by the user (not present in this project's own
    // mame/artwork mirror) -- confirmed it's the real MAME bundle by
    // matching its default.lay's own screen bounds/canvas size against
    // every other already-shipped Panorama title's own conventions.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically traced (headless SM511 sim, Node/vm harness). Same
    // clean sequential 6-cell block (20-25) as every other Panorama
    // title, confirmed fresh via a real natural run: a clean 12->1 hour
    // rollover at the 59-minute mark (the tap-then-run harness's own
    // ~1min-per-cycle offset, same as every other title), and a full
    // 12-hour rollover at the ~708-minute mark showing hT jump from 1 to
    // 9 (1|8, the pmBit:8 convention) exactly at the noon boundary, then
    // to 8 (0|8) one hour later for "1 PM" -- same convention dkjrp's own
    // comment documents, reconfirmed fresh rather than assumed.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    // Boot-init RAM writes settle by roughly cycle 1100-1200
    // (100-cycle-resolution trace; addresses that keep changing past that
    // point are periodic attract-loop churn, same class as every other
    // WIDE/Panorama title's own boot trace) -- a comfortable margin above
    // the observed completion point.
    bootSyncCycles: 1300,
    // Screen-glass box from the real MAME artwork's own "Unit Only" view
    // (default.lay): the plain (non-blend) Screen bounds (632,1106,1301,
    // 666) against the Unit element's own bounds (0,0,2548,3625) --
    // pixel-identical to dkjrp's own screen box, confirming this shared
    // case mold's screen position, not assumed.
    screen: { left: 24.80, top: 30.51, width: 51.06, height: 18.37 },
    // Real input ports (source-confirmed, gnw_snoopyp INPUT_PORTS_START):
    // IN.0 bit0=BUTTON1 ("Hit"), bit1=Right, bit2=Left -- hammer-shaped
    // (hotspots.left/right) plus a single dedicated action button, same
    // shape as Mario's Bombs Away's own Up/Down toggle position (bit0)
    // but here it's a real Hit action, not a toggle -- reused the
    // existing `jump` hotspot/BUTTON_DEFS plumbing with a custom
    // jumpLabel, same per-title-label pattern Balloon Fight's "Eject"/
    // Rain Shower's "Move" established. IN.1 bit0=Time, bit1=GameB,
    // bit2=GameA, bit3=Alarm, the usual mode-button row (Alarm has no
    // matching physical hotspot, an LED indicator only).
    // NOTE: this title's own default.lay references "IN.2" for its
    // Grey-Flat-1/2/3 elements and inputmask 0x08 for Jump-Flat -- a
    // stale numbering from an older MAME driver revision the artwork
    // bundle predates (confirmed real: the CURRENT hh_sm510_full.cpp
    // driver source only ever defines IN.0/IN.1 for this title, no IN.2
    // at all). Per this project's own "don't trust .lay bit/row numbers,
    // verify against the driver source" standing lesson, only the .lay's
    // spatial bounds were used; the actual bit mapping came from the
    // driver source's real INPUT_PORTS_START block. The Grey-Flat-1/2/3
    // mask VALUES (0x04/0x02/0x01) still line up correctly with the
    // current driver's own IN.1 bits (GameA/GameB/Time respectively), so
    // no gameA/gameB swap was needed despite the row-number mismatch.
    // Hotspot boxes: Game A/B/Time and the Hit button have real full-
    // canvas pressed-state art (measured via plain -trim) -- Left/Right
    // do not (no Left-Flat/Right-Flat in the bundle), so the single
    // rocker's own red-pixel bbox was hand-measured via connected-
    // components isolation and split into left/right halves at the
    // midpoint, synthesized at 150% brightness (bright saturated red,
    // same value the other bright-red D-pads/rockers in this project
    // needed).
    hotspots: {
      left:  { left: 15.66, top: 68.99, width: 9.62,  height: 4.94 },
      right: { left: 25.31, top: 68.99, width: 9.62,  height: 4.94 },
      jump:  { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77,  height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77,  height: 6.87 },
      time:  { left: 71.16, top: 83.06, width: 9.77,  height: 6.87 },
    },
    // jumpLabel: the real case prints "HIT", not "Jump".
    jumpLabel: 'Hit',
    // Hammer-shaped (no fixedRow, no btn1-4) -- needsResetForModeButtons
    // for GameA/GameB/Time to register at all, lampTestOnBoot so
    // startAttract() dismisses the boot lamp-test screen on its own,
    // hammersNeedQuickTap shipped proactively -- same three flags every
    // other hammer-shaped Panorama title (Mickey Mouse/DK Circus/Bombs
    // Away) already needed.
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { jump: 1, right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  /* Table Top Snoopy SM-73 (1983). Runs snoopyp's ROM; same believed-not-
     verified basis as GAMES.dkjrt -- SM-73 was never dumped, and MAME's list
     annotates SM-91 "assume same ROM & LCD as tabletop version" while marking
     SM-73 undumped with the chip a guess. See dkjrt's comment for the full
     reasoning and the site-side wording that keeps the distinction visible. */
  snoopyt: {
    title: 'Snoopy', subtitle: 'SM-73 · 1983',
    artPath: 'artwork/gnw_snoopyt/',
    // Unit.png is the bundle's own Unit-Only.png (its "Table Top - Unit Only"
    // view), renamed on copy.
    unitAspect: '634 / 1011',
    svgPath: 'artwork/gnw_snoopyp/gnw_snoopyp.svg',   // the shared LCD -- the whole premise
    lcdInverted: true,
    unitBehindScreen: true,
    noPressedArt: true,
    // default.lay "Table Top - Unit Only": screen 179,234,285x152 of 634x1011.
    screen: { left: 28.233, top: 23.145, width: 44.953, height: 15.035 },
    // "Zoom" view: 1920x1080 close-up, Zoom.png. Rect matches MAME's screen
    // exactly (= the LCD glass in the artwork) so the emulation lines up; the
    // zoom is made large by the height-bound device sizing, not this rect.
    zoom: { unit: 'Zoom.png', aspect: '1920 / 1080', screen: { left: 36.146, top: 42.963, width: 28.646, height: 26.667 } },
    hotspots: TABLETOP_LR_HOTSPOTS,
  },

  /* Table Top Popeye PG-74 (1983). Same story as snoopyt above: runs
     popeyep's ROM, PG-74 itself never dumped. */
  popeyet: {
    title: 'Popeye', subtitle: 'PG-74 · 1983',
    artPath: 'artwork/gnw_popeyet/',
    unitAspect: '634 / 1011',
    svgPath: 'artwork/gnw_popeyep/gnw_popeyep.svg',
    lcdInverted: true,
    unitBehindScreen: true,
    noPressedArt: true,
    // default.lay "Table Top - Unit Only": screen 179,234,285x152 of 634x1011.
    screen: { left: 28.233, top: 23.145, width: 44.953, height: 15.035 },
    // "Zoom" view: 1920x1080 close-up, Zoom.png. Rect matches MAME's screen
    // exactly (= the LCD glass in the artwork) so the emulation lines up; the
    // zoom is made large by the height-bound device sizing, not this rect.
    zoom: { unit: 'Zoom.png', aspect: '1920 / 1080', screen: { left: 36.146, top: 42.963, width: 28.646, height: 26.667 } },
    hotspots: TABLETOP_LR_HOTSPOTS,
  },


  /* ---- Table Top: Mario's Cement Factory CM-72 (1983) -------------------
     The odd one out of the four Table Tops, and the only one that needs no
     assumption: CM-72 has its OWN dump. Nintendo never made a Panorama
     Cement Factory -- they adapted the game for the New Wide Screen ML-102
     instead, which is a genuinely different ROM. So unlike dkjrt/snoopyt/
     popeyet, this entry borrows nothing and carries its own ROM, melody and
     traced clockRam, and its Hardware/Emulation tabs claim nothing that
     wasn't measured from this exact ROM.

     Verified against MAME's own driver before use: cm-72.program CRC
     b2ae4596, cm-72.melody CRC db4f0fc1 -- both match. MAME flags the melody
     BAD_DUMP ("decap needed for verification"), so treat any audio oddity as
     a possibly-bad source dump rather than an emulator bug.

     The cabinet is the same Table Top shell as the other three -- measured,
     not assumed: joystick trims to c(159,778), action button to 434,784
     71x57 and the mode pills to 333/391/451 at y=738, identical to Snoopy's
     and Popeye's on the same 634x1011 canvas. Only the marquee and colour
     differ. Hence unitBehindScreen/noPressedArt for the same reasons -- see
     GAMES.dkjrt. */
  mariocmt: {
    title: "Mario's Cement Factory", subtitle: 'CM-72 · 1983',
    artPath: 'artwork/gnw_mariocmt/',
    unitAspect: '634 / 1011',
    // Its own LCD, not borrowed: this title has no Panorama counterpart.
    svgPath: 'artwork/gnw_mariocmt/gnw_mariocmt.svg',
    // 298 segments traced #ffffff -- a light-marking (inverted) panel, same
    // as the other Table Tops. Checked in the SVG, not inferred from series.
    lcdInverted: true,
    unitBehindScreen: true,
    noPressedArt: true,
    cpuType: 'sm511',
    lcdCBits: 2,
    // Traced against this ROM: held Time (its own S2 bit0), measured which
    // cells count and at what ratio (1x/10x/60x/600x -> ram 25/24/23/22),
    // cross-checked by reading the clock back after 72 simulated minutes
    // from its 12:00 boot (read 01:13:47), and pmBit by poking 11:59:50 and
    // watching the hour-tens nibble flip 0x1 -> 0x9 across 12:00.
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 500,
    lampTestOnBoot: true,
    // default.lay "Unit Only": screen 176,235,285x156 of 634x1011.
    screen: { left: 27.760, top: 23.244, width: 44.953, height: 15.430 },
    // "Zoom" view: 1920x1080 close-up, Zoom.png (its own zoom.png). Rect
    // matches MAME's screen exactly (= the LCD glass in the artwork) so the
    // emulation lines up; the zoom is made large by the height-bound device
    // sizing, not this rect.
    zoom: { unit: 'Zoom.png', aspect: '1920 / 1080', screen: { left: 36.667, top: 44.352, width: 26.458, height: 24.352 } },
    hotspots: TABLETOP_CM_HOTSPOTS,
    // MAME's own gnw_mariocmt port block: IN.0 bit0 = Open (drops the
    // bucket), bit1 = Right, bit2 = Left; IN.1 = the mode buttons.
    inputRows: [ { open: 1, right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

  popeyep: {
    title: 'Popeye', subtitle: 'PG-92 · 1983',
    artPath: 'artwork/gnw_popeyep/',
    unitAspect: '2548 / 3625',
    svgPath: 'artwork/gnw_popeyep/gnw_popeyep.svg',
    // Same inverted-LCD family as Snoopy/dkjrp -- confirmed live (raw SVG
    // fill is #ffffff).
    lcdInverted: true,
    // Real MAME ROM (gnw_popeyep, hh_sm510_full.cpp): pg-92.program,
    // 4096B, f9a2f181; pg-92.melody, 256B, ce2a0e03 (BAD_DUMP/decap-
    // needed per MAME itself) -- both confirmed via sha1sum before use.
    // Artwork bundle supplied directly by the user, same source/session
    // as Snoopy's own. Driver source's own comment confirms this title's
    // controller board is literally the same PCB design as Snoopy's own
    // Panorama controller -- confirmed independently too: this title's
    // own rocker/Jump/Grey-Flat hotspot pixel positions came out
    // identical to Snoopy's.
    cpuType: 'sm511',
    lcdCBits: 2,
    // Empirically traced fresh (not assumed from Snoopy despite the
    // shared controller board) -- same clean sequential 6-cell block
    // (20-25), same pmBit:8 convention, confirmed via the same real
    // natural-rollover method (12->1 hour transition, then hT jumping to
    // 9 (1|8) at the ~714-minute noon boundary).
    clockRam: { hT: 20, hO: 21, mT: 22, mO: 23, sT: 24, sO: 25, pmBit: 8 },
    bootSyncCycles: 1300,
    // Screen-glass box from THIS title's own default.lay "Unit Only" view
    // -- plain Screen bounds (624,1120,1301,652), against Unit's own
    // bounds (0,0,2548,3625). Close to but not pixel-identical to
    // Snoopy's own (632,1106,1301,666) -- re-measured fresh from this
    // title's own .lay rather than reused blindly, small real-photo
    // alignment differences between titles sharing a case mold are
    // already a known pattern in this project (e.g. DK Circus vs Mickey
    // Mouse Panorama).
    screen: { left: 24.49, top: 30.90, width: 51.06, height: 17.99 },
    // Real input ports (source-confirmed, gnw_popeyep INPUT_PORTS_START):
    // IN.0 bit0=BUTTON1 ("Punch"), bit1=Right, bit2=Left -- same hammer +
    // dedicated action-button shape as Snoopy's own. IN.1 bit0=Time,
    // bit1=GameB, bit2=GameA, bit3=Alarm. Same stale-IN.2-numbering gap
    // in this title's own default.lay as Snoopy's (see that title's own
    // comment for the full explanation) -- driver source used for the
    // real bit mapping, .lay used only for spatial bounds.
    // Hotspot boxes: Game A/B/Time and the Punch button have real full-
    // canvas pressed-state art; Left/Right don't (same gap as Snoopy),
    // and this title's own rocker measured at the exact same pixel
    // position as Snoopy's (confirmed independently, not copied blindly)
    // -- the shared controller-board mold the driver source's own
    // comment describes. Synthesized the same way (150% brightness).
    hotspots: {
      left:  { left: 15.66, top: 68.99, width: 9.62,  height: 4.94 },
      right: { left: 25.31, top: 68.99, width: 9.62,  height: 4.94 },
      jump:  { left: 63.81, top: 63.83, width: 20.88, height: 14.68 },
      gameA: { left: 52.08, top: 83.06, width: 9.77,  height: 6.87 },
      gameB: { left: 61.62, top: 83.06, width: 9.77,  height: 6.87 },
      time:  { left: 71.16, top: 83.06, width: 9.77,  height: 6.87 },
    },
    // jumpLabel: the real case prints "PUNCH", not "Jump".
    jumpLabel: 'Punch',
    needsResetForModeButtons: true,
    lampTestOnBoot: true,
    hammersNeedQuickTap: true,
    inputRows: [ { jump: 1, right: 2, left: 4 }, { time: 1, gameB: 2, gameA: 4, alarm: 8 } ],
  },

};

/* HARDWARE TWINS -- pairs of entries that are the same machine in a
   different case, so the second inherits everything internal from the first
   and overrides only what the case changes.

   Nintendo shipped the 1986 Crystal Screen units and their 1988 New Wide
   Screen re-releases with identical program and melody ROMs -- byte-for-byte,
   not merely equivalent (sha256 of the real MAME dumps: bf-803.program ==
   bfightn's 38bfbb54..., dr-802 == climbern's, ym-801 == smbn's). MAME
   itself expresses this by making the New Wide Screen machines clones of the
   Crystal ones, which is why one ROM archive there ships both units' SVGs.
   Same chip, same ROM, same RAM map, same port wiring, same boot behaviour.

   Inherit-by-default rather than a list of things to copy, and that
   direction is deliberate -- it's the safe way round for this failure mode.
   The first cut of this copied only romB64/melodyB64 and left each Crystal
   entry to re-declare the rest by hand; three flags were duly missed
   (lampTestOnBoot, hammersNeedQuickTap, and Balloon Fight's jumpLabel), and
   the missing lampTestOnBoot is not subtle -- it gates startAttract()'s
   auto Time-tap, so all three units sat at their boot lamp test until the
   user pressed Time themselves. Nothing could have caught that but a person
   noticing. Defaulting to "same machine => same field" means the only way
   to get it wrong now is to actively list a field as case-specific below.

   The borrower's own declarations always win, so an entry overrides simply
   by declaring the field itself. */
const HW_TWIN_CASE_SPECIFIC = new Set([
  // Identity and artwork -- what the case IS.
  'title', 'subtitle', 'artPath', 'svgPath', 'svgPath2', 'unitAspect',
  // Geometry -- where things sit on THIS case.
  'screen', 'screen2', 'hotspots', 'crystal',
  // Panel/artwork traits. lcdInverted especially must never cross: it
  // describes the physical display, and a Crystal panel is exactly the
  // case where twins genuinely differ.
  'lcdInverted', 'hideLines', 'bgFile', 'bgFile2',
]);
/* borrower -> the entry it takes its internals from.
   smb/climber/bfight: Crystal Screen units, VERIFIED byte-identical to their
     New Wide Screen twins by sha256 against the real MAME dumps.
   dkjrt/snoopyt/popeyet: the Table Top cabinets -- BELIEVED identical to
     their Panorama counterparts, not verified. CJ-71, SM-73 and PG-74 were
     none of them ever dumped, so there is nothing to compare against. MAME's
     own list marks all three undumped (with the chip itself a guess,
     "SM511?") and annotates each Panorama entry "assume same ROM & LCD as
     tabletop version". Same mechanism as the Crystal pairs, weaker claim --
     see GAMES.dkjrt's own comment, and sharedFirmware.verified in
     index.html, which is what makes the site say which kind of claim it is
     rather than presenting both as fact. */
const GAMES_HW_TWINS = {
  smb: 'smbn', climber: 'climbern', bfight: 'bfightn',      // verified by hash
  smbspecial: 'smbn',                                       // verified by hash (same ROM as smbn)
  dkjrt: 'dkjrp', snoopyt: 'snoopyp', popeyet: 'popeyep',   // believed, unverifiable
};
for (const [borrower, owner] of Object.entries(GAMES_HW_TWINS)) {
  const a = GAMES[borrower], b = GAMES[owner];
  for (const [field, value] of Object.entries(b)) {
    if (HW_TWIN_CASE_SPECIFIC.has(field)) continue;
    if (Object.prototype.hasOwnProperty.call(a, field)) continue; // its own wins
    a[field] = value;
  }
}

// ---------------------------------------------------------------------------
// ROM archive (external). To keep this file lean, every title's mask-ROM (and
// melody ROM, where present) lives in firmware/gnw_roms.json rather than inline
// base64 here. It's fetched once on startup; _romsReady resolves after GAMES has
// been populated with each title's romB64 / melodyB64. Every emulator boot and
// preview path awaits _romsReady before constructing a GnwEmulator (which is the
// only thing that decodes game.romB64 / game.melodyB64). Titles that share a ROM
// via GAMES_HW_TWINS already have their own entry in the JSON (extracted after
// the inheritance loop above), so no re-inheritance is needed here.
const _GNW_ROMS_URL = (function () {
  try {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/[^/]*$/, '') + 'firmware/gnw_roms.json';
  } catch (e) {}
  return 'firmware/gnw_roms.json';
})();
function _gnwApplyRoms(roms) {
  for (const k in roms) {
    if (!GAMES[k]) continue;
    if (roms[k].rom)    GAMES[k].romB64    = roms[k].rom;
    if (roms[k].melody) GAMES[k].melodyB64 = roms[k].melody;
  }
}
const _romsReady = fetch(_GNW_ROMS_URL)
  .then(r => { if (!r.ok) throw new Error('gnw_roms.json HTTP ' + r.status); return r.json(); })
  .then(roms => { _gnwApplyRoms(roms); })
  .catch(err => {
    // No pre-built archive installed — fall back to a user-loaded content pack
    // (Settings → Content → open a .zip), which content_pack.js keeps in IndexedDB.
    return (window.__GNW_PACK ? window.__GNW_PACK.ready : Promise.resolve()).then(() => {
      const roms = window.__GNW_PACK && window.__GNW_PACK.roms();
      if (roms) { _gnwApplyRoms(roms); return; }
      console.error('[gnw] ROM archive (firmware/gnw_roms.json) failed to load — emulators cannot boot:', err);
      _gnwContentMissing();
      throw err;
    });
  });

// Shown when the emulator content (ROMs / artwork / colour-unit firmware) is not
// present — i.e. someone has the code-only distribution and hasn't run the
// builder yet. The rest of the site (catalogue, specs, manuals) still works, so
// this is a friendly top banner, not a fatal error screen. Idempotent.
function _gnwContentMissing() {
  if (!document.body) { document.addEventListener('DOMContentLoaded', _gnwContentMissing, { once: true }); return; }
  if (document.getElementById('gnw-content-banner')) return;
  const el = document.createElement('div');
  el.id = 'gnw-content-banner';
  el.style.cssText = 'position:sticky;top:0;z-index:100000;background:linear-gradient(180deg,#151b26,#0e131b);'
    + 'border-bottom:2px solid var(--accent,#9be15d);box-shadow:0 10px 34px rgba(0,0,0,.55);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6ebf2;padding:15px 20px;';
  // Which "plug it in" options apply here:
  //  • content pack (.zip)  — always.
  //  • cloud storage        — only on a real host AND once a provider is set up
  //                           (localhost's isolation headers block the sign-in
  //                           popup, and locally you can copy the files yourself).
  //  • the PowerShell builder — only when served locally (it can't touch a
  //                           GitHub Pages / remote deployment).
  const _local = _gnwIsLocalHost();
  const _cloud = !_local && !!(window.__GNW_CLOUD && window.__GNW_CLOUD.anyConfigured());
  const _count = 1 + (_cloud ? 1 : 0) + (_local ? 1 : 0);
  const _sub = 'The firmware isn’t installed — but you can plug it in ' + (_count >= 2 ? 'one of these ways:' : 'right here:');
  const _packSection =
        '<div style="flex:1 1 260px;border-left:3px solid var(--accent,#9be15d);background:rgba(var(--accent-rgb,155,225,93),.05);border-radius:0 7px 7px 0;padding:12px 15px">'
      +   '<div style="font-weight:700;color:#e6ebf2;font-size:13px;margin-bottom:5px">Open a content pack</div>'
      +   '<div style="font-size:12.5px;color:#aab3c0;line-height:1.6;margin-bottom:11px">Have your dumps, segment SVGs and colour-unit flash together in a single <b style="color:#cfd6df">.zip</b>? Open it here — the site works out the contents and keeps them <b style="color:#cfd6df">on this device (nothing is uploaded)</b>.</div>'
      +   '<button onclick="window.gnwBannerOpenPack&&window.gnwBannerOpenPack()" style="background:var(--accent,#9be15d);color:#0a0e14;border:0;padding:9px 15px;border-radius:8px;font-weight:700;cursor:pointer;font-size:12.5px">Open content pack (.zip)…</button>'
      + '</div>';
  const _cloudSection = !_cloud ? '' :
        '<div style="flex:1 1 260px;border-left:3px solid var(--accent-3,#5dc8f0);background:rgba(93,200,240,.05);border-radius:0 7px 7px 0;padding:12px 15px">'
      +   '<div style="font-weight:700;color:#e6ebf2;font-size:13px;margin-bottom:5px">From cloud storage</div>'
      +   '<div style="font-size:12.5px;color:#aab3c0;line-height:1.6;margin-bottom:11px">Keep your <b style="color:#cfd6df">.zip</b> in the cloud? Sign in and pick it once — it’s saved to <b style="color:#cfd6df">this device</b> afterwards, so no repeat logins.</div>'
      +   (window.__GNW_CLOUD.configured('google')
          ? '<button onclick="window.gnwBannerCloudPick&&window.gnwBannerCloudPick(\'google\')" style="background:rgba(93,200,240,.12);color:#cfe8f5;border:1px solid rgba(93,200,240,.42);padding:9px 15px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12.5px">Google Drive</button>'
          : '')
      + '</div>';
  const _builderSection = !_local ? '' :
        '<div style="flex:1 1 260px;border-left:3px solid var(--accent-2,#f5c542);background:rgba(245,197,66,.045);border-radius:0 7px 7px 0;padding:12px 15px">'
      +   '<div style="font-weight:700;color:#e6ebf2;font-size:13px;margin-bottom:5px">Or install it locally</div>'
      +   '<div style="font-size:12.5px;color:#aab3c0;line-height:1.6;margin-bottom:9px">Run the builder once, then reload the page:</div>'
      +   '<code style="display:inline-block;padding:7px 11px;border-radius:7px;background:#0a0e14;border:1px solid #2a3242;color:var(--accent-2,#f5c542);font-size:12.5px;font-family:ui-monospace,\'Cascadia Mono\',Consolas,monospace">firmware\\build_gnw_roms.ps1</code>'
      +   '<div style="font-size:12px;color:#8a9196;margin-top:7px">right-click → <b style="color:#aab3c0">Run with PowerShell</b></div>'
      + '</div>';
  el.innerHTML =
      '<div style="max-width:1080px;margin:0 auto">'
    +   '<div style="display:flex;gap:13px;align-items:flex-start;margin-bottom:12px">'
    +     '<div style="font-size:25px;line-height:1;filter:grayscale(.15)">🕹️</div>'
    +     '<div style="flex:1;min-width:0">'
    +       '<div style="font-weight:700;font-size:15px">Batteries not included.</div>'
    +       '<div style="font-size:12.5px;color:#8a9196;margin-top:2px">' + _sub + '</div>'
    +     '</div>'
    +     '<button aria-label="Dismiss" onclick="var b=document.getElementById(\'gnw-content-banner\');if(b)b.remove()" style="background:none;border:0;color:#8a9196;font-size:22px;cursor:pointer;line-height:1;padding:0 4px">×</button>'
    +   '</div>'
    +   '<div style="display:flex;gap:14px;align-items:stretch;flex-wrap:wrap">'
    +     _packSection + _cloudSection + _builderSection
    +   '</div>'
    +   '<div id="gnw-banner-msg" style="font-size:12px;color:#8a9196;line-height:1.5;margin-top:11px;min-height:0"></div>'
    + '</div>';
  document.body.insertBefore(el, document.body.firstChild);
}

// True only when the page is genuinely being served locally, where running the
// PowerShell builder can actually affect this deployment. Anything else (GitHub
// Pages, any real domain/IP) is remote — the builder hint is hidden there.
// Takes an optional host so the decision is unit-testable.
function _gnwIsLocalHost(h) {
  h = (h == null) ? location.hostname : h;
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || /\.localhost$/i.test(h);
}

// Banner's "Open content pack" action: pick a .zip, import it via the content
// pack (IndexedDB), then reload so the emulators boot from it. Self-contained so
// the banner works even before the Settings-panel handlers run.
window.gnwBannerOpenPack = function () {
  const msg = document.getElementById('gnw-banner-msg');
  if (!window.__GNW_PACK) { if (msg) msg.textContent = 'Content loader unavailable in this browser.'; return; }
  let inp = document.getElementById('gnw-banner-file');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.zip,application/zip'; inp.id = 'gnw-banner-file'; inp.style.display = 'none';
    inp.addEventListener('change', function () {
      const file = inp.files && inp.files[0]; if (!file) return;
      const m = document.getElementById('gnw-banner-msg');
      if (m) { m.style.color = '#8a9196'; m.textContent = 'Reading ' + (file.name || 'file') + ' …'; }
      window.__GNW_PACK.importZip(file).then(function (sum) {
        if (!m) return;
        if (sum && sum.empty) { m.textContent = 'That zip didn’t contain any recognised content.'; return; }
        m.style.color = 'var(--accent,#9be15d)';
        m.textContent = 'Loaded (' + sum.roms.found + ' ROMs, ' + sum.art.found + ' SVGs, ' + sum.tft.found + ' colour units) — starting the emulators…';
        setTimeout(function () { location.reload(); }, 800);
      }).catch(function (err) {
        if (m) m.textContent = 'Couldn’t read that file: ' + ((err && err.message) || err) + ' (it needs to be a .zip).';
      });
    });
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.click();
};

// Banner's "From cloud storage" action: sign in to the provider, let the user
// pick their .zip, then run it through the same content-pack import + reload.
window.gnwBannerCloudPick = function (provider) {
  const m = document.getElementById('gnw-banner-msg');
  if (!window.__GNW_CLOUD || !window.__GNW_PACK) { if (m) m.textContent = 'Cloud storage is unavailable here.'; return; }
  const label = provider === 'google' ? 'Google Drive' : provider;
  if (m) { m.style.color = '#8a9196'; m.textContent = 'Opening ' + label + ' — a sign-in window will appear…'; }
  window.__GNW_CLOUD.pick(provider).then(function (res) {
    if (m) m.textContent = 'Downloading ' + (res.name || 'your file') + ' …';
    return window.__GNW_PACK.importZip(res.blob).then(function (sum) {
      if (!m) return;
      if (sum && sum.empty) { m.textContent = 'That file didn’t contain any recognised content.'; return; }
      m.style.color = 'var(--accent,#9be15d)';
      m.textContent = 'Loaded (' + sum.roms.found + ' ROMs, ' + sum.art.found + ' SVGs, ' + sum.tft.found + ' colour units) — starting the emulators…';
      setTimeout(function () { location.reload(); }, 800);
    });
  }).catch(function (err) {
    const em = (err && err.message) || String(err);
    if (!m) return;
    if (/cancel/i.test(em)) { m.textContent = ''; return; }   // user backed out — no scary error
    m.style.color = '#f08a8a';
    m.textContent = 'Couldn’t load from ' + label + ': ' + em;
  });
};

// ---------------------------------------------------------------------------
// Artwork archive (external). Every title's LCD segment artwork — the per-screen
// SVGs, geometry plus the <title> segment addresses — lives in
// firmware/artwork.json.gz: a single gzip'd JSON keyed by the same relative
// svgPath strings GAMES and HARDWARE_DEVICE_INFO already use, rather than 71
// loose .svg files. It's fetched lazily the first time any device's screen is
// shown (NOT on page load), decompressed in-browser via DecompressionStream, and
// cached in memory; every later lookup is served off the cached map. _resolveArt
// is the single gateway all SVG loads go through, so a later stage can swap the
// backing store (IndexedDB / remote / companion server) without touching the
// emulator or the hardware pages.
const _GNW_ART_URL = (function () {
  try {
    const s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/[^/]*$/, '') + 'firmware/artwork.json.gz';
  } catch (e) {}
  return 'firmware/artwork.json.gz';
})();
let _artMap = null;
let _artReady = null;
function _loadArtArchive() {
  if (_artReady) return _artReady;
  _artReady = fetch(_GNW_ART_URL)
    .then(r => { if (!r.ok) throw new Error('artwork.json.gz HTTP ' + r.status); return r.body; })
    .then(body => new Response(body.pipeThrough(new DecompressionStream('gzip'))).json())
    .then(map => { _artMap = map; return map; })
    .catch(err => {
      // No pre-built archive installed — fall back to a user-loaded content pack
      // (Settings → Content → open a .zip); content_pack.js holds it in IndexedDB.
      return (window.__GNW_PACK ? window.__GNW_PACK.ready : Promise.resolve()).then(() => {
        const art = window.__GNW_PACK && window.__GNW_PACK.art();
        if (art) { _artMap = art; return art; }
        console.error('[gnw] artwork archive (firmware/artwork.json.gz) failed to load — LCDs cannot render:', err);
        _artReady = null;   // let a later attempt retry the fetch
        _gnwContentMissing();
        throw err;
      });
    });
  return _artReady;
}
// The single gateway every SVG load goes through. Resolves the artwork SVG text
// for an svgPath (the same relative path GAMES / HARDWARE_DEVICE_INFO reference).
function _resolveArt(svgPath) {
  return _loadArtArchive().then(map => {
    const svg = map[svgPath];
    if (svg == null) throw new Error('artwork not found in archive: ' + svgPath);
    return svg;
  });
}

function decodeRom(b64) {
  const raw = atob(b64);
  // 4096 covers both SM5A's largest ROM (1.8K) and SM510's (4K, e.g. Fire
  // Attack's id-29) — harmless extra trailing zero bytes for the smaller ones.
  const out = new Uint8Array(4096);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

// ─── SM5A CPU ───────────────────────────────────────────────────────────────
// Faithful port of MAME's sm5a_device / sm500_device / sm510_base_device
// (src/devices/cpu/sm510/{sm5a,sm500,sm510base}.cpp, license BSD-3-Clause,
// copyright-holders: hap). Vermin uses SM5A: 1 hardware stack level, 9 O-groups,
// 6-bit LFSR program counter — none of which behave like a conventional CPU.

class SM5A {
  constructor(rom) {
    this.rom = rom;
    this.ram = new Uint8Array(128);  // (bm<<4 | bl) & 0x7f
    this.ox  = new Uint8Array(9);    // W' shift register (9 O-groups)
    this.o   = new Uint8Array(9);    // W latch, committed by TW/PTW
    this.lcd = new Uint8Array(18);   // lcd[(A<<1)|C]: A=0..8 group, C=0/1 row (H1/H2)
    // Inputs (set from outside)
    this.inB  = 1;   // B  pin: active LOW = 0 (left hammer)
    this.inBA = 1;   // BA pin: active LOW = 0 (right hammer)
    // inRows[i] = current 4-bit value of hardware input row i (IN.0/IN.1/IN.2),
    // active HIGH. inFixedRow >= 0 means that row is read directly regardless
    // of R (matches MAME's inp_fixed_last() games — Vermin/Ball, which only
    // have one input row to begin with); inFixedRow = -1 means KTA gates
    // which rows are OR'd together by the R register instead, matching real
    // hardware's row-select-doubles-as-R-output wiring (see op_atr).
    this.inRows = [0];
    this.inFixedRow = 0;
    // Latched wakeup/interrupt line level, mirroring MAME's update_k_line().
    // Real hardware only re-evaluates this at two events — a button's held
    // state changing, or the ROM writing a new R value (ATR) — not every
    // cycle. See updateKLine() below.
    this.wakeupLine = false;
    // Fixed, real hardware constant (sm510_base_device::m_clk_div = 2,
    // "16kHz" per MAME's own comment) — SM5A/SM500 never change this at
    // runtime, unlike SM511 (see SM511.clkDiv). Exists here so GnwEmulator
    // can read cpu.clkDiv uniformly regardless of which CPU class it holds.
    this.clkDiv = 2;
    this.reset();
  }

  reset() {
    this.acc = 0; this.bl = 0; this.bm = 0;
    this.c   = 0; this.skip = false;
    this.op  = 0; this.prevOp = 0; this.param = 0;
    this.mx  = 0;
    this.halt = false;
    this.bp  = 1;    // LCD on
    this.r   = 0xf;
    this.div = 0; this.gamma = 1;  // gamma starts SET after reset (sm500_device::device_reset)
    this.cb  = 0; this.rsub = false;
    this.wakeupLine = false;
    this.ram.fill(0); this.ox.fill(0); this.o.fill(0); this.lcd.fill(0);
    // reset_vector for SM500-family: do_branch(0, 0xf, 0) => pc = 0x3c0, NOT 0
    this.pc  = 0x3c0;
    this.stk = this.pc;  // push_stack() in sm500_device::device_reset (also caches su=0xf)
    this._twCount = 0; this._cendCount = 0;
  }

  // Real SM5A RAM is only 5×13 nibbles: bl 13-15 alias back to bl=12 within the
  // same group (confirmed against sm5a_device::data_5x13x4's fallback decode,
  // offset & 0x7c), and bm=7 specifically mirrors bm=4 (the memory map's
  // explicit .mirror(0x30) on the bm=4 block) — confirmed against the real
  // sm5a_device::data_5x13x4 map. bm=5/6 are NOT mirrored to bm=4 (that was
  // a bug here: Math.min(bm&7,4) folded them in too); real hardware has no
  // defined behaviour there since valid ROM code never generates those
  // addresses, so they're just left as their own (unused) cells.
  ramAddr()   { return ((this.bm & 7) === 7 ? 4 : (this.bm & 7)) * 16 + Math.min(this.bl & 15, 12); }
  ramR()      { return this.ram[this.ramAddr()] & 15; }
  ramW(v)     { this.ram[this.ramAddr()] = v & 15; }
  bit()       { return 1 << (this.op & 3); }

  // The value KTA reads AND the wakeup line both come from the same
  // hardware read (hh_sm510_state::input_r() / read_inputs()) — inFixedRow
  // >= 0 reads that one row directly (Vermin/Ball, which only have one
  // row), otherwise R gates which rows are OR'd together (see the KTA case
  // in step() and the inRows/inFixedRow comment in the constructor).
  readInputRows() {
    if (this.inFixedRow >= 0) return (this.inRows[this.inFixedRow] || 0) & 0xf;
    // ATR doesn't hand R to the input mux verbatim on real hardware — R
    // pins are driven by sm500_device::clock_melody(), which for boards
    // wired RMASK_DIRECT (every SM5A title here, per hh_sm510.cpp's
    // mcfg_cpu_sm5a()) reduces to `out = ~R & 0xf`, and the driver's own
    // piezo_input_w() then takes `out >> 1` as the actual row-select mux
    // (out's bit 0 goes to the piezo instead). Confirmed against real MAME
    // register traces on Chef: at R=7, real hardware's mux only selects
    // row 2 (mode buttons), while the naive `(R>>1)&7` this used to do
    // selects rows 0+1 instead — silently dropping Game A/B/Time reads
    // during the post-press debounce poll and sending the ROM down a
    // different, still-executing-but-never-finishing branch (looked like a
    // permanent freeze on the "3 static chefs" intro frame, not an actual
    // CPU halt). Gated behind `rMuxInvert` (Chef only) rather than applied
    // universally — trying this on all non-fixedRow SM5A titles regressed
    // several of them (manhole, lion, pchute, octopus, mmouse, egg all
    // went from a clean busyCount to a stuck one), most likely because
    // their ROMs read input while R is still at SM500's post-reset default
    // (0xf) before their own boot code ever calls ATR — under the
    // corrected formula that legitimately reads as "no row selected" (real
    // hardware's own out=~0xf&0xf=0 too), so whatever timing those titles
    // currently rely on to avoid depending on that reads-as-zero window
    // hasn't been established. Root-causing that gap for every other title
    // is a separate, not-yet-done investigation — see project memory.
    const mux = this.rMuxInvert ? (((~this.r) & 0xf) >> 1) : ((this.r >> 1) & 0x7);
    let v = 0;
    for (let i = 0; i < this.inRows.length; i++) if ((mux >> i) & 1) v |= this.inRows[i];
    return v & 0xf;
  }

  // Mirrors hh_sm510_state::update_k_line(): latches the wakeup line from a
  // fresh readInputRows() sample. MAME calls this exactly twice — from
  // input_w() when the ROM writes a new R value (below, in ATR), and from
  // input_changed() when a button's held state changes (GnwEmulator calls
  // this after updating cpu.inRows for that reason). Not called every
  // cycle — see the step() comment on why that distinction matters.
  updateKLine() {
    this.wakeupLine = this.readInputRows() !== 0;
  }

  getSu()     { return (this.stk >> 6) & 0xf; }
  setSu(su)   { this.stk = (this.stk & ~0x3c0) | ((su << 6) & 0x3c0); }
  doBranch(pu, pm, pl) { this.pc = ((pu << 10) | ((pm << 6) & 0x3c0) | (pl & 0x3f)) & 0x7ff; }
  pushStack() { this.stk = this.pc; }               // stack_levels=1: plain overwrite
  popStack()  { this.pc = this.stk; }               // read-only, does not clear

  // 6-bit Fibonacci LFSR — real SM5xx program counters do NOT increment linearly
  incrementPc() {
    const pagemask = 0x3f, msb = (pagemask >> 1) ^ pagemask; // 0x20
    const feed = (((this.pc >> 1) ^ this.pc) & 1) ? 0 : msb;
    this.pc = (feed | ((this.pc >> 1) & (pagemask >> 1)) | (this.pc & ~pagemask)) & 0x7ff;
  }

  shiftW() { for (let i = 0; i < 8; i++) this.ox[i] = this.ox[i + 1]; }  // drop 0, shift left; caller fills [8]

  // Digit segment PLA: 32-entry LUT selected by BP bit3 (CN flag), OR'd with mx when CN=0
  getDigit() {
    const LUT = [
      0xe,0x0,0xc,0x8,0x2,0xa,0xe,0x2,0xe,0xa,0x0,0x0,0x2,0xa,0x2,0x2,
      0xb,0x9,0x7,0xf,0xd,0xe,0xe,0xb,0xf,0xf,0x4,0x0,0xd,0xe,0x4,0x0
    ];
    const sel = (this.bp >> 3) & 1;
    return LUT[(sel << 4) | (this.acc & 15)] | (sel === 0 ? this.mx : 0);
  }

  step() {
    if (this.halt) {
      // divider free-runs even while halted
      this.div = (this.div + 2) & 0x7fff;
      if (this.div === 0) this.gamma = 1;
      // Wake on the 1S timer, or the wakeup line (real hardware ties
      // SM510_EXT_WAKEUP_LINE to input_r(), i.e. the K-input port level —
      // hh_sm510_state::update_k_line()/input_r() only reads the K-port
      // (Time/GameB/GameA), never the dedicated hammer pins BA/B. It's a
      // level, not an edge: holding a K-button keeps the line asserted, and
      // do_interrupt() never clears it — real ROMs simply avoid relying on
      // CEND to sleep while a K-button is held (they busy-poll instead), so
      // this doesn't stall anything. Treating hammer presses as ALSO able to
      // trigger wakeup (an earlier, edge-based version of this) spuriously
      // woke the CPU on every hammer press/release during real gameplay,
      // corrupting CEND-paced timing — harmless for Vermin's gameplay but
      // broke Ball's ball-catch timing almost immediately.
      //
      // wakeupLine is a LATCH (see updateKLine()), not a live per-cycle
      // read of readInputRows() — an earlier version checked
      // readInputRows() directly here, re-sampling it every single cycle
      // regardless of R or button state actually changing. Real hardware
      // only re-latches on the two events updateKLine() is called from, so
      // a continuous check woke the CPU far more often than real hardware
      // would, running the ROM's software-timed delay loops (and therefore
      // its on-screen clock) tens of times too fast.
      if (this.gamma || this.wakeupLine) {
        this.halt = false;
        this.cb = 0;
        this.doBranch(0, 0, 0);  // wakeup_vector
        // MAME's execute_run() wakes up and, in the SAME while-loop iteration,
        // falls straight through to fetch/execute the instruction at the new
        // PC — it doesn't wait for a separate cycle. Fall through here too
        // instead of returning, so the first post-wakeup instruction runs on
        // the same step() call rather than being deferred to the next one
        // (which could otherwise push it past the end of the current frame's
        // cycle budget).
      } else {
        return;
      }
    }

    this.prevOp = this.op;
    this.op = this.rom[this.pc] & 0xff;
    this.incrementPc();

    this.div = (this.div + 2) & 0x7fff;  // divider ticks at full 32768Hz oscillator rate = 2x instruction rate
    if (this.div === 0) this.gamma = 1;

    this.param = 0;
    if (this.op === 0x5e || this.op === 0x5f) {
      this.param = this.rom[this.pc] & 0xff;
      this.incrementPc();
    }

    // Real hardware fakes a NOP (op=0) when an instruction is skipped, not the
    // real (skipped) opcode — matters because LAX's "same group as prevOp"
    // check and TRS's "prevOp was SSR" check both read prevOp on the NEXT
    // instruction. Leaving the real skipped opcode in place (as this used to)
    // could make a following LAX wrongly refuse to load, or a following TRS
    // wrongly treat itself as SSR-prefixed.
    if (this.skip) { this.skip = false; this.op = 0; return; }
    this.exec();
  }

  exec() {
    const op = this.op;

    // ── TRS (call) ────────────────────────────────────────────
    if (op >= 0xc0) {
      if (!this.rsub) {
        this.rsub = true;
        const su = this.getSu();
        this.pushStack();
        this.doBranch(1, 0, op & 0x3f);  // get_trs_field() === 1 for SM5A
        if ((this.prevOp & 0xf0) === 0x70) this.doBranch(this.cb, su, this.pc & 0x3f);
      } else {
        this.pc = (this.pc & ~0xff) | ((op << 2) & 0xc0) | (op & 0xf);
      }
      return;
    }
    // ── TR (jump) ─────────────────────────────────────────────
    if (op >= 0x80) {
      this.pc = (this.pc & ~0x3f) | (op & 0x3f);
      if (!this.rsub) this.doBranch(this.cb, this.getSu(), this.pc & 0x3f);
      return;
    }

    // ── SSR ───────────────────────────────────────────────────
    if (op >> 4 === 7) { this.setSu(op & 0xf); return; }

    // ── LB ────────────────────────────────────────────────────
    if (op >> 4 === 4) {
      this.bm = op & 3;
      this.bl = ((op >> 2) & 3) | ((op & 0xc) ? 8 : 0);
      return;
    }

    // ── ADX (carry untouched) ─────────────────────────────────
    if (op >> 4 === 3) {
      const imm = op & 15;
      this.acc += imm;
      this.skip = (imm !== 10) && ((this.acc & 0x10) !== 0);
      this.acc &= 0xf;
      return;
    }

    // ── LAX ───────────────────────────────────────────────────
    if (op >> 4 === 2) {
      if ((op & 0xf0) !== (this.prevOp & 0xf0)) this.acc = op & 15;
      return;
    }

    // ── Grouped 2-bit opcode families ─────────────────────────
    const grp = op & 0xfc;
    switch (grp) {
      case 0x54: this.skip = (this.ramR() & this.bit()) !== 0; return;   // TMI
      case 0x1c: {                                                         // EXCD
        const t = this.acc; this.acc = this.ramR(); this.ramW(t);
        this.bm ^= op & 3;
        this.bl  = (this.bl - 1 + 16) & 15;
        this.skip = (this.bl === 15); return;
      }
      case 0x18: this.acc = this.ramR(); this.bm ^= op & 3; return;      // LDA
      case 0x14: {                                                         // EXCI
        const t = this.acc; this.acc = this.ramR(); this.ramW(t);
        this.bm ^= op & 3;
        this.bl  = (this.bl + 1) & 15;
        this.skip = (this.bl === 8); return;
      }
      case 0x10: {                                                         // EXC
        const t = this.acc; this.acc = this.ramR(); this.ramW(t);
        this.bm ^= op & 3; return;
      }
      case 0x0c: this.ramW(this.ramR() |  this.bit()); return;           // SM
      case 0x04: this.ramW(this.ramR() & ~this.bit()); return;           // RM
    }

    // ── Single-byte opcodes ───────────────────────────────────
    switch (op) {
      case 0x00: break;                                                    // SKIP/NOP
      case 0x01: this.r   = this.acc; this.updateKLine(); break;         // ATR (also latches wakeup, like input_w())
      case 0x02: this.bm |= 4; break;                                    // SBM
      case 0x03: this.bp  = this.acc; break;                             // ATBP
      case 0x08: this.acc = (this.acc + this.ramR()) & 0xf; break;       // ADD (carry untouched)
      case 0x09: {                                                        // ADD11
        this.acc += this.ramR() + this.c;
        this.c = (this.acc >> 4) & 1;
        this.skip = (this.c === 1);
        this.acc &= 0xf;
      } break;
      case 0x0a: this.acc ^= 15; break;                                  // COMA
      case 0x0b: { const t = this.acc; this.acc = this.bl & 15; this.bl = t; } break; // EXBLA

      case 0x50: this.skip = (this.inBA !== 0); break;                   // TAL (right, active LOW)
      case 0x51: this.skip = (this.inB  !== 0); break;                   // TB  (left, active LOW)
      case 0x52: this.skip = (this.c === 0); break;                      // TC
      case 0x53: this.skip = (this.acc === this.ramR()); break;          // TAM
      case 0x58: this.skip = (this.gamma === 0); this.gamma = 0; break;  // TIS
      case 0x59: this.o[8] = this.ox[8]; this.o[7] = this.ox[7]; break;  // PTW (last 2 groups only)
      case 0x5a: this.skip = (this.acc === 0); break;                    // TA0
      case 0x5b: this.skip = (this.acc === (this.bl & 15)); break;       // TABL
      case 0x5c: for (let i = 0; i < 9; i++) { this.o[i] = this.ox[i]; } this._twCount++; break; // TW
      case 0x5d: this.shiftW(); this.ox[8] = this.getDigit(); break;      // DTW

      case 0x5e:                                                          // extended (2-byte prefix)
        this._cendCount++;
        if (this.param === 0x00) this.halt = true;                       // CEND
        else if (this.param === 0x04) this.acc = (this.div >> 11) & 0xf; // DTA
        break;

      case 0x5f: {                                                        // LBL (2-byte)
        this.bl = this.param & 15;
        this.bm = (this.param >> 4) & 7;
      } break;

      case 0x60: this.bp ^= 8; break;                                    // COMCN (CN flag, not display phase)
      case 0x61: this.ox[7] = this.ox[8]; this.ox[8] = this.getDigit(); break; // PDTW
      case 0x62: this.shiftW(); this.ox[8] = this.acc & 7; break;         // WR
      case 0x63: this.shiftW(); this.ox[8] = (this.acc & 7) | 8; break;   // WS
      case 0x64: this.bl = (this.bl + 1) & 15; this.skip = (this.bl === 8); break;         // INCB
      case 0x65: this.div &= 0x3f; break;                                // IDIV
      case 0x66: this.c = 0; break;                                      // RC
      case 0x67: this.c = 1; break;                                      // SC
      case 0x68: this.mx = 0; this.acc = 0; break;                      // RMF
      case 0x69: this.mx = 1; break;                                     // SMF
      case 0x6a: this.acc = this.readInputRows(); break;                 // KTA
      case 0x6b: this.bm &= ~4; break;                                   // RBM
      case 0x6c: this.bl = (this.bl - 1 + 16) & 15; this.skip = (this.bl === 15); break;  // DECB
      case 0x6d: this.cb ^= 1; break;                                    // COMCB
      case 0x6e: this.popStack(); this.rsub = false; break;              // RTN0
      case 0x6f: this.popStack(); this.rsub = false; this.skip = true; break; // RTN1
    }
  }

  // Continuous LCD refresh — real hardware drives this off a free-running ~1kHz
  // timer independent of instruction execution, not on every TW.
  updateLcd() {
    const on = this.bp & 1;
    for (let a = 0; a < 9; a++) {
      this.lcd[(a << 1) | 0] = on ? this.o[a]  : 0;
      this.lcd[(a << 1) | 1] = on ? this.ox[a] : 0;
    }
  }
}

// ─── SM510 CPU ──────────────────────────────────────────────────────────────
// Faithful port of MAME's sm510_device / sm510_base_device
// (src/devices/cpu/sm510/{sm510,sm510base,sm510op}.cpp, license BSD-3-Clause,
// copyright-holders: hap), fetched directly from GitHub as ground truth (not
// present in the local mame/ reference dump, which only carries sm5a/hh_sm510
// driver source). Fire Attack uses SM510 — despite similar-looking opcode
// mnemonics to SM5A, it's architecturally quite different:
//   - 12-bit program counter (SM5A: 11-bit) and a real 2-level hardware call
//     stack (SM5A: 1 level, plain overwrite).
//   - LCD segments are driven DIRECTLY from RAM (addresses 0x60-0x6f and
//     0x70-0x7f are memory-mapped straight to the display, refreshed
//     continuously) rather than SM5A's separate O/OX shift-register-plus-TW-
//     commit scheme. There is no TW-equivalent commit instruction at all.
//   - The K-input row-select mux is output on the S port (via the W shift
//     register + WR/WS, auto-latched to S on every shift — see
//     sm510_device::update_w_latch, "W is connected directly to S") instead
//     of SM5A's R-port-via-ATR.
//   - TM (0xc0-0xff) is an indirect call through a page-0 pointer table in
//     ROM, not SM5A's two-stage TRS/SU mechanism. T (0x80-0xbf) is a plain
//     within-page jump with no SU/CB involved at all.
// this.lcd's indexing ((A<<2)|C, A=segment-group 0/1/2, C=column 0-3) is
// deliberately NOT the same formula as SM5A's ((A<<1)|C) — Fire Attack's own
// SVG title numbering needs C to range 0-3, confirmed by direct inspection
// of gnw_fireatk.svg's title/desc pairs (desc tags like "h4a16" corroborate
// the h/column association). GnwDisplay.update() takes this as game.lcdCBits
// (default 1, matching every existing SM5A title) so the shared renderer
// still works for both without weakening the existing titles' behaviour.
class SM510 {
  constructor(rom) {
    this.rom = rom;
    this.ram = new Uint8Array(128); // 0x00-0x5f general, 0x60-0x6f=lcdA, 0x70-0x7f=lcdB
    // lcd[(A<<2)|C]: A=0 (SEGA, from ram 0x60-0x6f) / 1 (SEGB, from ram
    // 0x70-0x7f) hold a 16-bit "row" value — bit i set when RAM cell i in
    // that bank has its column-C bit set, matching get_lcd_row(). A=2
    // (SEGBS, the blink/cursor output) holds a real 2-bit value per real
    // MAME's own get_lcd_row()-adjacent bs computation in lcd_update()
    // (sm510base.cpp: `bs = ((m_l & ~blink) >> h & 1) | ((m_x*2) >> h & 2)`,
    // written through unmasked) -- bit 0 from L/blink, bit 1 from X. Every
    // title shipped before Pinball only ever used digit-index (B) 0 for A=2
    // titles, which is what led an earlier version of this code to mask the
    // write down to `bs & 1` -- silently dropping bit 1 (B=1) and leaving
    // Pinball's minute-tens digit (traced under A=2/B=1) permanently dark.
    // Fixed by writing the full `bs` value, matching real hardware.
    this.lcd = new Uint16Array(12);
    this.inRows = [0];
    this.inFixedRow = 0;
    this.wakeupLine = false;
    // Fixed, real hardware constant — see SM5A's own clkDiv comment. SM510
    // never changes this at runtime, unlike SM511.
    this.clkDiv = 2;
    this.reset();
  }

  reset() {
    this.acc = 0; this.bl = 0; this.bm = 0; this.bmask = 0;
    this.c = 0; this.skip = false;
    this.op = 0; this.prevOp = 0; this.param = 0;
    this.prevPc = 0;
    this.halt = false;
    this.bp = 1;      // LCD on (device_reset: "lcd is on (Bp on, BC off, bs(y) off)")
    this.bc = false;
    this.l = 0; this.x = 0; this.y = 0;
    this.w = 0;        // shift register, auto-mirrored to S on every WR/WS
    this.sOut = 0;     // S port (input-row mux select) — mirrors this.w
    this.r = 0;        // buzzer register (ATR), raw ROM-written value
    this.rOut = 0;      // actual R pin output (see clockMelody()), distinct from this.r
    this.div = 0; this.gamma = 0;
    this.wakeupLine = false;
    this.ram.fill(0); this.lcd.fill(0);
    this.stack = [0, 0];   // 2 hardware levels
    // reset_vector(): do_branch(3,7,0) => pc = (3<<10)|(7<<6&0x3c0)|0 = 0xdc0
    this.pc = 0xdc0;
    this._twCount = 0; this._cendCount = 0;  // twCount here tracks WR/WS (S-port commits), for parity with the SM5A debug overlay
  }

  ramAddr()   { return (this.bmask | (this.bm << 4) | this.bl) & 0x7f; }
  ramR()      { return this.ram[this.ramAddr()] & 0xf; }
  ramW(v)     { this.ram[this.ramAddr()] = v & 0xf; }
  bit()       { return 1 << (this.op & 3); }

  // Same K/S-mux relationship as SM5A's R-based one, just driven by S
  // (this.sOut, updated by WR/WS below) instead of R.
  readInputRows() {
    if (this.inFixedRow >= 0) return (this.inRows[this.inFixedRow] || 0) & 0xf;
    let v = 0;
    for (let i = 0; i < this.inRows.length; i++) if ((this.sOut >> i) & 1) v |= this.inRows[i];
    return v & 0xf;
  }

  updateKLine() {
    this.wakeupLine = this.readInputRows() !== 0;
  }

  // Mirrors sm510_device::clock_melody() for r_mask_option=2 (confirmed for
  // every SM510 title here via hh_sm510.cpp's "R mask option confirmed"
  // comments on tbridge/fireatk/stennis — not the RMASK_DIRECT passthrough
  // SM5A/SM500 use). The R pins aren't a direct copy of the ATR-written
  // register: real hardware gates a divider-derived oscillator (bit 2 of
  // the divider, inverted on R2) through whichever R bits are set, so the
  // buzzer's actual pitch comes from the divider, not from the ROM toggling
  // R at some rate itself. Called from ATR (this.r changes) and from every
  // divider tick (this.div changes) — same two triggers as real hardware's
  // op_atr() and div_timer_cb().
  clockMelody() {
    let out = (this.div >> 2) & 1;
    out |= (out << 1) ^ 2;
    this.rOut = out & this.r;
  }

  doBranch(pu, pm, pl) { this.pc = ((pu << 10) | ((pm << 6) & 0x3c0) | (pl & 0x3f)) & 0xfff; }
  pushStack() { this.stack[1] = this.stack[0]; this.stack[0] = this.pc; }
  popStack()  { this.pc = this.stack[0]; this.stack[0] = this.stack[1]; }

  // Same 6-bit Fibonacci LFSR formula as SM5A (m_pagemask=0x3f regardless of
  // program width — confirmed in sm510base.cpp's device_start, hardcoded the
  // same for every family member), just masked to 12 bits instead of 11.
  incrementPc() {
    const pagemask = 0x3f, msb = (pagemask >> 1) ^ pagemask;
    const feed = (((this.pc >> 1) ^ this.pc) & 1) ? 0 : msb;
    this.pc = (feed | ((this.pc >> 1) & (pagemask >> 1)) | (this.pc & ~pagemask)) & 0xfff;
  }

  // W is shifted and, per sm510_device::update_w_latch, mirrored straight to
  // S on every single shift — there's no separate "commit" instruction like
  // SM5A's TW/PTW.
  // W is EIGHT bits, not four -- it drives S1..S8, and a ROM can strobe all
  // eight. MAME: `u8 m_w` with `m_w = m_w << 1 | bit` and no mask at all
  // (sm510op.cpp op_wr/op_ws), then `m_write_s(m_w)` (sm510.h's
  // update_w_latch). This was `& 0xf` for a long time and it never showed,
  // because every title on the site until now reads at most 4 input rows and
  // readInputRows() only ever tests bits below inRows.length -- the high
  // nibble was shifted out and nothing missed it. The Micro Vs. System
  // titles are the first here that scan further (Time/Game/Alarm sit on S7),
  // so with a 4-bit W their mode buttons were unreachable: the K line never
  // went high, the ROM never saw Time, and its clock never started.
  shiftW(bit) { this.w = ((this.w << 1) | bit) & 0xff; this.sOut = this.w; this._twCount++; }

  step() {
    if (this.halt) {
      this.div = (this.div + 2) & 0x7fff;
      if (this.div === 0) this.gamma = 1;
      this.clockMelody();  // real hardware's divider free-runs during CEND sleep, so the buzzer keeps ticking too
      // See the SM5A step()'s halt-handling comment for why wakeupLine is a
      // latch (updateKLine()) rather than a live per-cycle read — the same
      // reasoning applies here.
      if (this.gamma || this.wakeupLine) {
        this.halt = false;
        this.doBranch(1, 0, 0);  // wakeup_vector(): do_branch(1,0,0)
        // fall through to fetch/execute on this same step() call, matching
        // MAME's execute_run() (see the SM5A step() comment for why).
      } else {
        return;
      }
    }

    this.prevOp = this.op;
    this.prevPc = this.pc;   // needed by ATPL, which addresses off the PC *before* this instruction's own fetch
    this.op = this.rom[this.pc] & 0xff;
    this.incrementPc();

    this.div = (this.div + 2) & 0x7fff;
    if (this.div === 0) this.gamma = 1;
    this.clockMelody();

    this.param = 0;
    // op_argument(): LBL(0x5f) or TL/TML (op&0xf0===0x70, i.e. 0x70/0x74/0x78/0x7c)
    if (this.op === 0x5f || (this.op & 0xf0) === 0x70) {
      this.param = this.rom[this.pc] & 0xff;
      this.incrementPc();
    }

    if (this.skip) { this.skip = false; this.op = 0; return; }
    this.exec();
  }

  exec() {
    const op = this.op;
    const wasSbm = (op === 0x02);

    // ── TM (indirect call via page-0 pointer table) ───────────
    if (op >= 0xc0) {
      this.pushStack();
      const idx = this.rom[op & 0x3f] & 0xff;
      this.doBranch((idx >> 6) & 3, 4, idx & 0x3f);
      this.bmask = 0; return;
    }
    // ── T (plain within-page jump) ─────────────────────────────
    if (op >= 0x80) {
      this.pc = (this.pc & ~0x3f) | (op & 0x3f);
      this.bmask = 0; return;
    }
    // ── LB ────────────────────────────────────────────────────
    if ((op & 0xf0) === 0x40) {
      this.bm = (this.bm & 4) | (op & 3);
      this.bl = ((op >> 2) & 3) | ((op & 0xc) ? 0xc : 0);
      this.bmask = 0; return;
    }
    // ── ADX (carry untouched) ─────────────────────────────────
    if ((op & 0xf0) === 0x30) {
      const imm = op & 0xf;
      this.acc += imm;
      this.skip = (imm !== 10) && ((this.acc & 0x10) !== 0);
      this.acc &= 0xf;
      this.bmask = 0; return;
    }
    // ── LAX ───────────────────────────────────────────────────
    if ((op & 0xf0) === 0x20) {
      if ((op & 0xf0) !== (this.prevOp & 0xf0)) this.acc = op & 0xf;
      this.bmask = 0; return;
    }

    const grp = op & 0xfc;
    switch (grp) {
      case 0x04: this.ramW(this.ramR() & ~this.bit()); this.bmask = wasSbm ? 0x40 : 0; return; // RM
      case 0x0c: this.ramW(this.ramR() |  this.bit()); this.bmask = wasSbm ? 0x40 : 0; return; // SM
      case 0x10: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bmask = wasSbm ? 0x40 : 0; return; } // EXC
      case 0x14: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bl = (this.bl + 1) & 0xf; this.skip = (this.bl === 0); this.bmask = wasSbm ? 0x40 : 0; return; } // EXCI
      case 0x18: this.acc = this.ramR(); this.bm ^= op & 3; this.bmask = wasSbm ? 0x40 : 0; return; // LDA
      case 0x1c: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bl = (this.bl - 1 + 16) & 0xf; this.skip = (this.bl === 15); this.bmask = wasSbm ? 0x40 : 0; return; } // EXCD
      case 0x54: this.skip = (this.ramR() & this.bit()) !== 0; this.bmask = wasSbm ? 0x40 : 0; return; // TMI
      case 0x70: case 0x74: case 0x78: // TL
        this.doBranch((this.param >> 6) & 3, op & 0xf, this.param & 0x3f);
        this.bmask = 0; return;
      case 0x7c: // TML
        this.pushStack();
        this.doBranch((this.param >> 6) & 3, op & 3, this.param & 0x3f);
        this.bmask = 0; return;
    }

    switch (op) {
      case 0x00: break;                                                  // SKIP/NOP
      case 0x01: this.bp = this.acc; break;                              // ATBP
      case 0x02: break;                                                  // SBM (bmask set below, one-shot)
      case 0x03: this.pc = (this.prevPc & ~0xf) | this.acc; break;       // ATPL
      case 0x08: this.acc = (this.acc + this.ramR()) & 0xf; break;       // ADD
      case 0x09: {                                                        // ADD11
        this.acc += this.ramR() + this.c;
        this.c = (this.acc >> 4) & 1;
        this.skip = (this.c === 1);
        this.acc &= 0xf;
      } break;
      case 0x0a: this.acc ^= 0xf; break;                                 // COMA
      case 0x0b: { const t = this.acc; this.acc = this.bl & 0xf; this.bl = t; } break; // EXBLA

      // TB/TAL test the B/BA input pins, which real hardware pulls up (=1)
      // when unconnected — Fire Attack has no dedicated hammer-style B/BA
      // wiring (confirmed against the driver's port list: only S1/S2 K-rows
      // plus ACL/cheat configs), so these always skip, matching the pins'
      // default pulled-up state.
      case 0x51: this.skip = true; break;                                // TB
      case 0x5e: this.skip = true; break;                                // TAL
      case 0x52: this.skip = (this.c === 0); break;                      // TC
      case 0x53: this.skip = (this.acc === this.ramR()); break;          // TAM
      case 0x58: this.skip = (this.gamma === 0); this.gamma = 0; break;  // TIS
      case 0x59: this.l = this.acc; break;                               // ATL
      case 0x5a: this.skip = (this.acc === 0); break;                    // TA0
      case 0x5b: this.skip = (this.acc === (this.bl & 0xf)); break;      // TABL
      case 0x5d: this.halt = true; this._cendCount++; break;             // CEND
      case 0x5f: this.bl = this.param & 0xf; this.bm = (this.param >> 4) & 0x7; break; // LBL

      case 0x60: this.y = this.acc; break;                               // ATFC
      case 0x61: this.r = this.acc; this.clockMelody(); break;           // ATR
      case 0x62: this.shiftW(0); break;                                  // WR
      case 0x63: this.shiftW(1); break;                                  // WS
      case 0x64: this.bl = (this.bl + 1) & 0xf; this.skip = (this.bl === 0); break;  // INCB
      case 0x65: this.div = 0; break;                                    // IDIV
      case 0x66: this.c = 0; break;                                      // RC
      case 0x67: this.c = 1; break;                                      // SC
      case 0x68: this.skip = (this.div & 0x4000) !== 0; break;           // TF1
      case 0x69: this.skip = (this.div & 0x0800) !== 0; break;           // TF4
      case 0x6a: this.acc = this.readInputRows(); break;                 // KTA
      case 0x6b: {                                                        // ROT
        const c = this.acc & 1;
        this.acc = (this.acc >> 1) | (this.c << 3);
        this.c = c;
      } break;
      case 0x6c: this.bl = (this.bl - 1 + 16) & 0xf; this.skip = (this.bl === 0xf); break; // DECB
      case 0x6d: this.bc = (this.c !== 0); break;                        // BDC
      case 0x6e: this.popStack(); break;                                 // RTN0
      case 0x6f: this.popStack(); this.skip = true; break;               // RTN1
    }

    this.bmask = wasSbm ? 0x40 : 0;
  }

  // Continuous LCD refresh — real hardware drives this off a free-running
  // timer independent of instruction execution (init_lcd_driver()), not tied
  // to any particular opcode (SM510 has no TW-equivalent at all).
  updateLcd() {
    const on = !this.bc && (this.bp & 1);
    for (let h = 0; h < 4; h++) {
      let rowA = 0, rowB = 0;
      if (on) {
        for (let i = 0; i < 16; i++) {
          if ((this.ram[0x60 + i] >> h) & 1) rowA |= 1 << i;
          if ((this.ram[0x70 + i] >> h) & 1) rowB |= 1 << i;
        }
      }
      this.lcd[(0 << 2) | h] = rowA;
      this.lcd[(1 << 2) | h] = rowB;
      const blink = (this.div & 0x4000) ? this.y : 0;
      const bs = ((this.l & ~blink) >> h & 1) | (((this.x * 2) >> h) & 2);
      this.lcd[(2 << 2) | h] = on ? bs : 0;
    }
  }
}


// Real sm511_device::clock_melody()'s tone-length lookup table (SM511/
// SM512 datasheet fig.5) -- cmd 0=rest, 1=stop, >13=illegal/inactive.
const SM511_TONE_CYCLES = new Uint8Array([
  0, 0, 7, 8, 8, 9, 9, 10,11,11,12,13,14,14, 0, 0,
  0, 0, 8, 8, 9, 9, 10,11,11,12,13,13,14,15, 0, 0,
  0, 0, 8, 8, 9, 9, 10,10,11,12,12,13,14,15, 0, 0,
  0, 0, 8, 9, 9, 10,10,11,11,12,13,14,14,15, 0, 0,
]);

// Sharp SM511 -- a genuinely different CPU family member from SM510, not a
// variant (sm511_device : public sm510_base_device directly, a sibling of
// sm510_device, not a subclass of it -- confirmed in real MAME source,
// src/devices/cpu/sm510/sm511.h/.cpp). Shares SM510's RAM layout, LCD
// model, reset vector, and stack depth (all defined once in the shared
// sm510_base_device/sm510op.cpp and inherited unchanged), but has its own
// completely rearranged opcode dispatch, a real melody-ROM-driven audio
// engine in place of SM510's ATR+divider buzzer (no ATR opcode is even
// reachable here), a program ROM that's a genuine contiguous 4K address
// space (SM510's is a sparse-mapped 2.7K with gaps -- see program_2_7k vs
// program_4k in real MAME source), ROT relocated to the NOP slot (0x00),
// TML relocated from SM510's 0x7C-0x7F to 0x68-0x6B (freeing all of
// 0x70-0x7F for TL), and several opcodes (ATFC/BDC/ATBP/CLKHI/CLKLO/RME/
// SME/TMEL) moved behind a new 2-byte 0x60-prefix rather than being direct
// single-byte ops. Ported directly from real MAME source (sm511.cpp/h,
// sm510base.cpp/h, sm510op.cpp), not adapted by assumption from the
// working SM510 class -- see this project's own EXCI bug history for why
// "looks like a sibling chip" isn't good enough justification on its own.
class SM511 {
  constructor(rom, melodyRom) {
    this.rom = rom;
    // Separate 256-byte ROM region (real hardware: "maincpu:melody"),
    // entirely distinct address space from the main program ROM -- null
    // for any SM511 title with no melody hardware populated.
    this.melodyRom = melodyRom || null;
    // Same 0x00-0x5f general / 0x60-0x6f=lcdA / 0x70-0x7f=lcdB layout as
    // SM510 -- sm511_device::data_96_32x4() is byte-for-byte identical to
    // sm510_device::data_96_32x4() in real MAME source.
    this.ram = new Uint8Array(128);
    // Same lcd[(A<<2)|C] scheme as SM510 (A=0 SEGA/1 SEGB/2 SEGBS) -- SEGC
    // (A=3) is architecturally absent on SM511 (only SM512's extra
    // lcd_ram_c populates it), so no title's SVG here ever references it.
    this.lcd = new Uint16Array(12);
    this.inRows = [0];
    this.inFixedRow = 0;
    this.wakeupLine = false;
    // Starts at 4 ("8kHz"), not SM510's fixed 2 ("16kHz") -- confirmed via
    // sm511_device::device_reset() explicitly setting m_clk_div=4. Mutable
    // at runtime via this chip's own CLKHI(->2)/CLKLO(->4) opcodes (see
    // exec()'s 0x60-prefix cases 0x36/0x37) -- unlike every other chip on
    // this site, SM511's instruction rate genuinely isn't fixed for the
    // title's lifetime.
    this.clkDiv = 4;
    // Melody controller state -- entirely new vs SM510, which drives its R
    // pin from a fixed divider-gated oscillator instead (SM510.clockMelody()).
    // SM511's R pin comes from ROM-scripted melody playback; there's no ATR
    // opcode reachable anywhere in its exec() dispatch.
    this.melodyRd = 0;         // bit0: enable (set/cleared by SME/RME), bit1: stop flag (set by clockMelody() on cmd=1, tested/cleared by TMEL)
    this.melodyStepCount = 0;
    this.melodyDutyCount = 0;
    this.melodyDutyIndex = 0;
    this.melodyAddress = 0;
    this.reset();
  }

  reset() {
    this.acc = 0; this.bl = 0; this.bm = 0; this.bmask = 0;
    this.c = 0; this.skip = false;
    this.op = 0; this.prevOp = 0; this.param = 0;
    this.prevPc = 0;
    this.halt = false;
    this.bp = 1;      // LCD on
    this.bc = false;
    this.l = 0; this.x = 0; this.y = 0;
    this.w = 0;         // shift register -- NOT auto-mirrored to S here (see PTW; SM511 doesn't override update_w_latch() the way SM510 does)
    this.sOut = 0;      // S port (input-row mux select) -- only updated by an explicit PTW
    this.r = 0;
    this.rOut = 0;
    this.div = 0; this.gamma = 0;
    this.wakeupLine = false;
    this.ram.fill(0); this.lcd.fill(0);
    this.stack = [0, 0];   // 2 hardware levels, same as SM510
    this.pc = 0xdc0;     // reset_vector(): do_branch(3,7,0) -- unchanged from SM510, sm511.cpp doesn't override it
    this.clkDiv = 4;      // sm511_device::device_reset() resets to 8kHz every ACL, even if CLKHI was left active before
    this.melodyRd &= ~1;   // device_reset(): "m_melody_rd &= ~1" -- clears enable, leaves the stop flag (bit1) alone
    this._twCount = 0; this._cendCount = 0;
  }

  ramAddr()   { return (this.bmask | (this.bm << 4) | this.bl) & 0x7f; }
  ramR()      { return this.ram[this.ramAddr()] & 0xf; }
  ramW(v)     { this.ram[this.ramAddr()] = v & 0xf; }
  bit()       { return 1 << (this.op & 3); }

  // Same K/S-mux relationship as SM510's -- gated by this.sOut, which for
  // this chip only changes on an explicit PTW (see exec()).
  readInputRows() {
    if (this.inFixedRow >= 0) return (this.inRows[this.inFixedRow] || 0) & 0xf;
    let v = 0;
    for (let i = 0; i < this.inRows.length; i++) if ((this.sOut >> i) & 1) v |= this.inRows[i];
    return v & 0xf;
  }

  updateKLine() {
    this.wakeupLine = this.readInputRows() !== 0;
  }

  // Mirrors sm511_device::clock_melody() -- a real ROM-scripted tone
  // player, structurally nothing like SM510's fixed divider-gated
  // oscillator. cmd is a 6-bit byte read from the melody ROM at
  // melodyAddress; its low nibble (2-13) selects a tone-length lookup from
  // SM511_TONE_CYCLES (duty toggles at a ROM-defined rate), bit5 selects
  // octave, cmd&0xf===1 sets the stop flag instead of playing a tone. The
  // melody only advances one ROM step every 128 divider ticks (melody_step_
  // mask()=0x7f, unused by SM511/SM512 so left at the real base-class
  // default) -- see the div-increment comment in step() for why checking
  // "(div & 0x7f) === 0" once per step(), with div advanced by clkDiv each
  // time, is exact and not an approximation. No-op if this title has no
  // melody ROM (matches "if (!m_melody_rom) return;").
  clockMelody() {
    if (!this.melodyRom) return;
    const cmd = this.melodyRom[this.melodyAddress & 0xff] & 0x3f;
    let out = 0;

    if ((cmd & 0xf) >= 2 && (cmd & 0xf) <= 13) {
      out = this.melodyDutyIndex & this.melodyRd & 1;
      this.melodyDutyCount++;
      const index = (this.melodyDutyIndex << 4) | (cmd & 0xf);
      const shift = (~cmd >> 4) & 1;
      if (this.melodyDutyCount >= (SM511_TONE_CYCLES[index] << shift)) {
        this.melodyDutyCount = 0;
        this.melodyDutyIndex = (this.melodyDutyIndex + 1) & 3;
      }
    } else if ((cmd & 0xf) === 1) {
      this.melodyRd |= 2;   // stop flag
    }

    if ((this.div & 0x7f) === 0) {
      const mask = (cmd & 0x20) ? 0x1f : 0x0f;
      this.melodyStepCount = (this.melodyStepCount + 1) & mask;
      if (this.melodyStepCount === 0) this.melodyAddress = (this.melodyAddress + 1) & 0xff;
    }

    this.rOut = out;
  }

  doBranch(pu, pm, pl) { this.pc = ((pu << 10) | ((pm << 6) & 0x3c0) | (pl & 0x3f)) & 0xfff; }
  pushStack() { this.stack[1] = this.stack[0]; this.stack[0] = this.pc; }
  popStack()  { this.pc = this.stack[0]; this.stack[0] = this.stack[1]; }

  // Same 6-bit Fibonacci LFSR formula as SM510/SM5A -- m_pagemask=0x3f
  // regardless of program width, confirmed unchanged for this family
  // member (sm510base.cpp's device_start() sets it once for every chip).
  incrementPc() {
    const pagemask = 0x3f, msb = (pagemask >> 1) ^ pagemask;
    const feed = (((this.pc >> 1) ^ this.pc) & 1) ? 0 : msb;
    this.pc = (feed | ((this.pc >> 1) & (pagemask >> 1)) | (this.pc & ~pagemask)) & 0xfff;
  }

  step() {
    if (this.halt) {
      // Real hardware's divider timer free-runs at the full, un-divided
      // 32768Hz crystal rate regardless of clk_div -- advancing it by
      // clkDiv per step() call (rather than a fixed amount) is what keeps
      // that true even while this chip is mid-CLKHI/CLKLO switch. See the
      // identical reasoning in the non-halted path below.
      //
      // Real MAME (sm510base.cpp div_timer_cb) increments m_div by
      // exactly 1 per raw crystal tick, on a genuinely separate hardware
      // timer decoupled from instruction execution, and fires gamma on
      // `m_div == 0`. Batching that into "+= clkDiv once per step()" (an
      // otherwise-safe speed optimization, since it's numerically the
      // same total distance travelled) broke that exact-zero check: once
      // clkDiv had changed mid-run (a real CLKHI/CLKLO title, confirmed
      // live on Pinball PB-59, the first title found doing this), div's
      // phase relative to a multiple-of-clkDiv can drift, so a later
      // wraparound lands a few ticks PAST zero (e.g. 32764 -> 4, or
      // 32766 -> 2) instead of exactly on it -- confirmed via direct
      // instrumentation, four clean ~1s gamma wakeups then a permanent
      // stuck CEND-halt once the phase drifted. Real hardware's own
      // per-tick counter can never skip over zero this way, so this is a
      // genuine gap in the batching optimization, not a hardware quirk to
      // replicate. Fixed by detecting the wraparound itself (the new
      // value coming back lower than the old one) instead of requiring
      // landing exactly on zero -- phase-independent, and identical to
      // the old check on every input that used to work.
      const prevDiv = this.div;
      this.div = (this.div + this.clkDiv) & 0x7fff;
      if (this.div < prevDiv) this.gamma = 1;
      this.clockMelody();  // real hardware's divider (and therefore the melody engine) keeps running during CEND sleep
      if (this.gamma || this.wakeupLine) {
        this.halt = false;
        this.doBranch(1, 0, 0);
      } else {
        return;
      }
    }

    this.prevOp = this.op;
    this.prevPc = this.pc;
    this.op = this.rom[this.pc] & 0xff;
    this.incrementPc();

    // See the comment above -- div (and the melody engine riding on it)
    // advances by however many real crystal ticks this one instruction
    // actually took, not a fixed amount, since this chip's clk_div isn't
    // fixed for its whole lifetime the way every other chip here is.
    // Wraparound-detected, not equality-with-zero -- see the halted
    // path's own comment above for why.
    {
      const prevDiv = this.div;
      this.div = (this.div + this.clkDiv) & 0x7fff;
      if (this.div < prevDiv) this.gamma = 1;
    }
    this.clockMelody();

    this.param = 0;
    // op_argument(): LBL(0x5f)/extended-prefix(0x60)/PRE(0x61), TL (any of
    // 0x70-0x7f), or TML (0x68-0x6b) -- see the class comment for how this
    // differs from SM510's much narrower 2-byte set.
    if ((this.op >= 0x5f && this.op <= 0x61) || (this.op & 0xf0) === 0x70 || (this.op & 0xfc) === 0x68) {
      this.param = this.rom[this.pc] & 0xff;
      this.incrementPc();
    }

    if (this.skip) { this.skip = false; this.op = 0; return; }
    this.exec();
  }

  exec() {
    const op = this.op;
    const wasSbm = (op === 0x02);

    // ── TM (indirect call via page-0 pointer table) ─── 0xc0-0xff, same formula as SM510
    if (op >= 0xc0) {
      this.pushStack();
      const idx = this.rom[op & 0x3f] & 0xff;
      this.doBranch((idx >> 6) & 3, 4, idx & 0x3f);
      this.bmask = 0; return;
    }
    // ── T (plain within-page jump) ─── 0x80-0xbf, same as SM510
    if (op >= 0x80) {
      this.pc = (this.pc & ~0x3f) | (op & 0x3f);
      this.bmask = 0; return;
    }
    // ── TL (long jump) ─── ALL of 0x70-0x7f on this chip, not just
    // 0x70/0x74/0x78 like SM510 -- op&0xf supplies the full page-mid field
    // the same way, TML (below) claims 0x68-0x6b instead of overlapping here.
    if ((op & 0xf0) === 0x70) {
      this.doBranch((this.param >> 6) & 3, op & 0xf, this.param & 0x3f);
      this.bmask = 0; return;
    }
    // ── LB ────────────────────────────────────────────
    if ((op & 0xf0) === 0x40) {
      this.bm = (this.bm & 4) | (op & 3);
      this.bl = ((op >> 2) & 3) | ((op & 0xc) ? 0xc : 0);
      this.bmask = 0; return;
    }
    // ── ADX (carry untouched) ──────────────────────────
    if ((op & 0xf0) === 0x30) {
      const imm = op & 0xf;
      this.acc += imm;
      this.skip = (imm !== 10) && ((this.acc & 0x10) !== 0);
      this.acc &= 0xf;
      this.bmask = 0; return;
    }
    // ── LAX ─────────────────────────────────────────────
    if ((op & 0xf0) === 0x20) {
      if ((op & 0xf0) !== (this.prevOp & 0xf0)) this.acc = op & 0xf;
      this.bmask = 0; return;
    }

    const grp = op & 0xfc;
    switch (grp) {
      case 0x04: this.ramW(this.ramR() & ~this.bit()); this.bmask = wasSbm ? 0x40 : 0; return; // RM
      case 0x0c: this.ramW(this.ramR() |  this.bit()); this.bmask = wasSbm ? 0x40 : 0; return; // SM
      case 0x10: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bmask = wasSbm ? 0x40 : 0; return; } // EXC
      case 0x14: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bl = (this.bl + 1) & 0xf; this.skip = (this.bl === 0); this.bmask = wasSbm ? 0x40 : 0; return; } // EXCI
      case 0x18: this.acc = this.ramR(); this.bm ^= op & 3; this.bmask = wasSbm ? 0x40 : 0; return; // LDA
      case 0x1c: { const t = this.acc; this.acc = this.ramR(); this.ramW(t); this.bm ^= op & 3; this.bl = (this.bl - 1 + 16) & 0xf; this.skip = (this.bl === 15); this.bmask = wasSbm ? 0x40 : 0; return; } // EXCD
      case 0x54: this.skip = (this.ramR() & this.bit()) !== 0; this.bmask = wasSbm ? 0x40 : 0; return; // TMI
      case 0x68: // TML -- relocated from SM510's 0x7C-0x7F to 0x68-0x6B, same push+branch formula (op&3 supplies part of the destination page)
        this.pushStack();
        this.doBranch((this.param >> 6) & 3, op & 3, this.param & 0x3f);
        this.bmask = 0; return;
    }

    switch (op) {
      case 0x00: {                                                        // ROT -- relocated from SM510's 0x6B to the NOP slot
        const c = this.acc & 1;
        this.acc = (this.acc >> 1) | (this.c << 3);
        this.c = c;
      } break;
      case 0x01: this.acc = (this.div >> 11) & 0xf; break;                // DTA -- new, no SM510 equivalent
      case 0x02: break;                                                   // SBM (bmask set below, one-shot)
      case 0x03: this.pc = (this.prevPc & ~0xf) | this.acc; break;        // ATPL
      case 0x08: this.acc = (this.acc + this.ramR()) & 0xf; break;        // ADD
      case 0x09: {                                                         // ADD11
        this.acc += this.ramR() + this.c;
        this.c = (this.acc >> 4) & 1;
        this.skip = (this.c === 1);
        this.acc &= 0xf;
      } break;
      case 0x0a: this.acc ^= 0xf; break;                                  // COMA
      case 0x0b: { const t = this.acc; this.acc = this.bl & 0xf; this.bl = t; } break; // EXBLA

      case 0x50: this.acc = this.readInputRows(); break;                  // KTA -- relocated from SM510's 0x6A
      // TB/TAL test the B/BA input pins, pulled up (=1) when unconnected --
      // confirmed no title implemented here wires dedicated B/BA hammer
      // pins (driver port list has only S-gated K-rows), so these always
      // skip, matching the pins' default pulled-up state -- same reasoning
      // as SM510's own TB/TAL handling.
      case 0x51: this.skip = true; break;                                 // TB
      case 0x52: this.skip = (this.c === 0); break;                       // TC
      case 0x53: this.skip = (this.acc === this.ramR()); break;           // TAM
      case 0x58: this.skip = (this.gamma === 0); this.gamma = 0; break;   // TIS
      case 0x59: this.l = this.acc; break;                                // ATL
      case 0x5a: this.skip = (this.acc === 0); break;                     // TA0
      case 0x5b: this.skip = (this.acc === (this.bl & 0xf)); break;       // TABL
      case 0x5c: this.x = this.acc; break;                                // ATX -- new, no SM510 equivalent
      case 0x5d: this.halt = true; this._cendCount++; break;              // CEND
      case 0x5e: this.skip = true; break;                                 // TAL
      case 0x5f: this.bl = this.param & 0xf; this.bm = (this.param >> 4) & 0x7; break; // LBL

      case 0x61: this.melodyAddress = this.param & 0xff; this.melodyStepCount = 0; break; // PRE -- melody ROM pointer preset
      // 8-bit W (S1..S8), same as SM510's shiftW -- see its comment for why
      // the old 4-bit mask went unnoticed until the Micro Vs. titles.
      case 0x62: this.w = ((this.w << 1) | 0) & 0xff; this._twCount++; break; // WR -- NOT auto-mirrored to S (see PTW below)
      case 0x63: this.w = ((this.w << 1) | 1) & 0xff; this._twCount++; break; // WS
      case 0x64: this.bl = (this.bl + 1) & 0xf; this.skip = (this.bl === 0); break; // INCB
      case 0x65: this.div = 0; break;                                     // IDIV
      case 0x66: this.c = 0; break;                                       // RC
      case 0x67: this.c = 1; break;                                       // SC
      case 0x6c: this.bl = (this.bl - 1 + 16) & 0xf; this.skip = (this.bl === 0xf); break; // DECB
      case 0x6d: this.sOut = this.w; break;                               // PTW -- the ONLY thing that actually commits W to the S port on this chip
      case 0x6e: this.popStack(); break;                                  // RTN0
      case 0x6f: this.popStack(); this.skip = true; break;                // RTN1

      // Extended 2-byte opcodes -- this chip moves several formerly-direct
      // SM510 single-byte ops behind a 0x60 prefix byte, dispatched on the
      // second byte (this.param) instead.
      case 0x60:
        switch (this.param) {
          case 0x30: this.melodyRd &= ~1; break;                          // RME
          case 0x31: this.melodyRd |= 1; break;                           // SME
          case 0x32: this.skip = (this.melodyRd & 2) !== 0; this.melodyRd &= ~2; break; // TMEL
          case 0x33: this.y = this.acc; break;                            // ATFC
          case 0x34: this.bc = (this.c !== 0); break;                     // BDC
          case 0x35: this.bp = this.acc; break;                           // ATBP
          case 0x36: this.clkDiv = 2; break;                              // CLKHI -- 16kHz
          case 0x37: this.clkDiv = 4; break;                              // CLKLO -- 8kHz
          // default: illegal/undocumented -- no-op, matches real hardware's op_illegal() (logerror-only, no state change)
        }
        break;
    }

    this.bmask = wasSbm ? 0x40 : 0;
  }

  // Identical to SM510's updateLcd() -- sm511.cpp doesn't override
  // lcd_update() at all, so this chip's display model is byte-for-byte the
  // same continuous-RAM-read scheme (see SM510.updateLcd()'s own comment
  // for the full explanation).
  updateLcd() {
    const on = !this.bc && (this.bp & 1);
    for (let h = 0; h < 4; h++) {
      let rowA = 0, rowB = 0;
      if (on) {
        for (let i = 0; i < 16; i++) {
          if ((this.ram[0x60 + i] >> h) & 1) rowA |= 1 << i;
          if ((this.ram[0x70 + i] >> h) & 1) rowB |= 1 << i;
        }
      }
      this.lcd[(0 << 2) | h] = rowA;
      this.lcd[(1 << 2) | h] = rowB;
      const blink = (this.div & 0x4000) ? this.y : 0;
      const bs = ((this.l & ~blink) >> h & 1) | (((this.x * 2) >> h) & 2);
      this.lcd[(2 << 2) | h] = on ? bs : 0;
    }
  }
}

// Sharp SM512 -- confirmed via real MAME source (sm511.h/.cpp) to be a
// genuine subclass of SM511 (`class sm512_device : public sm511_device`),
// not just "another sibling chip that looks similar" (the EXCI-bug lesson
// this project keeps citing before assuming a shared implementation) --
// the two share every opcode, the melody engine, reset vector, and stack
// depth verbatim; the ONLY override anywhere in sm511.cpp/h is the data
// memory map (`data_80_48x4` vs SM511's `data_96_32x4`), which shrinks
// general-purpose RAM from 0x00-0x5f down to 0x00-0x4f to make room for a
// third real LCD RAM region (`lcd_ram_c`, 0x50-0x5f) alongside the
// existing lcd_ram_a (0x60-0x6f)/lcd_ram_b (0x70-0x7f). That third region
// isn't the synthetic blink-driven SEGBS group SM510/SM511 already expose
// at A=2 -- it's confirmed via sm510_base_device::lcd_update() itself
// (shared by every chip in this family, SM510 through SM512) to be a
// genuine fourth RAM-driven row, SEGC, sitting at port index 0x0c -- SM511
// already calls into this exact same base lcd_update() every frame, it's
// just always a no-op there since `m_lcd_ram_c` is a null optional_shared_
// ptr for any chip whose own memory map (like SM511's) never declares that
// share. Implemented here as a real `extends SM511` (not a copy-pasted
// duplicate class) precisely because this is the one case in this
// project's whole CPU lineup where the real hardware C++ class hierarchy
// itself confirms the subclassing relationship, rather than two
// independently-designed sibling chips that merely resemble each other.
class SM512 extends SM511 {
  constructor(rom, melodyRom) {
    super(rom, melodyRom);
    // Widened from SM511's 12 (3 groups x 4 columns) to 16 (4 groups x 4
    // columns) for the new SEGC row -- GnwDisplay's own (A<<cBits)|C
    // indexing already supports cBits=2 (A 0-3) unchanged, this is the
    // only CPU-side size that needs to grow. super()'s own constructor
    // already ran reset() once against the old 12-length array; replacing
    // it here (post-super) and re-zeroing is cheap and keeps every later
    // reset() (a real ACL press) working unchanged against the correct size.
    this.lcd = new Uint16Array(16);
  }

  // Same SEGA/SEGB/SEGBS rows as SM511's own updateLcd() (see its comment
  // for the full explanation of that shared base-class scheme), plus the
  // new SEGC row read directly from ram[0x50+i] exactly like SEGA/SEGB
  // read from ram[0x60+i]/ram[0x70+i] -- confirmed against the real
  // sm510_base_device::lcd_update()'s own `get_lcd_row(h, m_lcd_ram_c)`
  // call, which is architecturally identical to its SEGA/SEGB calls, not
  // a special case.
  updateLcd() {
    const on = !this.bc && (this.bp & 1);
    for (let h = 0; h < 4; h++) {
      let rowA = 0, rowB = 0, rowC = 0;
      if (on) {
        for (let i = 0; i < 16; i++) {
          if ((this.ram[0x60 + i] >> h) & 1) rowA |= 1 << i;
          if ((this.ram[0x70 + i] >> h) & 1) rowB |= 1 << i;
          if ((this.ram[0x50 + i] >> h) & 1) rowC |= 1 << i;
        }
      }
      this.lcd[(0 << 2) | h] = rowA;
      this.lcd[(1 << 2) | h] = rowB;
      const blink = (this.div & 0x4000) ? this.y : 0;
      const bs = ((this.l & ~blink) >> h & 1) | (((this.x * 2) >> h) & 2);
      this.lcd[(2 << 2) | h] = on ? bs : 0;
      this.lcd[(3 << 2) | h] = rowC;
    }
  }
}

// ─── Diagnostic log ─────────────────────────────────────────────────────────
// Records every segment on/off transition (and any unusually slow frame, a
// likely cause of transient glitches) with a millisecond timestamp, so an
// intermittent flicker can be captured and inspected after the fact instead
// of guessed at. Ring-buffered so it's safe to leave running indefinitely.

const SEG_LOG_MAX = 20000;
const _gnwLog = [];
function _gnwLogPush(entry) {
  _gnwLog.push(entry);
  if (_gnwLog.length > SEG_LOG_MAX) _gnwLog.splice(0, _gnwLog.length - 15000);
}

// Press L during play, or call from the console: window.gnwDumpLog(15) for
// the last 15 seconds (omit for the whole buffer). Flags any segment whose
// ON pulse lasted under ~2 frames as a likely flicker, and marks any frame
// that had to run an unusually large instruction burst to catch up.
window.gnwDumpLog = function (lastSeconds) {
  const now = performance.now();
  const cutoff = lastSeconds ? now - lastSeconds * 1000 : 0;
  const entries = _gnwLog.filter(e => e.t >= cutoff);
  const lastOnAt = new Map();
  const lines = entries.map(e => {
    if (e.type === 'frame') {
      return e.t.toFixed(1) + 'ms  [frame stutter] dt=' + e.dt.toFixed(1) + 'ms cycles=' + e.cycles;
    }
    let flag = '';
    if (e.on) {
      lastOnAt.set(e.id, e.t);
    } else {
      const onAt = lastOnAt.get(e.id);
      if (onAt !== undefined && (e.t - onAt) < 34) flag = '  <-- SHORT-LIVED (' + (e.t - onAt).toFixed(1) + 'ms)';
      lastOnAt.delete(e.id);
    }
    return e.t.toFixed(1) + 'ms  ' + e.id + '  ' + (e.on ? 'ON ' : 'OFF') + flag;
  });
  const text = '[gnw] diagnostic log (' + entries.length + ' events):\n' + lines.join('\n');
  console.log(text);
  try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) {}
  _gnwShowLogOverlay(text);
  return text;
};

// Shows the dump directly on the page — console.log alone isn't reliable here,
// since most browsers don't retroactively display log calls made before
// DevTools was opened. This works regardless of whether DevTools is open.
function _gnwShowLogOverlay(text) {
  let box = document.getElementById('gnw-log-overlay');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gnw-log-overlay';
    box.style.cssText =
      'position:fixed; inset:5vh 5vw; z-index:99999; background:#111; color:#0f0; ' +
      'border:2px solid #0f0; border-radius:8px; padding:12px; display:flex; flex-direction:column; ' +
      'font:11px/1.4 ui-monospace, Consolas, monospace;';
    box.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#fff;">' +
      '<b>gnw diagnostic log</b>' +
      '<span>' +
      '<button id="gnw-log-copy" style="margin-right:8px;">Copy</button>' +
      '<button id="gnw-log-close">Close ✕</button>' +
      '</span></div>' +
      '<textarea id="gnw-log-text" readonly style="flex:1; width:100%; background:#000; color:#0f0; ' +
      'border:1px solid #333; font:inherit; resize:none;"></textarea>';
    document.body.appendChild(box);
    document.getElementById('gnw-log-close').onclick = () => box.remove();
    document.getElementById('gnw-log-copy').onclick = () => {
      const ta = document.getElementById('gnw-log-text');
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
    };
  }
  const ta = document.getElementById('gnw-log-text');
  ta.value = text;
  ta.scrollTop = ta.scrollHeight;
  ta.focus();
  ta.select();
}

// ─── Audio sample capture ───────────────────────────────────────────────────
// For inspecting the actual generated waveform as raw numbers instead of by
// ear — useful for comparing against a reference implementation's own sample
// stream. null when not capturing (the normal state — costs nothing then).
let _gnwAudioCapture = null;

// Call from the console: window.gnwCaptureAudio(1000) captures the next
// ~1000ms of generated samples (default 500ms), then automatically dumps
// them the same way window.gnwDumpLog() dumps the segment log. Only the
// currently-open interactive instance's _renderAudioFrame() feeds this.
window.gnwCaptureAudio = function (ms) {
  const durationMs = ms || 500;
  const samples = [];
  let sampleRate = 44100;
  const startedAt = performance.now();
  _gnwAudioCapture = {
    push(out, sampleIndexStart, sr) {
      sampleRate = sr;
      for (let i = 0; i < out.length; i++) samples.push(out[i]);
      if (performance.now() - startedAt >= durationMs) {
        _gnwAudioCapture = null;
        window.gnwDumpAudio(samples, sampleRate);
      }
    }
  };
  return 'capturing audio for ' + durationMs + 'ms...';
};

// samples/sampleRate are normally supplied automatically by gnwCaptureAudio's
// own timeout, but can be called directly with an array to inspect any other
// captured set the same way.
window.gnwDumpAudio = function (samples, sampleRate) {
  sampleRate = sampleRate || 44100;
  let min = Infinity, max = -Infinity, sum = 0, nanCount = 0;
  for (const v of samples) {
    if (Number.isNaN(v)) { nanCount++; continue; }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / (samples.length - nanCount || 1);
  const header = '[gnw] audio capture: ' + samples.length + ' samples @ ' + sampleRate + 'Hz (' +
    (samples.length / sampleRate).toFixed(3) + 's) — min=' + min.toFixed(6) + ' max=' + max.toFixed(6) +
    ' mean=' + mean.toFixed(6) + ' nanCount=' + nanCount;
  const lines = [header, 'index,t_ms,value'];
  for (let i = 0; i < samples.length; i++) {
    lines.push(i + ',' + (i / sampleRate * 1000).toFixed(3) + ',' + samples[i]);
  }
  const text = lines.join('\n');
  console.log(header);
  try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) {}
  _gnwShowLogOverlay(text);
  return text;
};

// ─── Display ────────────────────────────────────────────────────────────────

// Real hh_sm510_state base-class defaults (src/mame/handheld/hh_sm510.h,
// BSD-3-Clause, copyright hap — confirmed via two independent fetches of
// MAME's public source): "int m_decay_pivot = 8; // lcd segment off-to-on
// delay in 1kHz ticks" and "int m_decay_len = 17; // lcd segment on-to-off
// delay in 1kHz ticks". This one driver base class (hh_sm510_state) is
// shared by every title's own state class regardless of chip — SM5A and
// SM510 titles alike — so the same default applies project-wide unless a
// title's own class overrides it. Only one of this project's 18 titles has
// a confirmed override in the local MAME source (Turtle Bridge, see its
// GAMES entry's lcdDecay) — every other title uses this default, unverified
// against that specific title's own hardware but confirmed as the real
// chip-family default either way.
const LCD_DECAY_DEFAULT = { pivot: 8, len: 17 };
// MAME's decay timer free-runs at 1024Hz (1024 ticks/sec, real hardware-
// independent — see m_decay_timer->adjust(attotime::from_hz(1024), ...) in
// hh_sm510.cpp), decoupled from however often the host renders a frame — and
// its default window is tiny in real time (pivot 8 ticks ≈ 7.8ms, len 17
// ticks ≈ 16.6ms; even Turtle Bridge's overridden 25/25 ≈ 24.4ms each).
// We only get one sample per rendered frame (~16.7ms at 60fps) — so a
// literal tick-for-tick port would let a single anomalous frame's reading
// swing the counter most or all of the way across that window on its own,
// unable to suppress the one real, already-verified single-frame artifact
// this engine is known to hit: SM5A's C=1 row is fed from a live shift
// register that only holds a stray intermediate value for microseconds on
// real hardware, but since we sample once per rendered frame, that stray
// value occasionally lands as our one sample for that frame — previously
// handled by a dedicated "require 2 consecutive identical samples" rule
// (now removed, folded into this general mechanism instead). So each
// title's real tick-derived window is floored at 2 rendered frames' worth
// of real time, converted from ticks to ms first so a title with a
// genuinely large override (some Konami titles in this same MAME driver
// family go up to 35 ticks) still gets its own, larger, real value once it
// exceeds the floor — none of this project's 18 titles currently do,
// including Turtle Bridge's override, so today the floor is what actually
// governs every title's behaviour, with the per-title MAME values wired
// through correctly for whenever a future title's real numbers exceed it.
const LCD_DECAY_MS_PER_TICK = 1000 / 1024;
const LCD_DECAY_MIN_MS = 2 * (1000 / 60);
// The 2-frame floor above reduces how often a stray single-microsecond C=1
// shift-register sample gets rendered, but doesn't eliminate it: confirmed
// via a ~9-simulated-hour headless soak test of Ball's demo mode (a Node/vm
// harness driving the real GnwEmulator/_frame()/GnwDisplay classes through
// millions of synthetic frames, sampling-phase jitter included) that found
// 225 one-frame flashes over that run, every single one on a C=1 segment,
// at pseudo-random intervals uncorrelated with injected frame-timing
// hitches — the signature of sampling-phase aliasing (a sub-frame real
// transient occasionally straddling exactly two consecutive frame samples
// by chance), not a performance/contention bug despite that being the
// user's own first guess. A 4-frame floor, still far under any duration a
// real intentional animation change would need to clear, eliminated the
// reproduction for Ball entirely (same harness, 0 flickers over an
// equivalent run) without the general 2-frame floor above needing to
// change for every other row, which real MAME/hardware tuning already
// governs correctly. Fire (same SM5A family, different ROM/animation)
// dropped from 43 to 13 flickers over the same run length with this floor
// rather than reaching zero -- each additional frame of margin roughly
// halves the residual rate (matches a random-phase-alignment model, not a
// fixed bug with one root cause), so a title-specific push past 4 frames
// is a real option if a specific title still shows this visibly, but
// starts trading against display responsiveness for every title. The
// fully rigorous fix would track each segment's actual on-duration during
// the cpu.step() loop instead of sampling once per rendered frame (the
// same restructuring _renderAudioFrame() already did for the buzzer, see
// its own header comment) rather than raising this floor indefinitely.
const LCD_DECAY_MIN_MS_ROW1 = 4 * (1000 / 60);

class GnwDisplay {
  // cBits: how many bits of the flat lcd[] index the title's "C" component
  // occupies — default 1 (index = (A<<1)|C, C∈{0,1}), matching every SM5A
  // title shipped so far (C = H1/H2 row). Fire Attack (SM510) needs cBits=2
  // (index = (A<<2)|C, C∈{0,1,2,3} = LCD column h) — its SVG's own title
  // numbering genuinely uses a 0-3 range there, confirmed by direct
  // inspection, and (A<<1)|C would silently collide two unrelated segments
  // onto the same bit of the same lcd[] slot for any title with C∈{2,3}.
  // decay: { pivot, len } in real 1kHz-tick units (see LCD_DECAY_DEFAULT).
  constructor(svgEl, cBits, decay) {
    this.cBits = cBits || 1;
    decay = decay || LCD_DECAY_DEFAULT;
    // Stored pre-converted to ms (with the 2-frame floor applied) so the
    // per-frame update() hot path is a plain ms comparison, no unit
    // conversion or Math.max floor-checking per segment per frame.
    this.decayPivotMs = Math.max(decay.pivot * LCD_DECAY_MS_PER_TICK, LCD_DECAY_MIN_MS);
    this.decayLenMs   = Math.max(decay.len   * LCD_DECAY_MS_PER_TICK, LCD_DECAY_MIN_MS);
    // C=1 (row 1) on cBits===1 (SM5A/SM500-family) titles only -- see
    // LCD_DECAY_MIN_MS_ROW1's comment above for why this row specifically
    // needs a higher floor than every other row gets. cap must widen to
    // match, or a segment on this row could never actually reach the
    // higher pivot (Math.min(cap, ...) in update() would clamp it first).
    this.decayPivotMsRow1 = this.cBits === 1 ? Math.max(this.decayPivotMs, LCD_DECAY_MIN_MS_ROW1) : this.decayPivotMs;
    this.decayCapMs    = this.decayPivotMs + this.decayLenMs;
    this.decayCapMsRow1 = this.decayPivotMsRow1 + this.decayLenMs;
    this.map = new Map();     // "A.B.C" → segment element (a <g> or, on some
                               // titles' SVGs, a bare <path> with its own
                               // direct <title> child instead of a wrapping
                               // <g> — Chef's SVG has 61 of its 72 segments
                               // in this bare-<path> form, so both element
                               // types must be scanned or the vast majority
                               // of segments are silently never registered
                               // and stay at their default (visible) state
                               // forever, regardless of the actual LCD data.
    this.state = new Map();   // "A.B.C" → committed/displayed on-off state
    this.decay = new Map();   // "A.B.C" → current decay counter (0..pivot+len)
    svgEl.querySelectorAll('g, path').forEach(el => {
      const t = el.querySelector(':scope > title');
      if (!t) return;
      const id = t.textContent.trim();
      if (/^\d+\.\d+\.\d+$/.test(id)) {
        this.map.set(id, el);
        this.state.set(id, false);
        this.decay.set(id, 0);
      }
    });
  }

  // Mirrors hh_sm510_state::update_display()'s shape (per-segment counter
  // ramps up while commanded on, down while commanded off, capped at
  // [0, pivot+len]; rendered on once the counter crosses pivot) — a real
  // hysteresis, not a fixed-frame-count debounce: a segment that was only
  // briefly commanded on decays back off quickly (its counter never climbed
  // far above pivot), while one that was on for a while lingers visibly for
  // up to `len` worth of real time after being commanded off, same as real
  // LCD persistence — using the 2-frame-floored ms values computed in the
  // constructor (see the class-level comment above for why the floor is
  // necessary). This single mechanism covers every title's segments
  // uniformly — including SM5A's C=1 (live shift-register) row, which used
  // to need its own separate fixed 2-sample debounce. That debounce was
  // removed when this general mechanism was added, on the theory the
  // 2-frame floor alone was equivalent — an extended soak test later found
  // that's only mostly true (see LCD_DECAY_MIN_MS_ROW1's comment), so C=1
  // gets its own, still-small-but-higher floor again below.
  update(lcd, dtMs) {
    const t = performance.now();
    const step = Math.max(0, dtMs);
    this.map.forEach((el, id) => {
      const [A, B, C] = id.split('.').map(Number);
      const isRow1 = C === 1 && this.cBits === 1;
      const cap = isRow1 ? this.decayCapMsRow1 : this.decayCapMs;
      const pivot = isRow1 ? this.decayPivotMsRow1 : this.decayPivotMs;
      const commandedOn = !!((lcd[(A << this.cBits) | C] >> B) & 1);
      let d = this.decay.get(id);
      d = commandedOn ? Math.min(cap, d + step) : Math.max(0, d - step);
      this.decay.set(id, d);
      const on = d >= pivot;
      if (this.state.get(id) !== on) {
        this.state.set(id, on);
        _gnwLogPush({ t, type: 'seg', id, on });
        el.style.visibility = on ? 'visible' : 'hidden';
      }
    });
  }
}

// ─── Audio ──────────────────────────────────────────────────────────────────

// Real hardware's "buzzer" isn't a tone generator at all — hh_sm510_state's
// piezo_r1_w() just does `m_speaker->level_w(data & 1)`, driving the piezo
// element directly from the R1 output pin as a literal digital level. What
// drives that pin differs by chip: this project's SM5A titles are all
// r_mask_option=RMASK_DIRECT, so the pin is simply `~R & 1` (see
// clock_melody() in sm500.cpp), live as the ROM's own code toggles R via
// ATR. This project's SM510 titles are all r_mask_option=2 instead — the
// pin comes from a divider-gated oscillator (see SM510.clockMelody() in
// gnw.js, ported from clock_melody() in sm510.cpp), so R only turns the
// tone on/off; the actual pitch is the divider's. Either way there's no
// separate "frequency" register the ROM writes directly.
//
// This is a direct port of MAME's own speaker_sound_device
// (src/devices/sound/spkrdev.cpp), not an approximation of it. That device
// treats the raw digital level as a 1-bit oversampled DAC: it folds the level
// into a 4x-oversampled intermediate stream (time-weighted, so any number of
// transitions within one intermediate sample are handled correctly), applies
// a windowed-sinc low-pass/anti-alias filter across the last 64 intermediate
// samples to produce each real output sample, then removes DC bias with a
// one-pole filter: y[n] = x[n] - x[n-1] + 0.995*y[n-1]. Every constant and
// formula below (RATE_MULTIPLIER, FILTER_LENGTH, the sinc kernel, the DC
// blocker coefficient) is copied from that source, not tuned by hand.
// A simpler version of this (plain per-sample averaging, no anti-alias
// filtering) sounded progressively worse as gameplay sped up — without
// proper low-pass filtering, higher buzzer frequencies alias more, which
// matches "gets more corrupted as it gets faster" exactly. Function names
// below mirror MAME's (update_interm_samples, finalize_interm_sample, etc.)
// so this can be diffed against the original if anything still seems off.

// Runs on the audio rendering thread (not the main thread), so it keeps
// producing sample-accurate output regardless of any main-thread jitter —
// GC pauses, layout, other emulator instances, anything. This replaces an
// earlier approach that scheduled one new AudioBufferSourceNode per video
// frame at a precomputed start time: mathematically gapless on paper, but
// in practice any delay in the main thread reaching that .start() call
// before its scheduled time landed as an audible click at that frame's
// boundary — happening on every frame, it sounded like constant crackle.
// A ring buffer sidesteps this entirely: the main thread just tops it up
// once a frame, the audio thread drains it continuously and independently,
// and holds the last sample through a brief underrun instead of a hard
// drop to silence (a held level is a far less audible discontinuity than
// a snap to zero).
const GNW_WORKLET_CODE = `
class GnwSpeakerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringSize = Math.ceil(sampleRate * 2); // 2s of headroom
    this.ring = new Float32Array(this.ringSize);
    this.writeIdx = 0;
    this.readIdx = 0;
    this.available = 0;
    this.lastSample = 0;
    this.port.onmessage = (e) => {
      const chunk = e.data;
      for (let i = 0; i < chunk.length; i++) {
        this.ring[this.writeIdx] = chunk[i];
        this.writeIdx = (this.writeIdx + 1) % this.ringSize;
      }
      this.available += chunk.length;
      // Production should track real elapsed time closely, so this should
      // never actually trigger — but if something ever gets the main
      // thread far enough behind (a long background/suspend), drop the
      // oldest queued audio instead of letting latency grow unbounded.
      if (this.available > this.ringSize) {
        const drop = this.available - this.ringSize;
        this.readIdx = (this.readIdx + drop) % this.ringSize;
        this.available = this.ringSize;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.available > 0) {
        this.lastSample = this.ring[this.readIdx];
        this.readIdx = (this.readIdx + 1) % this.ringSize;
        this.available--;
      }
      out[i] = this.lastSample;
    }
    return true;
  }
}
registerProcessor('gnw-speaker-processor', GnwSpeakerProcessor);
`;

let _playMuted = false;   // play-modal mute (key "−" / the button); persists across game switches

class GnwAudio {
  init() {
    this.ctx = null; this.gain = null; this.sampleRate = 44100; this.node = null; this.ready = false;
    try {
      this.ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this.gain   = this.ctx.createGain();
      this.gain.gain.value = _playMuted ? 0 : 1;   // honour a mute chosen before this game booted
      this.gain.connect(this.ctx.destination);
      this.sampleRate = this.ctx.sampleRate;
      const blobUrl = URL.createObjectURL(new Blob([GNW_WORKLET_CODE], { type: 'application/javascript' }));
      this.ctx.audioWorklet.addModule(blobUrl)
        .then(() => {
          if (!this.ctx) return; // destroy() may have already run while this was loading
          this.node = new AudioWorkletNode(this.ctx, 'gnw-speaker-processor');
          this.node.connect(this.gain);
          this.ready = true;
        })
        .catch(() => {})
        .finally(() => URL.revokeObjectURL(blobUrl));
    } catch (_) {}

    this.RATE_MULTIPLIER = 4;      // intermediate stream oversamples the output stream by this much
    this.FILTER_LENGTH   = 64;     // sinc kernel taps
    this.intermPeriodSec = 1 / (this.sampleRate * this.RATE_MULTIPLIER);
    this.composedVolume  = new Float64Array(this.FILTER_LENGTH); // "stream 2", time-averaged intermediate samples
    this.composedSampleIndex = 0;
    this.lastUpdateSec = 0;        // time accounted for so far, seconds since this device's own t=0
    this.nextIntermSec = this.intermPeriodSec;
    this.prevX = 0; this.prevY = 0; // DC-blocker state

    // Approximated sinc (perfect sinc = ideal low-pass); FILTER_STEP sets the
    // cutoff (below Nyquist) — identical formula and constants to MAME's.
    this.ampl = new Float64Array(this.FILTER_LENGTH);
    const FILTER_STEP = Math.PI / 2 / this.RATE_MULTIPLIER;
    for (let i = 0, x = (0.5 - this.FILTER_LENGTH / 2) * FILTER_STEP; i < this.FILTER_LENGTH; i++, x += FILTER_STEP) {
      this.ampl[i] = (x === 0) ? 1 : Math.sin(x) / x;
    }
  }

  // Folds `volume` (the level active up to now) into the intermediate buffer
  // up to time t (seconds since this device's t=0), completing any
  // intermediate samples that finish along the way. Call once per transition,
  // in time order, with the volume that was active BEFORE that transition.
  // Mirrors update_interm_samples() exactly (including calling finalize+init
  // as a pair, not fused — later methods rely on being able to call
  // _finalizeIntermSample() on its own without an implicit index advance).
  updateIntermSamples(t, volume) {
    while (t >= this.nextIntermSec) {
      this._finalizeIntermSample(volume);
      this._initNextIntermSample();
    }
    const fraction = (t - this.lastUpdateSec) / this.intermPeriodSec;
    this.composedVolume[this.composedSampleIndex] += volume * fraction;
    this.lastUpdateSec = t;
  }

  // Mirrors finalize_interm_sample() — does NOT advance composedSampleIndex;
  // callers explicitly call _initNextIntermSample() afterward when needed.
  _finalizeIntermSample(volume) {
    const fraction = (this.nextIntermSec - this.lastUpdateSec) / this.intermPeriodSec;
    this.composedVolume[this.composedSampleIndex] += volume * fraction;
    this.lastUpdateSec = this.nextIntermSec;
    this.nextIntermSec += this.intermPeriodSec;
  }

  _initNextIntermSample() {
    this.composedSampleIndex = (this.composedSampleIndex + 1) % this.FILTER_LENGTH;
    this.composedVolume[this.composedSampleIndex] = 0;
  }

  _getFilteredVolume() {
    let filtered = 0, ampsum = 0, i = this.composedSampleIndex + 1;
    for (let c = 0; c < this.FILTER_LENGTH; c++, i++) {
      if (i >= this.FILTER_LENGTH) i = 0;
      filtered += this.composedVolume[i] * this.ampl[c];
      ampsum += Math.abs(this.ampl[c]);
    }
    return filtered / ampsum;
  }

  // Produces exactly one output-stream sample at real time `tSec` (seconds
  // since this device's t=0), folding `volume` in up to that instant first.
  // Callers must invoke this with tSec increasing by exactly 1/sampleRate
  // each time, interleaved in time order with any updateIntermSamples() calls
  // for transitions landing before each tSec (see _renderAudioFrame) — that
  // way the intermediate-sample clock (nextIntermSec) never has to guess
  // which of several possible volumes applied to time it hasn't been told
  // about yet, which is what let a single stray call corrupt a ring-buffer
  // bin by hundreds of intermediate periods' worth in testing.
  nextOutputSample(volume, tSec) {
    this.updateIntermSamples(tSec, volume);
    const filtered = this._getFilteredVolume();
    const y = filtered - this.prevX + 0.995 * this.prevY;
    this.prevX = filtered; this.prevY = y;
    return y;
  }

  // samples: Float32Array already produced by nextOutputSample(), one per
  // audio sample — handed to the worklet's ring buffer, not scheduled at
  // any particular time (see GNW_WORKLET_CODE for why).
  playSamples(samples) {
    if (!this.ready || !this.node || samples.length === 0) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.node.port.postMessage(samples);
  }

  destroy() {
    try { if (this.node) this.node.disconnect(); } catch (_) {}
    try { if (this.ctx) this.ctx.close(); } catch (_) {}
    this.ctx = null; this.node = null; this.ready = false;
  }
}

// ─── Emulator ───────────────────────────────────────────────────────────────

// The crystal is 32768Hz, but real hardware runs instructions at some
// fraction of that determined by clk_div (sm510_base_device::m_clk_div —
// 2 ("16kHz") for every SM5A/SM500/SM510 title here, fixed for the chip's
// lifetime. Running at the full 32768Hz (an earlier bug here) executes the
// game at 2x real speed, which is what made it unplayably fast and
// compressed multi-frame animations (like the hit effect) into too few
// real frames. SM511 breaks the "fixed forever" assumption: it resets to
// clkDiv=4 ("8kHz") and can switch to 2 ("16kHz") and back at runtime via
// its own CLKHI/CLKLO opcodes — so cpuHz is a per-GnwEmulator-instance
// value (read fresh each frame from cpu.clkDiv), not a module constant.

// Keyboard shortcut -> named button(s), shared across all games (a game
// simply won't have some of these in its `hotspots`/`inputRows`, e.g.
// Flagman has no left/right, Ball/Vermin have no btn1-4 — see
// GnwEmulator._held()). Each key maps to a list since Q/E do double duty
// (left/right on hammer games, upper-left/upper-right on quad-button
// games) — never ambiguous in practice since a game only ever defines one
// of those hotspot sets. 1/2/3 = Game A/B/Time on every title; 4 = Reset
// is handled separately in keydown() since it's not a _held()-tracked
// button. Arrow keys are hammer-only (left/right, not "up-left" etc.), so
// the 4-direction titles use Q/E/A/D instead — laid out to mirror the
// on-screen 2x2 corners (Q/E top row, A/D bottom row).
/* A key maps to a LIST of button names, and every name is set on press. That
   works because a game only ever reads the names its own inputRows mention --
   an entry for a button this title doesn't have is simply never looked at.
   So the Micro Vs. additions below ('fire'/'p2*') cost the other 52 titles
   nothing, and can share keys that already mean something else elsewhere
   (a/d stay btn3/btn4 for the quad-pad titles AND become player 2's
   left/right for a two-player one). */
const KEY_TO_BUTTON = {
  '1': ['gameA'],
  '2': ['gameB'],
  '3': ['time'],
  // Player 1 -- arrows + space, unchanged for every existing title.
  'ArrowLeft':  ['left', 'btn3'],
  'ArrowRight': ['right', 'btn1'],
  'q': ['left', 'btn1', 'hit'], 'Q': ['left', 'btn1', 'hit'],
  'e': ['right', 'btn2'], 'E': ['right', 'btn2'],
  'a': ['btn3', 'p2left'], 'A': ['btn3', 'p2left'],
  'd': ['btn4', 'p2right'], 'D': ['btn4', 'p2right'],
  'ArrowUp':   ['up', 'btn2'],
  'ArrowDown': ['down', 'btn4'],
  ' ': ['open', 'jump', 'fire'],
  // Player 2 (Micro Vs. System only) -- WASD + F, so both players can sit at
  // one keyboard without fighting over keys. a/d are shared with the quad-pad
  // titles' btn3/btn4 above; harmless, per this table's own comment.
  'w': ['p2up'], 'W': ['p2up'],
  's': ['p2down'], 'S': ['p2down'],
  'f': ['p2fire'], 'F': ['p2fire'],
};

class GnwEmulator {
  // gameKey: which entry in GAMES to boot (required).
  // opts.audio: false skips creating an AudioContext entirely (ambient/preview instances)
  constructor(gameKey, opts) {
    opts = opts || {};
    this.gameKey  = gameKey;                 // stable localStorage key for save states
    this.game     = GAMES[gameKey];
    this.cpu      = this.game.cpuType === 'sm512'
        ? new SM512(decodeRom(this.game.romB64), this.game.melodyB64 ? decodeRom(this.game.melodyB64) : null)
      : this.game.cpuType === 'sm511'
        ? new SM511(decodeRom(this.game.romB64), this.game.melodyB64 ? decodeRom(this.game.melodyB64) : null)
      : this.game.cpuType === 'sm510' ? new SM510(decodeRom(this.game.romB64))
      : new SM5A(decodeRom(this.game.romB64));
    this.cpu.rMuxInvert = !!this.game.rMuxInvert;
    // SM5A titles here are all RMASK_DIRECT (R pins = raw R register, see
    // GnwAudio's header comment), but this project's SM510 titles are all
    // r_mask_option=2 (a divider-gated oscillator, see SM510.clockMelody()),
    // and SM511/SM512 have no direct-passthrough R mode at all (their R pin
    // is driven entirely by the melody-ROM engine, see SM511.clockMelody(),
    // inherited unchanged by SM512) — the actual R-pin level lives in
    // cpu.rOut, not cpu.r, for all three.
    this._useROut = this.game.cpuType === 'sm510' || this.game.cpuType === 'sm511' || this.game.cpuType === 'sm512';
    this.disp     = null;
    this.disp2    = null;
    this.audio    = opts.audio === false ? null : new GnwAudio();
    this.raf      = null;
    this.keys     = Object.create(null);
    this._kButtons = Object.create(null);  // { buttonName: true } for each currently-held on-screen/touch button
    this.t0       = 0;
    // Per-instance instruction rate (32768Hz crystal / cpu.clkDiv) — read
    // fresh every frame rather than cached as a constant, since SM511's
    // clkDiv can change at runtime via its own CLKHI/CLKLO opcodes (see the
    // comment above the old module-level CPU_HZ constant this replaced).
    this.cpuHz    = 32768 / this.cpu.clkDiv;
    this.r1p      = (this._useROut ? this.cpu.rOut : this.cpu.r) & 1;  // matches boot state, avoids a spurious click on the first frame
    // Audio sample-integration state — see GnwAudio and _renderAudioFrame().
    // Both counters are cumulative and self-referential (samples needed is
    // derived from cycles run so far) — no wall-clock alignment needed
    // since playback is a continuously-drained ring buffer, not samples
    // scheduled at particular AudioContext times.
    this._audioLevel   = (this.r1p ? 0 : 0.3);  // speaker = ~R&1 (RMASK_DIRECT), scaled to a comfortable volume
    this._audioCycles  = 0;      // total CPU cycles run so far
    this._audioSamples = 0;      // total audio samples already generated so far
    this._commitAssistActive = false;  // see game.commitAssist handling in _frame()
  }

  // opts.interactive: false skips wiring the on-device button-press artwork lookup
  // (which otherwise does global getElementById calls — safe to skip for a
  // muted/non-interactive ambient preview instance, and necessary to avoid it
  // hijacking the real modal's button elements by id collision).
  // svgEl2: optional second SVG root for dual-screen (Multi Screen) titles
  // -- see game.dualScreen. The CPU's lcd[] array is one shared flat array
  // (see GnwDisplay's own comment for the (A,B,C) index formula), so a
  // second GnwDisplay instance reading from the same array is all a second
  // physical screen needs; no CPU-level change required.
  mount(svgEl, dbgEl, opts, svgEl2) {
    opts = opts || {};
    this._interactive = opts.interactive !== false;
    this.dbg = dbgEl || null;
    // Hide all segments initially; disp.update() will reveal active ones each
    // frame. Must scan both <g>-wrapped AND bare-<path> segments (Chef's SVG
    // has 61 of its 72 segments in the bare-<path> form — see GnwDisplay's
    // constructor comment) or every bare-<path> segment that happens to be
    // off in the very first digit the ROM ever draws is left at whatever the
    // SVG/CSS's own default visibility is (visible, on this artwork) instead
    // of hidden — GnwDisplay.update()'s debounced state starts at "off" for
    // every segment, so a segment that's genuinely off from frame one never
    // triggers an explicit style write to correct that mismatch (its state
    // already matches "off", nothing to update), leaving it permanently
    // showing a segment that should never have been lit at all.
    let segCount = 0;
    svgEl.querySelectorAll('g, path').forEach(el => {
      const t = el.querySelector(':scope > title');
      if (t && /^\d+\.\d+\.\d+$/.test(t.textContent.trim())) {
        segCount++;
        el.style.visibility = 'hidden';
      }
    });
    if (this.dbg) this.dbg.textContent = 'segs:' + segCount + ' starting...';
    this.disp = new GnwDisplay(svgEl, this.game.lcdCBits, this.game.lcdDecay);
    this.disp2 = null;
    if (svgEl2) {
      svgEl2.querySelectorAll('g, path').forEach(el => {
        const t = el.querySelector(':scope > title');
        if (t && /^\d+\.\d+\.\d+$/.test(t.textContent.trim())) el.style.visibility = 'hidden';
      });
      this.disp2 = new GnwDisplay(svgEl2, this.game.lcdCBits, this.game.lcdDecay);
    }
    if (this.audio) this.audio.init();
    if (this._interactive) {
      this._btnEls = {};
      // _hotspotEls: the clickable hotspot DIVs, cached alongside the img
      // overlays. Used by the press-HIGHLIGHT path (game.pressHighlight) for
      // titles whose bundle has no correctly-oriented pressed-state art -- we
      // glow the hotspot instead of swapping in a foreign PNG. See
      // _updateButtonArt() + the .play-hotspot.pressed CSS.
      this._hotspotEls = {};
      for (const name in BUTTON_DEFS) {
        this._btnEls[name] = document.getElementById(BUTTON_DEFS[name].imgId);
        this._hotspotEls[name] = document.querySelector('#play-emu-root .play-hotspot.' + BUTTON_DEFS[name].hotspotClass);
      }
    } else {
      this._btnEls = null;
      this._hotspotEls = null;
    }
  }

  // Rewind is only for the interactive play-modal emulator. The ambient tile
  // previews and the drawer's big-reveal (both mount with interactive:false)
  // must NOT allocate a ring — there is one live tile instance per device, and
  // a 3600-slot RewindBuffer each is tens of thousands of typed-array allocs
  // that stall the main thread (froze every tile + blocked the drawer open).
  start() { this._syncClockToNow(); if (this._interactive && this.cpu && !this._rew) this._rew = new RewindBuffer(this.cpu); this.t0 = this.startTime = performance.now(); this.raf = requestAnimationFrame(t => this._frame(t)); }
  stop()  { this.stopAttract(); if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } if (this.audio) this.audio.destroy(); }

  // _commitAssistActive must be cleared here too, not just in the
  // constructor — without this, resetting mid-game (e.g. via ACL) while
  // Game A was held left it stuck true, so the very next _frame() call
  // force-wrote game.commitAssist's RAM value into the just-reset cpu.ram
  // during the critical ~300-cycle boot window, corrupting the ROM's own
  // init sequence (symptom: buttons stop responding and the display never
  // settles after a reset — looks like "the ROM didn't load", but it's
  // this stale flag stomping boot-time RAM state before the ROM's own
  // startup code gets to run). Affects any title using commitAssist
  // (Popeye, Fire/FR-27) whenever reset happens while Game A was active.
  // window.gnwDevModeActive (set by index.html's gnwToggleDevMode/
  // gnwExitDevMode) skips the wall-clock sync here -- the real ACL/Reset
  // button (gnwTap('reset')) goes through this same path regardless of
  // Developer Mode, and without this check, resetting mid-session while
  // shadow-watching silently re-injected the real time, undermining the
  // whole point of gnwDevModeCleanReset()'s neutral boot in the first
  // place. Everything else about a real reset (cpu.reset(), clearing
  // stale per-title state) still happens the same either way.
  resetGame() { this.cpu.reset(); this._prevInRows = null; this._commitAssistActive = false; if (this._rew) this._rew.reset(); if (!window.gnwDevModeActive) this._syncClockToNow(); }

  // clockRam gives per-game RAM offsets for hour-tens/ones, minute-tens/ones,
  // second-tens/ones (12h format, rolls 12->1 — every title so far uses the
  // same format, just different RAM addresses). Seconds aren't displayed on
  // screen, but the ROM does track them internally and rolls them into the
  // minute digits — without setting those too, the clock could start up to
  // 59s behind the real time. Each ROM writes its own 12:00:00 default within
  // its first ~225 cycles of boot; let that run once, then overwrite with the
  // browser's current time (there's no RTC chip to hook into — the clock is
  // just a RAM counter the game increments off its own divider).
  // Just the "compute h/m/s and write clockRam" half of a sync, split out
  // so _frame()'s attract-mode keep-alive (below) can re-poke fresh values
  // into a title that's already running without re-running the boot burst.
  // See the attract-mode keep-alive comment in _frame() for why a bare RAM
  // write, not a real button press, is what several ROM families actually
  // need here.
  _pokeClockRam() {
    const cpu = this.cpu, cr = this.game.clockRam;
    const now = new Date();
    let h = now.getHours() % 12; if (h === 0) h = 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    // cr.pmBit (only set for ROMs verified to use it — see the Wide Screen
    // titles' clockRam comments): the hour-tens cell only ever needs bit 0
    // to hold its own digit (0 or 1), so these ROMs repurpose one of the
    // three otherwise-unused bits in that same nibble as the AM/PM flag
    // rather than spending a whole extra RAM cell on it. Without ORing it
    // in here, that bit is always left at 0, so the display always showed
    // AM regardless of the real time.
    const pm = cr.pmBit && now.getHours() >= 12 ? cr.pmBit : 0;
    cpu.ram[cr.hT] = Math.floor(h / 10) | pm;
    cpu.ram[cr.hO] = h % 10;
    cpu.ram[cr.mT] = Math.floor(m / 10);
    cpu.ram[cr.mO] = m % 10;
    cpu.ram[cr.sT] = Math.floor(s / 10);
    cpu.ram[cr.sO] = s % 10;
  }

  // midBoot: optional { at, fn } — fn runs once, right before boot cycle
  // `at`, letting _resetWithButtonHeld() briefly flip button state mid-way
  // through the 300-cycle boot rather than holding it the entire time.
  _syncClockToNow(midBoot) {
    const cpu = this.cpu, cr = this.game.clockRam;
    // The CPU constructor defaults inFixedRow to 0 (matching Vermin/Ball's
    // inp_fixed_last() wiring) as a placeholder — _readInputs() is what
    // normally corrects this to -1 for R-gated games, but that only runs
    // once the frame loop starts, which is AFTER this boot run. Without
    // this call, every R-gated game's first ~300 cycles read K-line input
    // through the wrong (fixed-row-0) path instead of gating by R — for
    // most titles nothing input-sensitive happens that early so it's
    // invisible, but any ROM that checks a K-line button within its very
    // first few instructions (as Helmet does) would always see 0
    // regardless of reality.
    this._readInputs();
    // game.bootSyncCycles: Fire Attack's own boot-init routine doesn't write
    // its default "12:00" into the persistent hour/minute counters until
    // ~cycle 416 (confirmed via direct write-tracing) — later than every
    // other title's boot-init, which always completes within 300. Syncing at
    // the usual 300 landed before that write, so the game's own default
    // immediately clobbered the real time we'd just written. Every other
    // title keeps the default (300) via this being undefined.
    const bootCycles = this.game.bootSyncCycles || 300;
    for (let i = 0; i < bootCycles; i++) {
      if (midBoot && i === midBoot.at) midBoot.fn();
      cpu.step();
    }
    this._pokeClockRam();
    // This RAM write is out-of-band from the ROM's own display pipeline —
    // the digits don't actually reach the LCD until the ROM's own redraw
    // code runs, reads these cells, and TW-commits each digit's segments
    // (SM5A's O-register latch). If the very first rendered frame paints
    // before that redraw finishes, whichever digit the ROM hasn't gotten to
    // yet still shows its stale pre-poke committed segments (on Chef,
    // that's the full lamp-test "8" pattern) instead of the real digit —
    // seen live as an extra stray segment (e.g. minutes-ones "5" flashing
    // as "8") for exactly one frame before the ROM catches up and it
    // self-corrects. How soon that first frame lands relative to real
    // elapsed time is timing-jitter-dependent (same class of issue as the
    // dash/startup-delay bugs above), so it's intermittent rather than
    // always-reproducible. Confirmed via direct cycle-by-cycle tracing
    // (Chef, several different poked times) that the ROM's redraw always
    // finishes within ~180 cycles of this point — running a fixed 300 extra
    // "blind" cycles here (same order of magnitude as bootCycles itself)
    // guarantees every digit's O-register reflects the real time before
    // start()/_frame() ever calls updateLcd() for the first time, so the
    // stale image is never actually painted. Plain extra instruction
    // execution, not a RAM force — can't corrupt state the way the old
    // Chef-only sweepFix hack could.
    for (let i = 0; i < (this.game.postSyncSettleCycles || 300); i++) cpu.step();
  }

  // ─── Attract/demo loop ──────────────────────────────────────────────────
  // Boots into Time mode (the clock display) as the default demo state,
  // until a real visitor presses a button — at which point it hands off
  // control permanently (until the modal is reopened).

  // Operates on this instance's own _kButtons directly (not via the global
  // window.gnwPress/gnwRelease, which act on the shared interactive _emu —
  // wrong target for an independent instance like the ambient tile preview).
  //
  // Games with a fixedRow (Vermin/Ball) need Time held to switch from their
  // gameplay-idle screen to a live clock display. The 4 direction-button
  // titles (Flagman/Judge/Manhole/Lion) and the widescreen hammer titles
  // (Parachute/Octopus/Popeye/Chef, flagged via game.lampTestOnBoot) need
  // the same Time press to dismiss their fresh-boot lamp-test screen into
  // demo mode — same as a player pressing Time by hand once the ROM's row
  // assignment was fixed (see the GAMES registry inputRows comment). Helmet
  // also uses game.lampTestOnBoot, but for an unrelated reason: its boot
  // screen isn't a lamp test, it's frozen — see the lampTestOnBoot comment
  // on Helmet's GAMES entry.
  // Fire is still excluded: it already shows its clock continuously from
  // boot with no lamp test to dismiss, and holding Time on it triggers the
  // real hold-to-fast-forward/set mechanism real G&W clocks have instead.
  //
  // Vermin/Ball (fixedRow) need Time held continuously — their idle screen
  // only shows a live clock while Time stays down. The lamp-test titles
  // only need a brief press to dismiss the lamp test and commit the
  // synced time to the display, same as a real button tap — release it
  // shortly after instead of holding indefinitely.
  //
  // game.attractKick (currently unused by any shipped title — Chef briefly
  // used it, see its GAMES entry comment for why that was wrong) exists
  // for a possible future title whose demo genuinely needs one extra brief
  // button press after the Time tap to start animating, in addition to
  // the plain lamp-test dismiss every title above gets.
  startAttract() {
    this._attractActive = true;
    this._lastClockRefresh = 0; // force _frame()'s keep-alive to poke fresh values right away, not wait out a stale timestamp from a previous attract session
    if (this.game.fixedRow === undefined && !this._hasQuadButtons() && !this.game.lampTestOnBoot) return;
    this._attractTimer = setTimeout(() => {
      if (!this._attractActive) return;
      this._kButtons['time'] = true;
      this._attractHoldingTime = true;
      // Route through the same reset-with-button-held path a real Time
      // click already uses (gnwPress calls this too) — a no-op for titles
      // that don't need it (see the guard at the top of the method), but
      // for Chef specifically, setting _kButtons.time directly without it
      // (the old behaviour here) left the CPU relying on the same unreliable
      // K-line wakeup latch documented at length on Chef's GAMES entry,
      // producing a garbled clock digit instead of the clean idle tableau
      // a manual Time click already correctly reaches.
      this._resetWithButtonHeld();
      if (this._hasQuadButtons() || this.game.lampTestOnBoot) {
        this._attractReleaseTimer = setTimeout(() => {
          delete this._kButtons['time'];
          this._attractHoldingTime = false;
          if (this.game.attractKick) {
            const kick = this.game.attractKick;
            this._kButtons[kick] = true;
            this._attractKickReleaseTimer = setTimeout(() => {
              if (!this._attractActive) return;
              delete this._kButtons[kick];
            }, 200);
          }
        }, 200);
      }
    }, 1200);
  }

  _hasQuadButtons() {
    return this.game.inputRows.some(row => 'btn1' in row || 'btn2' in row || 'btn3' in row || 'btn4' in row);
  }

  // Manhole/Judge/Lion/Flagman's CPU can end a halt cycle with R at a value
  // that happens to exclude the mode-button row (gameA/gameB/time) — the
  // once-a-second gamma timer eventually forces a wakeup regardless, but
  // whether the ROM's main loop actually notices the held button during
  // that brief awake window depends on which R value it's cycling through
  // right then, so a single gamma tick isn't a sure thing — it can take a
  // few tries. A quick tap normally releases long before even one tick
  // fires, so the ROM never gets a chance at all. Keep those 3 buttons
  // (only on titles with direction buttons) logically held for several
  // gamma periods after release so there's a real window of attempts —
  // direction buttons stay untouched since gameplay depends on them
  // staying immediately responsive. Shared by mouse/touch (gnwPress/
  // gnwRelease) and the keyboard (keydown/keyup) so neither path bypasses
  // it. The token bump on every (re-)press cancels any earlier pending
  // release outright, rather than fighting over the same key/button.
  _bumpReleaseToken(key) {
    const tokens = (this._releaseTokens = this._releaseTokens || {});
    tokens[key] = (tokens[key] || 0) + 1;
  }
  // needsMinHold is decided by the caller — gnwRelease() checks the
  // button name (gameA/gameB/time), keyup() checks what the released key
  // maps to — since a button name and a raw keyboard key aren't the same
  // namespace.
  _delayedRelease(key, needsMinHold, clear) {
    if (!needsMinHold || (!this._hasQuadButtons() && !this.game.needsResetForModeButtons)) { clear(); return; }
    const tokens = (this._releaseTokens = this._releaseTokens || {});
    const myToken = tokens[key];
    setTimeout(() => { if (tokens[key] === myToken) clear(); }, 5000);
  }

  stopAttract() {
    this._attractActive = false;
    if (this._attractTimer) { clearTimeout(this._attractTimer); this._attractTimer = null; }
    if (this._attractReleaseTimer) { clearTimeout(this._attractReleaseTimer); this._attractReleaseTimer = null; }
    if (this._attractKickReleaseTimer) { clearTimeout(this._attractKickReleaseTimer); this._attractKickReleaseTimer = null; }
    if (this._attractHoldingTime) { delete this._kButtons['time']; this._attractHoldingTime = false; }
    if (this.game.attractKick) delete this._kButtons[this.game.attractKick];
  }

  // held(name): true if `name` is currently pressed, via on-screen/touch
  // (_kButtons) or its bound keyboard key (KEY_TO_BUTTON).
  _held(name) {
    if (this._kButtons[name]) return true;
    for (const key in KEY_TO_BUTTON) if (KEY_TO_BUTTON[key].includes(name) && this.keys[key]) return true;
    return false;
  }

  _readInputs() {
    const cpu = this.cpu, game = this.game;
    // BA / B pins — hammers, active LOW (0 = pressed). Only Ball/Vermin-style
    // games have these at all (Flagman etc. read everything through K instead).
    // swapHammers (Parachute/Octopus/Popeye) crosses which hotspot drives
    // which pin, since their B/BA wiring is reversed relative to Ball.
    // (hammerActiveHigh was tried per the real driver's IP_ACTIVE_HIGH
    // declaration for these three titles, on the theory the idle level is
    // inverted too — reverted: it broke the empirically-confirmed working
    // swapHammers left/right behaviour, so evidently gameplay reads these
    // pins through some other path than the boot-time TB/TAL check that
    // motivated the theory.)
    const rightBtn = game.swapHammers ? 'left' : 'right';
    const leftBtn  = game.swapHammers ? 'right' : 'left';
    cpu.inBA = game.hotspots.right ? (this._held(rightBtn) ? 0 : 1) : 1;
    cpu.inB  = game.hotspots.left  ? (this._held(leftBtn)  ? 0 : 1) : 1;
    // Each game.inputRows[i] is one hardware input row (IN.0/IN.1/IN.2),
    // mapping the named buttons that live on that row to the K-bit each
    // sets — see the GAMES registry comment on inputRows for why this has
    // to be per-row rather than one flat merged bitmask. The CPU itself
    // (readInputRows(), used by KTA) gates these by R.
    const rows = game.inputRows;
    const newRows = rows.map(rowBits => {
      let v = 0;
      for (const name in rowBits) if (this._held(name)) v |= rowBits[name];
      return v;
    });
    // Mirrors hh_sm510_state::input_changed() — real hardware only
    // re-latches the wakeup line when a button's held state actually
    // changes, not continuously. Compare against last frame's rows so we
    // only call updateKLine() on an actual change, same as the real event.
    const changed = !this._prevInRows
      || newRows.length !== this._prevInRows.length
      || newRows.some((v, i) => v !== this._prevInRows[i]);
    cpu.inRows = newRows;
    cpu.inFixedRow = game.fixedRow !== undefined ? game.fixedRow : -1;
    if (changed) cpu.updateKLine();
    this._prevInRows = newRows;
  }

  _frame(now) {
    if (!this.raf) return;
    const dt = Math.min(now - this.t0, 50);  // cap at 50 ms to avoid spiral
    this.t0  = now;
    this._readInputs();

    // Refresh cpuHz every frame, not just once at construction — SM511's
    // clkDiv can change at runtime (CLKHI/CLKLO), so a title using those
    // needs N (below) computed against whatever rate is current right now,
    // not whatever it was at boot.
    this.cpuHz = 32768 / this.cpu.clkDiv;
    // Fractional cycles owed carry over instead of being truncated away each
    // frame — (dt*cpuHz/1000)|0 always rounds DOWN, so on its own it drops
    // roughly half a cycle's worth of time every single frame, one direction
    // only. That's a systematic (not random-noise) drift: at 60fps it adds up
    // to ~1-2ms of "missing" time per second, which the audio scheduler (see
    // _renderAudioFrame) relies on staying tightly in sync with the real
    // AudioContext clock — small per-frame loses compound over a play session
    // until scheduled audio buffers land behind where playback already is,
    // which is exactly what made audio increasingly break up over time.
    this._cycleDebt = (this._cycleDebt || 0) + dt * this.cpuHz / 1000;
    const N = this._cycleDebt | 0;
    this._cycleDebt -= N;
    if (dt > 20) _gnwLogPush({ t: now, type: 'frame', dt, cycles: N }); // catch-up burst — a likely glitch trigger
    const cpu = this.cpu;
    // Attract-mode clock keep-alive. Several ROM families (confirmed live:
    // Judge, Octopus, Popeye, Fire Attack, Turtle Bridge, Snoopy Tennis,
    // Donkey Kong Jr., Mario's Cement Factory, Manhole NH-103, Super Mario
    // Bros., Climber, Balloon Fight) only advance their own internal
    // seconds/minutes RAM while their Time-display code path is actively
    // being polled — once startAttract()'s brief Time tap is released,
    // some of these freeze the displayed digits outright, others resume
    // counting from a fresh internal zero instead of the real value
    // _syncClockToNow() poked in at boot. Either way the visible clock
    // drifts up to a full minute out of phase with every other device's
    // tile, which all stay correct because they're fixedRow titles
    // (Vermin/Ball/Fire) that keep Time held continuously, or their own
    // ROM happens to keep ticking correctly on its own after release
    // (Parachute/Chef/Fire-FR27/Tropical Fish/Mickey Mouse/Egg/the four
    // reset-vector-trick titles).
    // Fix: periodically re-poke just the RAM cells (not a real button
    // press/hold) so the displayed digits stay accurate regardless of
    // whether a given ROM's own tick logic is keeping up. Deliberately a
    // bare RAM write rather than re-pressing/holding Time — Octopus/
    // Popeye/Parachute/Chef share one clock ROM, and Chef's own history
    // (see timeIsFastForward) shows that ROM treats Time held past ~4s as
    // the real hold-to-set-clock gesture, so simulating a longer hold here
    // to "fix" the tick rate would risk corrupting the clock instead.
    // Gated on _attractActive only, never during real interactive play —
    // any actual visitor input calls stopAttract() first (see
    // startAttract()'s own comment), so this can never race with a real
    // player's use of these same RAM cells mid-game.
    if (this._attractActive && now - (this._lastClockRefresh || 0) > 5000) {
      this._lastClockRefresh = now;
      this._pokeClockRam();
    }
    // commitAssist's held/yields state only depends on button state, which
    // can't change mid-frame, so it's resolved once here — but see below
    // (inside the step loop) for why the actual RAM force can't wait until
    // after the loop the way it used to.
    // yieldsTo is checked BEFORE holdButton, not after — a released
    // GameA/GameB/Time key stays logically "held" for up to 5 real seconds
    // after keyup on titles needing extended hold (see _delayedRelease()),
    // so a quick GameA-then-GameB switch leaves both _held('gameA') and
    // _held('gameB') true at once for that whole window. Checking
    // holdButton first (the old order) let GameA's stale leftover hold win
    // every time, permanently locking the assist onto GameA's RAM value
    // and starving whatever GameB/Time actually needed to happen — found
    // via a live repro (rapid GameA -> GameB -> Time keypresses showed the
    // clock and score digits getting corrupted) that traced back to
    // ram[57] staying force-pinned to 8 the whole time. yieldsTo-first
    // means an explicit fresh press of any yieldsTo button always wins,
    // regardless of an older button's stale hold state.
    const assist = this.game.commitAssist;
    if (assist) {
      if (assist.yieldsTo.some(name => this._held(name))) this._commitAssistActive = false;
      else if (this._held(assist.holdButton)) this._commitAssistActive = true;
    }
    // Record every speaker-level transition (cycle offset within this frame,
    // new level) instead of scheduling each one as its own Web Audio event —
    // _renderAudioFrame() below turns these into properly time-weighted
    // audio samples afterward, same as MAME's speaker_sound_device.
    const transitions = this.audio ? [] : null;
    for (let i = 0; i < N; i++) {
      cpu.step();
      // Popeye/Fire's own commit-collision cells get re-cleared by the ROM
      // on a slow ~8-9-frame cadence, but forcing after every single step
      // (rather than once per frame) is strictly safer regardless.
      if (assist && this._commitAssistActive && (cpu.ram[assist.ramAddr] & 0xf) !== assist.value) {
        cpu.ram[assist.ramAddr] = assist.value;
      }
      const r1 = (this._useROut ? cpu.rOut : cpu.r) & 1;
      if (r1 !== this.r1p) {
        this.r1p = r1;
        if (transitions) transitions.push(i, r1 ? 0 : 0.3);
      }
    }
    if (transitions) this._renderAudioFrame(transitions, N);

    // Update visible debug counter every ~30 frames
    this._dbgTick = ((this._dbgTick || 0) + 1);
    if (this._dbgTick % 30 === 1) {
      const winStart = this._dbgWindowStart || now;
      this._fps = 30000 / Math.max(1, now - winStart);
      this._dbgWindowStart = now;
    }
    if (this.dbg && this._dbgTick % 30 === 1) {
      this.dbg.textContent =
        'fps:' + (this._fps || 0).toFixed(0) +
        ' f:' + this._dbgTick +
        ' tw:' + cpu._twCount +
        ' cend:' + cpu._cendCount +
        ' pc:' + cpu.pc.toString(16) +
        ' halt:' + (cpu.halt ? 1 : 0) +
        ' r:' + cpu.r.toString(2).padStart(4,'0');
    }

    cpu.updateLcd();
    if (this._rew && !_rewinding) this._rew.capture(cpu);   // one snapshot per rendered frame (byte-copy)
    if (this.disp) this.disp.update(cpu.lcd, dt);
    if (this.disp2) this.disp2.update(cpu.lcd, dt);
    this._updateButtonArt();
    this.raf = requestAnimationFrame(t => this._frame(t));
  }

  // Converts this frame's recorded (cycleOffset, newLevel) transition pairs
  // into output audio samples via GnwAudio's oversampling/filter pipeline —
  // the same integration MAME's speaker_sound_device does — and schedules
  // them for playback. Per-frame cost is O(transitions + samples) regardless
  // of tone frequency, instead of one Web Audio scheduling call per transition.
  // NOTE: frameStartSec/frameEndSec divide the CUMULATIVE cycle count by
  // this.cpuHz, which is only exact if cpuHz has been constant for this
  // instance's entire lifetime. **That is not true, and this comment used to
  // claim it was.** It said no shipped SM511 title had been confirmed to call
  // CLKHI/CLKLO -- while the Pinball entry in GAMES said the opposite a few
  // thousand lines up, having found a CPU-core divider bug precisely because
  // that title does change clkDiv at runtime. Two comments in one file, in
  // direct contradiction; this is the one that was wrong.
  //
  // Measured over 60s of each title's live demo: eight SM511 titles change
  // rate ~2x/sec on a clean rule -- CLKHI (16384Hz) on wake, CLKLO (8192Hz)
  // before halt, i.e. power management. Pinball 29.8% awake, mmousep/dkcirc
  // 25.1%, mbaway 24.5%, dkjrp 21.8%, snoopyp 21.3%, mariocmt 18.7%, popeyep
  // 16.6%. Only smbn/climbern hold a genuinely fixed 8192Hz. SM5A/SM510 never
  // change clkDiv, so they remain exact.
  //
  // So the misdating below is REAL on those eight, not theoretical: cycles
  // counted under one rate get re-dated under the other. Still not fixed --
  // not because it can't happen, but because it hasn't been reported audible.
  // The fix is to accumulate audio time in SECONDS as the rate changes
  // (adding N/cpuHz per frame to a running total) instead of dividing a
  // cumulative cycle count by whatever rate is current right now.
  _renderAudioFrame(transitions, N) {
    const audio = this.audio;
    if (!audio || !audio.ctx) return;
    const sampleRate = audio.sampleRate;

    const frameStartSec = this._audioCycles / this.cpuHz;
    this._audioCycles += N;
    const frameEndSec = this._audioCycles / this.cpuHz;

    const totalShouldExist = Math.floor(frameEndSec * sampleRate);
    const toEmit = totalShouldExist - this._audioSamples;

    // Fold each transition in, in time order, using the level that was
    // active just BEFORE it takes effect (matches level_w()'s own use of
    // m_levels[m_level] — the OLD level — before applying the new one).
    // Interleaved with pulling each output sample (rather than folding all
    // of this frame's transitions first and only then pulling every sample)
    // so a transition landing between two output samples is folded in
    // before either of them reads the filter, instead of after both —
    // batching the two phases let the intermediate-sample clock and the
    // ring-buffer position drift out of step with each other, occasionally
    // by hundreds of intermediate periods, which showed up as short but
    // extreme (tens-of-x) amplitude spikes right on top of real buzzer clicks.
    let curLevel = this._audioLevel;
    let ti = 0;
    let out = null;
    if (toEmit > 0) out = new Float32Array(toEmit);
    for (let k = 0; k < toEmit; k++) {
      const sampleEndSec = (this._audioSamples + k + 1) / sampleRate;
      while (ti < transitions.length && frameStartSec + transitions[ti] / this.cpuHz <= sampleEndSec) {
        audio.updateIntermSamples(frameStartSec + transitions[ti] / this.cpuHz, curLevel);
        curLevel = transitions[ti + 1];
        ti += 2;
      }
      out[k] = audio.nextOutputSample(curLevel, sampleEndSec);
    }
    // Any transitions after this frame's last emitted sample (but still
    // within the frame) still need folding now so the level's current for
    // whichever future frame's samples come next.
    for (; ti < transitions.length; ti += 2) {
      audio.updateIntermSamples(frameStartSec + transitions[ti] / this.cpuHz, curLevel);
      curLevel = transitions[ti + 1];
    }
    this._audioLevel = curLevel;

    if (!out) return;

    if (_gnwAudioCapture) _gnwAudioCapture.push(out, this._audioSamples, sampleRate);

    this._audioSamples = totalShouldExist;
    audio.playSamples(out);
  }

  // Toggle the on-device button-press artwork from the actual input state,
  // so keyboard, on-screen buttons, and device hotspots all agree. Hammers
  // reflect the CPU's latched pins; K-based buttons reflect _held() directly
  // (not a CPU read) since which row is "active" cycles with R every few
  // cycles and isn't a meaningful snapshot of what the user is holding.
  _updateButtonArt() {
    if (!this._btnEls) return;
    const cpu = this.cpu;
    // pressHighlight: this title's cabinet has no correctly-oriented pressed-
    // state PNGs (e.g. smbspecial's portrait Table Top reuses smbn's LANDSCAPE
    // Animation frames), so instead of pasting a foreign PNG we glow the
    // hotspot itself. The img overlays stay hidden (see noPressedArt in
    // _applyGameArtwork); we toggle .pressed on the hotspot DIV instead.
    const highlightAll = !!this.game.pressHighlight;
    const hlButtons = this.game.highlightButtons;   // per-button glow (e.g. wrong-size synthesized d-pad crops)
    for (const name in this._btnEls) {
      const swap = !!this.game.swapHammers;
      const pressed = name === 'left' ? (swap ? cpu.inBA === 0 : cpu.inB === 0)
                    : name === 'right' ? (swap ? cpu.inB === 0 : cpu.inBA === 0)
                    : this._held(name);
      if (highlightAll || (hlButtons && hlButtons.indexOf(name) >= 0)) {
        const hs = this._hotspotEls && this._hotspotEls[name];
        if (hs) hs.classList.toggle('pressed', pressed);
        const el0 = this._btnEls[name];
        if (el0) el0.classList.remove('show');   // never stretch this button's wrong-size overlay
        continue;
      }
      const el = this._btnEls[name];
      if (!el) continue;
      el.classList.toggle('show', pressed);
    }
  }

  keydown(e) {
    this.keys[e.key] = true;
    this._bumpReleaseToken(e.key);
    this.stopAttract();
    if (e.key === '4' || e.key === 'r' || e.key === 'R') this.resetGame();
    if (e.key === 'l' || e.key === 'L') window.gnwDumpLog(15);
    const names = KEY_TO_BUTTON[e.key] || [];
    if (names.includes('gameA') || names.includes('gameB') || names.includes('time')) this._resetWithButtonHeld();
  }
  keyup(e) {
    const names = KEY_TO_BUTTON[e.key] || [];
    const needsMinHold = names.some(n => this._needsMinHold(n));
    this._delayedRelease(e.key, needsMinHold, () => { this.keys[e.key] = false; });
  }

  // Helmet reads its hammer pins (left/right) through the same kind of
  // infrequent, easy-to-miss polling as the quad-button titles' mode
  // buttons — confirmed live: a single tap/hold-then-release left no
  // lasting change, but several quick taps in a row did. Unlike
  // Vermin/Ball/Fire (which have fixedRow set and read hammers reliably
  // every loop pass), Helmet has no fixedRow, so it's the only title
  // this condition currently matches. gameA/gameB/time also keep this as
  // a second line of defence alongside _resetWithButtonHeld() — the reset
  // trick handles the common case, but staying logically held afterward
  // costs nothing and covers any edge case the reset alone doesn't.
  _needsMinHold(btn) {
    // Time is deliberately excluded when game.timeIsFastForward is set:
    // Chef's ROM (and presumably any title with this same real-hardware
    // quirk) treats Time held past ~4 seconds as the set-clock/
    // fast-forward gesture real G&W clocks have, visibly corrupting the
    // displayed digits and rolling the minutes rapidly — confirmed via
    // direct RAM tracing (hT/hO jump to invalid values and mT/mO start
    // incrementing every ~1s instead of never, at exactly the point Time
    // had been artificially held via the extended min-hold below).
    if (btn === 'time' && this.game.timeIsFastForward) return false;
    // GameA/GameB excluded when game.modeButtonsRegisterQuickly is set:
    // this used to be genuinely needed on Chef (a quick click's debounce
    // poll could silently miss the press entirely, before the R-mux input
    // formula was fixed — see readInputRows() on SM5A), but with that
    // fixed, a real GameA/GameB press now registers reliably on its own.
    // Leaving the extension on made it actively harmful instead of just
    // unnecessary: Chef's ROM has its own "is the mode button still held?"
    // debounce loop that waits to see the button genuinely go back up
    // before it'll let gameplay actually start — with the button staying
    // logically held for up to 5 real seconds after release, that loop
    // just kept re-polling "yes" and looping (visible as the post-press
    // "3 static chefs" intro pose briefly flickering every ~1s gamma tick
    // and reverting, never settling into sustained animation) until the
    // stale hold happened to expire — matching the ~4s delay before Game A
    // "actually starts" that a real user sees, confirmed by simulating a
    // real quick release instead: gameplay starts within a few frames.
    if ((btn === 'gameA' || btn === 'gameB') && this.game.modeButtonsRegisterQuickly) return false;
    if (btn === 'gameA' || btn === 'gameB' || btn === 'time') {
      return this._hasQuadButtons() || !!this.game.needsResetForModeButtons;
    }
    // Excluded when game.hammersNeedQuickTap is set: Chef's own catch
    // mechanic reads the hammer as a discrete tap (press, then release) —
    // the extended hold below (needed so needsResetForModeButtons titles
    // register a quick GameA/GameB/Time click at all) was also catching
    // Left/Right, since Chef has no fixedRow and does have hotspots.left/
    // right. That left a real hammer tap logically "held" for up to 5 real
    // seconds after release, so the ROM's own catch-detection (which wants
    // to see the hammer actually go back up before it'll register the next
    // press) didn't process the catch until the stale hold finally expired
    // or the next round's own reset happened to clear it first — looked
    // like input was queued and only applied "at the start of the next
    // round." Other hammer titles (Popeye/Octopus/Parachute/Fire(WS)) don't
    // actually hit this in practice (none of them combine hotspots.left/
    // right with needsResetForModeButtons the way Chef does — see
    // _delayedRelease()'s own gating), so this is scoped to Chef only
    // rather than changed for every fixedRow-less hammer title.
    if ((btn === 'left' || btn === 'right') && this.game.hammersNeedQuickTap) return false;
    if (btn === 'left' || btn === 'right') {
      return this.game.fixedRow === undefined && !!(this.game.hotspots.left || this.game.hotspots.right);
    }
    return false;
  }

  // Manhole/Judge/Lion/Flagman/Helmet only recognise GameA/GameB/Time from
  // a fresh reset — confirmed by hand and reproduced here. But holding the
  // button through the *entire* 300-cycle reboot isn't right either: it
  // left Manhole permanently stuck (twCount never advancing past the
  // first frame), where releasing it partway through and letting the rest
  // of boot run clean, then re-asserting it for the ongoing frame loop,
  // correctly reaches gameplay for both Judge and Manhole (and, verified
  // separately, Helmet). So: briefly flip it off ~20 cycles into the
  // reboot, then restore it once boot completes — the very next real
  // frame's _readInputs() sees that as a fresh press and still gets the
  // standard extended min-hold afterward as a second line of defence (see
  // _needsMinHold).
  _resetWithButtonHeld() {
    // game.noResetOnModeButtons: opts a _hasQuadButtons() title OUT of this
    // reset (Manhole NH-103 needs this -- see its own GAMES entry comment).
    // Confirmed via real MAME (a genuine Time/GameA K-line change, no reset)
    // that NH-103's own ROM doesn't need the reset-vector trick at all,
    // unlike the old MH-06/Judge/Lion/Flagman/Chef quirk this method exists
    // for -- _hasQuadButtons() blanket-applying it here was accidentally
    // harmless before a since-fixed CPU-core bug (see the EXCI comment in
    // exec()) changed exactly when this reset's raw cycle-burst lands, which
    // could now leave NH-103's CPU stuck CEND-halted for the rest of a play
    // session (confirmed live: the clock stopped ticking entirely).
    if (this.game.noResetOnModeButtons) return;
    if (!this._hasQuadButtons() && !this.game.needsResetForModeButtons) return;
    this.cpu.reset();
    this._prevInRows = null;
    this._syncClockToNow({
      at: 20,
      fn: () => {
        const saved = this._kButtons;
        this._kButtons = {};
        this._readInputs();
        this._kButtons = saved;
      }
    });
  }
}

// ─── Modal integration ──────────────────────────────────────────────────────

let _emu = null, _kd = null, _ku = null;
let _pendingBootKey = null; // set while the "tap to play" prompt is showing (see openPlayModal's autoBoot:false path)

// Diagnostic console helpers for the currently-open play modal instance —
// gnwPokeRam/gnwPeekRam read/write a raw nibble directly in CPU RAM
// (bm/bl-folded address, e.g. 0x30 = bm:3,bl:0), useful for manually
// forcing or inspecting game-state flags while debugging a title's ROM
// behaviour from the console.
window.gnwPokeRam = function (addr, value) {
  if (!_emu) { console.warn('[gnw] no play modal open'); return; }
  _emu.cpu.ram[addr & 0x7f] = value & 0xf;
  console.log('[gnw] ram[0x' + addr.toString(16) + '] = ' + (value & 0xf));
};
window.gnwPeekRam = function (addr) {
  if (!_emu) { console.warn('[gnw] no play modal open'); return null; }
  return _emu.cpu.ram[addr & 0x7f] & 0xf;
};
// Developer Mode (index.html's gnwToggleDevMode) wants a genuinely
// UNMODIFIED boot to shadow-watch -- not just skipping the wall-clock RAM
// poke, but also making sure no button is left logically held over from
// whatever the normal play session was doing (including startAttract()'s
// own auto-Time-hold that puts fixedRow titles like Vermin straight into
// its demo/clock state on open -- real hardware powering on doesn't have
// a button held either). Anything less is itself an artificial starting
// condition, which defeats the purpose for a view meant to validate real
// decompiled control flow: stopAttract() cancels any pending/active
// attract timers and releases whatever IT was holding, and _kButtons is
// cleared outright on top of that in case ordinary gameplay (not attract
// mode) had a button held at the moment Developer Mode was toggled on.
window.gnwDevModeCleanReset = function () {
  if (!_emu) return false;
  _emu.stopAttract();
  _emu._kButtons = Object.create(null);
  _emu.cpu.reset();
  _emu._prevInRows = null;
  _emu._commitAssistActive = false;
  return true;
};
// The reverse direction (Developer Mode -> Play Mode) needs to be a real
// transition too, not just a CSS/panel toggle leaving the shadow-watched
// CPU running exactly as Developer Mode left it -- confirmed live that
// naively toggling back showed the ROM continuing from its clean-reset
// state instead of a genuine play session. This restores the same fresh
// state a newly-opened play modal actually gets: real reset, real
// wall-clock sync, and real re-entry into attract/demo mode.
window.gnwPlayModeFreshBoot = function () {
  if (!_emu) return false;
  _emu.stopAttract();
  _emu._kButtons = Object.create(null);
  _emu.cpu.reset();
  _emu._prevInRows = null;
  _emu._commitAssistActive = false;
  _emu._syncClockToNow();
  _emu.startAttract();
  return true;
};
// Developer Mode's live shadow-execution view needs to wrap cpu.step()
// itself (same instrumentation pattern already proven in this project's
// offline tracer scripts, ported to run live) to know the real address
// executed on every single step, not just a periodic snapshot. Returns
// the live cpu object directly rather than wrapping step() here in
// gnw.js -- index.html owns the highlighting logic, this just exposes
// the one thing it can't get any other way.
window.gnwGetActiveCpu = function () {
  return _emu ? _emu.cpu : null;
};
// Same idea as gnwGetActiveCpu, for Developer Mode's segment-level pin
// highlighting -- it needs disp.state (the real debounced/decayed on-off
// state GnwDisplay actually paints to the screen, not a raw lcd[] bit
// re-derivation that would miss the decay/hysteresis this engine applies)
// to know which segments are genuinely visible right now.
window.gnwGetActiveDisp = function () {
  return _emu ? _emu.disp : null;
};
// Manually drives N synthetic 1000/60ms frames on the currently-open play
// modal instance, bypassing real wall-clock/rAF timing entirely — useful in
// automated/sandboxed tabs where rAF throttling can silently starve
// real-time progress, or for stepping past a boot/attract sequence quickly.
window.gnwStepFrames = function (n) {
  if (!_emu) { console.warn('[gnw] no play modal open'); return null; }
  const frameMs = 1000 / 60;
  let t = _emu.t0 || performance.now();
  for (let i = 0; i < n; i++) {
    t += frameMs;
    _emu.raf = 1;
    _emu._frame(t);
  }
  return window.gnwPeekState();
};
window.gnwPeekState = function () {
  if (!_emu) return null;
  const cpu = _emu.cpu;
  return { pc: cpu.pc.toString(16), halt: cpu.halt, lcdSum: cpu.lcd.reduce((a,b)=>a+b,0), ram30: cpu.ram[0x30]&0xf };
};
// Diagnostic snapshot of the currently-open play modal instance's internal
// state — button-hold bookkeeping, CPU display-commit counters, and the raw
// LCD segment array — for debugging input-timing or display-refresh issues
// from the console.
window.gnwDebugEmu = function () {
  if (!_emu) return null;
  return {
    needsResetForModeButtons: !!_emu.game.needsResetForModeButtons,
    hasQuadButtons: _emu._hasQuadButtons(),
    kButtons: Object.assign({}, _emu._kButtons),
    keys: Object.assign({}, _emu.keys),
    twCount: _emu.cpu._twCount,
    cendCount: _emu.cpu._cendCount,
    lcd: Array.from(_emu.cpu.lcd),
  };
};

// `scripted` is true only for the attract-mode driver's own calls — real
// clicks/taps from the page never pass it, so they always hand off control.
// `btn` is just a button name (left/right/gameA/gameB/time/btn1-4) — which
// ones actually do anything depends on the currently-loaded game's hotspots.
window.gnwPress = function (btn, scripted) {
  if (!scripted && _emu) _emu.stopAttract();
  if (!_emu) return;
  _emu._kButtons[btn] = true;
  _emu._bumpReleaseToken(btn);
  if (btn === 'gameA' || btn === 'gameB' || btn === 'time') _emu._resetWithButtonHeld();
};
window.gnwRelease = function (btn, scripted) {
  if (!_emu) return;
  _emu._delayedRelease(btn, _emu._needsMinHold(btn), () => delete _emu._kButtons[btn]);
};
window.gnwTap = function (btn, scripted) {
  if (btn === 'reset') {
    if (!scripted && _emu) _emu.stopAttract();
    if (_emu) _emu.resetGame();
    return;
  }
  gnwPress(btn, scripted); setTimeout(() => gnwRelease(btn, scripted), 120);
};

// Tears down whatever interactive instance is currently running (if any),
// without touching any overlay's visibility — shared by closePlayModal() and
// the lightbox's emulator slide, which both host the same relocatable markup.
function _stopPlayEmulator() {
  if (_rewinding) window.gnwStopRewind();
  if (_emu) { _emu.stop(); _emu = null; }
  if (_kd)  { document.removeEventListener('keydown', _kd); _kd = null; }
  if (_ku)  { document.removeEventListener('keyup',   _ku); _ku = null; }
  _pendingBootKey = null;
  const prompt = document.getElementById('play-start-prompt');
  if (prompt) prompt.style.display = 'none';
  // Wipe the LCD segments so the device we're leaving never ghosts onto the
  // next one: its frozen last frame would otherwise sit in these containers
  // through the next device's open/zoom-in (before that device's own SVG has
  // fetched and mounted) and linger as this modal closes. _bootPlayEmulator
  // refills #play-svg-container with the new title's SVG right after.
  ['play-svg-container', 'play-svg-container-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

// Every button any game might have — not every game uses all of them (Ball/
// Vermin have hammers but no quad buttons, Flagman has quad buttons but no
// hammers). Maps each to its overlay <img> id, hotspot CSS class, and
// pressed-state artwork file, so _applyGameArtwork can show/position only
// what a given game's `hotspots` actually defines and hide the rest.
const BUTTON_DEFS = {
  left:  { imgId: 'play-btn-img-left',  hotspotClass: 'hammer-left',  file: 'Animation/Left-Flat.png' },
  right: { imgId: 'play-btn-img-right', hotspotClass: 'hammer-right', file: 'Animation/Right-Flat.png' },
  btn1:  { imgId: 'play-btn-img-btn1',  hotspotClass: 'quad-btn1',    file: 'Animation/1-Flat.png' },
  btn2:  { imgId: 'play-btn-img-btn2',  hotspotClass: 'quad-btn2',    file: 'Animation/2-Flat.png' },
  btn3:  { imgId: 'play-btn-img-btn3',  hotspotClass: 'quad-btn3',    file: 'Animation/3-Flat.png' },
  btn4:  { imgId: 'play-btn-img-btn4',  hotspotClass: 'quad-btn4',    file: 'Animation/4-Flat.png' },
  gameA: { imgId: 'play-btn-img-gameA', hotspotClass: 'round-a',      file: 'Animation/Grey-Flat-1.png' },
  gameB: { imgId: 'play-btn-img-gameB', hotspotClass: 'round-b',      file: 'Animation/Grey-Flat-2.png' },
  time:  { imgId: 'play-btn-img-time',  hotspotClass: 'round-time',   file: 'Animation/Grey-Flat-3.png' },
  // Snoopy Tennis's shape: one hammer-style button (Hit, where Left normally
  // sits) plus a stacked pair (Up/Down, where Right normally sits) instead
  // of a second hammer or a 4-way quad pad — no existing BUTTON_DEFS entry
  // fit, so these three are new.
  hit:   { imgId: 'play-btn-img-hit',   hotspotClass: 'updown-hit',   file: 'Animation/Hit-Flat.png' },
  up:    { imgId: 'play-btn-img-up',    hotspotClass: 'updown-up',    file: 'Animation/Up-Flat.png' },
  down:  { imgId: 'play-btn-img-down',  hotspotClass: 'updown-down',  file: 'Animation/Down-Flat.png' },
  // Mario's Cement Factory's own dedicated third button (drops the cement
  // bucket) -- physically separate from Left/Right, no existing shape fit.
  open:  { imgId: 'play-btn-img-open',  hotspotClass: 'hammer-open',  file: 'Animation/Jump-Flat.png' },
  // Donkey Kong Jr.'s own dedicated Jump button, sitting opposite a genuine
  // single 4-way D-pad cluster (reused via btn1-4, see its GAMES entry
  // comment) -- same shape/position as Cement Factory's Open, different
  // name/artwork file, so its own BUTTON_DEFS entry rather than reusing
  // 'open' (titles never share a live instance, but distinct names keep
  // the DOM lookup unambiguous).
  jump:  { imgId: 'play-btn-img-jump',  hotspotClass: 'hammer-jump',  file: 'Animation/Jump-Flat.png' },
  // Super Mario Bros' third round mode button -- every prior title's
  // 'alarm' K-line bit (present in several inputRows tables already) has
  // never had an actual on-screen button wired to it before now; this
  // title's real MAME layout treats it as a genuinely separate, clickable
  // button from Game/Time (its own Grey-Flat-1.png artwork position), so
  // it gets its own shape rather than silently reusing gameB's slot for a
  // button that isn't Game B.
  alarm: { imgId: 'play-btn-img-alarm', hotspotClass: 'round-alarm',  file: 'Animation/Grey-Flat-1.png' },
};

// Sets a unit-image element's src and, once it actually loads, stamps its
// real natural aspect ratio onto containerId's CSS aspect-ratio — shared by
// the Play modal (_applyGameArtwork) and each collection-tile preview
// (gnwMountTilePreview), the two places a device's case artwork is shown at
// a size other than the image's own pixels. Attaching the listener before
// setting src catches both the cached-and-fires-async case (virtually all
// browsers) and the not-yet-cached case; if the image is already loaded by
// the time this runs (imgEl.complete), apply immediately too since a fresh
// 'load' listener never fires for an already-complete image.
// hint: optional known aspect-ratio ("W / H") for this title (game.unitAspect),
// applied synchronously up front so the box already has the right shape before
// Unit.png has even started loading. Without it, .play-device sits at its CSS
// default (2227/1500, the Silver/Gold ratio) until the 'load' handler below
// corrects it — invisible for titles close to that ratio, but for the two
// Super Colour titles (997/2094) and two Multi Screen titles (1767/2199), both
// far taller/narrower than the default, that correction visibly snapped the
// whole device box a beat after the modal opened ("the CSS resizes the device
// a little", reported live). The 'load' handler still runs regardless of the
// hint — it's the actual source of truth (so a wrong/stale hint self-corrects
// visibly instead of silently drifting), the hint just avoids ever painting
// the wrong shape first.
function _applyUnitAspectRatio(imgId, src, containerId, hint) {
  const imgEl = document.getElementById(imgId);
  if (!imgEl) return;
  const containerEl = document.getElementById(containerId);
  if (hint && containerEl) containerEl.style.aspectRatio = hint;
  const apply = () => {
    if (containerEl && imgEl.naturalWidth && imgEl.naturalHeight) {
      containerEl.style.aspectRatio = imgEl.naturalWidth + ' / ' + imgEl.naturalHeight;
    }
  };
  imgEl.addEventListener('load', apply, { once: true });
  imgEl.src = src;
  if (imgEl.complete) apply();
}

// Applies a game's artwork paths, screen-glass box, and button-hotspot
// positions to the shared #play-emu-root markup — needed because that one
// set of DOM nodes gets reused for whichever game is currently loaded.
// Zoom-view state (see the Zoom functions after this) -- reset whenever the
// normal artwork is (re)applied, e.g. a fresh game boot.
let _zoomActive = false;
let _zoomStartW = 0;       // device width in the normal (un-zoomed) view -- the curtain's closed size
function _applyGameArtwork(gameKey) {
  const game = GAMES[gameKey];
  const art = game.artPath;
  _zoomActive = false;
  const _dev0 = document.getElementById('play-device');
  if (_dev0) { _dev0.classList.remove('play-zoomed'); _dev0.style.width = ''; _dev0.style.height = ''; _dev0.style.clipPath = ''; }
  const _ov0 = document.getElementById('play-overlay');
  if (_ov0) { _ov0.classList.remove('play-zoom-wide'); _ov0.classList.remove('play-zoom-clip'); }
  const setSrc = (id, file) => { const el = document.getElementById(id); if (el) el.src = art + file; };
  // Wide Screen titles' Unit.png is a genuinely different, taller aspect
  // ratio (2611x1579) than the Silver/Gold series (2227x1500) — real Wide
  // Screen devices are physically more elongated. .play-device's CSS
  // aspect-ratio used to be hardcoded to the Silver dimensions for every
  // title, silently squishing every Wide Screen device's artwork to match
  // (object-fit:fill on the unit image stretches it to whatever box it's
  // given). Derived from the actual loaded image's natural size here
  // instead of a maintained per-game constant, so it can never drift from
  // the real artwork.
  _applyUnitAspectRatio('play-unit-img', art + 'Unit.png', 'play-device', game.unitAspect);
  // Multi Screen titles (game.screen2) have no single Background.png -- each
  // screen gets its own Background-Top.png/Background-Bottom.png, set below.
  if (!game.screen2) setSrc('play-lcd-bg', 'Background.png');

  const screenEl = document.getElementById('play-svg-container');
  const lcdBgEl = document.getElementById('play-lcd-bg');
  const hideEl = document.getElementById('play-lcd-hide');
  // Ball's hiding-line mask (see GAMES.ball's own comment) sits ABOVE the
  // segments (drawn after #play-svg-container in the static markup) but
  // confined to the exact same screen-glass box, so it never bleeds onto
  // the surrounding device frame. Most titles don't have one.
  if (hideEl) {
    if (game.hideLines) { hideEl.src = art + 'Background2.png'; hideEl.style.display = ''; }
    else { hideEl.removeAttribute('src'); hideEl.style.display = 'none'; }
  }
  // game.lcdInverted: real "inverted lcd screen" titles (confirmed via the
  // MAME driver source's own hardware description, so far only the
  // Panorama-series Donkey Kong Jr./Mickey Mouse/Donkey Kong Circus/
  // Mario's Bombs Away) trace their segments as light/white marks, not the
  // usual dark ones -- the shared mix-blend-mode:multiply every other
  // title's #play-svg-container svg CSS rule relies on (segment colour
  // tints through the backdrop texture) actively HIDES a white segment
  // against a dark backdrop instead (white × dark ≈ dark, "on" and "off"
  // become visually identical -- confirmed live as a real, silent
  // rendering bug: 123 of 131 segments genuinely had visibility:visible
  // with a correct #fffffe fill, yet nothing showed at all). The
  // .lcd-inverted class (see its own CSS rule) switches mix-blend-mode to
  // normal instead, so these segments paint as plain opaque shapes over
  // the (now solid black, not the real hardware's own multiply-tinted
  // texture -- see each title's own Background.png comment) backdrop.
  // (screenEl2 isn't declared yet at this point in the function -- see the
  // matching toggle call further down, right after its own declaration.)
  if (screenEl) screenEl.classList.toggle('lcd-inverted', !!game.lcdInverted);
  [screenEl, lcdBgEl, hideEl].forEach(el => {
    if (!el) return;
    // Crystal Screen titles are the one case where the backing does NOT
    // share the segments' box: MAME insets it a little inside the panel
    // (see CRYSTAL_SHELL.bg), and at these sizes the difference shows.
    const rect = (game.panel && el === lcdBgEl) ? game.panel.bg : game.screen;
    el.style.left = rect.left + '%';
    el.style.top = rect.top + '%';
    el.style.width = rect.width + '%';
    el.style.height = rect.height + '%';
  });

  // Multi Screen titles only (game.dualScreen/game.screen2) -- second LCD
  // glass/segment box for the bottom screen. Hidden for every other title.
  const screenEl2 = document.getElementById('play-svg-container-2');
  const lcdBgEl2 = document.getElementById('play-lcd-bg-2');
  if (screenEl2) screenEl2.classList.toggle('lcd-inverted', !!game.lcdInverted);
  if (game.screen2) {
    // game.bgFile/bgFile2: every dual-screen title before Lifeboat is
    // vertically stacked (top/bottom LCDs), so 'Background-Top.png'/
    // '-Bottom.png' was safe to hardcode. Lifeboat is the first genuinely
    // WIDE (left/right LCD) Multi Screen title -- its real artwork bundle
    // names the files 'Background-Left.png'/'-Right.png' instead, so this
    // pair of fields lets a title override the filenames while every
    // existing top/bottom title keeps working unchanged via the defaults.
    setSrc('play-lcd-bg-2', game.bgFile2 || 'Background-Bottom.png');
    setSrc('play-lcd-bg', game.bgFile || 'Background-Top.png');
    [screenEl2, lcdBgEl2].forEach(el => {
      if (!el) return;
      // 'block', not '' -- '' just clears any inline override and falls
      // back to the stylesheet's own display:none default (see the CSS
      // comment above #play-svg-container-2), which left this box
      // permanently hidden even once positioned correctly (confirmed live:
      // the bottom screen never appeared despite its box/segments/SVG all
      // being present and correct in the DOM).
      el.style.display = 'block';
      el.style.left = game.screen2.left + '%';
      el.style.top = game.screen2.top + '%';
      el.style.width = game.screen2.width + '%';
      el.style.height = game.screen2.height + '%';
    });
  } else {
    if (screenEl2) screenEl2.style.display = 'none';
    if (lcdBgEl2) lcdBgEl2.style.display = 'none';
  }

  for (const name in BUTTON_DEFS) {
    const def = BUTTON_DEFS[name];
    const imgEl = document.getElementById(def.imgId);
    const hotspotEl = document.querySelector('#play-emu-root .play-hotspot.' + def.hotspotClass);
    const hs = game.hotspots[name];
    if (hs) {
      // game.noPressedArt: this title's artwork bundle ships no
      // pressed-state PNGs, so there's nothing to light up on press --
      // currently just the Table Top cabinet, whose bundle only draws
      // button art for the Panorama shell it lives in. The hotspot is still
      // placed and still works; only the visual feedback is absent. Without
      // this the loop would point every overlay at a file that 404s.
      if (imgEl) {
        if (game.noPressedArt) { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }
        else { imgEl.src = art + def.file; imgEl.style.display = ''; }
      }
      if (hotspotEl) {
        hotspotEl.style.display = '';
        hotspotEl.style.left = hs.left + '%';
        hotspotEl.style.top = hs.top + '%';
        hotspotEl.style.width = hs.width + '%';
        hotspotEl.style.height = hs.height + '%';
      }
    } else {
      if (imgEl) imgEl.style.display = 'none';
      if (hotspotEl) hotspotEl.style.display = 'none';
    }
  }

  // Show/hide the whole Left/Right vs 1/2/3/4 control-bar groups depending
  // on which set of buttons this game actually has.
  const hammerGroup = document.querySelector('#play-overlay .play-hammer-controls');
  const quadGroup = document.querySelector('#play-overlay .play-quad-controls');
  const updownGroup = document.querySelector('#play-overlay .play-updown-controls');
  const openGroup = document.querySelector('#play-overlay .play-open-controls');
  const jumpGroup = document.querySelector('#play-overlay .play-jump-controls');
  // Micro Vs. only. Gated on game.microVs rather than on a hotspot the way
  // every other group is, precisely because this shape HAS no movement
  // hotspots -- there's nothing on the console to click (see
  // MICROVS_HOTSPOTS), which is exactly why its controls have to appear
  // here. Also swap in each title's own name for the action button: Boxing
  // punches, Donkey Kong 3 sprays, Hockey shoots -- same mechanism as
  // jumpLabel does for the single-button titles.
  const microVsGroup = document.querySelector('#play-overlay .play-microvs-controls');
  if (microVsGroup) microVsGroup.style.display = game.microVs ? 'contents' : 'none';
  if (game.microVs) {
    const fireLabel = game.fireLabel || 'Fire';
    const f1 = document.getElementById('play-fire-label');
    const f2 = document.getElementById('play-p2fire-label');
    if (f1) f1.textContent = fireLabel;
    if (f2) f2.textContent = fireLabel;
  }
  if (hammerGroup) hammerGroup.style.display = game.hotspots.left ? 'contents' : 'none';
  if (quadGroup) quadGroup.style.display = game.hotspots.btn1 ? 'contents' : 'none';
  // Gated on hotspots.up, not hotspots.hit -- this same three-button
  // (Hit/Up/Down) group is shared by two different real shapes: Snoopy
  // Tennis's hit+up/down cluster (has both), and Super Mario Bros./
  // Climber/Balloon Fight's plain D-pad+jump cluster (up/down but no hit
  // at all). Gating on hotspots.hit alone left the whole group -- Up and
  // Down included -- hidden for the second shape even though those three
  // titles' emulator core already reads Up/Down input correctly; only the
  // on-screen control-bar entries for them were missing. The Hit button
  // itself still needs its own visibility check below since it doesn't
  // apply to the second shape.
  if (updownGroup) updownGroup.style.display = game.hotspots.up ? 'contents' : 'none';
  const hitCtrlBtn = document.getElementById('play-ctrl-hit');
  if (hitCtrlBtn) hitCtrlBtn.style.display = game.hotspots.hit ? '' : 'none';
  if (openGroup) openGroup.style.display = game.hotspots.open ? 'contents' : 'none';
  if (jumpGroup) jumpGroup.style.display = game.hotspots.jump ? 'contents' : 'none';
  // Balloon Fight's single action button is physically labeled "Eject" on
  // the real device (it ejects air to fly, not a jump) -- every other
  // title sharing this same internal `jump` hotspot/button plumbing
  // (Donkey Kong Jr., Super Mario Bros., Climber) really is a jump button,
  // so the label is per-game rather than renaming the shared mechanism.
  const jumpLabelEl = document.getElementById('play-jump-label');
  if (jumpLabelEl) jumpLabelEl.textContent = game.jumpLabel || 'Jump';
  const jumpHotspotEl = document.getElementById('play-hotspot-jump');
  if (jumpHotspotEl) jumpHotspotEl.title = game.jumpLabel || 'Jump';

  _applyPanelLayers(game, {
    overlay:   document.getElementById('play-lcd-overlay'),
    gradient:  document.getElementById('play-gradient'),
    gradient2: document.getElementById('play-gradient-2'),
  });

  // game.unitBehindScreen -- see the .unit-behind CSS. Only the Table Top
  // cabinet needs it: its unit art has no window cut for the LCD.
  const playDeviceEl = document.getElementById('play-device');
  if (playDeviceEl) {
    playDeviceEl.classList.toggle('unit-behind', !!game.unitBehindScreen);
    // Non-rectangular cases (Micro Vs./Panorama/Table Top) need their #111 box
    // backing dropped so the empty silhouette corners aren't a black rectangle.
    // Stamp the series so the per-series .play-device CSS can target them; the
    // gameKey->series map is built in index.html (a gameKey has no series here).
    const _series = (window.GNW_KEY_TO_SERIES && window.GNW_KEY_TO_SERIES[gameKey]) || '';
    if (_series) playDeviceEl.dataset.series = _series; else delete playDeviceEl.dataset.series;
  }

  const titleEl = document.querySelector('#play-overlay .modal-title');
  if (titleEl) titleEl.innerHTML = game.title + ' <span style="font-weight:400;font-size:13px;color:var(--muted)">' + game.subtitle + '</span>';
}

// ---- Zoom view (Table Tops) --------------------------------------------
// A title's `zoom` config (currently the Table Tops) is a close-up "Zoom"
// layout -- a bigger screen so the tiny LCD is actually playable (via keyboard;
// the on-device hotspots are cropped out and hidden in zoom, see .play-zoomed).
// Toggling swaps the unit image to the zoom art and moves the LCD backing +
// segments to the zoom layout's larger screen rect; toggling off re-applies the
// normal artwork.
window.gnwGameHasZoom = function (gameKey) { return !!(GAMES[gameKey] && GAMES[gameKey].zoom); };
window.gnwIsZoomed = function () { return _zoomActive; };

// Curtain animation, "final image first, then move the curtains" both ways:
//  * OPEN: the zoom art is applied and the device pinned to its FINAL (wide)
//    size FIRST, then a clip-path inset draws the sides open from the old narrow
//    width to full -- only the sides move, art + LCD stay at a fixed scale (never
//    scaled up, which read as a "zoom in"). #play-emu-root is a full-width centred
//    clipper (see CSS) holding the oversized device centred with overflow hidden.
//  * CLOSE: the cabinet is shown FIRST (_applyGameArtwork), then the modal panel
//    curtains closed around it (dropping play-zoom-wide animates its max-width
//    back to normal). The cabinet is narrower than the zoom so it can't be
//    revealed by a widening clip the way the zoom is; the panel closing in is the
//    matching motion. See the else branch's own comment.
window.gnwSetZoom = function (gameKey, on) {
  const game = GAMES[gameKey];
  const dev = document.getElementById('play-device');
  const ov = document.getElementById('play-overlay');
  if (!dev) return _zoomActive;
  const openCurtain = (fromInset) => {
    // start clipped to the narrow (closed) width with no transition, commit it,
    // then release to fully open so the CSS clip-path transition draws it out
    dev.style.transition = 'none';
    dev.style.clipPath = `inset(0 ${fromInset}px 0 ${fromInset}px)`;
    void dev.offsetWidth;
    dev.style.transition = '';
    dev.style.clipPath = 'inset(0 0px 0 0px)';
  };
  if (on && game && game.zoom) {
    const z = game.zoom;
    const start = dev.getBoundingClientRect();
    // Only a device that ISN'T already zoomed reports the true narrow (closed)
    // width. Re-opening mid-close (the user toggling faster than the ~520ms close)
    // would otherwise measure the still-final 1385px and compute a ~0 curtain,
    // so keep the cached narrow width in that case.
    if (!dev.classList.contains('play-zoomed')) _zoomStartW = start.width;
    const finalH = start.height;                        // keep the SAME height as un-zoomed
    const [aw, ah] = z.aspect.split('/').map(parseFloat);
    const finalW = finalH * (aw / ah);                  // height-bound final (open) width
    _applyUnitAspectRatio('play-unit-img', game.artPath + z.unit, 'play-device', z.aspect);
    ['play-svg-container', 'play-lcd-bg', 'play-lcd-hide'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      el.style.left = z.screen.left + '%'; el.style.top = z.screen.top + '%';
      el.style.width = z.screen.width + '%'; el.style.height = z.screen.height + '%';
    });
    // Pin to an explicit final size: as a centred flex item its width:auto would
    // collapse (all children are absolutely positioned) and its block width would
    // track the animating container and scale. Fixed px keeps it rock-steady while
    // the clip-path draws the curtain.
    dev.style.width = finalW + 'px';
    dev.style.height = finalH + 'px';
    dev.classList.add('play-zoomed');
    if (ov) { ov.classList.add('play-zoom-wide'); ov.classList.add('play-zoom-clip'); }
    openCurtain(Math.max(0, (finalW - _zoomStartW) / 2));
    _zoomActive = true;
  } else {
    // Close = "final image first, then move the curtains". Show the CABINET (the
    // destination) immediately, then curtain closed AROUND it: _applyGameArtwork
    // swaps the cabinet art/rect back and drops play-zoom-wide, and dropping that
    // class animates the modal's max-width from the wide zoom width down to normal
    // via its CSS transition -- the visible "curtains closing" -- with the cabinet
    // already in place. (The old path curtained the zoom shut first and only
    // swapped the cabinet in at the very end, which read as "inserting the final
    // image at the end" -- exactly what the user asked to avoid. The cabinet is
    // narrower than the zoom, so it can't itself be revealed BY a widening
    // curtain the way the zoom is on open; the panel closing around it is the
    // matching motion.)
    if (game) _applyGameArtwork(gameKey);  // cabinet art/rect/size + clears the pin, clip, play-zoom-wide/clip
    _zoomActive = false;
  }
  return _zoomActive;
};

/* game.panel -- extra LCD layers for titles whose screen isn't a plain
   opaque backing + segments + case. Two families need it, for different
   reasons, which is why this is `panel` (what it describes) rather than
   `crystal` (the first series that happened to want it):

     Crystal Screen (1986)  -- a genuinely TRANSPARENT LCD:
       backing                    (already drawn: .play-lcd-bg / .tile-emu-bg)
       segments, multiply         (already drawn: the SVG)
       backing AGAIN at 10%  <-- overlay: what sells "you're seeing through it"
       case                       (already drawn: Unit.png)
       Gradient  at 5%       <-- glass reflection, over the case
       Gradient2 at 10%      <-- ditto

     Micro Vs. System (1984) -- opaque, but its backing box is inset from the
       segment box, so it still needs panel.bg. Boxing additionally uses the
       overlay (10%) and two reflections (15%); Donkey Kong 3 and Hockey set
       those to alpha 0.0 in their own layouts, so they declare bg alone.

   Every number, including the alphas and which layers exist at all, is read
   off each unit's own MAME default.lay "Unit Only" view. Shared by the play
   modal and the tile preview, which build the same stack out of different
   elements -- hence taking them as a parameter rather than reaching for ids.

   Not implemented: MAME also draws a second copy of the segments at 5%
   alpha, offset a few px (a soft drop-shadow of the LCD onto its backing).
   It needs a whole second render of the segment SVG every frame -- real
   cost on a page that can have 49+ tile previews live at once -- for an
   effect that is, at 0.05, close to invisible. Revisit if the panels ever
   look too "flat" against a real unit.

   els = { overlay, gradient, gradient2 }; any may be absent. */
function _applyPanelLayers(game, els) {
  const p = game.panel;
  // Crystal ships Gradient.png/Gradient2.png; Micro Vs. names its pair
  // Gradient1.png/Gradient2.png. Per-game rather than renamed on copy, so
  // each folder keeps the filenames its MAME bundle actually shipped.
  const files = (p && p.gradientFiles) || ['Gradient.png', 'Gradient2.png'];
  const place = (el, rect, alpha, src) => {
    if (!el) return;
    // A layer is only drawn if this game actually declares it AND gives it a
    // real alpha. Both matter: a title can want panel.bg (an inset backing)
    // and no overlay at all, and MAME expresses "no layer" as alpha 0.0 --
    // drawing that would be a no-op at best and a wrong lift of the whole
    // panel at worst.
    if (!p || !rect || !(alpha > 0)) { el.style.display = 'none'; el.removeAttribute('src'); return; }
    el.src = game.artPath + src;
    el.style.left = rect.left + '%';
    el.style.top = rect.top + '%';
    el.style.width = rect.width + '%';
    el.style.height = rect.height + '%';
    el.style.opacity = alpha;
    // Explicitly 'block', not '' -- these elements' CSS default IS
    // display:none (that's what keeps them off every ordinary title), so
    // clearing the inline style would just hand them back to it.
    el.style.display = 'block';
  };
  place(els.overlay,   p && p.bg,       p && p.bgOverlayAlpha, 'Background.png');
  place(els.gradient,  p && p.gradient, p && p.gradientAlpha,  files[0]);
  place(els.gradient2, p && p.gradient, p && p.gradient2Alpha, files[1]);
}

// Core boot sequence — fetches the given game's SVG and mounts a fresh
// interactive GnwEmulator into whichever #play-svg-container/#play-dbg
// elements are currently in the document (the #play-emu-root markup gets
// relocated between the nav Play modal and the lightbox's emulator slide;
// wherever it currently lives is where this boots into). Does not touch
// overlay visibility — callers handle that themselves.
// Returns the fetch/mount promise (not just fire-and-forget) so callers
// that need the CPU to genuinely exist before proceeding -- Developer
// Mode's toggle, specifically, see gnwToggleDevMode's comment -- can
// await real completion instead of racing an in-flight SVG fetch.
// Parses raw SVG text into a mounted, styled root element the same way for
// both screens of a Multi Screen title (and the single screen of every
// other title) -- factored out so _bootPlayEmulator's dual-screen path
// doesn't duplicate this element-prep logic per screen.
function _parseGnwSvg(txt) {
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
  const svg = doc.documentElement;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'none');
  // Force explicit inline style — bypass any CSS specificity issues
  svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
  // Hide white background rect (layer ID varies per SVG -- select by its
  // consistent Inkscape label, not a hardcoded ID like 'layer2', since some
  // titles' top/bottom SVGs swap which numbered layer is the background).
  const bg = _findLayerByLabel(svg, 'white');
  if (bg) bg.style.display = 'none';
  return svg;
}

function _findLayerByLabel(svg, label) {
  const gs = svg.getElementsByTagName('g');
  for (let i = 0; i < gs.length; i++) {
    if (gs[i].getAttribute('inkscape:label') === label) return gs[i];
  }
  return null;
}

function _bootPlayEmulator(gameKey) {
  const screen = document.getElementById('play-svg-container');
  const game = GAMES[gameKey];
  if (!screen || !game) return Promise.resolve();
  _stopPlayEmulator();
  _applyGameArtwork(gameKey);

  // Multi Screen titles (game.dualScreen/svgPath2) fetch both screens' SVGs
  // in parallel and mount them together -- see GnwEmulator.mount()'s svgEl2
  // param and GnwDisplay's own comment for why a second screen needs no
  // CPU-level change, just a second display instance off the same cpu.lcd[].
  const fetchSvg = _resolveArt;   // artwork now served from firmware/artwork.json.gz via the _resolveArt gateway
  const fetches = game.svgPath2 ? Promise.all([fetchSvg(game.svgPath), fetchSvg(game.svgPath2)]) : fetchSvg(game.svgPath).then(txt => [txt, null]);

  return _romsReady.then(() => fetches)
    .then(([txt, txt2]) => {
      const svg = _parseGnwSvg(txt);
      screen.innerHTML = '';
      screen.appendChild(svg);

      let svg2 = null;
      if (txt2) {
        svg2 = _parseGnwSvg(txt2);
        const screen2 = document.getElementById('play-svg-container-2');
        if (screen2) { screen2.innerHTML = ''; screen2.appendChild(svg2); }
      }

      const dbg = document.getElementById('play-dbg');
      _emu = new GnwEmulator(gameKey);
      _emu.mount(svg, dbg, null, svg2);
      // preventDefault for every key this emulator actually binds (arrows,
      // space, 1/2/3/q/e/a/d, ...) -- without it, ArrowUp/ArrowDown/Space
      // still worked as game input, but ALSO ran the browser's own default
      // action for them (scrolling the page), so playing Crab Grab's
      // Up/Down or Spitball Sparky's Shooter (bound to Space) visibly
      // scrolled/jumped the page underneath the modal on every press.
      // KEY_TO_BUTTON-scoped rather than a blanket preventDefault so it
      // doesn't swallow unrelated keys (Tab, browser shortcuts, etc).
      // Skip game input while the user is typing in a field (the save-slot
      // comment box) -- otherwise the modal's document-level handler eats most
      // letters/arrows as game buttons and the textarea never receives them.
      _kd  = e => { if (_gnwIsTypingTarget(e.target)) return; if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'Left')) { e.preventDefault(); window.gnwStartRewind(); return; } if (e.key === '-') { e.preventDefault(); window.gnwToggleMute(); return; } if (e.key !== 'Escape') { if (KEY_TO_BUTTON[e.key]) e.preventDefault(); _emu.keydown(e); } };
      _ku  = e => { if (_gnwIsTypingTarget(e.target)) return; if (_rewinding && (e.key === 'ArrowLeft' || e.key === 'Left' || e.key === 'Control')) window.gnwStopRewind(); if (KEY_TO_BUTTON[e.key]) e.preventDefault(); _emu.keyup(e); };
      document.addEventListener('keydown', _kd);
      document.addEventListener('keyup',   _ku);
      _emu.start();
      _emu.startAttract();
      window.gnwUpdateSaveButtons();   // _emu now exists — enable Save (unless slots are full)
    })
    .catch(err => {
      console.error('[gnw] fetch/init error:', err);
      screen.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#e86;font-size:13px;">Failed to load game: ' + err.message + '</div>';
    });
}

// Moves the shared #play-emu-root markup (device art + controls) into the
// given container if it isn't already there — used to relocate the one
// interactive instance between the nav Play modal and the collection page's
// gallery/lightbox emulator slide.
function _relocatePlayEmuRoot(container) {
  const root = document.getElementById('play-emu-root');
  if (root && container && root.parentElement !== container) container.appendChild(root);
}

window.gnwBootPlayEmulator     = _bootPlayEmulator;
window.gnwStopPlayEmulator     = _stopPlayEmulator;
window.gnwRelocatePlayEmuRoot  = _relocatePlayEmuRoot;

// True only when the interactive Play emulator exists AND has left its
// attract/demo loop -- i.e. the visitor is genuinely playing, not watching the
// boot/attract sequence. startAttract() sets _attractActive=true on boot; the
// first real input calls stopAttract() (_attractActive=false). Used by the
// play-time tracker so demo mode is never counted. Strict === false so the
// brief pre-attract window (flag still undefined) doesn't count either.
window.gnwIsActivelyPlaying = function () {
  return !!(_emu && _emu._attractActive === false);
};

// opts.autoBoot: false shows the modal with the correct device art/title
// (via _applyGameArtwork) but skips fetching the ROM/SVG and starting the
// CPU/audio -- used for deep links (#/play/<key>) landing from an email or
// blog post, where nothing actually clicked "play" yet. A "Tap to play"
// prompt takes over the boot from there (see gnwStartPlayFromPrompt).
window.openPlayModal = function (gameKey, opts) {
  const overlay = document.getElementById('play-overlay');
  const home    = document.getElementById('play-modal-emu-home');
  if (!overlay || !GAMES[gameKey]) return;
  _relocatePlayEmuRoot(home);
  // Tear down any device still loaded from a previous open BEFORE applying the
  // new artwork, so the outgoing device's segments are cleared up front rather
  // than lingering behind the new device through its ~0.75s zoom-in (the boot,
  // which normally stops the old emulator, is deferred until that finishes).
  _stopPlayEmulator();
  // Apply the CORRECT device artwork BEFORE opening — .open triggers the
  // zoom-in, so setting the art first means switching straight from one game's
  // Play to another's zooms in the right device from the first frame instead of
  // flashing the previously-loaded one and snapping over.
  _applyGameArtwork(gameKey);
  openOverlay('play-overlay');
  window.gnwSyncMuteBtn();   // reflect the persisted mute state on the button
  _playPaused = false; window.gnwSyncPauseBtn();   // a freshly opened game is running, not paused
  window.gnwCloseSaveGrid(true); window.gnwUpdateSaveButtons();   // never open the save grid onto a fresh game
  if (opts && opts.autoBoot === false) {
    _stopPlayEmulator();
    _applyGameArtwork(gameKey);
    _pendingBootKey = gameKey;
    const prompt = document.getElementById('play-start-prompt');
    if (prompt) prompt.style.display = 'flex';
  } else {
    // Let the play-window zoom-in reveal (CSS animation on #play-overlay.open .modal)
    // play fully before booting: _bootPlayEmulator blocks the main thread long enough
    // to eat the whole ~0.32s animation, so booting synchronously makes the window pop
    // in at full size with no visible zoom. Wait for the animation to finish, then boot;
    // reduced-motion (animation disabled) and a safety-net timeout both boot immediately.
    const modal = overlay.querySelector('.modal');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!modal || reduce) {
      _bootPlayEmulator(gameKey);
    } else {
      let booted = false;
      const boot = () => { if (booted) return; booted = true; modal.removeEventListener('animationend', onEnd); _bootPlayEmulator(gameKey); };
      const onEnd = (e) => { if (e.target === modal && e.animationName === 'play-window-zoom-in') boot(); };
      modal.addEventListener('animationend', onEnd);
      setTimeout(boot, 850); // safety net just past the ~0.75s reveal in case animationend doesn't fire
    }
  }
};

window.gnwStartPlayFromPrompt = function () {
  const key = _pendingBootKey;
  _pendingBootKey = null;
  const prompt = document.getElementById('play-start-prompt');
  if (prompt) prompt.style.display = 'none';
  return key ? _bootPlayEmulator(key) : Promise.resolve();
};

window.closePlayModal = function () {
  window.gnwCloseSaveGrid(true);
  _stopPlayEmulator();
  closeOverlay('play-overlay');
};

// Play-modal mute — toggled by the right-justified control-bar button and the
// "−" key. Applies to the live audio immediately and is remembered (GnwAudio.init
// reads _playMuted) so it survives switching between devices.
window.gnwToggleMute = function () {
  _playMuted = !_playMuted;
  try { if (_emu && _emu.audio && _emu.audio.gain) _emu.audio.gain.gain.value = _playMuted ? 0 : 1; } catch (e) {}
  window.gnwSyncMuteBtn();
};
window.gnwSyncMuteBtn = function () {
  const btn = document.getElementById('play-mute-btn');
  if (!btn) return;
  btn.classList.toggle('muted', _playMuted);
  btn.setAttribute('aria-pressed', _playMuted ? 'true' : 'false');
  const lbl = document.getElementById('play-mute-label');
  if (lbl) lbl.textContent = _playMuted ? '🔇' : '🔊';
};

// Play-modal pause — freezes the emulator loop (cancels its rAF and suspends the
// audio context) and shows a PAUSED overlay on the screen; the button flips to a
// play icon to resume. _frame caps dt at 50ms, and resume resets t0, so there's
// no time-jump/fast-forward when unpausing. Per game session (reset on open).
const _PAUSE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor"/><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6" fill="currentColor"/></svg>';
const _PLAY_ICON  = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5 L10 6 L3 10.5 Z" fill="currentColor"/></svg>';
let _playPaused = false;
window.gnwTogglePause = function () {
  if (!_emu) return;
  _playPaused = !_playPaused;
  if (_playPaused) {
    if (_emu.raf) { cancelAnimationFrame(_emu.raf); _emu.raf = null; }
    try { if (_emu.audio && _emu.audio.ctx) _emu.audio.ctx.suspend(); } catch (e) {}
  } else {
    _emu.t0 = performance.now();                       // avoid a dt jump on resume
    try { if (_emu.audio && _emu.audio.ctx) _emu.audio.ctx.resume(); } catch (e) {}
    if (!_emu.raf) _emu.raf = requestAnimationFrame(t => _emu._frame(t));
  }
  window.gnwSyncPauseBtn();
};
window.gnwSyncPauseBtn = function () {
  const btn = document.getElementById('play-pause-toggle');
  if (btn) {
    btn.innerHTML = _playPaused ? _PLAY_ICON : _PAUSE_ICON;
    btn.title = _playPaused ? 'Resume' : 'Pause';
    btn.setAttribute('aria-label', _playPaused ? 'Resume' : 'Pause');
    btn.setAttribute('aria-pressed', _playPaused ? 'true' : 'false');
  }
  const ind = document.getElementById('play-paused-indicator');
  if (ind) ind.style.display = _playPaused ? 'flex' : 'none';
};

// ─── Visual Filmstrip Rewind ────────────────────────────────────────────────
// Scrub backward through play with a VHS-style effect. These Sharp chips carry
// tiny state (RAM + the 18-byte LCD + a few registers, ~200 bytes), so there's
// no need for anything clever like keyframes or diffs: we keep a ring of FULL
// snapshots — one per rendered frame — in slots that are PRE-ALLOCATED once, so
// capture is a pure byte-copy with zero per-frame allocation/GC, and rewind is
// an O(1) seek (no decode, no buffering — the whole point: it has to be instant).
// ~60s of history for a couple of MB. Chip-agnostic: the snapshot shape is read
// off the live cpu (same field rules as _serializeCpu), so one path covers
// SM5A/SM510/SM511/SM512. Driven by Ctrl+Left or the rewind button (hold to run).
const REWIND_CAP  = 3600;   // frames of history (~60s at 60fps)
const REWIND_STEP = 6;      // frames rewound per tick (~6x reverse speed)
class RewindBuffer {
  constructor(cpu) {
    this.cap = REWIND_CAP; this.head = 0; this.size = 0; this.steps = 0;
    this._scalar = []; this._typed = []; this._arr = [];      // field shape, read off the cpu
    for (const k in cpu) {
      if (!Object.prototype.hasOwnProperty.call(cpu, k) || /rom/i.test(k)) continue;
      const v = cpu[k];
      if (typeof v === 'number' || typeof v === 'boolean') this._scalar.push(k);
      // ANY typed array, remembering its constructor — SM5A's lcd is a
      // Uint8Array but SM510/SM511/SM512 use a Uint16Array (and ram is a
      // Uint8Array on all). Matching only Uint8Array here silently dropped the
      // Uint16 lcd, so on those chips the screen never moved while rewinding.
      else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) this._typed.push([k, v.length, v.constructor]);
      else if (Array.isArray(v)) this._arr.push([k, v.length]);
    }
    this.slots = new Array(this.cap);
    for (let i = 0; i < this.cap; i++) {
      const slot = { s: {}, u: {}, a: {} };
      for (const [k, n, Ctor] of this._typed) slot.u[k] = new Ctor(n);
      for (const [k, n] of this._arr) slot.a[k] = new Array(n).fill(0);
      this.slots[i] = slot;
    }
  }
  capture(cpu) {                                              // live cpu -> next slot (byte-copy)
    const slot = this.slots[this.head];
    for (const k of this._scalar) slot.s[k] = cpu[k];
    for (const [k] of this._typed) slot.u[k].set(cpu[k]);
    for (const [k, n] of this._arr) { const src = cpu[k], dst = slot.a[k]; for (let j = 0; j < n; j++) dst[j] = src[j]; }
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
    this.steps = 0;
  }
  stepBack() { if (this.steps >= this.size - 1) return false; this.steps++; return true; }
  restore(cpu) {                                             // slot at current rewind offset -> live cpu
    const slot = this.slots[(this.head - 1 - this.steps + this.cap * 2) % this.cap];
    for (const k of this._scalar) cpu[k] = slot.s[k];
    for (const [k] of this._typed) cpu[k].set(slot.u[k]);
    for (const [k, n] of this._arr) { const dst = cpu[k], src = slot.a[k]; for (let j = 0; j < n; j++) dst[j] = src[j]; }
  }
  commit() { this.head = (this.head - this.steps + this.cap * 2) % this.cap; this.size = Math.max(1, this.size - this.steps); this.steps = 0; }  // resume from here; drop the future we rewound past
  reset()  { this.head = 0; this.size = 0; this.steps = 0; }
}

let _rewinding = false, _rewRaf = null;
window.gnwStartRewind = function () {
  if (_rewinding || !_emu || !_emu.cpu || !_emu._rew || _emu._rew.size < 2) return;
  _rewinding = true;
  if (_emu.raf) { cancelAnimationFrame(_emu.raf); _emu.raf = null; }   // freeze forward play + audio
  try { if (_emu.audio && _emu.audio.ctx) _emu.audio.ctx.suspend(); } catch (e) {}
  window.addEventListener('blur', window.gnwStopRewind, { once: true });   // never get stuck rewinding on alt-tab
  _gnwSetRewindUI(true);
  const tick = () => {
    if (!_rewinding) return;
    for (let i = 0; i < REWIND_STEP; i++) { if (!_emu._rew.stepBack()) break; }
    _emu._rew.restore(_emu.cpu);
    if (_emu.disp)  _emu.disp.update(_emu.cpu.lcd, 1e9);   // 1e9ms drives the decay model to snap exactly to the restored frame (no ghosting)
    if (_emu.disp2) _emu.disp2.update(_emu.cpu.lcd, 1e9);
    _gnwUpdateRewindHud(_emu._rew.steps);
    _rewRaf = requestAnimationFrame(tick);
  };
  _rewRaf = requestAnimationFrame(tick);
};
window.gnwStopRewind = function () {
  if (!_rewinding) return;
  _rewinding = false;
  if (_rewRaf) { cancelAnimationFrame(_rewRaf); _rewRaf = null; }
  window.removeEventListener('blur', window.gnwStopRewind);
  if (_emu && _emu._rew) _emu._rew.commit();
  _gnwSetRewindUI(false);
  if (_emu) {                                               // resume forward play from the rewound-to point
    _emu.t0 = performance.now();
    try { if (_emu.audio && _emu.audio.ctx && !_playPaused) _emu.audio.ctx.resume(); } catch (e) {}
    if (!_emu.raf && !_playPaused) _emu.raf = requestAnimationFrame(t => _emu._frame(t));
  }
};
function _gnwSetRewindUI(on) {
  const dev = document.getElementById('play-device');         if (dev) dev.classList.toggle('gnw-rewinding', on);
  const btn = document.getElementById('play-rewind-btn');     if (btn) btn.classList.toggle('active', on);
  const ov  = document.getElementById('play-rewind-overlay');
  const ov2 = document.getElementById('play-rewind-overlay-2');
  const sc  = document.getElementById('play-svg-container');
  const sc2 = document.getElementById('play-svg-container-2');
  // Pin each scan overlay to the exact LCD glass box. _applyGameArtwork() sets
  // those boxes (inline % left/top/width/height) per title on the segment
  // containers, so mirroring them lands the VHS effect on the screen(s), never
  // the case — and drives the second overlay only when a Multi Screen title
  // actually shows its bottom/right glass (#play-svg-container-2 visible).
  const pin = (el, src, show) => {
    if (!el) return;
    if (on && show && src) {
      el.style.left = src.style.left; el.style.top = src.style.top;
      el.style.width = src.style.width; el.style.height = src.style.height;
    }
    el.classList.toggle('on', on && show);
  };
  pin(ov, sc, true);
  pin(ov2, sc2, !!(sc2 && sc2.style.display !== 'none' && sc2.style.width));
  const pausedInd = document.getElementById('play-paused-indicator');
  if (pausedInd && on) pausedInd.style.display = 'none';      // hide PAUSED while the REW HUD is up
  if (!on) window.gnwSyncPauseBtn();                          // restore PAUSED indicator if we were paused
  if (on) _gnwUpdateRewindHud(_emu && _emu._rew ? _emu._rew.steps : 0);
}
function _gnwUpdateRewindHud(stepsBack) {
  const hud = document.getElementById('play-rewind-hud');
  if (hud) hud.textContent = '◄◄ REW  ' + (stepsBack / 60).toFixed(1) + 's';
}

// Warm the browser cache with every classic device's tile artwork (LCD
// background + Unit case) so opening the collection is instant instead of the
// tiles popping in. Fire-and-forget during idle time — keeps the files as files
// (HTTP/2 parallel, full resolution, no base64 bloat), just fetched earlier.
window.gnwPreloadTileArt = function () {
  try {
    for (const key in GAMES) {
      const g = GAMES[key];
      if (!g || !g.folder) continue;
      new Image().src = g.folder + '/' + (g.bgFile || 'Background.png');
      new Image().src = g.folder + '/Unit.png';
      if (g.hideLines) new Image().src = g.folder + '/Background2.png';
    }
  } catch (e) {}
};

// ─── Save states ──────────────────────────────────────────────────────────
// A full G&W save is tiny — the CPU RAM + LCD segment state + a handful of
// registers/timers, ~200 bytes. Serialise every own DATA field of the CPU (skip
// the immutable ROM/melody), so one code path covers every chip class
// (SM5A/SM510/SM511/SM512) with no per-chip knowledge. Typed arrays are tagged
// with '#', plain arrays with '@', so restore puts each back in place.
function _serializeCpu(cpu){
  var s = {};
  for (var k in cpu){
    if (!Object.prototype.hasOwnProperty.call(cpu, k)) continue;
    if (/rom/i.test(k)) continue;                       // immutable program/melody data
    var v = cpu[k];
    if (typeof v === 'number' || typeof v === 'boolean') s[k] = v;
    else if (v instanceof Uint8Array) s['#'+k] = Array.from(v);
    else if (Array.isArray(v)) s['@'+k] = v.slice();
  }
  return s;
}
function _restoreCpu(cpu, s){
  for (var k in s){
    if (k.charAt(0) === '#'){ var a = cpu[k.slice(1)]; if (a instanceof Uint8Array) a.set(s[k]); }
    else if (k.charAt(0) === '@'){ var arr = cpu[k.slice(1)]; if (Array.isArray(arr)){ arr.length = 0; for (var i=0;i<s[k].length;i++) arr.push(s[k][i]); } }
    else if (k in cpu){ cpu[k] = s[k]; }
  }
}
// Snapshot the running game -> plain object (game key + CPU state + a copy of the
// 18-byte LCD for the thumbnail), or null if nothing is playing.
window.gnwSaveState = function(){
  if (!_emu || !_emu.cpu) return null;
  return { key: _emu.gameKey || null, ts: Date.now(),
           cpu: _serializeCpu(_emu.cpu), lcd: Array.from(_emu.cpu.lcd) };
};
// Restore a snapshot into the running game (must be the same title). The next
// frame renders straight from the restored cpu.lcd.
window.gnwLoadState = function(st){
  if (!_emu || !_emu.cpu || !st || !st.cpu) return false;
  _restoreCpu(_emu.cpu, st.cpu);
  return true;
};

// ─── Save-state UI: 12-slot grid, in-place Load view, slide-in toast ────────
// Design follows the approved mockup. Persistence is per-title in localStorage
// under gnw.saves.<gameKey>: a fixed 12-length array, each entry null or
// { ts, comment, thumb (PNG data URL), state (gnwSaveState object) }. The grid
// swaps into the play area in place (no reload) and freezes the emulator while
// it's up; Back thaws it. All of this lives here (not index.html) because it
// needs the live _emu and the on-screen LCD to build each slot's thumbnail.
const _SAVE_SLOTS = 12;
const _saveKeyFor = k => 'gnw.saves.' + k;
// True when a keystroke is destined for an editable field (the comment box) --
// game input must yield to it. Used by the play modal's keydown/keyup handlers.
function _gnwIsTypingTarget(t){
  if (!t) return false;
  var n = t.nodeName;
  return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
}
function _saveLoadSlots(key){
  try { var a = JSON.parse(localStorage.getItem(_saveKeyFor(key)) || 'null');
        if (Array.isArray(a)) { a.length = _SAVE_SLOTS; return a; } } catch (e) {}
  return new Array(_SAVE_SLOTS).fill(null);
}
function _saveStoreSlots(key, arr){
  try { localStorage.setItem(_saveKeyFor(key), JSON.stringify(arr)); } catch (e) {}
}
function _saveRelTime(ts){
  var s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  var m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  var h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

// Rasterise the live LCD — Background.png with the current segment SVG on top,
// composited exactly as the screen shows them (multiply blend, or plain paint
// over black for inverted panels) — to a small PNG data URL: a frozen snapshot
// of this instant. Async (the cloned SVG loads as an image); calls cb(url|null).
function _saveRenderThumb(cb){
  try {
    var bg   = document.getElementById('play-lcd-bg');
    var cont = document.getElementById('play-svg-container');
    var svg  = cont && cont.querySelector('svg');
    var game = _emu && _emu.game;
    if (!svg) { cb(null); return; }
    var aw = (bg && bg.naturalWidth)  || 4, ah = (bg && bg.naturalHeight) || 3;
    var W = 220, H = Math.round(W * ah / aw);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var inverted = !!(game && game.lcdInverted);
    var finish = function(){ try { cb(cv.toDataURL('image/jpeg', 0.72)); } catch (e) { cb(null); } };
    if (inverted) { ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H); }
    else if (bg && bg.complete && bg.naturalWidth) { try { ctx.drawImage(bg, 0, 0, W, H); } catch (e) {} }
    var clone = svg.cloneNode(true);
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function(){
      ctx.globalCompositeOperation = inverted ? 'source-over' : 'multiply';
      try { ctx.drawImage(img, 0, 0, W, H); } catch (e) {}
      ctx.globalCompositeOperation = 'source-over';
      finish();
    };
    img.onerror = finish;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  } catch (e) { cb(null); }
}

// Freeze/thaw the emulator around the grid — same mechanism as gnwTogglePause,
// but without touching the pause button/overlay (the grid covers the screen).
// Thaw is a no-op if the user had genuinely paused, so their pause survives.
let _gridOpen = false, _gridAudioSuspended = false;
function _saveFreeze(){
  if (!_emu) return;
  if (_emu.raf) { cancelAnimationFrame(_emu.raf); _emu.raf = null; }
  try { if (_emu.audio && _emu.audio.ctx && _emu.audio.ctx.state === 'running') { _emu.audio.ctx.suspend(); _gridAudioSuspended = true; } } catch (e) {}
}
function _saveThaw(){
  if (!_emu || _playPaused) return;
  if (_gridAudioSuspended) { try { _emu.audio.ctx.resume(); } catch (e) {} _gridAudioSuspended = false; }
  _emu.t0 = performance.now();                          // no dt jump on resume
  if (!_emu.raf) _emu.raf = requestAnimationFrame(t => _emu._frame(t));
}
// A brief bright pulse on the glass to acknowledge a load.
function _saveFlash(){
  var el = document.getElementById('play-lcd-bg'); if (!el) return;
  el.style.transition = 'none'; el.style.filter = 'brightness(2.2)';
  requestAnimationFrame(function(){
    el.style.transition = 'filter .45s'; el.style.filter = 'none';
    setTimeout(function(){ el.style.transition = ''; }, 500);
  });
}

// Inject the grid panel (into #play-emu-root, so it travels with the device),
// the toast (into body), and the CSS — once.
function _saveEnsureDom(){
  if (document.getElementById('play-save-panel')) return;
  var style = document.createElement('style');
  style.textContent =
    '#play-save-btn{--c:var(--accent)}' +
    // While the grid is open, the header shows only Back + slot info (more room
    // for the grid, and forces the user out through Back).
    '#play-head-actions.saves-open #play-save-btn,#play-head-actions.saves-open #play-load-btn,' +
      '#play-head-actions.saves-open #play-pause-toggle,#play-head-actions.saves-open #play-devmode-toggle,' +
      '#play-head-actions.saves-open #play-zoom-toggle{display:none!important}' +
    '#play-head-actions.saves-open #play-saves-headbar{display:flex!important}' +
    '#play-emu-root{position:relative}' +
    '#play-save-panel{position:absolute;inset:0;z-index:80;display:none;flex-direction:column;' +
      'background:linear-gradient(180deg,var(--bg-1),var(--bg-0));border-radius:14px;padding:16px 18px;overflow:auto}' +
    '#play-save-panel.open{display:flex}' +
    '.save-back{font:inherit;font-size:12px;font-weight:700;color:var(--text);background:transparent;' +
      'border:1px solid var(--line);border-radius:9px;padding:6px 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}' +
    '.save-back:hover{background:var(--bg-3)}' +
    // grid-auto-rows:min-content + align-*:start keep every slot at its natural
    // (minimal) height -- an expanded slot grows its own row and pushes the rows
    // below down, but empty/collapsed slots never stretch to fill it.
    // width:100% + justify-items:stretch force the grid to fill the panel so the
    // four 1fr columns are true equal fractions (otherwise the grid shrink-wraps
    // to its widest item). align-items:start keeps each slot at its own (minimal)
    // height. NB: do NOT use grid-auto-rows:min-content -- with the thumb's
    // percentage-padding aspect box it triggers a pathological intrinsic pass
    // that inflates empty rows; default auto rows size to the real content.
    '.save-grid{display:grid;width:100%;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;align-items:start;justify-items:stretch}' +
    '@media(max-width:640px){.save-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    // Flex column so the thumb + meta always stretch to the full slot width (no
    // shrink-wrapping to the meta text), and the slot is exactly as tall as its
    // content -- every slot the same minimal height.
    '.save-slot{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:var(--bg-2);' +
      'overflow:hidden;cursor:pointer;width:100%;min-width:0;align-self:start;transition:border-color .14s,box-shadow .14s}' +
    '.save-slot:hover{border-color:#3b4557}' +
    '.save-slot.expanded{border-color:rgba(155,225,93,.55);box-shadow:0 10px 26px -14px rgba(0,0,0,.7)}' +
    // Fixed-height thumb with the snapshot as a background-image (NOT an <img>):
    // sidesteps every replaced-element / aspect-ratio intrinsic-sizing pitfall
    // that inflated empty slots. Identical box for filled and empty slots.
    '.save-thumb{position:relative;width:100%;height:146px;flex:0 0 auto;background:#aeb7a2 center center/cover no-repeat;overflow:hidden;border-bottom:1px solid var(--line)}' +
    '.save-meta{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;font-size:10.5px;color:var(--muted)}' +
    '.save-idx{font-family:ui-monospace,Consolas,monospace;font-weight:800;color:var(--muted)}' +
    '.save-slot.save-empty{border-style:dashed;background:transparent}' +
    '.save-slot.save-empty .save-thumb{background:repeating-linear-gradient(135deg,rgba(255,255,255,.02) 0 10px,transparent 10px 20px)}' +
    '.save-plus{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;' +
      'border:2px dashed #3b4557;border-radius:50%;color:#5a6474;display:flex;align-items:center;justify-content:center;font-size:19px;line-height:1}' +
    '.save-slot.save-empty .save-meta{color:#5a6474}' +
    '.save-slot.save-empty:hover .save-plus{border-color:var(--accent);color:var(--accent)}' +
    // display:none (not max-height:0) so the collapsed detail contributes NOTHING
    // to the slot's intrinsic size -- otherwise grid min-content sizing counts its
    // natural height and stretches every row (and the empty slots) to the expanded
    // height. A short fade-in on expand keeps it from popping.
    '.save-detail{display:none;border-top:1px solid var(--line);animation:saveDetailIn .18s ease}' +
    '@keyframes saveDetailIn{from{opacity:0}to{opacity:1}}' +
    '.save-slot.expanded .save-detail{display:block}' +
    '.save-pad{padding:9px;display:flex;flex-direction:column;gap:8px}' +
    '.save-acts{display:flex;gap:7px}' +
    '.save-acts .save-btn{flex:1;justify-content:center;font:inherit;font-size:11.5px;font-weight:700;padding:6px 8px;' +
      'border-radius:7px;border:1px solid var(--line);background:var(--bg-3);color:var(--text);cursor:pointer;' +
      'display:inline-flex;align-items:center;gap:4px}' +
    '.save-acts .load{border-color:rgba(155,225,93,.5);color:#cbeeb0}' +
    '.save-acts .load:hover{background:rgba(155,225,93,.12)}' +
    '.save-acts .del{border-color:rgba(224,107,93,.4);color:#f0b7af}' +
    '.save-acts .del:hover{background:rgba(224,107,93,.12)}' +
    '.save-comment{width:100%;background:var(--bg-0);border:1px solid var(--line);border-radius:6px;color:var(--text);' +
      'font:inherit;font-size:12px;padding:7px 8px;resize:none;min-height:42px}' +
    '.save-comment::placeholder{color:#57616f}' +
    '#play-save-toast{position:fixed;right:22px;bottom:22px;width:min(300px,80vw);z-index:1200;' +
      'background:var(--bg-2);border:1px solid var(--line);border-radius:12px;padding:11px;display:flex;gap:11px;align-items:center;' +
      'box-shadow:0 18px 40px -16px rgba(0,0,0,.7);transform:translateX(140%);transition:transform .5s cubic-bezier(.2,.8,.25,1)}' +
    '#play-save-toast.in{transform:translateX(0)}' +
    '#play-save-toast .tthumb{width:56px;height:42px;border-radius:6px;background:#aeb7a2;flex:0 0 auto;overflow:hidden}' +
    '#play-save-toast .tthumb img{width:100%;height:100%;object-fit:cover;display:block}' +
    '#play-save-toast .tx b{font-size:13px;color:var(--text)}' +
    '#play-save-toast .tx span{display:block;font-size:11px;color:var(--muted);margin-top:1px}' +
    '#play-save-toast .check{margin-left:auto;color:var(--accent);font-size:18px}';
  document.head.appendChild(style);

  var root = document.getElementById('play-emu-root');
  if (root) {
    var panel = document.createElement('div');
    panel.id = 'play-save-panel';
    panel.innerHTML = '<div class="save-grid"></div>';   // Back + count now live in the modal header
    root.appendChild(panel);
  }
  var toast = document.createElement('div');
  toast.id = 'play-save-toast';
  toast.innerHTML = '<div class="tthumb"></div><div class="tx"><b>Game saved</b><span></span></div><div class="check">✓</div>';
  document.body.appendChild(toast);
}

function _saveRenderGrid(){
  if (!_emu) return;
  var grid = document.querySelector('#play-save-panel .save-grid');
  if (!grid) return;
  var key = _emu.gameKey;
  var slots = _saveLoadSlots(key);
  grid.innerHTML = '';
  slots.forEach(function(s, i){
    var el = document.createElement('div');
    if (!s) {
      el.className = 'save-slot save-empty';   // NB: not "empty" -- collides with the site-wide .empty{padding:60px} rule
      el.innerHTML = '<div class="save-thumb"><span class="save-plus">+</span></div>' +
        '<div class="save-meta"><span class="save-idx">' + (i + 1) + '</span><span>Save here</span></div>';
      el.onclick = function(){ _saveToSlot(i); };
    } else {
      el.className = 'save-slot';
      el.innerHTML = '<div class="save-thumb"' + (s.thumb ? ' style="background-image:url(' + s.thumb + ')"' : '') + '></div>' +
        '<div class="save-meta"><span class="save-idx">' + (i + 1) + '</span><span>' + _saveRelTime(s.ts) + '</span></div>' +
        '<div class="save-detail"><div class="save-pad">' +
          '<div class="save-acts"><button type="button" class="save-btn load">▶ Load</button>' +
          '<button type="button" class="save-btn del">🗑 Delete</button></div>' +
          '<textarea class="save-comment" placeholder="Add a note about this save…"></textarea>' +
        '</div></div>';
      el.querySelector('.save-comment').value = s.comment || '';
      el.onclick = function(e){
        if (e.target.closest('.save-detail')) return;   // don't collapse while using the panel
        var open = el.classList.contains('expanded');
        grid.querySelectorAll('.save-slot.expanded').forEach(function(x){ x.classList.remove('expanded'); });
        if (!open) el.classList.add('expanded');
      };
      el.querySelector('.load').onclick = function(){ _saveLoadSlot(i); };
      el.querySelector('.del').onclick  = function(){ _saveDeleteSlot(i); };
      el.querySelector('.save-comment').oninput = function(ev){
        var arr = _saveLoadSlots(key); if (arr[i]) { arr[i].comment = ev.target.value; _saveStoreSlots(key, arr); }
      };
    }
    grid.appendChild(el);
  });
  var used = slots.filter(Boolean).length;
  var cnt = document.getElementById('play-saves-count');
  if (cnt) cnt.textContent = used + ' / ' + _SAVE_SLOTS + ' used';
  window.gnwUpdateSaveButtons();
}

// Capture the running game into slot i (from an empty-slot tap or the header
// Save button), then persist + toast. Async because the thumbnail is.
function _saveToSlot(i){
  if (!_emu) return;
  _saveEnsureDom();                                     // toast lives in this DOM
  var key = _emu.gameKey;
  var state = window.gnwSaveState(); if (!state) return;
  _saveRenderThumb(function(thumb){
    var arr = _saveLoadSlots(key);
    arr[i] = { ts: Date.now(), comment: (arr[i] && arr[i].comment) || '', thumb: thumb, state: state };
    _saveStoreSlots(key, arr);
    if (_gridOpen) _saveRenderGrid();
    _saveShowToast(i, thumb);
    window.gnwUpdateSaveButtons();
  });
}
function _saveLoadSlot(i){
  if (!_emu) return;
  var s = _saveLoadSlots(_emu.gameKey)[i];
  if (!s || !s.state) return;
  window.gnwLoadState(s.state);
  window.gnwCloseSaveGrid();
  _saveFlash();
}
function _saveDeleteSlot(i){
  if (!_emu) return;
  var key = _emu.gameKey;
  var arr = _saveLoadSlots(key); arr[i] = null; _saveStoreSlots(key, arr);
  _saveRenderGrid();
}
function _saveShowToast(i, thumb){
  var toast = document.getElementById('play-save-toast'); if (!toast) return;
  toast.querySelector('.tthumb').innerHTML = thumb ? '<img src="' + thumb + '" alt="">' : '';
  toast.querySelector('.tx span').textContent = 'Slot ' + (i + 1) + ' · just now';
  toast.classList.add('in');
  clearTimeout(toast._t); toast._t = setTimeout(function(){ toast.classList.remove('in'); }, 2600);
}

// ── public API (called from index.html's header buttons + modal open/close) ──
window.gnwSaveSlot = function(){
  if (!_emu) return;
  var free = _saveLoadSlots(_emu.gameKey).indexOf(null);
  if (free < 0) return;                                 // full — button is disabled anyway
  _saveToSlot(free);
};
window.gnwOpenSaveGrid = function(){
  if (!_emu) return;
  _saveEnsureDom();
  _saveFreeze();
  _gridOpen = true;
  _saveRenderGrid();
  var p = document.getElementById('play-save-panel'); if (p) p.classList.add('open');
  var h = document.getElementById('play-head-actions'); if (h) h.classList.add('saves-open');
};
window.gnwCloseSaveGrid = function(silent){
  var p = document.getElementById('play-save-panel'); if (p) p.classList.remove('open');
  var h = document.getElementById('play-head-actions'); if (h) h.classList.remove('saves-open');
  if (_gridOpen && !silent) _saveThaw();
  _gridOpen = false;
};
window.gnwUpdateSaveButtons = function(){
  var save = document.getElementById('play-save-btn'); if (!save) return;
  var full = false;
  if (_emu) full = _saveLoadSlots(_emu.gameKey).indexOf(null) < 0;
  save.disabled = !_emu || full;
  save.title = full ? 'All 12 slots full — delete one to save' : 'Save game to a slot';
};

// ─── Ambient tile preview ───────────────────────────────────────────────────
// A completely separate, muted, non-interactive instance for the collection
// page's device tile — always running the Time-mode demo, never receiving
// input, so attract mode never hands off control. Independent of _emu (the
// interactive instance) so the two can never cross-talk.

// Keyed by gameKey (not a single instance) so multiple different games' tiles
// can run their own ambient preview simultaneously without stopping each other.
const _tileEmus = {};

// The big collection-page "device reveal" preview (slides in on the left when a
// tile's drawer opens) is a SEPARATE emulator instance from the tiles' own
// ambient previews -- its own single slot, not keyed into _tileEmus. That
// isolation is deliberate: gnwMountTilePreview stops any existing instance of
// the SAME gameKey (below), so routing the big reveal through _tileEmus would
// stop the clicked device's own tile preview still running behind the drawer.
const _bigPreview = { emu: null };

// containerEl must contain a child matching '.tile-emu-svg' as the SVG mount point.
// The tile's own Unit/Background artwork <img> srcs are set directly in the
// static HTML (deviceCardHTML) — this only needs gameKey for ROM/SVG/clock.
// store/storeKey say WHERE to remember the live instance (so tile previews use
// _tileEmus keyed by gameKey, the big reveal uses its own _bigPreview slot) --
// both share this one body so the mount logic never forks into parallel copies.
function _mountPreviewInto(containerEl, gameKey, store, storeKey) {
  if (!containerEl) return;
  const game = GAMES[gameKey];
  if (!game) return;
  // PREVIEW-ART OVERRIDE: a title may declare game.preview to show DIFFERENT art
  // in the non-interactive previews (tile + drawer stage) than in the Play modal.
  // Only smbspecial uses this today (full flip-lid cabinet here, zoomed crop in
  // Play). `pv` is the source of truth for the screen-glass box + segment SVG on
  // this path; the tile's Unit/Background <img> srcs are set from previewFolder in
  // deviceCardHTML/tileEmuLayersHTML. Titles without .preview fall back to `game`,
  // so every other device is byte-for-byte unaffected.
  const pv = game.preview || game;
  if (store[storeKey]) { store[storeKey].stop(); store[storeKey] = null; }
  const screen = containerEl.querySelector('.tile-emu-svg');
  if (!screen) return;
  // Same Wide-Screen-vs-Silver aspect-ratio fix as _applyGameArtwork(), for
  // the tile's own Unit.png — see _applyUnitAspectRatio's comment. The
  // tile's <img> src is already set directly in the static HTML
  // (deviceCardHTML), not here, so this just reads whatever's already
  // loading/loaded rather than assigning a new src.
  const unitEl = containerEl.querySelector('.tile-emu-unit');
  if (unitEl) {
    const applyTileAspect = () => {
      if (!unitEl.naturalWidth || !unitEl.naturalHeight) return;
      containerEl.style.aspectRatio = unitEl.naturalWidth + ' / ' + unitEl.naturalHeight;
      // .tile-emu's CSS width is a fixed 90% (see its own comment for why
      // width:auto isn't usable here) -- fine for every title whose case is
      // wide enough that width is the binding constraint, but Spitball
      // Sparky/Crab Grab's real 997x2094 case is proportionally TALLER
      // than the tile-tall-2x .img box itself, so 90% width would derive a
      // height taller than the tile and get clipped by .img's own
      // overflow:hidden (confirmed live: the LCD showed but the case
      // photo above/below it was cropped off). Recompute width down from
      // 90% whenever the device's own aspect ratio is narrower than the
      // tile's, so the resulting height instead tops out at 90% of the
      // tile -- the same "whichever axis actually binds" fix
      // .play-device's CSS got, just done here in JS since width:auto
      // can't do it for an absolutely-positioned centered box.
      const imgBox = containerEl.parentElement;
      if (!imgBox) return;
      const boxRect = imgBox.getBoundingClientRect();
      if (!boxRect.width || !boxRect.height) return;
      const deviceWH = unitEl.naturalWidth / unitEl.naturalHeight;
      const boxWH = boxRect.width / boxRect.height;
      if (deviceWH < boxWH) {
        containerEl.style.width = (90 * (deviceWH / boxWH)).toFixed(2) + '%';
      } else {
        containerEl.style.width = '90%';
      }
    };
    unitEl.addEventListener('load', applyTileAspect, { once: true });
    if (unitEl.complete) applyTileAspect();
  }
  // The CSS class's left/top/width/height are just Vermin's screen-glass
  // percentages as a fallback default (from when this was Vermin-only) —
  // every other title needs its own box applied here, same as
  // _applyGameArtwork() does for the play modal, or its LCD renders at
  // Vermin's (smaller, non-widescreen) box instead of its own.
  const bgEl = containerEl.querySelector('.tile-emu-bg');
  const hideEl = containerEl.querySelector('.tile-emu-hide');
  // game.lcdInverted -- see _applyGameArtwork()'s own comment for the full
  // writeup, same fix needed for the ambient tile preview.
  screen.classList.toggle('lcd-inverted', !!game.lcdInverted);
  [screen, bgEl, hideEl].forEach(el => {
    if (!el) return;
    // Crystal Screen backing is inset from the segments -- see the matching
    // comment in _applyGameArtwork(). (pv.screen = the preview-override glass box
    // when this title has one, else game.screen -- see the `pv` note above.)
    const rect = (game.panel && el === bgEl) ? game.panel.bg : pv.screen;
    el.style.left = rect.left + '%';
    el.style.top = rect.top + '%';
    el.style.width = rect.width + '%';
    el.style.height = rect.height + '%';
  });
  // Crystal Screen see-through panel -- same three layers the play modal
  // gets, built here out of the tile's own elements.
  _applyPanelLayers(game, {
    overlay:   containerEl.querySelector('.tile-emu-overlay'),
    gradient:  containerEl.querySelector('.tile-emu-gradient'),
    gradient2: containerEl.querySelector('.tile-emu-gradient-2'),
  });
  // Same unit-behind-the-LCD case the play modal handles -- see the
  // .unit-behind CSS.
  containerEl.classList.toggle('unit-behind', !!game.unitBehindScreen);

  // Multi Screen titles only (game.screen2/svgPath2) -- second LCD glass/
  // segment box for the bottom screen, same mechanism as _applyGameArtwork()
  // gets in the Play modal. Hidden for every other title (see the CSS
  // default for .tile-emu-bg-2/.tile-emu-svg-2).
  const screen2 = containerEl.querySelector('.tile-emu-svg-2');
  const bgEl2 = containerEl.querySelector('.tile-emu-bg-2');
  if (screen2) screen2.classList.toggle('lcd-inverted', !!game.lcdInverted);
  if (game.screen2 && screen2 && bgEl2) {
    // See _applyGameArtwork()'s own game.bgFile/bgFile2 comment -- same
    // override, needed here too since this function re-sets bgEl's src
    // unconditionally, overwriting whatever the static HTML template's own
    // GNW_EMULATED_GAMES.bgFile already put there.
    bgEl2.src = game.artPath + (game.bgFile2 || 'Background-Bottom.png');
    bgEl.src = game.artPath + (game.bgFile || 'Background-Top.png');
    [screen2, bgEl2].forEach(el => {
      el.style.display = 'block';
      el.style.left = game.screen2.left + '%';
      el.style.top = game.screen2.top + '%';
      el.style.width = game.screen2.width + '%';
      el.style.height = game.screen2.height + '%';
    });
  }

  const parseSvg = txt => {
    const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
    const svg = doc.documentElement;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
    const bg = _findLayerByLabel(svg, 'white');
    if (bg) bg.style.display = 'none';
    return svg;
  };

  const fetchSvg = _resolveArt;   // artwork now served from firmware/artwork.json.gz via the _resolveArt gateway
  // pv.svgPath = the preview-override segment art when present (smbspecial reuses
  // smbn's regardless, so this is a no-op for it, but keeps the override coherent).
  const fetches = pv.svgPath2 ? Promise.all([fetchSvg(pv.svgPath), fetchSvg(pv.svgPath2)]) : fetchSvg(pv.svgPath).then(txt => [txt, null]);

  _romsReady.then(() => fetches)
    .then(([txt, txt2]) => {
      const svg = parseSvg(txt);
      screen.innerHTML = '';
      screen.appendChild(svg);

      let svg2 = null;
      if (txt2 && screen2) {
        svg2 = parseSvg(txt2);
        screen2.innerHTML = '';
        screen2.appendChild(svg2);
      }

      const emu = new GnwEmulator(gameKey, { audio: false });
      emu.mount(svg, null, { interactive: false }, svg2);
      emu.start();
      emu.startAttract();
      store[storeKey] = emu;
    })
    .catch(() => { /* silent — tile just keeps whatever placeholder was there */ });
}

// Tile ambient previews: one live instance per gameKey (see _tileEmus).
window.gnwMountTilePreview = function (containerEl, gameKey) {
  _mountPreviewInto(containerEl, gameKey, _tileEmus, gameKey);
};

// The big left-side device reveal: its own single slot, non-interactive demo
// mode exactly like a tile preview, but isolated from _tileEmus (see the
// _bigPreview comment above). gnwStopBigPreview tears it down on drawer close.
window.gnwMountBigPreview = function (containerEl, gameKey) {
  _mountPreviewInto(containerEl, gameKey, _bigPreview, 'emu');
};
window.gnwStopBigPreview = function () {
  if (_bigPreview.emu) { _bigPreview.emu.stop(); _bigPreview.emu = null; }
};

// Omit gameKey to stop every ambient tile preview.
window.gnwStopTilePreview = function (gameKey) {
  if (gameKey) {
    if (_tileEmus[gameKey]) { _tileEmus[gameKey].stop(); _tileEmus[gameKey] = null; }
  } else {
    Object.keys(_tileEmus).forEach(k => { if (_tileEmus[k]) _tileEmus[k].stop(); });
    for (const k in _tileEmus) delete _tileEmus[k];
  }
};

})();
