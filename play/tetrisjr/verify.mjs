import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TetrisJr = require('./engine.js');
const G = TetrisJr.GEOMETRY;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };

// deterministic rng that cycles a fixed sequence of shapes
function rngFor(seq) {
  let i = 0;
  return () => { const v = seq[i % seq.length] / 7 + 0.001; i++; return v; };
}
// map shape -> index in BAG for rng
const IDX = { I:0,O:1,L:2,J:3,S:4,Z:5,T:6 };

function advance(g, seconds, dt=0.016){ for(let t=0;t<seconds;t+=dt) g.update(dt); }

// ---- Test 1: shapes table sane ----
console.log('T1 shapes');
for (const s of ['I','O','L','J','S','Z','T']) {
  ok(TetrisJr.SHAPES[s].length === 4, s+' has 4 orientations');
  let cells = 0; for (const row of TetrisJr.SHAPES[s][0]) for (const ch of row) if (ch==='x') cells++;
  ok(cells === 4, s+' orient0 has 4 filled cells (got '+cells+')');
}

// ---- Test 2: cyclic stack-shift quirk ----
console.log('T2 cyclic stack shift');
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A');
  // hand-craft a bin row: one block at visible col 1
  for (let c=0;c<=12;c++) g.cell[G.BIN_TOP][c]=false;
  g.cell[G.BIN_TOP][1]=true;
  g.piece=null; g.enabled=true; g.phase='play'; g.stackTouchedChute=false;
  g._shiftStack(+1); // right: col1 -> col2
  ok(g.cell[G.BIN_TOP][2] && !g.cell[G.BIN_TOP][1], 'right shift moves block col1->col2');
  // shift right 11 more times: should wrap around the 12-ring back to col1
  for (let i=0;i<11;i++) g._shiftStack(+1);
  ok(g.cell[G.BIN_TOP][1] && !g.cell[G.BIN_TOP][2], 'after 12 right shifts block wraps back to col1');
  // left shift wraps col1 -> col12
  for (let c=0;c<=12;c++) g.cell[G.BIN_TOP][c]=false;
  g.cell[G.BIN_TOP][1]=true;
  g._shiftStack(-1);
  ok(g.cell[G.BIN_TOP][12] && !g.cell[G.BIN_TOP][1], 'left shift wraps col1->col12');
}

// ---- Test 3: piece never moves sideways (only orient/row change on input) ----
console.log('T3 piece stays centred');
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); advance(g, 0.75); // deal first piece
  ok(g.piece, 'piece dealt');
  if (g.piece) {
    // all piece cells live in columns 5..8 regardless of shifts
    g._shiftStack(-1); g._shiftStack(+1);
    const m = TetrisJr.SHAPES[g.piece.shape][g.piece.orient];
    let okCols = true;
    for (let b=0;b<4;b++) for (let c=0;c<4;c++) if (m[b][c]==='x'){ const col=c+G.PIECE_OFFSET; if(col<5||col>8) okCols=false; }
    ok(okCols, 'piece cells confined to columns 5..8');
  }
}

// ---- Test 4: gravity lands a piece on the floor ----
console.log('T4 gravity + lock');
{
  const g = new TetrisJr(null, { rng: rngFor([IDX.O]) });
  g.start('A'); advance(g, 0.8);
  const beforeScore = g.score;
  advance(g, 20); // let it fall and lock (many rows)
  // after landing, some bin cells should be set (the O piece)
  let any=false; for(let r=G.BIN_TOP;r<=G.BIN_BOT;r++) for(let c=1;c<=12;c++) if(g.cell[r][c]) any=true;
  ok(any, 'a piece settled into the bin');
}

// ---- Test 5: line clear + scoring 7 for a single line ----
console.log('T5 single line clear scores 7');
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); advance(g, 0.75);
  g.enabled=false; g.piece=null; g.phase='play';
  // fill bottom bin row completely except cols 5..8, then drop an O? Simpler:
  // Directly fill the floor row fully and invoke the settle path.
  for (let c=1;c<=12;c++) g.cell[G.BIN_BOT][c]=true;
  const rows = g._findFullLines();
  ok(rows.length===1 && rows[0]===G.BIN_BOT, 'detects one full floor line');
  g._clearLines(rows);
  advance(g, 2.0);
  ok(g.score===7, 'single line scored 7 (got '+g.score+')');
  let cleared=true; for(let c=1;c<=12;c++) if(g.cell[G.BIN_BOT][c]) cleared=false;
  ok(cleared, 'floor row emptied after clear');
}

