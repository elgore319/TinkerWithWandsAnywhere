/* Wand engine: my own implementation of Noita's draw/cast rules, written to follow the game's behavior.
   Times are in frames. Produces a call tree plus labeled terms for every stat change. */
const TYPE_NUM = { projectile: 0, static: 1, modifier: 2, multicast: 3, material: 4, other: 5, utility: 6, passive: 7 };
const PROJECTILE_GROUPS = { projectile: 1, static: 1, material: 1 };
const DIVIDE = { DIVIDE_2: [2, 5], DIVIDE_3: [3, 4], DIVIDE_4: [4, 4], DIVIDE_10: [10, 3] };
const ADD_TRIG = { ADD_TRIGGER: ['hit', 0], ADD_TIMER: ['timer', 20], ADD_DEATH_TRIGGER: ['death', 0] };
const IFS = { IF_ENEMY: 'enemy', IF_PROJECTILE: 'projectile', IF_HP: 'hp', IF_HALF: 'half' };
const RANDOM_NOTE = {
  RANDOM_SPELL: 'casts a random spell', RANDOM_PROJECTILE: 'casts a random projectile', RANDOM_MODIFIER: 'applies a random modifier',
  RANDOM_STATIC_PROJECTILE: 'casts a random static projectile', DRAW_RANDOM: 'plays a random spell from the wand',
  DRAW_RANDOM_X3: 'plays a random spell from the wand 3 times', DRAW_3_RANDOM: 'plays 3 random spells from the wand',
  ZETA: 'copies a random spell from your other wands', SUMMON_EGG: 'summons a random egg', FIREWORK: 'fires a random firework',
  DAMAGE_RANDOM: 'adds random damage', ALL_SPELLS: 'casts every spell at once',
  BLOOD_MAGIC: 'also costs HP', MONEY_MAGIC: 'converts gold into damage (not counted)', BLOOD_TO_POWER: 'converts HP into damage (not counted)',
  BLACK_HOLE_GIGA: 'assumes fewer than 3 Giga Black Holes exist'
};
const HANDLED = new Set(['BURST_X', 'DUPLICATE', 'ALPHA', 'GAMMA', 'TAU', 'OMEGA', 'MU', 'PHI', 'SIGMA', 'RESET', 'INFESTATION', 'DAMAGE_FOREVER',
  ...Object.keys(DIVIDE), ...Object.keys(ADD_TRIG), ...Object.keys(IFS)]);

