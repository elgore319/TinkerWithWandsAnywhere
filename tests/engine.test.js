// Run with: node tests/engine.test.js
// Checks the draw engine against known wand behavior.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/gamedata.js'), 'utf8') + ';this.GAME_SPELLS=GAME_SPELLS;this.GAME_PROJ=GAME_PROJ;', ctx);
const { makeEngine } = require('../js/engine.js');
const E = makeEngine(ctx.GAME_SPELLS, ctx.GAME_PROJ);

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
const wand = (o = {}) => Object.assign({ spc: 1, cd: 10, rt: 30, max: 500, regen: 100, spread: 0, mult: 1 }, o);
const run = (slots, w, o = {}) => E.simulate(Object.assign({ wand: wand(w), slots }, o));
const names = n => n.children.filter(c => c.card).map(c => c.card.def.id);

// Teleport hop build: Chainsaw zeroes cast delay, Add Mana makes it mana-positive, recharge 30 - 10.
let r = run(['MANA_REDUCE', 'BURST_2', 'LONG_DISTANCE_CAST', 'NOLLA', 'TELEPORT_PROJECTILE_SHORT', 'CHAINSAW']);
check('teleport: one cast per cycle', r.casts.length, 1);
check('teleport: cast delay 0', r.casts[0].cdFrames, 0);
check('teleport: recharge 20 frames', r.reloadFrames, 20);
check('teleport: gains 8 mana', r.casts[0].manaEnd - r.casts[0].manaStart, 8);
check('teleport: payload shot has Nolla', r.casts[0].shots[1].nolla, true);

// Divide By 2 copies the next spell twice and its copies' cast delay is undone.
r = run(['DIVIDE_2', 'LIGHT_BULLET', 'BULLET']);
check('divide: two spark bolts', r.casts[0].rootShot.projs.length, 2);
check('divide: cast delay = wand 10 + divide 20', r.casts[0].cdFrames, 30);

// Alpha copies the first card of the cast.
r = run(['LIGHT_BULLET', 'ALPHA'], { spc: 2 });
check('alpha: two projectiles', r.casts[0].rootShot.projs.length, 2);

// Requirement with condition not met skips to the else branch.
r = run(['IF_ENEMY', 'LIGHT_BULLET', 'IF_ELSE', 'BULLET', 'IF_END'], { spc: 1 });
check('requirement: else branch casts Magic Arrow', names(r.casts[0].root.children[0]), ['BULLET']);

// Not enough mana skips a spell and draws the next one.
r = run(['BOMB', 'LIGHT_BULLET'], { max: 10 });
check('mana: bomb skipped, spark cast', r.casts[0].root.children.map(c => c.kind), ['skip', 'draw']);

// Recharge adds up across casts in a cycle.
r = run(['RECHARGE', 'LIGHT_BULLET', 'RECHARGE', 'LIGHT_BULLET']);
check('recharge: 30 - 20 - 20', r.reloadFrames, -10);

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