// ---- Test 6: scoring table 25/100/400 ----
console.log('T6 multi-line scoring');
for (const [n, expect] of [[2,25],[3,100],[4,400]]) {
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); advance(g, 0.75);
  g.enabled=false; g.piece=null; g.phase='play';
  const rows=[];
  for (let i=0;i<n;i++){ const r=G.BIN_BOT-i; for(let c=1;c<=12;c++) g.cell[r][c]=true; rows.push(r); }
  g._clearLines(g._findFullLines());
  advance(g, 3.0);
  ok(g.score===expect, n+' lines score '+expect+' (got '+g.score+')');
}

// ---- Test 7: Game A top-out accumulates misses, 3 -> game over ----
console.log('T7 miss accumulation');
{
  let over=null;
  const view = new Proxy({ gameOver:(x)=>{over=x;} }, { get:(t,k)=> k in t ? t[k] : ()=>{} });
  const g = new TetrisJr(view, { rng: Math.random });
  g.start('A'); advance(g, 0.75);
  // jam the chute cols 5..8 for rows 1..9 so _canAcceptPiece() is false
  for (let r=1;r<=9;r++) for(let c=5;c<=8;c++) g.cell[r][c]=true;
  g.piece=null;
  g._afterSettle(); // should top out
  ok(g.misses===1 && g.phase==='miss', 'first top-out -> miss 1');
  advance(g, 2.0); // flash then continue clears the bin, deals again
  ok(g.misses===1, 'still 1 miss after continue');
}
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); g.sched.clear(); g.misses=2; // drop the pending first-deal
  for (let r=1;r<=9;r++) for(let c=5;c<=8;c++) g.cell[r][c]=true;
  g.piece=null; g._afterSettle();
  advance(g, 3.6); // X -> "End" brick message (~3.2s) then game over
  ok(g.misses===3 && g.phase==='over', 'third miss -> game over (misses='+g.misses+', phase='+g.phase+')');
}

// ---- Test 8: Game B countdown + line adds time ----
console.log('T8 Game B timer');
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('B');
  ok(g.timeLeft===60, 'Game B starts at 60');
  advance(g, 3.05);
  ok(g.timeLeft<=57 && g.timeLeft>=56, 'timer counts down (~57, got '+g.timeLeft+')');
  const t0=g.timeLeft;
  g.enabled=false; g.piece=null; g.phase='play';
  for (let c=1;c<=12;c++) g.cell[G.BIN_BOT][c]=true; // one line -> +5s
  g._clearLines(g._findFullLines());
  advance(g, 2.0);
  ok(g.timeLeft>t0, 'clearing a line in B adds time ('+t0+' -> '+g.timeLeft+')');
}
{
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('B'); g.timeLeft=2; g.phase='play'; g.enabled=true;
  advance(g, 3.2);
  ok(g.phase==='over', 'Game B ends when timer hits 0 (phase='+g.phase+')');
}

// ---- Test 9: rotation cycles orientation ANTI-CLOCKWISE ----
console.log('T9 rotation (anti-clockwise)');
{
  const g = new TetrisJr(null, { rng: rngFor([IDX.T]) });
  g.start('A'); advance(g, 0.75);
  if (g.piece && g.piece.shape==='T') {
    const o0=g.piece.orient; g._rotate();
    // anti-clockwise = step forward through the tables (+1 mod 4)
    ok(g.piece.orient===(o0+1)%4, 'rotate turns anti-clockwise');
    // and four rotations return to start
    g._rotate(); g._rotate(); g._rotate();
    ok(g.piece.orient===o0, 'four rotations return to start');
  } else ok(true, 'skip (non-T dealt)');
}

