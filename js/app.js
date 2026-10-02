/* UI: wand inputs, spell slots, equation rendering, spell stats table. Depends on gamedata.js and engine.js. */
(function () {
  const FPS = 60;
  const f = s => Math.round(Number(s) * FPS);
  const sec = fr => (fr / FPS).toFixed(2);
  const r2 = x => (Math.round(x * 100) / 100).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'noita-wand-calc-v3';
  const TELE = ['MANA_REDUCE', 'BURST_2', 'LONG_DISTANCE_CAST', 'NOLLA', 'TELEPORT_PROJECTILE_SHORT', 'CHAINSAW'];
  const DIVEX = ['DIVIDE_2', 'LIGHT_BULLET_TRIGGER', 'BULLET', 'RECHARGE', 'LIGHT_BULLET'];
  const APPROX = new Set(Object.keys(RANDOM_NOTE));

  let state = {
    wand: { spc: 1, cd: 0.17, rt: 0.5, max: 300, regen: 100, spread: 0, mult: 1, shuffle: 'no' },
    slots: TELE.slice(), ac: ['', '', '', ''], conds: { enemy: false, projectile: false, hp: false }, unlimited: false,
    overrides: {}, custom: [], customN: 0
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.wand && Array.isArray(saved.slots)) state = Object.assign(state, saved);
  } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  /* ---------- effective spell data (game data + edits + custom) ---------- */
  let SPELLS, PROJ, engine, byId;
  const sumOps = (def, k) => def.ops.filter(o => o[0] === k).reduce((s, o) => s + o[1], 0);
  function replaceOps(ops, k, v) {
    const i = ops.findIndex(o => o[0] === k);
    const rest = ops.filter(o => o[0] !== k);
    if (v === 0 && i < 0) return rest;
    rest.splice(i < 0 ? 0 : Math.min(i, rest.length), 0, [k, v]);
    return rest;
  }
  function rebuild() {
    PROJ = Object.assign({}, GAME_PROJ);
    SPELLS = GAME_SPELLS.map(s => {
      const o = state.overrides[s.id];
      if (!o) return s;
      const d = Object.assign({}, s, { ops: s.ops.slice() });
      if (o.mana != null) d.mana = o.mana;
      if (o.cd != null) d.ops = replaceOps(d.ops, 'cd', o.cd);
      if (o.rt != null) d.ops = replaceOps(d.ops, 'rt', o.rt);
      d.edited = true;
      return d;
    });
    for (const c of state.custom) {
      const key = 'custom/' + c.id;
      const ops = [];
      if (c.cd) ops.push(['cd', c.cd]);
      if (c.rt) ops.push(['rt', c.rt]);
      if (c.type === 'projectile') { PROJ[key] = [c.speed, c.speed, c.life, 0, 1000, 0, 0, 0]; ops.push(['proj', key]); }
      else if (c.type === 'trigger') { PROJ[key] = [c.speed, c.speed, c.life, 0, 1000, 0, 0, 0]; ops.push(['trig', 'hit', key, c.draws, 0]); }
      else ops.push(['draw', c.type === 'multicast' ? c.draws : 1]);
      SPELLS.push({ id: c.id, name: c.name, g: c.type === 'trigger' ? 'projectile' : c.type, mana: c.mana, ops, rel: c.type === 'projectile' || c.type === 'trigger' ? [key] : undefined, custom: true });
    }
    engine = makeEngine(SPELLS, PROJ);
    byId = engine.byId;
  }
  rebuild();

  /* ---------- equation rendering ---------- */
  const grp = def => def ? (def.g || 'projectile') : 'wand';
  function termHtml(t, first, fmt, mul) {
    const cls = 't-' + (t.group || 'wand');
    const tip = esc((t.slot === 'W' ? 'Wand' : (String(t.slot).startsWith('AC') ? 'Always cast ' + t.slot.slice(2) : 'Slot ' + t.slot)) + ': ' + t.name + (t.reverted ? ' (undone)' : '') + (t.payload ? ' (goes to a payload, ignored)' : ''));
    const ig = t.ign ? ' ign' : '';
    if (t.op === 'set') return `<span class="op">${first ? '' : ' '}</span><span class="term ${cls}${ig}" title="${tip}">=${fmt(t.v)}<sub>${t.slot}</sub></span>`;
    if (mul || t.op === '*') return `<span class="op">${first ? '' : ' × '}</span><span class="term ${cls}${ig}" title="${tip}">${r2(t.v)}<sub>${t.slot}</sub></span>`;
    const neg = t.v < 0;
    const op = first ? (neg ? '−' : '') : (neg ? ' − ' : ' + ');
    return `<span class="op">${op}</span><span class="term ${cls}${ig}" title="${tip}">${fmt(Math.abs(t.v))}<sub>${t.slot}</sub></span>`;
  }
  function renderItems(arr, fmt, lead) {
    let h = '', first = lead;
    for (const it of arr) {
      if (it.k === 't') { h += termHtml(it, first, fmt); first = false; }
      else if (it.items.length) {
        const [o, c] = { '(': ['(', ')'], '[': ['[', ']'], '{': ['{', '}'] }[it.br];
        const ig = it.ign ? ' ign' : '';
        h += (first ? '' : '<span class="op"> + </span>') + `<span class="br${ig}" title="${esc(it.title || '')}">${o}</span>` + renderItems(it.items, fmt, true) + `<span class="br${ig}">${c}</span>`;
        first = false;
      }
    }
    return h;
  }
  // Build items for a stat from the call tree. ignoreFn(term) decides strike-through.
  function treeItems(n, stat, ignoreFn, manaMode) {
    const out = [];
    if (manaMode) {
      if ((n.kind === 'draw' || n.kind === 'always') && n.card) out.push({ k: 't', op: '+', v: n.mana || 0, slot: n.card.slot, name: n.card.def.name, group: grp(n.card.def), seq: 0 });
    } else {
      n.terms.filter(t => t.stat === stat).forEach(t => out.push(Object.assign({ k: 't', group: grp(n.card && n.card.def), ign: ignoreFn(t) }, t)));
    }
    const kids = n.children.filter(ch => ch.kind !== 'wrap' && ch.kind !== 'skip');
    const draws = kids.filter(ch => ch.kind === 'draw' || ch.kind === 'always');
    const childItems = [];
    for (const ch of kids) {
      const sub = treeItems(ch, stat, ignoreFn, manaMode);
      if (!sub.length) continue;
      if (ch.kind === 'payload') childItems.push({ k: 'g', br: '[', items: sub, ign: !manaMode && sub.every(x => x.ign !== false && allIgn(x)), title: 'Payload of ' + ch.card.def.name });
      else if (ch.kind === 'copy') childItems.push({ k: 'g', br: '{', items: sub, ign: !manaMode && sub.every(allIgn), title: 'Copy of ' + ch.card.def.name + (ch.viaName ? ' made by ' + ch.viaName : '') });
      else childItems.push(...sub);
    }
    if (draws.length >= 2 && n.kind !== 'root' && n.kind !== 'payload') out.push({ k: 'g', br: '(', items: childItems, ign: !manaMode && childItems.every(allIgn) });
    else out.push(...childItems);
    return out;
  }
  const allIgn = x => x.k === 't' ? !!x.ign : x.items.every(allIgn);
  function flat(arr) { return arr.flatMap(it => it.k === 't' ? [it] : flat(it.items)); }
  function split(arr, k) {
    const b = [], a = [];
    for (const it of arr) {
      if (it.k === 't') { if (it.seq < k) b.push(it); else if (it.seq > k) a.push(it); }
      else { const s = split(it.items, k); if (s.b.length) b.push(Object.assign({}, it, { items: s.b })); if (s.a.length) a.push(Object.assign({}, it, { items: s.a })); }
    }
    return { b, a };
  }

  function cdEquation(cast) {
    const rootId = cast.rootShot.id;
    const ignore = t => t.shot !== rootId || t.reverted;
    const base = { k: 't', op: '+', v: state.wand.cd * FPS, slot: 'W', name: 'Wand cast delay', group: 'wand', seq: 0 };
    const items = [base, ...treeItems(cast.root, 'cd', ignore, false)];
    const live = flat(items).filter(t => !t.ign);
    const sets = live.filter(t => t.op === 'set');
    const fmt = v => sec(v);
    if (sets.length) {
      const last = sets[sets.length - 1];
      const { b, a } = split(items, last.seq);
      const before = renderItems(b, fmt, true) || '0';
      return `<span class="br">(</span>${before}<span class="br">)</span><span class="op"> × </span><span class="term t-${last.group}" title="${esc('Slot ' + last.slot + ': ' + last.name + ' sets cast delay to ' + sec(last.v))}">${last.v ? sec(last.v) + '⁼' : '0'}<sub>${last.slot}</sub></span>` + (a.length ? renderItems(a, fmt, false) : '');
    }
    return renderItems(items, fmt, true);
  }
  function manaEquation(cast) {
    const items = treeItems(cast.root, 'mana', () => false, true);
    return renderItems(items, v => String(v), true) || '0';
  }
  function rtEquation(res) {
    const base = { k: 't', op: '+', v: f(state.wand.rt), slot: 'W', name: 'Wand recharge', group: 'wand', seq: 0 };
    const groups = [];
    res.casts.forEach((c, i) => {
      const ts = res.rtTerms.slice(c.rtTermsFrom, c.rtTermsTo).map(t => Object.assign({ k: 't', group: grp(byId[findDef(c, t)]), ign: t.reverted }, t));
      if (ts.length) groups.push({ k: 'g', br: '(', items: ts, title: 'Cast ' + (i + 1) });
    });
    return renderItems([base, ...groups], v => sec(v), true);
  }
  function findDef(cast, t) {
    let id = null;
    const walk = n => { if (n.id === t.node && n.card) id = n.card.def.id; n.children.forEach(walk); };
    walk(cast.root);
    return id;
  }
  function flatEq(terms, base, mul, fmt) {
    const items = [...(base ? [base] : []), ...terms.map(t => Object.assign({ k: 't', ign: t.reverted }, t))];
    let h = '', first = true;
    for (const t of items) { h += termHtml(t, first, fmt, mul); first = false; }
    return h;
  }

  /* ---------- per-shot physics ---------- */
  function projMath(shot, p, offset) {
    const st = p.stats;
    if (!st) return `<div class="note">No flight data for this projectile (it's static, random or summoned).</div>`;
    const [smin, smax, life0, lifeRand, term, dmg, exD, exR] = st;
    const mult = shot.mult;
    const cap = term > 0 ? term : Infinity;
    const vmin = Math.min(smin * mult, cap), vmax = Math.min(smax * mult, cap);
    const sp = `<span class="term t-projectile">${smin === smax ? smin : smin + '–' + smax}<sub>${p.slot}</sub></span>`;
    const multTxt = mult !== 1 ? `<span class="op"> × </span><span class="term t-modifier">${r2(mult)}<sub>×</sub></span>` : '';
    const capTxt = (smax * mult > cap) ? ` <span class="note">capped at terminal velocity ${term}</span>` : '';
    const vTxt = vmin === vmax ? r2(vmin) : r2(vmin) + '–' + r2(vmax);
    let lifeHtml, lifeF;
    if (shot.nolla) { lifeF = 3; lifeHtml = `<span class="term t-modifier">3<sub>Nolla</sub></span><span class="op"> = </span><span class="res">3 frames</span> <span class="note">(Nolla overrides)</span>`; }
    else if (life0 < 0) { lifeF = Infinity; lifeHtml = `<span class="res">no limit</span> <span class="note">(lives until it hits something)</span>`; }
    else {
      lifeF = Math.max(1, life0 + shot.life);
      lifeHtml = `<span class="term t-projectile">${life0}<sub>${p.slot}</sub></span>${shot.life ? `<span class="op"> ${shot.life < 0 ? '−' : '+'} </span><span class="term t-modifier">${Math.abs(shot.life)}<sub>mods</sub></span>` : ''}<span class="op"> = </span><span class="res">${lifeF} frames</span>${lifeRand ? ` <span class="note">± ${lifeRand} random</span>` : ''}`;
    }
    let distHtml;
    if (lifeF === Infinity) distHtml = `<span class="note">Unlimited lifetime, so distance depends on what it hits.</span>`;
    else {
      const dmin = vmin * lifeF / FPS, dmax = vmax * lifeF / FPS;
      const dTxt = dmin === dmax ? r2(dmin) : r2(dmin) + '–' + r2(dmax);
      distHtml = `${vTxt}<span class="op"> × </span>${lifeF}<span class="op"> / 60 = </span><span class="res">${dTxt} px</span>`;
      if (offset) distHtml += `<br><span class="note">Starts where its carrier expires:</span> ${offset.txt}<span class="op"> + </span>${dTxt}<span class="op"> = </span><span class="res">${r2(offset.min + dmin)}${offset.max + dmax !== offset.min + dmin ? '–' + r2(offset.max + dmax) : ''} px total</span>`;
      p.dist = [dmin, dmax];
    }
    const dmgTot = dmg + shot.dmg;
    const dmgHtml = (dmg || shot.dmg) ? `<span class="term t-projectile">${r2(dmg)}<sub>${p.slot}</sub></span>${shot.dmg ? `<span class="op"> ${shot.dmg < 0 ? '−' : '+'} </span><span class="term t-modifier">${r2(Math.abs(shot.dmg))}<sub>mods</sub></span>` : ''}<span class="op"> = </span><span class="res">${r2(Math.max(0, dmgTot))}</span>` : '<span class="note">none</span>';
    return `<div class="eqrow"><div class="eqlabel">Speed (px/s)</div><div class="eq">v = ${sp}${multTxt}<span class="op"> = </span><span class="res">${vTxt}</span>${capTxt}</div></div>
      <div class="eqrow"><div class="eqlabel">Lifetime</div><div class="eq">t = ${lifeHtml}</div></div>
      <div class="eqrow"><div class="eqlabel">Distance</div><div class="eq">d = ${distHtml}</div></div>
      <div class="eqrow"><div class="eqlabel">Projectile damage</div><div class="eq">${dmgHtml}${exD ? ` <span class="note">explosion ${r2(exD)} dmg, radius ${exR}</span>` : ''}</div></div>`;
  }
  function shotsHtml(cast) {
    const offsets = {};
    let h = '<div class="shots">';
    for (const s of cast.shots) {
      const trig = cast.shots.find(x => x.projs.some(p => p.payloadShot === s));
      const carrier = trig ? trig.projs.find(p => p.payloadShot === s) : null;
      const label = s.kind === 'root' ? 'Main shot' : `Payload of ${esc(carrier.name)} (slot ${carrier.slot}) — ${s.kind === 'hit' ? 'fires on impact' : s.kind === 'timer' ? 'fires after a timer' : 'fires when it expires'}`;
      const sterms = k => s.terms.filter(t => t.stat === k).map(t => Object.assign({ group: grp(byId[findDef(cast, t)]) }, t));
      const spreadEq = flatEq(sterms('spread'), { k: 't', op: '+', v: s.kind === 'root' ? (state.wand.spread || 0) : 0, slot: s.kind === 'root' ? 'W' : '', name: 'Base spread', group: 'wand' }, false, v => r2(v) + '°');
      const multEq = flatEq(sterms('mult'), { k: 't', op: '*', v: s.kind === 'root' ? (state.wand.mult || 1) : 1, slot: s.kind === 'root' ? 'W' : '', name: 'Base speed', group: 'wand' }, true, r2);
      const lifeT = sterms('life');
      const dmgT = sterms('dmg');
      h += `<div class="shot"><h4>${label}</h4>
        <div class="eqrow"><div class="eqlabel">Spread</div><div class="eq">${spreadEq}<span class="op"> = </span><span class="res">${r2(Math.max(0, s.spread))}°</span>${s.spread < 0 ? ' <span class="note">(below 0 counts as 0)</span>' : ''}</div></div>
        <div class="eqrow"><div class="eqlabel">Speed ×</div><div class="eq">${multEq}<span class="op"> = </span><span class="res">${r2(s.mult)}×</span>${s.clamped ? ' <span class="note">(capped at 20×)</span>' : ''}</div></div>
        ${lifeT.length ? `<div class="eqrow"><div class="eqlabel">Lifetime mods</div><div class="eq">${s.nolla ? '<span class="note">Nolla sets lifetime to ~3 frames</span>' : flatEq(lifeT.filter(t => t.op !== 'nolla'), null, false, v => v + 'f') + `<span class="op"> = </span><span class="res">${s.life > 0 ? '+' : ''}${s.life} frames</span>`}</div></div>` : ''}
        ${dmgT.length ? `<div class="eqrow"><div class="eqlabel">Damage mods</div><div class="eq">${flatEq(dmgT, null, false, r2)}<span class="op"> = </span><span class="res">${s.dmg > 0 ? '+' : ''}${r2(s.dmg)}</span></div></div>` : ''}`;
      if (!s.projs.length) h += `<p class="note">No projectiles in this shot.</p>`;
      for (const p of s.projs) {
        const off = offsets[s.id];
        h += `<div class="proj"><span class="pn">${esc(p.name)}</span> <span class="note">slot ${p.slot}${p.trigger ? ' · carries a payload' : ''}</span>${projMath(s, p, off)}</div>`;
        if (p.payloadShot && p.trigger === 'death' && p.dist) {
          const prevMin = off ? off.min : 0, prevMax = off ? off.max : 0;
          offsets[p.payloadShot.id] = { min: prevMin + p.dist[0], max: prevMax + p.dist[1], txt: r2(prevMin + p.dist[0]) + (prevMax + p.dist[1] !== prevMin + p.dist[0] ? '–' + r2(prevMax + p.dist[1]) : '') };
        }
      }
      h += `</div>`;
    }
    return h + '</div>';
  }

  function treeHtml(n) {
    const kids = n.children;
    if (!kids.length) return '';
    return '<ul>' + kids.map(ch => {
      if (ch.kind === 'wrap') return `<li><span class="cp">↻ deck empty: wrapped to the discard pile</span></li>`;
      const d = ch.card ? ch.card.def : null;
      const name = d ? esc(d.name) : '';
      const sl = ch.card ? ch.card.slot : '';
      let h = `<li><span class="nm t-${grp(d)}"><span class="sl">#${sl}</span>${name}</span>`;
      if (ch.kind === 'skip') h += `<span class="sk">skipped: ${esc(ch.reason)}</span>`;
      if (ch.kind === 'copy') h += `<span class="cp">copy${ch.viaName ? ' by ' + esc(ch.viaName) + ' #' + ch.via : ''}${ch.converted ? ', turned into a trigger' : ''}</span>`;
      if (ch.kind === 'always') h += `<span class="cp">always cast</span>`;
      if (ch.kind === 'payload') h = `<li class="plab">payload (${ch.trigger === 'hit' ? 'on impact' : ch.trigger === 'timer' ? 'timer' : 'on expiry'})`;
      if ((ch.kind === 'draw' || ch.kind === 'always') && ch.mana) h += `<span class="mana">${ch.mana > 0 ? '−' : '+'}${Math.abs(ch.mana)} mana</span>`;
      if (ch.cond) h += `<span class="cond ${ch.cond === 'true' ? 't' : 'f'}">${ch.cond === 'true' ? 'condition met' : 'condition not met'}${ch.skipped && ch.skipped.length ? ', discards #' + ch.skipped.join(', #') : ''}</span>`;
      h += ch.kind === 'payload' ? treeHtml(ch).replace('<ul>', '<ul class="payload">') : treeHtml(ch);
      return h + '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- results ---------- */
  function renderResults() {
    const R = document.getElementById('results');
    if (state.wand.shuffle === 'yes') { R.innerHTML = `<div class="panel"><h2>Results</h2><p class="empty">Shuffle wands draw in random order, so there is no single equation. Switch Shuffle to No to calculate.</p></div>`; return; }
    if (!state.slots.length) { R.innerHTML = `<div class="panel"><h2>Results</h2><p class="empty">Add spells on the left to see the math for each cast.</p></div>`; return; }
    const W = state.wand;
    let res;
    try {
      res = engine.simulate({
        wand: { spc: W.spc, cd: f(W.cd), rt: f(W.rt), max: Number(W.max) || 0, regen: Number(W.regen) || 0, spread: Number(W.spread) || 0, mult: Number(W.mult) || 1 },
        slots: state.slots, alwaysCast: state.ac.filter(Boolean), conds: state.conds, unlimited: state.unlimited
      });
    } catch (err) {
      R.innerHTML = `<div class="panel"><h2>Results</h2><p class="empty">This wand couldn't be simulated: ${esc(err.message)}. Try removing the last spell you added.</p></div>`;
      return;
    }
    const casts = res.casts;
    const total = casts.reduce((s, c) => s + c.wait, 0);
    const manaCycle = casts.reduce((s, c) => s + (c.manaStart - c.manaEnd), 0);
    const manaSpent = casts.reduce((s, c) => s + sumMana(c.root), 0);
    const cps = casts.length * FPS / total;
    const regen = Number(W.regen) || 0;
    const net = manaSpent * FPS / total - regen;
    const sustain = net <= 0;
    const burst = !sustain ? (Number(W.max) || 0) / net : null;
    const finalRt = Math.max(0, res.reloadFrames);
    const skipped = casts.some(c => hasKind(c.root, 'skip'));

    let h = `<div class="panel"><h2>Summary</h2><div class="tiles">
      <div class="tile"><div class="k">Casts per cycle</div><div class="v">${casts.length}</div><div class="s">until the wand recharges</div></div>
      <div class="tile"><div class="k">Cast delay</div><div class="v">${sec(Math.max(0, casts[0].cdFrames))} s</div><div class="s">first cast</div></div>
      <div class="tile"><div class="k">Recharge</div><div class="v">${sec(finalRt)} s</div><div class="s">after the last cast</div></div>
      <div class="tile"><div class="k">Casts per second</div><div class="v">${cps.toFixed(2)}</div><div class="s">cap is 60</div></div>
      <div class="tile"><div class="k">Mana per cycle</div><div class="v">${r2(manaSpent)}</div><div class="s">${manaSpent <= 0 ? 'free or mana-positive' : 'spent each cycle'}</div></div>
      <div class="tile ${sustain ? 'ok' : 'warn'}"><div class="k">Net mana / s</div><div class="v">${net > 0 ? '−' : '+'}${Math.abs(net).toFixed(1)}</div><div class="s">${sustain ? 'regen keeps up, holds fire forever' : `empties a full wand in ${burst.toFixed(1)} s`}</div></div>
    </div>
    <div class="eqrow"><div class="eqlabel">Recharge (s)</div><div class="eq">RT = max(0, ${rtEquation(res)}) <span class="op">= </span><span class="res">${sec(finalRt)}</span></div></div>
    <div class="eqrow"><div class="eqlabel">Cycle time</div><div class="eq">T = ${casts.map((c, i) => `<span class="term t-wand" title="Cast ${i + 1}: ${c.reload ? 'larger of cast delay and recharge' : 'cast delay'}">${sec(c.wait)}<sub>c${i + 1}</sub></span>`).join('<span class="op"> + </span>')}<span class="op"> = </span><span class="res">${sec(total)} s</span></div></div>
    <div class="eqrow"><div class="eqlabel">Net mana / s</div><div class="eq">${r2(manaSpent)}<span class="op"> / </span>${sec(total)}<span class="op"> − </span>${regen}<span class="op"> = </span><span class="res">${net > 0 ? '−' : '+'}${Math.abs(net).toFixed(1)}</span> <span class="note">(mana spent per second minus regen)</span></div></div>`;
    if (skipped) h += `<div class="warnbox"><b>Not enough mana:</b> some spells were skipped in this cycle (marked in red below). Simulation starts from a full wand and regenerates between casts.</div>`;
    const limited = res.usage.filter(u => u.start > 0 && u.left < u.start);
    if (limited.length) h += `<div class="warnbox"><b>Limited uses:</b> ${limited.map(u => `${esc(u.name)} (slot ${u.slot}) uses ${u.start - u.left} of ${u.start} charges per cycle, so it runs out after ${Math.floor(u.start / (u.start - u.left))} cycle${Math.floor(u.start / (u.start - u.left)) === 1 ? '' : 's'}`).join('; ')}.</div>`;
    h += `</div><div class="panel"><h2>Casts</h2>`;
    casts.forEach((c, i) => {
      h += `<div class="cast"><div class="casthead"><h3>Cast ${i + 1}</h3>
        ${c.reload ? '<span class="pill r">recharges after</span>' : '<span class="pill">deck continues</span>'}
        ${c.wrapped ? '<span class="pill w">wrapped</span>' : ''}
        <span class="pill">wait ${sec(c.wait)} s</span>
        <span class="pill">mana ${Math.floor(c.manaStart)} → ${Math.floor(c.manaEnd)}</span></div>
        <div class="tree">${treeHtml(c.root) || '<p class="empty">Nothing was cast.</p>'}</div>
        ${c.notes.length ? `<ul class="notes">${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="eqrow"><div class="eqlabel">Cast delay (s)</div><div class="eq">CD = ${cdEquation(c)}<span class="op"> = </span><span class="res">${sec(Math.max(0, c.cdFrames))}</span>${c.cdFrames < 0 ? ` <span class="note">(−${sec(-c.cdFrames)} counts as 0)</span>` : ''}</div></div>
        <div class="eqrow"><div class="eqlabel">Mana</div><div class="eq">M = ${manaEquation(c)}<span class="op"> = </span><span class="res">${r2(sumMana(c.root))}</span></div></div>
        ${shotsHtml(c)}</div>`;
    });
    h += `</div>`;
    R.innerHTML = h;
  }
  function sumMana(n) { let s = (n.kind === 'draw' || n.kind === 'always') ? (n.mana || 0) : 0; n.children.forEach(ch => { s += sumMana(ch); }); return s; }
  function hasKind(n, k) { return n.kind === k || n.children.some(ch => hasKind(ch, k)); }

  /* ---------- controls ---------- */
  const groupOrder = ['projectile', 'static', 'modifier', 'multicast', 'material', 'utility', 'other', 'passive'];
  const groupName = { projectile: 'Projectiles', static: 'Static projectiles', modifier: 'Modifiers', multicast: 'Multicasts', material: 'Materials', utility: 'Utility', other: 'Other', passive: 'Passive' };
  const label = s => s.name + (APPROX.has(s.id) ? ' ~' : '') + (s.custom ? ' (custom)' : '');
  // Search: every query word must match a word in the spell's name or internal id,
  // in any order, allowing partial words ("orbiting nuke" finds "Nuke Orbit").
  const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  function matches(s, query) {
    const q = words(query || '');
    if (!q.length) return true;
    const hay = [...words(s.name), ...words(s.id)];
    return q.every(w => hay.some(t => t.startsWith(w) || (t.length >= 4 && w.startsWith(t))));
  }
  function optionsHtml(sel, filter, withNone) {
    return (withNone ? `<option value="">None</option>` : '') + groupOrder.map(g => {
      const list = SPELLS.filter(s => s.g === g && (matches(s, filter) || s.id === sel)).sort((x, y) => x.name.localeCompare(y.name));
      if (!list.length) return '';
      return `<optgroup label="${groupName[g]}">` + list.map(s => `<option value="${esc(s.id)}"${s.id === sel ? ' selected' : ''}>${esc(label(s))}</option>`).join('') + '</optgroup>';
    }).join('');
  }
  function renderAdd() {
    const sel = document.getElementById('addSel');
    const cur = sel.value;
    sel.innerHTML = optionsHtml(null, document.getElementById('addFind').value);
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  // Optional spell icons: put the game's gun_actions PNGs in img/spells/ (see README).
  // Icons that fail to load once are remembered so they aren't requested again.
  const ICON_DIR = 'img/spells/';
  const missingIcons = new Set();
  window.__wandIconFail = img => { missingIcons.add(img.dataset.icon); img.remove(); };
  const iconHtml = sp => {
    const name = sp.icon || sp.id.toLowerCase();
    if (sp.custom || missingIcons.has(name)) return '';
    return `<img src="${ICON_DIR}${esc(name)}.png" data-icon="${esc(name)}" alt="" onerror="__wandIconFail(this)">`;
  };
  let selSlot = -1;
  function renderSlots() {
    state.slots = state.slots.filter(id => byId[id]);
    if (selSlot >= state.slots.length) selSlot = state.slots.length - 1;
    document.getElementById('slots').innerHTML = state.slots.map((id, i) => {
      const sp = byId[id];
      const lim = sp.uses != null && sp.uses >= 0 && (!state.unlimited || sp.nu);
      return `<li><button type="button" class="slot t-${sp.g}${i === selSlot ? ' sel' : ''}" draggable="true" data-slot="${i}" aria-pressed="${i === selSlot}" title="${esc(`Slot ${i + 1}: ${sp.name} (${groupName[sp.g] || sp.g}, ${sp.mana} mana)`)}">
        <span class="sn">${i + 1}</span>${lim ? `<span class="su">${sp.uses}</span>` : ''}${iconHtml(sp)}<span class="tn">${esc(label(sp))}</span></button></li>`;
    }).join('') + `<li><button type="button" class="slot add" id="slotAdd" title="Add a spell" aria-label="Add a spell">+</button></li>`;
    document.getElementById('slotCount').textContent = `${state.slots.length} slot${state.slots.length === 1 ? '' : 's'} · drag to reorder, click to edit`;
    renderSlotEdit();
    renderAdd();
  }
  function renderSlotEdit() {
    const box = document.getElementById('slotEdit');
    if (selSlot < 0 || !state.slots[selSlot]) { box.innerHTML = state.slots.length ? 'Click a slot to replace, move or remove it.' : 'No spells yet. Search below to add one.'; return; }
    const i = selSlot;
    box.innerHTML = `<span>Slot ${i + 1}</span>
      <select id="slotReplace" aria-label="Spell in slot ${i + 1}">${optionsHtml(state.slots[i])}</select>
      <span class="btns"><button data-move="-1" aria-label="Move slot ${i + 1} left">←</button><button data-move="1" aria-label="Move slot ${i + 1} right">→</button><button data-del="1" aria-label="Remove slot ${i + 1}">Remove</button><button data-desel="1" aria-label="Done editing">Done</button></span>`;
  }
  function moveSlot(from, to) {
    const s = state.slots;
    if (from === to || from < 0 || to < 0 || from >= s.length || to > s.length) return;
    const [id] = s.splice(from, 1);
    s.splice(to > from ? to - 1 : to, 0, id);
  }
  function renderAcs() {
    document.getElementById('acs').innerHTML = state.ac.map((id, i) => `<select id="ac-${i}" data-ac="${i}" aria-label="Always cast ${i + 1}">${optionsHtml(id && byId[id] ? id : '', '', true)}</select>`).join('');
  }
  const unlockName = s => s ? s.replace('card_unlocked_', '').replace(/_/g, ' ') : '';
  function renderLib() {
    const t = document.getElementById('libTable');
    const q = document.getElementById('libFind').value;
    const rows = SPELLS.filter(s => matches(s, q));
    t.innerHTML = `<tr><th>Spell</th><th>Type</th><th>Mana</th><th>Cast delay (s)</th><th>Recharge (s)</th><th>Spread</th><th>Speed ×</th><th>Draws</th><th>Uses</th><th>Projectile</th><th>Unlock</th><th>Notes</th></tr>` +
      rows.map(s => {
        const ro = HANDLED.has(s.id) || s.custom;
        const cd = sumOps(s, 'cd'), rt = sumOps(s, 'rt'), spr = sumOps(s, 'spread');
        const mult = s.ops.filter(o => o[0] === 'mult').reduce((m, o) => m * o[1], 1);
        const draws = s.ops.filter(o => o[0] === 'draw').reduce((m, o) => m + o[1], 0) + s.ops.filter(o => o[0] === 'trig').reduce((m, o) => m + o[3], 0);
        const set0 = s.ops.some(o => o[0] === 'cdSet');
        const pkey = (s.ops.find(o => o[0] === 'proj') || [])[1] || (s.ops.find(o => o[0] === 'trig') || [])[2] || (s.rel || [])[0];
        const ps = pkey ? PROJ[pkey] : null;
        const ptxt = ps ? `${ps[0] === ps[1] ? ps[0] : ps[0] + '–' + ps[1]} px/s, ${ps[2] < 0 ? '∞' : ps[2] + 'f'}${ps[5] ? ', ' + r2(ps[5]) + ' dmg' : ''}` : '–';
        const notes = [set0 ? 'sets cast delay to 0' : '', s.ops.some(o => o[0] === 'nolla') ? 'lifetime → ~3 frames' : '', sumOps(s, 'life') ? `lifetime ${sumOps(s, 'life') > 0 ? '+' : ''}${sumOps(s, 'life')}f` : '', s.ops.some(o => o[0] === 'trig') ? 'trigger (' + s.ops.find(o => o[0] === 'trig')[1] + ')' : '', HANDLED.has(s.id) ? 'special rules' : '', APPROX.has(s.id) ? '~ ' + RANDOM_NOTE[s.id] : '', s.nu ? 'never unlimited' : '', s.edited ? 'edited' : ''].filter(Boolean).join('; ');
        const inp = (k, v, step) => ro ? (k === 'mana' ? v : sec(v)) : `<input type="number" id="lib-${esc(s.id)}-${k}" data-l="${esc(s.id)}" data-k="${k}" value="${k === 'mana' ? v : sec(v)}" step="${step}">`;
        return `<tr><td><span class="nm t-${s.g}">${esc(s.name)}</span></td><td>${groupName[s.g] || s.g}</td>
          <td>${ro ? s.mana : inp('mana', s.mana, 1)}</td><td>${set0 ? 'sets 0' : inp('cd', cd, 0.01)}</td><td>${inp('rt', rt, 0.01)}</td>
          <td>${spr ? r2(spr) + '°' : '–'}</td><td>${mult !== 1 ? r2(mult) + '×' : '–'}</td><td>${draws || '–'}</td><td>${s.uses != null && s.uses >= 0 ? s.uses : '∞'}</td>
          <td class="note">${ptxt}</td><td class="note">${esc(unlockName(s.unlock))}</td><td class="note">${esc(notes)}</td></tr>`;
      }).join('') + (rows.length ? '' : '<tr><td colspan="12" class="empty">No spells match that filter.</td></tr>');
  }
  function renderWand() {
    const W = state.wand;
    [['w-spc', 'spc'], ['w-cd', 'cd'], ['w-rt', 'rt'], ['w-max', 'max'], ['w-regen', 'regen'], ['w-spread', 'spread'], ['w-mult', 'mult']].forEach(([id, k]) => { document.getElementById(id).value = W[k]; });
    document.getElementById('w-shuffle').value = W.shuffle;
    document.getElementById('unl').checked = !!state.unlimited;
    document.getElementById('c-enemy').checked = !!state.conds.enemy;
    document.getElementById('c-projectile').checked = !!state.conds.projectile;
    document.getElementById('c-hp').checked = !!state.conds.hp;
  }
  function refresh() { renderSlots(); renderResults(); save(); }
  function full() { rebuild(); renderAcs(); renderLib(); refresh(); }

  [['w-spc', 'spc'], ['w-cd', 'cd'], ['w-rt', 'rt'], ['w-max', 'max'], ['w-regen', 'regen'], ['w-spread', 'spread'], ['w-mult', 'mult']].forEach(([id, k]) => {
    document.getElementById(id).addEventListener('input', e => { const v = parseFloat(e.target.value); state.wand[k] = isNaN(v) ? 0 : v; renderResults(); save(); });
  });
  document.getElementById('w-shuffle').addEventListener('change', e => { state.wand.shuffle = e.target.value; renderResults(); save(); });
  document.getElementById('unl').addEventListener('change', e => { state.unlimited = e.target.checked; refresh(); });
  [['c-enemy', 'enemy'], ['c-projectile', 'projectile'], ['c-hp', 'hp']].forEach(([id, k]) => document.getElementById(id).addEventListener('change', e => { state.conds[k] = e.target.checked; renderResults(); save(); }));
  document.getElementById('acs').addEventListener('change', e => { if (e.target.dataset.ac != null) { state.ac[+e.target.dataset.ac] = e.target.value; renderResults(); save(); } });
  // Slot tiles: click to select, drag to reorder.
  const slotsEl = document.getElementById('slots');
  let dragFrom = -1;
  slotsEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'slotAdd') { document.getElementById('addFind').focus(); return; }
    const i = +b.dataset.slot;
    selSlot = selSlot === i ? -1 : i;
    renderSlots();
    const again = slotsEl.querySelector(`[data-slot="${i}"]`); if (again) again.focus();
  });
  slotsEl.addEventListener('dragstart', e => {
    const b = e.target.closest('[data-slot]'); if (!b) return;
    dragFrom = +b.dataset.slot;
    b.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {}
  });
  slotsEl.addEventListener('dragover', e => {
    if (dragFrom < 0) return;
    e.preventDefault();
    slotsEl.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
    const b = e.target.closest('.slot'); if (b) b.classList.add('over');
  });
  slotsEl.addEventListener('dragleave', e => { const b = e.target.closest('.slot'); if (b) b.classList.remove('over'); });
  slotsEl.addEventListener('drop', e => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const b = e.target.closest('.slot');
    const to = !b || b.id === 'slotAdd' ? state.slots.length : +b.dataset.slot;
    moveSlot(dragFrom, to);
    const newIdx = to > dragFrom ? to - 1 : to;
    if (selSlot === dragFrom) selSlot = newIdx;
    else if (selSlot >= 0) { let k = selSlot - (selSlot > dragFrom ? 1 : 0); if (k >= newIdx) k++; selSlot = k; }
    dragFrom = -1;
    refresh();
  });
  slotsEl.addEventListener('dragend', () => { dragFrom = -1; slotsEl.querySelectorAll('.dragging, .over').forEach(x => x.classList.remove('dragging', 'over')); });

  // Editor for the selected slot.
  const editEl = document.getElementById('slotEdit');
  editEl.addEventListener('change', e => { if (e.target.id === 'slotReplace' && selSlot >= 0) { state.slots[selSlot] = e.target.value; refresh(); } });
  editEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || selSlot < 0) return;
    if (b.dataset.move) {
      const to = selSlot + +b.dataset.move;
      if (to >= 0 && to < state.slots.length) { [state.slots[selSlot], state.slots[to]] = [state.slots[to], state.slots[selSlot]]; selSlot = to; }
    } else if (b.dataset.del) { state.slots.splice(selSlot, 1); selSlot = Math.min(selSlot, state.slots.length - 1); }
    else if (b.dataset.desel) selSlot = -1;
    refresh();
  });
  document.getElementById('addBtn').addEventListener('click', () => {
    const v = document.getElementById('addSel').value; if (!v) return;
    if (selSlot >= 0) { state.slots.splice(selSlot + 1, 0, v); selSlot++; } else state.slots.push(v);
    refresh();
  });
  document.getElementById('addFind').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('addBtn').click(); });
  document.getElementById('addFind').addEventListener('input', renderAdd);
  document.getElementById('libFind').addEventListener('input', renderLib);
  document.getElementById('pTele').addEventListener('click', () => { state.slots = TELE.slice(); selSlot = -1; refresh(); });
  document.getElementById('pDiv').addEventListener('click', () => { state.slots = DIVEX.slice(); selSlot = -1; refresh(); });
  document.getElementById('pClear').addEventListener('click', () => { state.slots = []; selSlot = -1; refresh(); });
  document.getElementById('libTable').addEventListener('change', e => {
    const el = e.target; if (el.dataset.l == null) return;
    const id = el.dataset.l, k = el.dataset.k, v = parseFloat(el.value);
    const o = state.overrides[id] = state.overrides[id] || {};
    if (k === 'mana') o.mana = isNaN(v) ? 0 : v; else o[k] = isNaN(v) ? 0 : f(v);
    full();
  });
  document.getElementById('c-add').addEventListener('click', () => {
    const name = document.getElementById('c-name').value.trim();
    if (!name) { document.getElementById('c-name').focus(); return; }
    const num = id => parseFloat(document.getElementById(id).value) || 0;
    state.custom.push({ id: 'CUSTOM_' + (++state.customN), name, type: document.getElementById('c-type').value, draws: Math.max(1, Math.round(num('c-draws'))), mana: num('c-mana'), cd: f(num('c-cd')), rt: f(num('c-rt')), speed: num('c-speed'), life: num('c-life') });
    document.getElementById('c-name').value = '';
    full();
  });
  document.getElementById('resetLib').addEventListener('click', () => { state.overrides = {}; state.custom = []; full(); });

  renderWand(); full();
})();
