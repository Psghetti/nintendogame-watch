/*
 * Tetris Jr. (Game & Watch, TR-66) — clean-room behavioural reimplementation.
 * ---------------------------------------------------------------------------
 * This is NOT an emulator: there is no ROM for this title. It is a bespoke
 * re-creation of the *rules* of the device, written from scratch. RetroFab's
 * simulation was used only as a behavioural oracle to confirm the rules; none
 * of its code or assets are present here. Architecture, naming and structure
 * below are original.
 *
 * The one thing that makes this game "Tetris Jr." rather than plain Tetris is
 * the STACK-SHIFT mechanic: the falling piece is welded to the four centre
 * columns of the bin and can never move sideways. Instead, Left/Right rotate
 * the entire settled stack cyclically around the 12-column ring, sliding the
 * pile underneath the piece. That quirk (and its exact geometry) is the
 * functional heart of the machine and is reproduced faithfully here.
 *
 * Coordinate system (a functional fact of the device, matched exactly so the
 * quirk behaves like the real thing):
 *   - 17 grid rows, indexed 0..16.
 *   - Rows 0..9   = the "chute": a 4-wide column the piece falls down.
 *                    Only columns 5..8 exist here.
 *   - Rows 10..16 = the "bin"  : the 7-row x 12-column settled playfield.
 *                    Columns 1..12 are visible; column 0 is a wrap buffer.
 *   - A piece is a 4x4 matrix whose local column c maps to grid column c+5,
 *     so a piece always occupies bin columns 5..8 (dead centre of the 12).
 */