// ---- Test 10: game-over "Oh! / No!" brick message ----
console.log('T10 miss message (X -> Oh! -> No! -> End)');
{
  // The expected bottom-screen bitmaps (what a real TR-66 lights up).
  const X  = ['  o     o   ','   o   o    ','    o o     ','     o      ','    o o     ','   o   o    ','  o     o   '];
  const OH = ['            ',' ooo o    o ',' o o o    o ',' o o ooo  o ',' o o o o    ',' ooo o o o  ','            '];
  const NO = ['            ',' o  o      o',' oo o      o',' o oo ooo  o',' o  o o o   ',' o  o ooo o ','            '];
  const END= ['            ',' ooo       o',' o         o',' ooo oo  ooo',' o   o o o o',' ooo o o ooo','            '];
  // Record the latest bin ("pf") frame the engine paints.
  const bin = Array.from({length:7}, () => new Array(12).fill(false));
  const view = new Proxy({ setCell:(kind,r,c,on)=>{ if(kind==='pf') bin[r][c]=on; } },
                         { get:(t,k)=> k in t ? t[k] : ()=>{} });
  const matches = (glyph) => {
    for (let r=0;r<7;r++) for (let c=0;c<12;c++)
      if (bin[r][c] !== (glyph[r].charAt(c)==='o')) return false;
    return true;
  };
  const topOut = (g) => { // jam the chute so the next settle can't accept a piece
    for (let r=1;r<=9;r++) for(let c=5;c<=8;c++) g.cell[r][c]=true;
    g.piece=null; g._afterSettle();
  };

  // First miss (non-final): X -> Oh! -> No!
  const g = new TetrisJr(view, { rng: Math.random });
  g.start('A'); advance(g,0.75);
  topOut(g);
  advance(g,0.9);  ok(matches(X),  'beat 1 shows the X');
  advance(g,0.8);  ok(matches(OH), 'beat 2 shows "Oh!"');
  advance(g,0.8);  ok(matches(NO), 'beat 3 shows "No!"');

  // Final miss shows "End" instead.
  const g2 = new TetrisJr(view, { rng: Math.random });
  g2.start('A'); g2.sched.clear(); g2.misses=2;
  topOut(g2);
  advance(g2,0.9);  ok(matches(X),   'final beat 1 shows the X');
  advance(g2,0.8);  ok(matches(END), 'final beat 2 shows "End"');
}

// ---- Test 11: held inputs (Down soft-drop persists; Left/Right auto-repeat) ----
console.log('T11 held inputs (Down persists, Left/Right auto-repeat)');
{
  // Down is a held soft-drop that must survive the deal of the next piece.
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); advance(g, 1.3);          // reach live play (first deal ~0.7s + 0.42s toss)
  g.input('drop', true);
  ok(g._softDrop===true && g._dropHeld===true, 'holding Down engages soft-drop');
  g._deal(); advance(g, 0.6);              // toss + a new piece goes live
  ok(g._softDrop===true, 'held Down keeps soft-dropping the NEXT piece (no re-press)');
  g.input('drop', false);
  ok(g._softDrop===false && g._dropHeld===false, 'releasing Down stops soft-drop');
}
{
  // Left/Right is a held control whose auto-repeat is driven inside the engine.
  const g = new TetrisJr(null, { rng: Math.random });
  g.start('A'); advance(g, 1.3);           // reach live play
  g.enabled=false; g.phase='play';         // freeze gravity so only shifts move cells
  for (let r=G.BIN_TOP;r<=G.BIN_BOT;r++) for(let c=0;c<=12;c++) g.cell[r][c]=false;
  g.cell[G.BIN_TOP][1]=true; g.stackTouchedChute=false;
  const colOf = ()=>{ for(let c=1;c<=12;c++) if(g.cell[G.BIN_TOP][c]) return c; return 0; };
  g.setShiftHeld(1);                       // press Right -> one immediate shift
  const afterPress = colOf();
  ok(afterPress===2, 'press shifts once immediately col1->col2 (got '+afterPress+')');
  advance(g, 0.4);                         // hold -> engine auto-repeats
  const afterHold = colOf();
  ok(afterHold > afterPress+2, 'holding auto-repeats the shift (col '+afterPress+'->'+afterHold+')');
  g.setShiftHeld(0);
  const stopped = colOf();
  advance(g, 0.4);
  ok(colOf()===stopped, 'releasing stops the shift (held at col '+stopped+')');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