function makeEngine(SPELLS, PROJ) {
  const byId = {};
  SPELLS.forEach(s => { byId[s.id] = s; });

  function simulate(opts) {
    const W = opts.wand;
    const conds = opts.conds || {};
    const unlimited = !!opts.unlimited;
    const maxCasts = opts.maxCasts || 64;
    let seq = 0, nodeSeq = 0, shotSeq = 0;
    const cards = opts.slots.map((id, i) => {
      const def = byId[id];
      if (!def) return null;
      const lim = def.uses != null && def.uses >= 0 && (!unlimited || def.nu);
      return { def, slot: i + 1, deckIndex: i, uses: lim ? def.uses : -1, startUses: lim ? def.uses : -1 };
    }).filter(Boolean);
    let deck = cards.slice(), hand = [], discarded = [];
    let mana = W.max, reload = W.rt;
    let dontDraw = false, forceStop = false, reloading = false, startReload = false, gotProj = false, playingPerm = false;
    let ifHalf = 0;
    let c = null, cur = null, rootShot = null;
    let rtTerms = [];
    let castNotes = null;
    const casts = [];

    const newShot = (kind, parent, triggerNode) => {
      const s = { id: ++shotSeq, kind, parent, triggerNode, cd: 0, spread: 0, mult: 1, life: 0, dmg: 0, nolla: false, terms: [], projs: [], clamped: false };
      return s;
    };
    const node = (kind, card, extra) => {
      const n = Object.assign({ id: ++nodeSeq, kind, card, children: [], terms: [], shot: c ? c.id : 0 }, extra || {});
      if (cur) cur.children.push(n);
      return n;
    };
    const term = (stat, op, v, extra) => {
      const t = Object.assign({ stat, op, v, seq: ++seq, slot: cur && cur.card ? cur.card.slot : 'W', name: cur && cur.card ? cur.card.def.name : 'Wand', shot: c ? c.id : 0, node: cur ? cur.id : 0, reverted: false }, extra || {});
      if (cur) cur.terms.push(t);
      if (stat === 'rt') rtTerms.push(t);
      else if (c && stat !== 'mana') c.terms.push(t);
      return t;
    };
    const note = s => { if (castNotes) castNotes.add(s); };
    const checkRec = (def, rec) => {
      rec = rec || 0;
      if (def && def.rec) return rec >= 2 ? -1 : rec + 1;
      return rec;
    };
    const order = () => { deck.sort((a, b) => a.deckIndex - b.deckIndex); };
    const moveDiscardedToDeck = () => { deck.push(...discarded); discarded = []; };
    const snapshot = () => ({ cd: c.cd, reload, mana, seq });
    const restore = (snap, what) => {
      if (what.cd) c.cd = snap.cd;
      if (what.reload) reload = snap.reload;
      if (what.mana) mana = snap.mana;
      const mark = n => {
        n.terms.forEach(t => {
          if (t.seq > snap.seq && ((what.cd && t.stat === 'cd') || (what.reload && t.stat === 'rt'))) t.reverted = true;
        });
        n.children.forEach(mark);
      };
      mark(castRootNode);
    };
    let castRootNode = null;

    function addProjectile(entity, card) {
      const p = PROJ[entity];
      c.projs.push({ entity, slot: card ? card.slot : '?', name: card ? card.def.name : '?', stats: p || null, trigger: null });
      gotProjCheck(card);
    }
    function gotProjCheck() { /* projectile flag is set by card type in playAction */ }
    function addTrigger(kind, entity, draws, timer, card) {
      const p = PROJ[entity];
      const proj = { entity, slot: card ? card.slot : '?', name: card ? card.def.name : '?', stats: p || null, trigger: kind, timer };
      c.projs.push(proj);
      const parentShot = c, parentCur = cur;
      const pay = node('payload', card, { trigger: kind, timer, draws });
      const shot = newShot(kind, parentShot.id, pay.id);
      proj.payloadShot = shot;
      pay.shotRef = shot;
      allShots.push(shot);
      c = shot; cur = pay;
      pay.shot = shot.id;
      drawActions(draws, true);
      c = parentShot; cur = parentCur;
    }

    function runOps(card, rec, iter) {
      const def = card.def, id = def.id;
      if (DIVIDE[id]) return divide(card, rec, iter);
      if (ADD_TRIG[id]) return addTrig(card);
      if (IFS[id]) return requirement(card);
      if (RANDOM_NOTE[id]) note(`${def.name}: ${RANDOM_NOTE[id]}`);
      switch (id) {
        case 'BURST_X': if (deck.length > 0) drawActions(deck.length, true); return;
        case 'DUPLICATE': {
          const hc = hand.length;
          hand.slice(0, hc).forEach(v => {
            const r = checkRec(v.def, rec);
            if (v.def.id !== 'DUPLICATE' && r > -1) callAction(v, r, undefined, card);
          });
          addCd(20); addRt(20); drawActions(1, true); return;
        }
        case 'ALPHA': {
          addCd(15);
          const data = discarded[0] || hand[0] || deck[0];
          const r = checkRec(data && data.def, rec);
          if (data && r > -1) callAction(data, r, undefined, card);
          return;
        }
        case 'GAMMA': {
          addCd(15);
          const data = deck.length ? deck[deck.length - 1] : (hand.length ? hand[hand.length - 1] : null);
          const r = checkRec(data && data.def, rec);
          if (data && r > -1) callAction(data, r, undefined, card);
          return;
        }
        case 'TAU': {
          addCd(35);
          const d1 = deck.length ? deck[0] : null, d2 = deck.length ? deck[1] || null : null;
          const r1 = checkRec(d1 && d1.def, rec), r2 = checkRec(d2 && d2.def, rec);
          if (d1 && r1 > -1) callAction(d1, r1, undefined, card);
          if (d2 && r2 > -1) callAction(d2, r2, undefined, card);
          return;
        }
        case 'OMEGA': {
          addCd(50);
          discarded.slice().forEach(d => { const r = checkRec(d.def, rec); if (r > -1 && d.def.id !== 'RESET') { dontDraw = true; callAction(d, r, undefined, card); dontDraw = false; } });
          hand.slice().forEach(d => { const r = checkRec(d.def, rec); if (!d.def.rec) { dontDraw = true; callAction(d, r, undefined, card); dontDraw = false; } });
          deck.slice().forEach(d => { const r = checkRec(d.def, rec); if (r > -1 && d.def.id !== 'RESET') { dontDraw = true; callAction(d, r, undefined, card); dontDraw = false; } });
          return;
        }
        case 'MU': case 'PHI': case 'SIGMA': {
          const want = { MU: 2, PHI: 0, SIGMA: 1 }[id];
          addCd(id === 'SIGMA' ? 30 : 50);
          const snap = snapshot();
          [discarded, hand, deck].forEach(list => list.slice().forEach(d => {
            const r = checkRec(d.def, rec);
            if (TYPE_NUM[d.def.g] === want && r > -1) { dontDraw = true; callAction(d, r, undefined, card); dontDraw = false; }
          }));
          restore(snap, { cd: true, reload: true, mana: true });
          if (id !== 'PHI') drawActions(1, true);
          return;
        }
        case 'RESET': {
          addRt(-25);
          discarded.push(...hand, ...deck);
          hand = []; deck = [];
          if (!forceStop) { forceStop = true; moveDiscardedToDeck(); order(); }
          return;
        }
        case 'INFESTATION': {
          for (let i = 0; i < 6; i++) addProjectile('projectiles/deck/infestation.xml', card);
          addCd(-2); addSpread(25); return;
        }
        case 'DAMAGE_FOREVER': {
          if (mana > 50) { const extra = mana - 50; term('dmg', '+', 0.025 * extra * 25, { note: `0.025 × (mana ${Math.round(mana)} − 50) × 25` }); c.dmg += 0.025 * extra * 25; mana = 50; term('mana', 'set', 50); }
          addCd(15); addRt(10); drawActions(1, true); return;
        }
      }
      for (const op of def.ops) runOp(op, card);
    }
    function runOp(op, card) {
      switch (op[0]) {
        case 'cd': addCd(op[1]); break;
        case 'cdSet': c.cd = op[1]; term('cd', 'set', op[1]); break;
        case 'rt': addRt(op[1]); break;
        case 'rtSet': reload = op[1]; term('rt', 'set', op[1]); break;
        case 'spread': addSpread(op[1]); break;
        case 'mult': c.mult *= op[1]; term('mult', '*', op[1]); break;
        case 'multClamp': if (c.mult > 20) { c.mult = 20; c.clamped = true; } else if (c.mult < 0) c.mult = 0; break;
        case 'life': c.life += op[1]; term('life', '+', op[1]); break;
        case 'dmg': c.dmg += op[1] * 25; term('dmg', '+', op[1] * 25); break;
        case 'nolla': c.nolla = true; term('life', 'nolla', 3); break;
        case 'proj': addProjectile(op[1], card); break;
        case 'trig': addTrigger(op[1], op[2], op[3], op[4], card); break;
        case 'draw': drawActions(op[1], true); break;
      }
    }
    const addCd = v => { c.cd += v; term('cd', '+', v); };
    const addRt = v => { reload += v; term('rt', '+', v); };
    const addSpread = v => { c.spread += v; term('spread', '+', v); };

    function callAction(card, rec, iter, via) {
      const prev = cur;
      cur = node('copy', card, { via: via ? via.slot : null, viaName: via ? via.def.name : null });
      const r = runOps(card, rec, iter);
      cur = prev;
      return r;
    }
    function divide(card, rec, iter) {
      const def = card.def;
      const [count0, lim] = DIVIDE[def.id];
      for (const op of def.ops) if (op[0] === 'cd' || op[0] === 'rt') runOp(op, card);
      iter = iter || 1;
      let iterMax = iter;
      const data = deck.length > 0 ? deck[iter - 1] || null : null;
      const count = iter >= lim ? 1 : count0;
      const r = checkRec(data && data.def, rec);
      if (data && r > -1 && data.uses !== 0) {
        const snap = snapshot();
        for (let i = 1; i <= count; i++) {
          if (i === 1) dontDraw = true;
          const im = callAction(data, r, iter + 1, card);
          dontDraw = false;
          if (im != null) iterMax = im;
        }
        if (data.uses > 0) data.uses--;
        if (iter === 1) {
          restore(snap, { cd: true, reload: true });
          for (let i = 1; i <= iterMax; i++) if (deck.length > 0) discarded.push(deck.shift());
        }
      }
      for (const op of def.ops) if (op[0] === 'dmg') runOp(op, card);
      return iterMax;
    }
    function addTrig(card) {
      const [kind, timer] = ADD_TRIG[card.def.id];
      let howMany = 1;
      let data = deck.length > 0 ? deck[0] : null;
      if (!data) return;
      const skipTypes = { modifier: 1, passive: 1, other: 1, multicast: 1 };
      while (deck.length >= howMany && data && skipTypes[data.def.g]) {
        if (data.uses !== 0 && !ADD_TRIG[data.def.id] && data.def.g === 'modifier') {
          dontDraw = true; callAction(data, 0, undefined, card); dontDraw = false;
        }
        howMany++;
        data = deck[howMany - 1];
      }
      if (data && data.def.rel && data.def.rel.length && data.uses !== 0) {
        const target = data.def.rel[0], cnt = data.def.rc || 1;
        for (let i = 1; i <= howMany; i++) { const d = deck.shift(); if (d) discarded.push(d); data = d; }
        const valid = deck.some(ch => ch && (PROJECTILE_GROUPS[ch.def.g] || ch.def.g === 'utility'));
        if (data.uses > 0) data.uses--;
        if (valid) {
          const prev = cur;
          cur = node('copy', data, { via: card.slot, viaName: card.def.name, converted: kind });
          for (let i = 0; i < cnt; i++) addTrigger(kind, target, 1, timer, data);
          cur = prev;
        } else {
          dontDraw = true; callAction(data, 0, undefined, card); dontDraw = false;
        }
      }
    }
    function requirement(card) {
      const kind = IFS[card.def.id];
      let doskip;
      if (kind === 'half') { doskip = ifHalf === 1; ifHalf = 1 - ifHalf; }
      else doskip = !conds[kind];
      cur.cond = doskip ? 'false' : 'true';
      let endpoint = -1, elsepoint = -1;
      if (deck.length > 0) {
        for (let i = 1; i <= deck.length; i++) {
          const v = deck[i - 1], vid = v.def.id;
          if (vid.startsWith('IF_') && vid !== 'IF_END' && vid !== 'IF_ELSE') { endpoint = -1; break; }
          if (vid === 'IF_ELSE') { endpoint = i; elsepoint = i; }
          if (vid === 'IF_END') { endpoint = i; break; }
        }
        let emin = 1, emax = 1, go = false;
        if (doskip) {
          if (elsepoint > 0) emax = elsepoint; else if (endpoint > 0) emax = endpoint;
          go = true;
        } else if (elsepoint > 0) {
          emin = elsepoint; emax = endpoint > 0 ? endpoint : deck.length; go = true;
        }
        if (go) {
          const removed = [];
          for (let i = emin; i <= emax; i++) {
            const v = deck[emin - 1];
            if (v) { discarded.push(v); deck.splice(emin - 1, 1); removed.push(v.slot); }
          }
          cur.skipped = removed;
        }
      }
      drawActions(1, true);
    }

    function playAction(card, kind) {
      hand.push(card);
      const prev = cur;
      cur = node(kind || 'draw', card, { mana: card.costPaid });
      runOps(card, 0, undefined);
      if (PROJECTILE_GROUPS[card.def.g]) gotProj = true;
      cur = prev;
    }
    function drawAction(instant) {
      if (deck.length <= 0) {
        if (instant && !forceStop) {
          moveDiscardedToDeck(); order(); startReload = true;
          node('wrap', null);
          if (castState) castState.wrapped = true;
        } else { reloading = true; return true; }
      }
      if (deck.length > 0) {
        const card = deck.shift();
        const cost = card.def.mana;
        if (cost > mana) {
          discarded.push(card); node('skip', card, { reason: `needs ${cost} mana, wand has ${Math.floor(mana)}` });
          return false;
        }
        if (card.uses === 0) { discarded.push(card); node('skip', card, { reason: 'out of uses' }); return false; }
        const before = mana;
        mana -= cost;
        card.costPaid = cost;
        playAction(card);
        const n = cur.children[cur.children.length - 1];
        if (n) { n.mana = cost; n.manaBefore = before; }
      }
      return true;
    }
    function drawActions(n, instant) {
      if (dontDraw) return;
      if (playingPerm && n === 1) return;
      for (let i = 0; i < n; i++) {
        const ok = drawAction(instant);
        if (ok === false) { while (deck.length > 0) { if (drawAction(instant)) break; } }
        if (reloading) return;
      }
    }

    let allShots = [];
    let castState = null;
    let cycleDone = false;
    const acCards = (opts.alwaysCast || []).map((id, i) => byId[id] ? { def: byId[id], slot: 'AC' + (i + 1), deckIndex: -1, uses: -1, perm: true } : null).filter(Boolean);
    for (let k = 0; k < maxCasts && !cycleDone; k++) {
      allShots = [];
      rootShot = newShot('root', null, null);
      rootShot.cd = W.cd; rootShot.spread = W.spread || 0; rootShot.mult = W.mult || 1;
      allShots.push(rootShot);
      c = rootShot;
      castNotes = new Set();
      const manaStart = mana;
      castState = { wrapped: false };
      castRootNode = { id: ++nodeSeq, kind: 'root', card: null, children: [], terms: [], shot: rootShot.id };
      cur = castRootNode;
      dontDraw = false; forceStop = false; reloading = false; gotProj = false;
      const rtStart = rtTerms.length;
      for (const ac of acCards) {
        playingPerm = true;
        if (ac.def.mana < 0) mana -= ac.def.mana;
        ac.costPaid = Math.min(0, ac.def.mana);
        playAction(ac, 'always');
        playingPerm = false;
      }
      drawActions(Math.max(1, W.spc | 0), false);
      // move hand to discarded
      for (const card of hand) {
        if (card.perm) continue;
        if (gotProj || card.def.g === 'other' || card.def.g === 'utility') {
          if (card.uses > 0) card.uses--;
        }
        if (card.uses !== 0) discarded.push(card);
        else castNotes.add(`${card.def.name} (slot ${card.slot}) ran out of uses`);
      }
      hand = [];
      let doReload = false;
      if (deck.length <= 0 || startReload) {
        doReload = true;
        moveDiscardedToDeck(); order(); startReload = false;
      }
      const cast = {
        root: castRootNode, shots: allShots, rootShot, cdFrames: rootShot.cd, manaStart, manaEnd: mana, reload: doReload,
        wrapped: castState.wrapped, notes: [...castNotes], rtTermsFrom: rtStart, rtTermsTo: rtTerms.length, empty: castRootNode.children.length === 0
      };
      casts.push(cast);
      if (doReload) {
        cast.reloadFrames = reload;
        cycleDone = true;
      }
      // regen during the wait before the next cast
      const wait = Math.max(1, doReload ? Math.max(Math.max(0, rootShot.cd), Math.max(0, reload)) : Math.max(0, rootShot.cd));
      cast.wait = wait;
      mana = Math.min(W.max, mana + (W.regen || 0) * wait / 60);
      if (cast.empty && !doReload) { cycleDone = true; }
    }
    const usage = cards.filter(cd => cd.startUses > 0).map(cd => ({ slot: cd.slot, name: cd.def.name, start: cd.startUses, left: cd.uses }));
    return { casts, rtTerms, reloadFrames: reload, baseReload: W.rt, usage };
  }

  return { simulate, byId };
}
if (typeof module !== 'undefined') module.exports = { makeEngine, HANDLED, RANDOM_NOTE };