(function (global) {
  'use strict';

  // ---- Tetromino geometry -------------------------------------------------
  // Each shape has four orientations (index 0..3). A row string uses 'x' for a
  // filled cell and ' ' for empty. These orientation tables describe how the
  // real device tumbles each piece; they are functional facts about the game,
  // re-encoded here in our own layout.
  const SHAPES = {
    I: [
      ['    ', 'xxxx', '    ', '    '],
      [' x  ', ' x  ', ' x  ', ' x  '],
      ['    ', 'xxxx', '    ', '    '],
      [' x  ', ' x  ', ' x  ', ' x  '],
    ],
    O: [
      ['    ', ' xx ', ' xx ', '    '],
      ['    ', ' xx ', ' xx ', '    '],
      ['    ', ' xx ', ' xx ', '    '],
      ['    ', ' xx ', ' xx ', '    '],
    ],
    L: [
      ['    ', 'xxx ', 'x   ', '    '],
      [' x  ', ' x  ', ' xx ', '    '],
      ['  x ', 'xxx ', '    ', '    '],
      ['xx  ', ' x  ', ' x  ', '    '],
    ],
    J: [
      ['    ', 'xxx ', '  x ', '    '],
      [' xx ', ' x  ', ' x  ', '    '],
      ['x   ', 'xxx ', '    ', '    '],
      [' x  ', ' x  ', 'xx  ', '    '],
    ],
    S: [
      ['    ', ' xx ', 'xx  ', '    '],
      [' x  ', ' xx ', '  x ', '    '],
      [' xx ', 'xx  ', '    ', '    '],
      ['x   ', 'xx  ', ' x  ', '    '],
    ],
    Z: [
      ['    ', 'xx  ', ' xx ', '    '],
      ['  x ', ' xx ', ' x  ', '    '],
      ['xx  ', ' xx ', '    ', '    '],
      [' x  ', 'xx  ', 'x   ', '    '],
    ],
    T: [
      ['    ', 'xxx ', ' x  ', '    '],
      [' x  ', ' xx ', ' x  ', '    '],
      [' x  ', 'xxx ', '    ', '    '],
      [' x  ', 'xx  ', ' x  ', '    '],
    ],
  };
  const BAG = ['I', 'O', 'L', 'J', 'S', 'Z', 'T'];

  // Grid geometry constants.
  const ROWS = 17;          // 0..16
  const COLS = 13;          // 0..12 (col 0 is the hidden wrap buffer)
  const CHUTE_TOP = 0;      // first chute row
  const CHUTE_BOT = 9;      // last chute row
  const BIN_TOP = 10;       // first bin row
  const BIN_BOT = 16;       // last / floor row
  const PIECE_OFFSET = 5;   // piece local col c -> grid col c+5
  const BIN_LEFT = 1;       // first visible bin column
  const BIN_RIGHT = 12;     // last visible bin column

  // Scoring — the exact Tetris Jr. table for 1/2/3/4 simultaneous lines.
  const LINE_SCORE = { 1: 7, 2: 25, 3: 100, 4: 400 };
  // Game B bonus time (seconds) awarded per simultaneous line count.
  const LINE_TIME = { 1: 5, 2: 15, 3: 30, 4: 45 };

  const GAME_B_SECONDS = 60;

  // Held Left/Right auto-repeat (DAS-style): a short pause after the first
  // shift, then a brisk, smooth repeat while the button stays down.
  const SHIFT_DELAY = 0.14;   // seconds before the held direction starts repeating
  const SHIFT_REPEAT = 0.06;  // seconds between repeats thereafter

  // ---- Snapshot schema ----------------------------------------------------
  // Every flat (number / boolean / string / null) field of TetrisJr that is
  // dynamic game state. Listed once here so snapshot/restore, the localStorage
  // save, and the zero-alloc rewind ring all agree on exactly what to copy —
  // there is no per-feature field list to drift out of sync. Structured state
  // (the cell[][] grid, the piece object, the small transient arrays, and the
  // scheduler's pending timers) is handled explicitly alongside this list.
  const SNAP_VERSION = 1;
  const SNAP_SCALARS = [
    'mode', 'phase', 'enabled', 'next', 'score', 'misses', 'timeLeft',
    'stackTouchedChute',
    '_gravAcc', '_softDrop', '_dropHeld',
    '_shiftDir', '_shiftAcc', '_shiftPhase',
    '_clockAcc', '_clockHalf', '_swingDir', '_swingPos',
    '_clrStep', '_missFinal', '_missStep', '_swingHitOne',
    '_demo', '_pieceSeq', '_demoSeq', '_demoWait', '_demoDropped',
  ];

  // ---- Game-over "message" glyphs -----------------------------------------
  // When a life is lost the bottom screen (the 7-row x 12-column bin) stops
  // showing the pile and instead spells a short message out of its bricks: the
  // pieces are crossed out with an "X", then the machine sighs "Oh!" / "No!"
  // (or "End" on the final miss). These 7x12 bitmaps are a functional fact of
  // what the real TR-66's LCD lights up — reproduced here from observation, in
  // our own encoding ('o' = a lit brick, space = dark). Rows map to bin rows
  // A..G (top..bottom); columns map to bin columns 1..12.
  const GLYPH = {
    X: [
      '  o     o   ',
      '   o   o    ',
      '    o o     ',
      '     o      ',
      '    o o     ',
      '   o   o    ',
      '  o     o   ',
    ],
    OH: [               // "Oh!"
      '            ',
      ' ooo o    o ',
      ' o o o    o ',
      ' o o ooo  o ',
      ' o o o o    ',
      ' ooo o o o  ',
      '            ',
    ],
    NO: [               // "No!"
      '            ',
      ' o  o      o',
      ' oo o      o',
      ' o oo ooo  o',
      ' o  o o o   ',
      ' o  o ooo o ',
      '            ',
    ],
    END: [              // "End" — shown on the game-ending third miss
      '            ',
      ' ooo       o',
      ' o         o',
      ' ooo oo  ooo',
      ' o   o o o o',
      ' ooo o o ooo',
      '            ',
    ],
  };

  // ---- A tiny cooperative scheduler --------------------------------------
  // Original, minimal replacement for the oracle's timer objects: named
  // one-shots so animation beats can be scheduled and cancelled by name.
  class Scheduler {
    constructor() { this._jobs = new Map(); this._auto = 0; }
    /** Run cb after `delay` seconds. Returns a handle key. */
    after(delay, cb, key) {
      key = key || 'job' + (this._auto++);
      this._jobs.set(key, { t: delay, cb });
      return key;
    }
    cancel(key) { this._jobs.delete(key); }
    clear() { this._jobs.clear(); }
    update(dt) {
      if (this._jobs.size === 0) return;
      for (const [key, job] of [...this._jobs]) {
        job.t -= dt;
        if (job.t <= 0) { this._jobs.delete(key); job.cb(); }
      }
    }
    // ---- snapshot support -------------------------------------------------
    // The jobs hold live function callbacks that can't be JSON-serialised nor
    // cloned. We therefore capture only DATA — each pending job's stable key and
    // its remaining delay — and rebuild the callbacks on restore from a fixed
    // registry keyed by that key (see TetrisJr._JOBS / _resolveJob). Every
    // `after()` in this engine passes an explicit, stable key, so this is lossless.
    /** -> [{ key, t }] for every pending job (no callbacks). */
    snapshot() {
      const out = [];
      for (const [key, job] of this._jobs) out.push({ key, t: job.t });
      return out;
    }
    /** Rebuild pending jobs from snapshot() data. `resolve(key)` -> a fresh cb
     *  (or null to drop an unknown/cosmetic job). */
    restore(list, resolve) {
      this._jobs.clear();
      if (!list) return;
      for (const it of list) {
        const cb = resolve(it.key);
        if (cb) this._jobs.set(it.key, { t: it.t, cb });
      }
    }
    /** Zero-alloc-friendly variant: rebuild from a flat [key, t, key, t, ...]. */
    restoreFlat(flat, resolve) {
      this._jobs.clear();
      if (!flat) return;
      for (let i = 0; i < flat.length; i += 2) {
        const cb = resolve(flat[i]);
        if (cb) this._jobs.set(flat[i], { t: flat[i + 1], cb });
      }
    }
  }

  // ---- Rewind ring --------------------------------------------------------
  // A ring of pre-allocated snapshot slots (see TetrisJr._makeSlot). Capture is
  // a byte-copy into the current slot (zero allocation on the hot path); rewind
  // is an O(1) seek back through the ring. Same shape as gnw.js's RewindBuffer.
  class RewindRing {
    constructor(game, cap) {
      this.game = game; this.cap = cap; this.head = 0; this.size = 0; this.steps = 0;
      this.slots = new Array(cap);
      for (let i = 0; i < cap; i++) this.slots[i] = game._makeSlot();
    }
    capture() {
      this.game._captureInto(this.slots[this.head]);
      this.head = (this.head + 1) % this.cap;
      if (this.size < this.cap) this.size++;
      this.steps = 0;
    }
    /** Seek one frame further back; false if we've hit the oldest frame. */
    stepBack() { if (this.steps >= this.size - 1) return false; this.steps++; return true; }
    /** Push the slot at the current rewind offset back into the live game. */
    restore() {
      const slot = this.slots[(this.head - 1 - this.steps + this.cap * 2) % this.cap];
      this.game._restoreFrom(slot);
    }
    /** Resume forward play from where we rewound to; drop the discarded future. */
    commit() { this.head = (this.head - this.steps + this.cap * 2) % this.cap; this.size = Math.max(1, this.size - this.steps); this.steps = 0; }
    reset() { this.head = 0; this.size = 0; this.steps = 0; }
  }

  // A no-op view so the engine can run headless (unit tests / verification).
  const NULL_VIEW = new Proxy({}, { get: () => () => {} });

  class TetrisJr {
    /**
     * @param {object} view  rendering sink (see README of methods at bottom)
     * @param {object} [opts]
     * @param {() => number} [opts.rng]  returns [0,1); inject for determinism
     */
    constructor(view, opts = {}) {
      this.view = view || NULL_VIEW;
      this.rng = opts.rng || Math.random;
      this.sched = new Scheduler();

      // Grid of booleans; only "valid" cells are ever set true.
      this.cell = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));

      this.mode = null;          // 'A' | 'B'
      this.phase = 'idle';       // idle | deal | play | clear | miss | over
      this.enabled = false;      // are player inputs + gravity live?
      this.piece = null;         // {shape, orient, row}
      this.next = null;          // previewed shape string
      this.score = 0;
      this.misses = 0;
      this.timeLeft = 0;         // Game B countdown (seconds)
      this.stackTouchedChute = false; // "isFull": pile has climbed into chute

      // gravity / soft-drop accumulators (seconds)
      this._gravAcc = 0;
      this._softDrop = false;
      this._dropHeld = false;    // is the player physically holding Down? (persists
                                 // across pieces so a held Down keeps soft-dropping)
      // Held stack-shift (Left/Right auto-repeat). Driven inside update() as a
      // DAS-style accumulator so it's decoupled from browser/input timing — no
      // setInterval drift, no dead spots waiting on the frame loop.
      this._shiftDir = 0;        // -1 = left, +1 = right, 0 = released
      this._shiftAcc = 0;        // seconds since the last auto-shift
      this._shiftPhase = 0;      // 0 = initial delay, 1 = repeating
      this._clockAcc = 0;        // Game B one-second tick accumulator
      this._clockHalf = 0;       // clock/demo colon+pendulum half-second toggle
      this._swingDir = -1;       // Game B pendulum direction
      this._swingPos = 4;        // Game B pendulum position 1..4

      // Resumable animation state (lifted out of scheduler closures so a
      // snapshot can capture mid-animation progress and restore() can rebuild
      // the pending timers deterministically — see snapshot()/_resolveJob()).
      this._clrRows = null;      // rows being wiped in a line-clear
      this._clrBands = null;     // which "bricks off the left" graphics to flash
      this._clrStep = 0;         // wipe column progress
      this._missFinal = false;   // is the in-progress miss the game-ending 3rd?
      this._missStep = 0;        // miss-message beat index
      this._swingHitOne = false; // Game-B fail sweep has reached pos-1

      // Demo (attract) auto-player bookkeeping.
      this._demo = false;
      this._pieceSeq = 0;        // bumped on every deal; the demo re-plans per piece
      this._demoSeq = -1;        // last piece the demo planned for
      this._demoQueue = null;    // pending planned inputs for the current piece
      this._demoPlan = null;     // the move decided for the current piece
      this._demoWait = 0;        // "thinking" beat before committing the move
      this._demoDropped = false; // has the current piece been sent to soft-drop yet
    }

    // ==== Public API =======================================================

    /** Begin a new game in mode 'A' (endless, 3 misses) or 'B' (60s sprint). */
    start(mode) {
      this.mode = mode === 'B' ? 'B' : 'A';
      this.sched.clear();
      this._clearGrid();
      this.score = 0;
      this.misses = 0;
      this._demo = false;                // a real game clears any running demo
      this.stackTouchedChute = false;
      this.piece = null;
      this.enabled = false;
      this._softDrop = false;            // never inherit a held input from before
      this._dropHeld = false;
      this._shiftDir = 0; this._shiftAcc = 0; this._shiftPhase = 0;
      this.phase = 'deal';
      this._gravAcc = 0;
      this._softDrop = false;

      this.view.reset && this.view.reset();
      this.view.setMode(this.mode);
      this.view.setMisses(0);
      this.view.hitter('idle');
      this.view.dealer('idle');

      if (this.mode === 'A') {
        this.view.clapper('open');
        this.view.swinger('off');
        this.view.setLabel('point');
        this.view.setScore(0);
      } else {
        this.view.clapper('off');
        this.timeLeft = GAME_B_SECONDS;
        this._clockAcc = 0;
        this._swingDir = -1;
        this._swingPos = 4;
        this.view.swinger(this._swingPos);
        this.view.setLabel('time');
        this.view.setTime(this.timeLeft);
      }

      // Pre-load the first previewed piece, then deal it after a beat — the
      // dealer always holds the "next" piece before tossing it into the chute.
      this._pickNext();
      this.sched.after(0.7, () => this._deal(), 'firstdeal');
      this._render();
    }

    /** Idle clock only (no gameplay): the time + pendulum. A building block; the
     *  catalogue tile/drawer uses startDemo() (attract play + live clock together). */
    startClock() {
      this.mode = 'clock';
      this.phase = 'clock';
      this.enabled = false;
      this.piece = null;
      this._demo = false;
      this.sched.clear();
      this.view.reset && this.view.reset();
      this.view.setMode && this.view.setMode(null);
      this.view.setLabel && this.view.setLabel(null);
      this._swingDir = -1;
      this._swingPos = 4;
      this.view.pendulum(this._swingPos);
      this._clockAcc = 0;
      this._clockHalf = 0;
      this._renderClock(true);
    }

    /** Attract/demo for the catalogue tile + drawer: the game auto-plays (dealer
     *  tossing bricks, lines clearing) WHILE the digits show the live time and the
     *  pendulum swings — the classic Game & Watch idle. The time takes the score's
     *  place; no pusher. */
    startDemo() {
      // Power-on segment test: light EVERY segment for 1.5s (like all Game & Watch
      // units on ACL / boot), then begin the attract. Nothing else ticks meanwhile
      // (mode/_demo cleared) so the static "all on" frame holds.
      this.mode = null;
      this.phase = 'segtest';
      this._demo = false;
      this.enabled = false;
      this.piece = null;
      this.sched.clear();
      this.view.reset && this.view.reset();
      this.view.allSegments && this.view.allSegments();
      this.sched.after(1.5, () => this._beginDemo(), 'segtest');
    }

    /** Begin the actual attract demo (after the segment test): the game auto-plays
     *  (dealer tossing bricks, lines clearing) WHILE the digits show the live time
     *  and the pendulum swings — the classic Game & Watch idle. The time takes the
     *  score's place; no pusher. */
    _beginDemo() {
      this.start('A');                    // borrow Game-A mechanics (deal / gravity / clears)
      this._demo = true;
      // A demo is NOT a game: strip the Game-A chrome. No GAME label, no POINT
      // label (the time takes the score's place), no miss heads. The CLAPPER is
      // shown on the demo screen (authentic Tetris Jr shows the clapper here, NOT
      // the swinging pendulum) — it claps on line clears via the borrowed Game-A
      // logic (mode is still 'A' internally).
      this.view.setMode && this.view.setMode(null);
      this.view.setLabel && this.view.setLabel(null);
      this.view.setMisses && this.view.setMisses(0);
      this.view.clapper && this.view.clapper('open');
      this._demoSeq = -1;
      this._demoQueue = null;
      this._demoDropped = false;
      this._swingDir = -1;
      this._swingPos = 4;
      this._clockAcc = 0;
      this._clockHalf = 0;
      this._renderClock(true);
      this.sched.after(0.4, () => this._demoTick(), 'demoauto');
    }

    /** The attract auto-player. Unlike a random driver, this actually *plays*:
     *  for each freshly dealt piece it evaluates every orientation and every
     *  cyclic bin-shift, picks the placement that keeps the pile low, flat and
     *  hole-free, then issues exactly those inputs (rotate / shift-stack / drop)
     *  — the same moves a human has on this device. The result reads as real,
     *  competent gameplay rather than a blind test. */
    _demoTick() {
      if (!this._demo) return;
      if (this.phase === 'play' && this.enabled && this.piece) {
        if (this._demoSeq !== this._pieceSeq) {
          // New piece in the chute: decide its move now, but DON'T act on it yet —
          // hold a random human "thinking" beat (0–4s) first, so the stack doesn't
          // snap into place the instant the piece appears at the top. Deciding at a
          // random moment reads as a person, not a machine reacting on frame one.
          this._demoPlan = this._planDemo();
          this._demoQueue = null;                          // null = decision not yet committed
          this._demoWait = this.rng() * 4;                 // seconds to mull it over
          this._demoSeq = this._pieceSeq;
        }
        if (this._demoQueue === null) {
          this._demoWait -= 0.16;                          // still thinking
          if (this._demoWait <= 0) this._demoQueue = this._demoPlan || [];   // now commit to the move
        } else if (this._demoQueue.length) {
          this.input(this._demoQueue.shift(), true);       // one deliberate press per tick
        }
        // The demo NEVER soft-drops — a demonstration shows the piece drifting
        // down at the calm demo gravity, not rushing it home like a player.
      }
      this.sched.after(0.16, () => this._demoTick(), 'demoauto');
    }

    /** Decide the best move for the current piece and return the input queue to
     *  reach it. Evaluates the resulting bin with the well-known El-Tetris
     *  heuristic (aggregate height / complete lines / holes / bumpiness). */
    _planDemo() {
      if (!this.piece) return [];
      const shape = this.piece.shape;
      const canShift = !this.stackTouchedChute;   // device locks shifting once the pile jams the chute
      const maxShift = canShift ? BIN_RIGHT : 1;  // 12 cyclic positions, or none
      let best = null;
      for (let o = 0; o < 4; o++) {
        for (let s = 0; s < maxShift; s++) {
          const grid = this._cloneBinShifted(s);            // bin as if Left pressed s times
          if (!this._dropSim(grid, shape, o)) continue;     // couldn't seat the piece
          const val = this._evalGrid(grid);
          if (!best || val > best.val) best = { val, o, s };
        }
      }
      if (!best) return [];
      const q = [];
      for (let i = 0; i < best.o; i++) q.push('rotate');    // rotate is anti-clockwise, +1 per press
      // Left s ≡ Right (12−s); take whichever is fewer presses.
      if (best.s > BIN_RIGHT / 2) for (let i = 0; i < BIN_RIGHT - best.s; i++) q.push('right');
      else                       for (let i = 0; i < best.s; i++) q.push('left');
      return q;
    }

    /** A copy of the settled bin after `s` cyclic Left shifts (mirrors pressing
     *  Left s times). The live piece isn't in this.cell, so it isn't included. */
    _cloneBinShifted(s) {
      const g = this.cell.map(r => r.slice());
      for (let n = 0; n < s; n++) {
        for (let r = BIN_TOP; r <= BIN_BOT; r++) {
          const row = g[r];
          const first = row[BIN_LEFT];
          for (let c = BIN_LEFT; c < BIN_RIGHT; c++) row[c] = row[c + 1];
          row[BIN_RIGHT] = first;
        }
      }
      return g;
    }

    /** Hard-drop `shape`/`orient` (welded to cols 5..8) into `grid`, mutating it.
     *  Returns false if the piece can't even be seated. */
    _dropSim(grid, shape, orient) {
      const m = SHAPES[shape][orient];
      const fits = (rr) => {
        for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
          if (m[b][c] === ' ') continue;
          const r = rr + b, col = c + PIECE_OFFSET;
          if (r > BIN_BOT) return false;
          if (r >= CHUTE_TOP && grid[r][col]) return false;
        }
        return true;
      };
      if (!fits(0)) return false;
      let R = 0;
      while (fits(R + 1)) R++;
      for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
        if (m[b][c] === ' ') continue;
        grid[R + b][c + PIECE_OFFSET] = true;
      }
      return true;
    }

    /** El-Tetris board score over the visible bin (higher = better). */
    _evalGrid(grid) {
      const h = new Array(BIN_RIGHT + 1).fill(0);
      let holes = 0, agg = 0, lines = 0;
      for (let c = BIN_LEFT; c <= BIN_RIGHT; c++) {
        let seen = false;
        for (let r = BIN_TOP; r <= BIN_BOT; r++) {
          if (grid[r][c]) { if (!seen) { seen = true; h[c] = BIN_BOT - r + 1; } }
          else if (seen) holes++;
        }
        agg += h[c];
      }
      for (let r = BIN_TOP; r <= BIN_BOT; r++) {
        let full = true;
        for (let c = BIN_LEFT; c <= BIN_RIGHT; c++) if (!grid[r][c]) { full = false; break; }
        if (full) lines++;
      }
      let bump = 0;
      for (let c = BIN_LEFT; c < BIN_RIGHT; c++) bump += Math.abs(h[c] - h[c + 1]);
      bump += Math.abs(h[BIN_RIGHT] - h[BIN_LEFT]);   // bin is a cyclic ring
      return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
    }

    _renderClock(colonOn) {
      const now = new Date();
      let h = now.getHours();
      const pm = h >= 12;
      h = h % 12; if (h === 0) h = 12;                    // 12-hour clock
      this.view.setClock && this.view.setClock(h, now.getMinutes(), colonOn, pm);
    }

    /** Stop everything (game over / external halt). */
    stop() {
      this.phase = 'over';
      this.enabled = false;
      this.sched.clear();
    }

    /**
     * Route a control input.
     * @param {'left'|'right'|'rotate'|'drop'} action
     * @param {boolean} down  true = press, false = release (only 'drop' cares)
     */
    input(action, down) {
      if (action === 'drop') {
        if (down) this._pressDrop(); else this._releaseDrop();
        return;
      }
      if (!down) return;
      if (!this.enabled) return;
      if (action === 'left') this._shiftStack(-1);
      else if (action === 'right') this._shiftStack(+1);
      else if (action === 'rotate') this._rotate();
    }

    /**
     * Set the held stack-shift direction for continuous player movement.
     * The auto-repeat itself runs in update() (see SHIFT_DELAY/SHIFT_REPEAT),
     * so holding a direction slides the bin smoothly regardless of frame or
     * input-event timing. Discrete taps still go through input('left'/'right').
     * @param {number} dir  -1 = left, +1 = right, 0 = released
     */
    setShiftHeld(dir) {
      if (this._demo) return;            // player input never disturbs the attract loop
      dir = dir < 0 ? -1 : dir > 0 ? 1 : 0;
      if (dir === this._shiftDir) return;
      this._shiftDir = dir;
      this._shiftPhase = 0;
      this._shiftAcc = 0;
      // Respond to the press instantly (the auto-repeat waits SHIFT_DELAY).
      if (dir !== 0 && this._canShiftNow()) this._shiftStack(dir);
    }

    /** May a player stack-shift land right now? (A piece is in play or being
     *  dealt — not during a line-clear, miss message, or game-over.) */
    _canShiftNow() {
      return !!this.piece && (this.phase === 'play' || this.phase === 'deal');
    }

    /** Advance the simulation by dt seconds (drive from rAF). */
    update(dt) {
      if (dt > 0.1) dt = 0.1; // clamp long frame gaps
      this.sched.update(dt);

      if (this.phase === 'play' && this.enabled) {
        // gravity / soft drop
        const interval = this._softDrop ? this._dropInterval() : this._gravityInterval();
        this._gravAcc += dt;
        while (this._gravAcc >= interval && this.phase === 'play' && this.enabled) {
          this._gravAcc -= interval;
          this._stepDown(true);
        }
      }

      // Held Left/Right auto-repeat — driven here (not on a browser timer) so the
      // slide stays smooth and never stalls waiting on the input/frame loop. It
      // runs through the deal beat too, so holding a direction glides straight
      // into the next piece with no gap.
      if (this._shiftDir !== 0 && this._canShiftNow()) {
        this._shiftAcc += dt;
        let step = this._shiftPhase === 0 ? SHIFT_DELAY : SHIFT_REPEAT;
        while (this._shiftAcc >= step && this._shiftDir !== 0 && this._canShiftNow()) {
          this._shiftAcc -= step;
          this._shiftStack(this._shiftDir);
          this._shiftPhase = 1;
          step = SHIFT_REPEAT;
        }
      }

      // Game B wall clock ticks whenever the round is live (deal/play), not
      // while paused for a line-clear animation or after game over.
      if (this.mode === 'B' && (this.phase === 'play' || this.phase === 'deal')) {
        this._clockAcc += dt;
        while (this._clockAcc >= 1) {
          this._clockAcc -= 1;
          this._tickClockB();
          if (this.phase === 'over') break;
        }
      }

      // Clock / demo idle: blink the colon twice a second, swing the pendulum once a
      // second, and keep the displayed time current. In demo the game auto-plays
      // underneath this — the classic Game & Watch idle: attract play + live clock.
      if (this.mode === 'clock' || this._demo) {
        this._clockAcc += dt;
        while (this._clockAcc >= 0.5) {
          this._clockAcc -= 0.5;
          this._clockHalf ^= 1;
          // The pure clock swings the pendulum; the DEMO shows the clapper instead
          // (it claps on clears), so it doesn't swing the pendulum here.
          if (this._clockHalf === 0 && this.mode === 'clock') {
            if (this._swingDir < 0) { this._swingPos--; if (this._swingPos <= 1) this._swingDir = 1; }
            else { this._swingPos++; if (this._swingPos >= 4) this._swingDir = -1; }
            this.view.pendulum(this._swingPos);
          }
          this._renderClock(this._clockHalf === 0);
        }
      }
    }

    /** Snapshot of state, for tests / debugging. */
    getState() {
      return {
        mode: this.mode, phase: this.phase, score: this.score,
        misses: this.misses, timeLeft: this.timeLeft,
        piece: this.piece && { ...this.piece }, next: this.next,
        grid: this.cell.map(r => r.slice()),
      };
    }

    // ==== Snapshot / restore / persistence =================================
    // ALL dynamic state divides into three kinds:
    //   • flat scalars (numbers/booleans/strings/null) — SNAP_SCALARS, below;
    //   • structured values — the cell[][] grid, the piece object, and a few
    //     small transient arrays (line-clear rows/bands, demo plan/queue);
    //   • the scheduler's PENDING TIMERS — captured as data (key + remaining
    //     delay) and rebuilt from a fixed registry, since their callbacks are
    //     live closures that can neither be JSON-serialised nor deep-copied.
    // snapshot()/restore() are the in-memory core (rewind + pause use them);
    // serialize()/deserialize() are JSON-safe wrappers for localStorage saves.
    // All values captured are already JSON-safe, so persistence needs no special
    // encoding — only a version tag + a repaint on the way back in.

    /** Deep, self-contained, JSON-safe copy of ALL dynamic state. */
    snapshot() {
      const s = { v: SNAP_VERSION };
      for (const k of SNAP_SCALARS) s[k] = this[k];
      s.cell = this.cell.map(r => r.slice());
      s.piece = this.piece ? { shape: this.piece.shape, orient: this.piece.orient, row: this.piece.row } : null;
      s.clrRows = this._clrRows ? this._clrRows.slice() : null;
      s.clrBands = this._clrBands ? this._clrBands.slice() : null;
      s.demoQueue = this._demoQueue ? this._demoQueue.slice() : null;
      s.demoPlan = this._demoPlan ? this._demoPlan.slice() : null;
      s.jobs = this.sched.snapshot();
      s.auto = this.sched._auto;
      return s;
    }

    /** Set state back exactly from a snapshot() object, then repaint the view. */
    restore(s) {
      if (!s) return false;
      for (const k of SNAP_SCALARS) if (k in s) this[k] = s[k];
      if (s.cell) for (let r = 0; r < ROWS; r++) {
        const src = s.cell[r], dst = this.cell[r];
        for (let c = 0; c < COLS; c++) dst[c] = !!src[c];
      }
      this.piece = s.piece ? { shape: s.piece.shape, orient: s.piece.orient, row: s.piece.row } : null;
      this._clrRows = s.clrRows ? s.clrRows.slice() : null;
      this._clrBands = s.clrBands ? s.clrBands.slice() : null;
      this._demoQueue = s.demoQueue ? s.demoQueue.slice() : null;
      this._demoPlan = s.demoPlan ? s.demoPlan.slice() : null;
      this.sched.restore(s.jobs, (key) => this._resolveJob(key));
      this.sched._auto = s.auto || 0;
      this._repaint();
      return true;
    }

    /** JSON-safe object for localStorage (snapshot() is already JSON-safe). */
    serialize() { return this.snapshot(); }
    /** Restore from a serialize() object (accepts a JSON string too). */
    deserialize(obj) {
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return false; } }
      if (!obj || obj.v !== SNAP_VERSION) return false;
      return this.restore(obj);
    }

    /** Rebuild a scheduler callback from its stable job key (see _JOBS). Returns
     *  null for an unknown/cosmetic key, which is simply dropped. */
    _resolveJob(key) {
      const fn = TetrisJr._JOBS[key];
      return fn ? () => fn(this) : null;
    }

    /** Repaint the full view from current state (after a restore). The view holds
     *  its own segment state between frames, so a restore must re-push everything:
     *  the grid, the numeric/label/mode/miss chrome, the preview, and the
     *  phase-appropriate character poses. Fine detail of an in-progress character
     *  animation re-syncs on its next scheduled beat. */
    _repaint() {
      const v = this.view;
      v.reset && v.reset();
      v.setMisses && v.setMisses(this._demo ? 0 : this.misses);

      if (this._demo) {
        v.setMode && v.setMode(null);
        v.setLabel && v.setLabel(null);
        // The demo shows the CLAPPER (authentic), never the swinger/pendulum — must
        // match _beginDemo, else the swinger reappears on every rewind repaint.
        v.clapper && v.clapper('open');
        this._renderClock(this._clockHalf === 0);
      } else if (this.mode === 'clock') {
        v.setMode && v.setMode(null);
        v.setLabel && v.setLabel(null);
        v.pendulum && v.pendulum(this._swingPos);
        this._renderClock(this._clockHalf === 0);
      } else if (this.mode === 'A') {
        v.setMode && v.setMode('A');
        v.setLabel && v.setLabel('point');
        v.setScore && v.setScore(this.score);
        v.clapper && v.clapper('open');
      } else if (this.mode === 'B') {
        v.setMode && v.setMode('B');
        v.setLabel && v.setLabel('time');
        v.setTime && v.setTime(this.timeLeft);
        v.clapper && v.clapper('off');
        v.swinger && v.swinger(this._swingPos);
      }

      // Character poses inferred from phase (the exact in-flight frame re-syncs
      // on the next scheduled beat of that animation).
      // The dealer + hitter are shown in real gameplay AND the demo (both toss
      // bricks / celebrate clears) — only the pure clock has none. Without this,
      // rewind's repaint dropped the dealer in the demo (brick hovering, no dealer).
      if (this.mode !== 'clock') {
        v.hitter && v.hitter(this.phase === 'clear' ? 'hit' : 'idle');
        if (!this._demo && (this.phase === 'miss' || this.phase === 'over') && this.mode === 'A') v.dealer && v.dealer('miss');
        else if (this.phase !== 'over') v.dealer && v.dealer('idle');
      }

      // Dealer's held next piece — only shown in the calm phases where he holds it.
      if (this.next && (this.phase === 'play' || this.phase === 'deal' || this.phase === 'idle')) {
        const m = SHAPES[this.next][0];
        v.setPreview && v.setPreview(this.next, [m[1], m[2]]);
      }
      this._render();
    }

    // ==== Rewind ring (pre-allocated, zero-alloc capture) ==================
    // Mirrors gnw.js's filmstrip rewind: a ring of PRE-ALLOCATED slots so each
    // per-frame capture is a byte-copy (grid + scalars written in place, no GC
    // churn), and a rewind is an O(1) seek. Capture is limited by the driver to
    // live falling-piece frames (phase play/deal) so a rewound-to frame is always
    // a clean gameplay position that resumes forward play seamlessly.

    /** Create a fresh pre-allocated rewind slot matching this engine's shape. */
    _makeSlot() {
      const s = { cell: Array.from({ length: ROWS }, () => new Array(COLS).fill(false)),
                  piece: { shape: null, orient: 0, row: 0 }, hasPiece: false,
                  jobs: [], auto: 0 };
      for (const k of SNAP_SCALARS) s[k] = this[k];
      return s;
    }

    /** Copy live state INTO a pre-allocated slot (no allocation on the hot path). */
    _captureInto(s) {
      for (const k of SNAP_SCALARS) s[k] = this[k];
      for (let r = 0; r < ROWS; r++) {
        const src = this.cell[r], dst = s.cell[r];
        for (let c = 0; c < COLS; c++) dst[c] = src[c];
      }
      if (this.piece) { s.hasPiece = true; s.piece.shape = this.piece.shape; s.piece.orient = this.piece.orient; s.piece.row = this.piece.row; }
      else s.hasPiece = false;
      // Rewind only captures play/deal frames, where these transient arrays are
      // inert; store references (cleared on restore) rather than allocating.
      s._clrRows = this._clrRows; s._clrBands = this._clrBands;
      s._demoQueue = this._demoQueue; s._demoPlan = this._demoPlan;
      // Pending timers: flat [key, t, ...] rebuilt in place (usually 0–1 entries
      // during play — e.g. a cosmetic 'clapreset').
      s.jobs.length = 0;
      for (const [key, job] of this.sched._jobs) { s.jobs.push(key, job.t); }
      s.auto = this.sched._auto;
    }

    /** Restore live state from a slot written by _captureInto, then repaint. */
    _restoreFrom(s) {
      for (const k of SNAP_SCALARS) this[k] = s[k];
      for (let r = 0; r < ROWS; r++) {
        const src = s.cell[r], dst = this.cell[r];
        for (let c = 0; c < COLS; c++) dst[c] = src[c];
      }
      this.piece = s.hasPiece ? { shape: s.piece.shape, orient: s.piece.orient, row: s.piece.row } : null;
      this._clrRows = s._clrRows ? s._clrRows.slice() : null;
      this._clrBands = s._clrBands ? s._clrBands.slice() : null;
      this._demoQueue = s._demoQueue ? s._demoQueue.slice() : null;
      this._demoPlan = s._demoPlan ? s._demoPlan.slice() : null;
      this.sched.restoreFlat(s.jobs, (key) => this._resolveJob(key));
      this.sched._auto = s.auto || 0;
      this._repaint();
    }

    /** Build a rewind ring of `cap` frames bound to this engine. */
    createRewind(cap) { return new RewindRing(this, cap || 3600); }

    // ==== Piece dealing ====================================================

    _pickNext() {
      this.next = BAG[Math.floor(this.rng() * BAG.length)];
      // Preview: rows 1..2 of the piece's spawn orientation (matches the
      // dealer holding the piece up before it drops).
      const m = SHAPES[this.next][0];
      this.view.setPreview(this.next, [m[1], m[2]]);
    }

    _deal() {
      // Dealer tosses the held piece into the chute, then reaches for a new one.
      this.enabled = false;
      this._softDrop = false;            // a fresh piece is never mid-soft-drop
      this._pieceSeq++;                  // demo: signals a new piece to plan for
      this.view.dealer('deal');
      this._sfx('deal');

      this.piece = { shape: this.next, orient: 0, row: 0 };
      // (Hands are already empty here: dealer('deal') above hides the preview,
      // since it only shows in the holding pose — so the block reads as thrown.)
      this._render();

      this.sched.after(0.42, () => this._dealFinish(), 'dealfinish');
    }

    /** The tail of a deal (scheduled 'dealfinish'): the piece goes live. Split
     *  into a named method so a snapshot taken mid-deal can rebuild this timer. */
    _dealFinish() {
      this.phase = 'play';
      this.enabled = true;
      this._gravAcc = 0;
      this.view.dealer('idle');
      this._pickNext();
      // If the player is still holding Down, keep soft-dropping straight into
      // the new piece — no need to release and re-press for every brick.
      if (this._dropHeld) this._engageDrop();
    }

    // ==== Gravity & locking ================================================

    _gravityInterval() {
      // The attract demo runs at a fixed, unhurried pace — it never accelerates
      // with score and never soft-drops, so it reads as a demonstration of the
      // game rather than a player going full tilt. Dialed down in two 20% steps
      // from the game's ~0.35s/row mid cadence (0.35 * 1.2 * 1.2 ≈ 0.5).
      if (this._demo) return 0.5;
      if (this.mode === 'B') {
        return this.stackTouchedChute ? 0.24 : 0.55;
      }
      // Game A speeds up as the score climbs, and doubles its pace once the
      // pile has crept up into the chute.
      const level = Math.floor(this.score / 60);
      let iv = Math.max(0.30, 0.80 - level * 0.05);
      if (this.stackTouchedChute) iv *= 0.4;
      return iv;
    }

    _dropInterval() { return 0.12; }

    /** One gravity step. Returns true if the piece descended, false if locked. */
    _stepDown(playSound) {
      if (!this.piece) return false;
      if (this._collidesBelow()) {
        this._lockPiece();
        return false;
      }
      this.piece.row++;
      if (playSound) this._sfx('step');
      // Visual clap on each downward step — fires in the silent demo too (the clap
      // is visual, so it's decoupled from the sound branch).
      if (this.mode === 'A') this._clap();
      this._render();
      return true;
    }

    /** True if the piece cannot descend one more row. */
    _collidesBelow() {
      const m = SHAPES[this.piece.shape][this.piece.orient];
      for (let b = 0; b < 4; b++) {
        for (let c = 0; c < 4; c++) {
          if (m[b][c] === ' ') continue;
          const r = this.piece.row + b;
          const col = c + PIECE_OFFSET;
          if (r === BIN_BOT) return true;            // resting on the floor
          if (this.cell[r + 1][col]) return true;    // resting on a block
        }
      }
      return false;
    }

    _lockPiece() {
      const m = SHAPES[this.piece.shape][this.piece.orient];
      let touchedChute = false;
      for (let b = 0; b < 4; b++) {
        for (let c = 0; c < 4; c++) {
          if (m[b][c] === ' ') continue;
          const r = this.piece.row + b;
          const col = c + PIECE_OFFSET;
          this.cell[r][col] = true;
          if (r <= CHUTE_BOT) touchedChute = true;
        }
      }
      this.stackTouchedChute = touchedChute;
      this.piece = null;
      this.enabled = false;
      this._sfx('land');
      this._render();

      const cleared = this._findFullLines();
      if (cleared.length) {
        this._clearLines(cleared);
      } else {
        this._afterSettle();
      }
    }

    // ==== The stack-shift quirk ===========================================

    /**
     * The signature Tetris Jr. mechanic. The piece never moves sideways; the
     * settled 12-column bin rotates cyclically under it. dir = -1 (Left) or
     * +1 (Right). If rotating the stack would drive a block into the piece,
     * the piece locks first (then rides one step with the rotation).
     */
    _shiftStack(dir) {
      if (this.stackTouchedChute) return; // pile jammed into chute: locked out
      if (this._shiftWouldHit(dir)) {
        this._lockPiece();
        // fall through: rotate the bin (now includes the just-locked cells)
      }
      for (let r = BIN_TOP; r <= BIN_BOT; r++) {
        const row = this.cell[r];
        if (dir < 0) {
          // cyclic left: visible cols 1..12 -> [2..12, 1]
          const first = row[BIN_LEFT];
          for (let c = BIN_LEFT; c < BIN_RIGHT; c++) row[c] = row[c + 1];
          row[BIN_RIGHT] = first;
        } else {
          // cyclic right: visible cols 1..12 -> [12, 1..11]
          const last = row[BIN_RIGHT];
          for (let c = BIN_RIGHT; c > BIN_LEFT; c--) row[c] = row[c - 1];
          row[BIN_LEFT] = last;
        }
      }
      this._sfx('shift');
      this._render();
    }

    /** Would a stack block collide with the piece if the bin rotates in dir? */
    _shiftWouldHit(dir) {
      if (!this.piece) return false;
      const m = SHAPES[this.piece.shape][this.piece.orient];
      for (let b = 0; b < 4; b++) {
        for (let c = 0; c < 4; c++) {
          if (m[b][c] === ' ') continue;
          const r = this.piece.row + b;
          if (r < BIN_TOP || r > BIN_BOT) continue; // only bin rows shift
          const neighbour = c + PIECE_OFFSET - dir;  // block moving toward us
          if (neighbour >= BIN_LEFT && neighbour <= BIN_RIGHT && this.cell[r][neighbour]) {
            return true;
          }
        }
      }
      return false;
    }

    // ==== Rotation =========================================================

    _rotate() {
      if (!this.piece) return;
      // Anti-clockwise (counter-clockwise) — the real Tetris Jr. direction.
      // The orientation tables are ordered so that stepping forward (+1)
      // turns the piece anti-clockwise.
      const nextOrient = (this.piece.orient + 1) % 4;
      const m = SHAPES[this.piece.shape][nextOrient];
      // Refuse rotation if any new cell would sit on the floor row or overlap
      // a settled block (no wall-kicks — matches the device).
      for (let b = 0; b < 4; b++) {
        for (let c = 0; c < 4; c++) {
          if (m[b][c] === ' ') continue;
          const r = this.piece.row + b;
          const col = c + PIECE_OFFSET;
          if (r === BIN_BOT) return;
          if (r >= BIN_TOP && this.cell[r][col]) return;
        }
      }
      this.piece.orient = nextOrient;
      this._sfx('rotate');
      this._render();
    }

    // ==== Soft drop ========================================================

    _pressDrop() {
      if (this._demo) return;            // player input never disturbs the attract loop
      this._dropHeld = true;             // remember the physical hold across pieces
      if (!this.enabled) return;         // engages when the next piece goes live
      this._engageDrop();
      if (this.mode === 'A') this._clap();
      this._sfx('drop');
    }

    /** Turn on the fast soft-drop cadence for the current piece. */
    _engageDrop() {
      this._softDrop = true;
      this._gravAcc = this._dropInterval(); // step immediately
    }

    _releaseDrop() {
      this._dropHeld = false;
      this._softDrop = false;
      this._gravAcc = 0;
    }

    // ==== Line clearing & settle ===========================================

    _findFullLines() {
      const full = [];
      for (let r = BIN_TOP; r <= BIN_BOT; r++) {
        let count = 0;
        for (let c = BIN_LEFT; c <= BIN_RIGHT; c++) if (this.cell[r][c]) count++;
        if (count === BIN_RIGHT) full.push(r); // all 12 visible columns
      }
      return full;
    }

    _clearLines(rows) {
      this.phase = 'clear';
      this.enabled = false;
      this.view.hitter('hit');
      this._sfx(rows.length >= 3 ? 'points2' : 'points1');

      // Which "bricks leaving off the left" graphic(s) to flash after the wipe,
      // keyed to the cleared row — matching RetroFab's Grid logic exactly:
      //   bottom row G → 1, rows F/E → 2, rows D/B/A → 3.
      //   Row C is deliberately omitted (RetroFab shows nothing for it).
      const bands = [];
      for (const r of rows) {
        const local = r - BIN_TOP;                         // 0=A(top) .. 6=G(bottom)
        const id = local === 6 ? 1
                 : (local === 5 || local === 4) ? 2
                 : (local === 3 || local === 1 || local === 0) ? 3
                 : 0;                                       // local 2 = row C → none
        if (id && !bands.includes(id)) bands.push(id);
      }

      // wipe-across animation, then collapse + score. The progress (which rows,
      // which broken-brick bands, how far the wipe has swept) lives in instance
      // fields, not a closure, so a snapshot can capture it mid-wipe and restore()
      // can re-arm the exact next beat (see _resolveJob).
      this._clrRows = rows;
      this._clrBands = bands;
      this._clrStep = 0;
      this.sched.after(0.08, () => this._wipeTick(), 'wipe');
    }

    /** One column of the line-wipe. Re-schedules itself until the row is clear,
     *  then hands off to the broken-brick flash. */
    _wipeTick() {
      this._clrStep++;
      for (const r of this._clrRows) this.cell[r][BIN_RIGHT - this._clrStep + 1] = false;
      this._render();
      if (this._clrStep < BIN_RIGHT) {
        this.sched.after(0.06, () => this._wipeTick(), 'wipe');
      } else {
        // RetroFab: 0.08s after the wipe finishes, flash the broken-bricks for
        // 0.5s, then collapse + score.
        this.sched.after(0.08, () => this._wipeBlocks(), 'blocks');
      }
    }

    /** Flash the "bricks flying off the left" graphic, then collapse + score. */
    _wipeBlocks() {
      this.view.setBlocks && this.view.setBlocks(this._clrBands);
      this.sched.after(0.5, () => this._collapseAndScore(this._clrRows), 'collapse');
    }

    _collapseAndScore(rows) {
      this.view.setBlocks && this.view.setBlocks([]); // broken-bricks flash done
      // Drop everything above each cleared row down by one.
      const sorted = rows.slice().sort((a, b) => a - b);
      for (const cleared of sorted) {
        for (let r = cleared; r > BIN_TOP; r--) {
          for (let c = BIN_LEFT; c <= BIN_RIGHT; c++) this.cell[r][c] = this.cell[r - 1][c];
        }
        for (let c = BIN_LEFT; c <= BIN_RIGHT; c++) this.cell[BIN_TOP][c] = false;
      }
      this._recomputeChuteFlag();
      this._render();

      const n = Math.min(4, rows.length);
      this.score += LINE_SCORE[n] || 0;
      if (this.mode === 'A') {
        if (!this._demo) this.view.setScore(this.score);   // demo shows the clock, not the score
      } else {
        this.timeLeft = Math.min(GAME_B_SECONDS, this.timeLeft + (LINE_TIME[n] || 0));
        this.view.setTime(this.timeLeft);
      }

      this.sched.after(0.12, () => this._clearEnd(), 'clearend');
    }

    /** Tail of a line-clear (scheduled 'clearend'): the hitter rests, then the
     *  next piece is dealt (or the board tops out). */
    _clearEnd() {
      this.view.hitter('idle');
      this._afterSettle();
    }

    /** After a piece settles (and any clears): deal the next one or top out. */
    _afterSettle() {
      if (this._canAcceptPiece()) {
        this.phase = 'deal';
        this._deal();
      } else {
        this._topOut();
      }
    }

    /** Room to drop a new piece = at least one fully-empty chute row (1..9). */
    _canAcceptPiece() {
      for (let r = 1; r <= CHUTE_BOT; r++) {
        let empty = true;
        for (let col = PIECE_OFFSET; col <= PIECE_OFFSET + 3; col++) {
          if (this.cell[r][col]) { empty = false; break; }
        }
        if (empty) return true;
      }
      return false;
    }

    _recomputeChuteFlag() {
      let touched = false;
      for (let r = 0; r <= CHUTE_BOT && !touched; r++) {
        for (let col = PIECE_OFFSET; col <= PIECE_OFFSET + 3; col++) {
          if (this.cell[r][col]) { touched = true; break; }
        }
      }
      this.stackTouchedChute = touched;
    }

    // ==== Miss / top-out / game over =======================================

    _topOut() {
      if (this._demo) {
        // The attract never "loses": quietly reset the pile and play on — no
        // miss heads, no dealer-miss pose. Score resets so the pace stays calm.
        this.enabled = false;
        this._clearGrid();
        this.stackTouchedChute = false;
        this.score = 0;
        this.view.dealer('idle');
        this.phase = 'deal';
        this._deal();
        return;
      }
      this.enabled = false;
      this.view.dealer('miss');
      this._sfx('miss');
      if (this.mode === 'A') this.view.clapper('open');
      this.phase = 'miss';
      // Both modes are 3-miss games (matches RetroFab's shared Grid.onMiss):
      // flash the bin, lose a life, carry on — no swinger tumble on a top-out.
      this._loseLife();
    }

    /** Lose a life: cross out the pile and spell the "Oh! / No!" (or "End")
     *  message, then either carry on to the next life or end the game at 3
     *  misses. Shared by top-outs (both modes) and Game B time-up. */
    _loseLife() {
      this.misses++;
      this.view.setMisses(this.misses);
      this._missFinal = this.misses >= 3;
      this._missAnim(this._missFinal);
    }

    /** Continuation after the miss message finishes (was the done-closure passed
     *  to _missAnim; lifted to a method so restore() can rebuild the timer). */
    _afterMiss() {
      if (this._missFinal) { this._gameOver(); return; }
      // clear the bin and carry on — classic G&W "lose a life" behaviour
      this._clearGrid();
      this.stackTouchedChute = false;
      this.view.dealer('idle');
      if (this.mode === 'B') {
        // fresh sprint clock + the swinger back to swinging for the new life
        this.timeLeft = GAME_B_SECONDS;
        this._clockAcc = 0;
        this._swingDir = -1;
        this._swingPos = 4;
        this.view.swinger(this._swingPos);
        this.view.setTime(this.timeLeft);
      }
      this.phase = 'deal';
      this._deal();
    }

    /** Paint one 7x12 message bitmap onto the bin (bottom screen), clearing
     *  everything else. 'o' lights a brick; anything else is dark. */
    _showBlocks(rows) {
      this.piece = null;             // no stray live piece bleeding through
      this._clearGrid();
      for (let r = 0; r < 7; r++) {
        const line = rows[r] || '';
        for (let c = 0; c < 12; c++) {
          if (line.charAt(c) === 'o') this.cell[BIN_TOP + r][BIN_LEFT + c] = true;
        }
      }
      this._render();
    }

    /** The lose-a-life brick message, faithful to the real device: the frozen
     *  pile holds for a beat, gets crossed out with an "X", then the machine
     *  spells "Oh!" and "No!" — or, on the game-ending third miss, "End". Each
     *  frame holds 0.8s (matching the hardware's cadence). */
    _missAnim(final) {
      this._missFinal = final;
      this._missStep = 0;
      this.piece = null;
      // beat 1: the just-landed pile lingers, then the X strikes it out. The
      // beat index lives in _missStep (not a nesting of closures) so a snapshot
      // can resume the message at the exact beat it was captured on.
      this.sched.after(0.8, () => this._missTick(), 'missanim');
    }

    /** Advance the lose-a-life brick message one beat. Single re-entrant beat
     *  driver so restore() only ever has to re-arm one 'missanim' timer. */
    _missTick() {
      const HOLD = 0.8;
      this._missStep++;
      if (this._missStep === 1) {
        this._showBlocks(GLYPH.X);
        this.sched.after(HOLD, () => this._missTick(), 'missanim');
      } else if (this._missStep === 2) {
        this._showBlocks(this._missFinal ? GLYPH.END : GLYPH.OH);
        // "End" holds a touch longer, then the game is over.
        this.sched.after(this._missFinal ? HOLD * 2 : HOLD, () => this._missTick(), 'missanim');
      } else if (this._missStep === 3) {
        if (this._missFinal) { this._afterMiss(); return; }
        this._showBlocks(GLYPH.NO);
        this.sched.after(HOLD, () => this._missTick(), 'missanim');
      } else {
        this._afterMiss();
      }
    }

    _tickClockB() {
      if (this.timeLeft <= 0) return;
      this.timeLeft--;
      this.view.setTime(this.timeLeft);
      // pendulum swing 1..4 and back
      if (this._swingDir < 0) { this._swingPos--; if (this._swingPos <= 1) this._swingDir = 1; }
      else { this._swingPos++; if (this._swingPos >= 4) this._swingDir = -1; }
      this.view.swinger(this._swingPos);
      if (this.timeLeft <= 0) this._gameOverB();
    }

    _gameOverB() {
      this.enabled = false;
      this.piece = null;
      this.phase = 'over';
      this.sched.clear();   // drop any pending deal/gravity/clear beats so the
                            // fail sequence can't be interrupted (e.g. a stale
                            // 'dealfinish' flipping us back to 'play').
      // RetroFab fail sequence: the swinger picks up speed (0.16s/step), sweeps
      // down to pos-1 then back up to pos-4, then the pusher shoves it (pie in
      // the face) and it topples flat.
      this._swingHitOne = false;
      this.sched.after(0.16, () => this._swingFastTick(), 'swingfast');
    }

    /** One step of the Game-B fail sweep (state in _swingHitOne, so restore() can
     *  re-arm it). */
    _swingFastTick() {
      if (this._swingDir < 0) { this._swingPos--; if (this._swingPos <= 1) this._swingDir = 1; }
      else { this._swingPos++; if (this._swingPos >= 4) this._swingDir = -1; }
      this.view.swinger(this._swingPos);
      if (this._swingPos === 1) this._swingHitOne = true;
      if (this._swingPos === 4 && this._swingHitOne) this._pushB();  // back at the top after hitting 1 → fall
      else this.sched.after(0.16, () => this._swingFastTick(), 'swingfast');
    }

    _pushB() {
      // The pusher shoves — pie in the face — held 0.7s, then the swinger lands
      // flat for 0.7s, then it costs a life (RetroFab: swinger.onMiss → grid.onMiss).
      this.view.swinger('push');
      this._sfx('miss');
      this.sched.after(0.7, () => this._pushBFall(), 'bpush');
    }

    /** Swinger topples flat after the push, then it costs a life. */
    _pushBFall() {
      this.view.swinger('fall');
      this.sched.after(0.7, () => this._loseLife(), 'bover');
    }

    _gameOver() {
      this.phase = 'over';
      this.enabled = false;
      this.piece = null;
      if (this._demo) { this.sched.after(1.2, () => this.startDemo(), 'demoloop'); return; }  // attract loops, no overlay
      this.view.gameOver && this.view.gameOver({ score: this.score, mode: this.mode });
    }

    // ==== Rendering sink ===================================================

    _clearGrid() {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.cell[r][c] = false;
    }

    _pieceAt(r, col) {
      if (!this.piece) return false;
      const m = SHAPES[this.piece.shape][this.piece.orient];
      const b = r - this.piece.row;
      const c = col - PIECE_OFFSET;
      if (b < 0 || b > 3 || c < 0 || c > 3) return false;
      return m[b][c] !== ' ';
    }

    /** Push the full visible state to the view (stack OR live piece). */
    _render() {
      // Chute: rows 0..9, cols 5..8 -> local (r, c 0..3)
      for (let r = CHUTE_TOP; r <= CHUTE_BOT; r++) {
        for (let cc = 0; cc < 4; cc++) {
          const col = cc + PIECE_OFFSET;
          this.view.setCell('ch', r, cc, this.cell[r][col] || this._pieceAt(r, col));
        }
      }
      // Bin: rows 10..16, cols 1..12 -> local (r-10, c-1)
      for (let r = BIN_TOP; r <= BIN_BOT; r++) {
        for (let cc = 0; cc < 12; cc++) {
          const col = cc + BIN_LEFT;
          this.view.setCell('pf', r - BIN_TOP, cc, this.cell[r][col] || this._pieceAt(r, col));
        }
      }
    }

    /** Play an audio cue — but never during the attract demo. Real Game & Watch
     *  units are silent in their idle/demo loop (a shelf of them can't all beep);
     *  sound only belongs to an actual game the player has started. */
    _sfx(name) {
      if (this._demo) return;
      this.view.sound && this.view.sound(name);
    }

    _clap() {
      // Claps on each downward step — in real gameplay AND the attract demo: the
      // authentic Tetris Jr claps as the pieces fall on the demo screen.
      this.view.clapper('clap');
      this.sched.after(0.18, () => this.view.clapper('open'), 'clapreset');
    }
  }

  // ---- Scheduler job registry ---------------------------------------------
  // Maps each stable scheduler key to the callback that resumes it, rebuilt from
  // instance state alone (no closures). restore()/_restoreFrom() use this to
  // re-arm exactly the timers that were pending when the snapshot was taken, so
  // a mid-animation deal / line-clear / miss / Game-B fail sequence continues
  // correctly. Keys not listed here (none are emitted by this engine) are dropped.
  TetrisJr._JOBS = {
    firstdeal:  (g) => g._deal(),
    dealfinish: (g) => g._dealFinish(),
    wipe:       (g) => g._wipeTick(),
    blocks:     (g) => g._wipeBlocks(),
    collapse:   (g) => g._collapseAndScore(g._clrRows || []),
    clearend:   (g) => g._clearEnd(),
    missanim:   (g) => g._missTick(),
    clapreset:  (g) => g.view.clapper && g.view.clapper('open'),
    swingfast:  (g) => g._swingFastTick(),
    bpush:      (g) => g._pushBFall(),
    bover:      (g) => g._loseLife(),
    segtest:    (g) => g._beginDemo(),
    demoauto:   (g) => g._demoTick(),
    demoloop:   (g) => g.startDemo(),
  };
  TetrisJr.RewindRing = RewindRing;

  // Expose constants for the view/tests without leaking internals.
  TetrisJr.SHAPES = SHAPES;
  TetrisJr.LINE_SCORE = LINE_SCORE;
  TetrisJr.LINE_TIME = LINE_TIME;
  TetrisJr.GEOMETRY = {
    ROWS, COLS, CHUTE_TOP, CHUTE_BOT, BIN_TOP, BIN_BOT,
    PIECE_OFFSET, BIN_LEFT, BIN_RIGHT, GAME_B_SECONDS,
  };

  // UMD-ish export
  if (typeof module !== 'undefined' && module.exports) module.exports = TetrisJr;
  else global.TetrisJr = TetrisJr;

  /*
   * View interface (all optional; a missing method is simply ignored):
   *   reset()                              clear all dynamic segments
   *   setCell('ch'|'pf', row, col, on)     block cell on/off
   *   setPreview(shape, rows2x4)           dealer's held next piece
   *   setScore(n) / setTime(sec)           the numeric display
   *   setLabel('point'|'time')             which label lights
   *   setMode('A'|'B')                     which GAME label lights
   *   setMisses(n)                         0..3 miss heads
   *   dealer('idle'|'deal'|'miss')
   *   clapper('open'|'clap'|'off')         Game A only
   *   hitter('idle'|'hit')                 line-clear celebration
   *   swinger(1|2|3|4|'fall'|'off')        Game B pendulum / tumble
   *   sound(name)                          audio cue
   *   gameOver({score, mode})
   */
})(typeof globalThis !== 'undefined' ? globalThis : this);
