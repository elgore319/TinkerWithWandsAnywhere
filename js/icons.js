/* Original pixel icons for spell slots, picked from what each spell does.
   Used when the game's own icons aren't installed in img/spells/ (see README).
   spellIconSvg(spell) returns an inline SVG string drawn in currentColor. */
(function () {
  // 12x12 pixel art. '#' = spell color, '+' = highlight, '.' = empty.
  const PIX = {
    bolt: [
      '............',
      '.........++.',
      '........+++.',
      '.......###+.',
      '......###...',
      '.....###....',
      '....###.....',
      '...###......',
      '..###.......',
      '.###........',
      '.##.........',
      '............'],
    orb: [
      '............',
      '....####....',
      '...#++###...',
      '..#++#####..',
      '..#+######..',
      '..########..',
      '..########..',
      '..########..',
      '...######...',
      '....####....',
      '............',
      '............'],
    trigger: [
      '+..........+',
      '....####....',
      '...#++###...',
      '..#++#####..',
      '..#+######..',
      '+.########.+',
      '..########..',
      '..########..',
      '...######...',
      '....####....',
      '............',
      '+..........+'],
    saw: [
      '.....##.....',
      '..#.####.#..',
      '..########..',
      '.###++++###.',
      '###+....+###',
      '.##+....+##.',
      '.##+....+##.',
      '###+....+###',
      '.###++++###.',
      '..########..',
      '..#.####.#..',
      '.....##.....'],
    target: [
      '.....##.....',
      '.....##.....',
      '...######...',
      '..#......#..',
      '..#..++..#..',
      '####.++.####',
      '####.++.####',
      '..#..++..#..',
      '..#......#..',
      '...######...',
      '.....##.....',
      '.....##.....'],
    swirl: [
      '............',
      '...######...',
      '..#......#..',
      '.#..####..#.',
      '.#.#....#.#.',
      '.#.#.++.#.#.',
      '.#.#..+.#.#.',
      '.#.#....#...',
      '.#..####....',
      '..#.........',
      '...####.....',
      '............'],
    plus: [
      '............',
      '.....##.....',
      '....####....',
      '...######...',
      '..##.##.##..',
      '.....##.....',
      '.....##.....',
      '..++++++++..',
      '..++++++++..',
      '............',
      '............',
      '............'],
    speed: [
      '............',
      '............',
      '.##...##....',
      '..##...##...',
      '...##...##..',
      '....##...##.',
      '....##...##.',
      '...##...##..',
      '..##...##...',
      '.##...##....',
      '............',
      '............'],
    heavy: [
      '............',
      '.....++.....',
      '....+..+....',
      '....+..+....',
      '...######...',
      '..########..',
      '..########..',
      '.##########.',
      '.##########.',
      '.##########.',
      '............',
      '............'],
    fan: [
      '............',
      '#..........#',
      '.#...##...#.',
      '..#..##..#..',
      '...#.##.#...',
      '....####....',
      '.....++.....',
      '.....++.....',
      '.....++.....',
      '.....++.....',
      '.....++.....',
      '............'],
    narrow: [
      '.....##.....',
      '.....##.....',
      '.....##.....',
      '.#...##...#.',
      '..#..##..#..',
      '...#.##.#...',
      '....####....',
      '.....++.....',
      '.....++.....',
      '.....++.....',
      '.....++.....',
      '............'],
    hourglass: [
      '..########..',
      '..#......#..',
      '...#++++#...',
      '....#++#....',
      '.....##.....',
      '.....##.....',
      '....#..#....',
      '...#....#...',
      '..#.++++.#..',
      '..#++++++#..',
      '..########..',
      '............'],
    clock: [
      '...######...',
      '..#......#..',
      '.#...+....#.',
      '#....+.....#',
      '#....+.....#',
      '#....+++...#',
      '#..........#',
      '#..........#',
      '.#........#.',
      '..#......#..',
      '...######...',
      '............'],
    drop: [
      '.....#......',
      '.....#......',
      '....###.....',
      '....###.....',
      '...#####....',
      '..##+####...',
      '..#++#####..',
      '..#+######..',
      '..########..',
      '...######...',
      '....####....',
      '............'],
    star: [
      '.....##.....',
      '.....##.....',
      '.#...##...#.',
      '..#.####.#..',
      '...######...',
      '####++++####',
      '####++++####',
      '...######...',
      '..#.####.#..',
      '.#...##...#.',
      '.....##.....',
      '.....##.....'],
    pillar: [
      '..########..',
      '...######...',
      '...#++###...',
      '...#++###...',
      '...#+####...',
      '...######...',
      '...######...',
      '...######...',
      '...######...',
      '...######...',
      '..########..',
      '.##########.'],
    gear: [
      '.....##.....',
      '..#.####.#..',
      '..########..',
      '.###....###.',
      '###..++..###',
      '.##.+..+.##.',
      '.##.+..+.##.',
      '###..++..###',
      '.###....###.',
      '..########..',
      '..#.####.#..',
      '.....##.....'],
    shield: [
      '............',
      '.##########.',
      '.#++######..',
      '.#+#######..',
      '.#########..',
      '.#########..',
      '..#######...',
      '..#######...',
      '...#####....',
      '....###.....',
      '.....#......',
      '............']
  };
  const GREEK = { ALPHA: 'α', GAMMA: 'γ', TAU: 'τ', OMEGA: 'ω', MU: 'μ', PHI: 'φ', SIGMA: 'σ', ZETA: 'ζ' };
  const IFTXT = { IF_ENEMY: '?', IF_PROJECTILE: '?', IF_HP: '?', IF_HALF: '½', IF_ELSE: '≠', IF_END: '∎' };

  function pixSvg(rows) {
    let main = '', hi = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') main += `M${x} ${y}h1v1h-1z`;
        else if (row[x] === '+') hi += `M${x} ${y}h1v1h-1z`;
      }
    });
    return `<svg class="gicon" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path d="${main}" fill="currentColor"/><path d="${hi}" fill="currentColor" opacity="0.45"/></svg>`;
  }
  function dotsSvg(n) {
    // n small orbs in a ring (or a row for 2)
    const k = Math.max(2, Math.min(n, 8));
    let rects = '';
    for (let i = 0; i < k; i++) {
      const a = (Math.PI * 2 * i) / k - Math.PI / 2;
      const r = k === 2 ? 0 : 3.4;
      const cx = k === 2 ? (i === 0 ? 3.5 : 8.5) : 6 + Math.cos(a) * r, cy = k === 2 ? 6 : 6 + Math.sin(a) * r;
      rects += `<rect x="${(cx - 1.25).toFixed(2)}" y="${(cy - 1.25).toFixed(2)}" width="2.5" height="2.5" fill="currentColor"/>`;
    }
    return `<svg class="gicon" viewBox="0 0 12 12" aria-hidden="true">${rects}</svg>`;
  }
  function textSvg(t) {
    const size = t.length > 2 ? 6 : t.length === 2 ? 7.5 : 10;
    return `<svg class="gicon" viewBox="0 0 12 12" aria-hidden="true"><text x="6" y="6.4" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${size}" fill="currentColor">${t}</text></svg>`;
  }
  const has = (s, k) => s.ops && s.ops.some(o => o[0] === k);
  const sum = (s, k) => (s.ops || []).filter(o => o[0] === k).reduce((a, o) => a + o[1], 0);
  const prod = (s, k) => (s.ops || []).filter(o => o[0] === k).reduce((a, o) => a * o[1], 1);

  // Pick an icon from what the spell does. Order matters: most specific first.
  function pick(s) {
    const id = s.id;
    if (GREEK[id]) return textSvg(GREEK[id]);
    const div = /^DIVIDE_(\d+)$/.exec(id);
    if (div) return textSvg('÷' + div[1]);
    if (IFTXT[id]) return textSvg(IFTXT[id]);
    if (id === 'RESET') return textSvg('↺');
    if (id === 'BURST_X') return textSvg('∞');
    if (/^ADD_(TRIGGER|TIMER|DEATH_TRIGGER)$/.test(id)) return pixSvg(PIX.target);
    if (/^RANDOM_|^DRAW_RANDOM|^DRAW_3_RANDOM/.test(id)) return textSvg('?');
    if (s.ops && s.ops.some(o => o[0] === 'cdSet' && o[1] === 0)) return pixSvg(PIX.saw);
    if (/TELEPORT/.test(id)) return pixSvg(PIX.swirl);
    if (s.g === 'multicast') {
      const n = sum(s, 'draw');
      return n > 1 ? dotsSvg(n) : pixSvg(PIX.plus);
    }
    if (s.g === 'modifier' || s.g === 'utility' || s.g === 'other') {
      if (has(s, 'nolla')) return textSvg('0');
      if (has(s, 'trig')) return pixSvg(PIX.target);
      const mult = prod(s, 'mult');
      if (mult > 1) return pixSvg(PIX.speed);
      if (mult < 1) return pixSvg(PIX.heavy);
      if (s.mana < 0) return pixSvg(PIX.drop);
      if (sum(s, 'rt') < 0) return pixSvg(PIX.clock);
      if (sum(s, 'life')) return pixSvg(PIX.hourglass);
      const spr = sum(s, 'spread');
      if (spr < 0) return pixSvg(PIX.narrow);
      if (spr > 0) return pixSvg(PIX.fan);
      if (sum(s, 'dmg') > 0) return pixSvg(PIX.star);
      return pixSvg(s.g === 'modifier' ? PIX.plus : PIX.gear);
    }
    if (s.g === 'static') return pixSvg(PIX.pillar);
    if (s.g === 'material') return pixSvg(PIX.drop);
    if (s.g === 'passive') return pixSvg(PIX.shield);
    if (has(s, 'trig')) return pixSvg(PIX.trigger);
    if (/SUMMON|EGG|BOMB|MINE|GRENADE|NUKE|BLACK_HOLE|ORB/.test(id)) return pixSvg(PIX.orb);
    return pixSvg(PIX.bolt);
  }

  const cache = new Map();
  window.spellIconSvg = s => {
    if (!s) return '';
    const key = s.id + (s.custom ? ':c' : '');
    if (!cache.has(key)) cache.set(key, pick(s));
    return cache.get(key);
  };
})();
