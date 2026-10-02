"""Build js/gamedata.js from Noita's own data files.

Usage:
    python3 tools/build_data.py --data PATH_TO_NOITA_DATA [--out js/gamedata.js] [-v]

PATH_TO_NOITA_DATA is an unpacked data.wak folder (the one containing scripts/, entities/
and translations/), for example a clone of https://github.com/vexx32/noita-data.
It reads scripts/gun/gun_actions.lua for spell stats, the projectile XMLs for speed,
lifetime and damage, and translations/common.csv for English spell names.
"""
import re, json, os, sys, csv, argparse

ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('--data', required=True, help='unpacked Noita data folder')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'js', 'gamedata.js'))
ap.add_argument('-v', action='store_true', help='list spells with logic the parser did not recognize')
args = ap.parse_args()
DATA = os.path.join(args.data, '')
lua = open(DATA + 'scripts/gun/gun_actions.lua', encoding='utf-8').read()
tr = {}
with open(DATA + 'translations/common.csv', encoding='utf-8') as fh:
    for row in csv.reader(fh):
        if len(row) > 1: tr[row[0]] = row[1]
# Names missing from some versions of common.csv
for k, v in {'action_black_hole_giga': 'Omega Black Hole', 'action_blood_to_power': 'Blood to Power'}.items():
    tr.setdefault(k, v)

GROUP = {'ACTION_TYPE_PROJECTILE': 'projectile', 'ACTION_TYPE_STATIC_PROJECTILE': 'static',
         'ACTION_TYPE_MODIFIER': 'modifier', 'ACTION_TYPE_DRAW_MANY': 'multicast',
         'ACTION_TYPE_MATERIAL': 'material', 'ACTION_TYPE_OTHER': 'other',
         'ACTION_TYPE_UTILITY': 'utility', 'ACTION_TYPE_PASSIVE': 'passive'}

# ---- split the actions table into entries (top-level { ... } inside actions = { ... })
start = lua.index('actions =')
body = lua[lua.index('{', start) + 1:]
entries, depth, cur, i = [], 0, [], 0
in_str = None
buf_start = None
while i < len(body):
    ch = body[i]
    if in_str:
        if ch == '\\': i += 2; continue
        if ch == in_str: in_str = None
    elif body.startswith('--', i):
        if body.startswith('--[[', i):
            j = body.find(']]', i); i = j + 2; continue
        j = body.find('\n', i); i = j; continue
    elif ch in '"\'':
        in_str = ch
    elif ch == '{':
        if depth == 0: buf_start = i
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0: entries.append(body[buf_start:i + 1])
        if depth < 0: break
    i += 1

def strip_comments(s):
    s = re.sub(r'--\[\[.*?\]\]', '', s, flags=re.S)
    return re.sub(r'--[^\n]*', '', s)

def action_body(e):
    m = re.search(r'\baction\s*=\s*function\s*\(([^)]*)\)', e)
    if not m: return None
    i = m.end(); depth = 1
    toks = re.finditer(r'\b(function|if|for|while|do|end)\b|"(?:[^"\\]|\\.)*"', e[i:])
    for t in toks:
        w = t.group(1)
        if not w: continue
        if w in ('function', 'if'): depth += 1
        elif w in ('for', 'while'): depth += 1
        elif w == 'do':
            # 'do' following for/while doesn't open a new block; standalone 'do' does (rare)
            pass
        elif w == 'end':
            depth -= 1
            if depth == 0:
                return e[i:i + t.start()]
    return e[i:]

NUM = r'(-?\d+(?:\.\d+)?)'
spells = []
unknown = {}
for e in entries:
    e = strip_comments(e)
    g = lambda pat, d=None: (re.search(pat, e).group(1) if re.search(pat, e) else d)
    sid = g(r'\bid\s*=\s*"([A-Za-z0-9_]+)"')
    if not sid: continue
    namekey = g(r'\bname\s*=\s*"\$([a-z0-9_]+)"')
    name = tr.get(namekey) or sid.replace('_', ' ').title()
    name = name[:1].upper() + name[1:]
    group = GROUP.get(g(r'\btype\s*=\s*(ACTION_TYPE_[A-Z_]+)'), 'other')
    mana = g(r'\bmana\s*=\s*' + NUM)
    mana = float(mana) if mana is not None else 10.0
    sp = {'id': sid, 'name': name, 'group': group, 'mana': mana}
    mu = g(r'\bmax_uses\s*=\s*' + NUM)
    if mu is not None: sp['uses'] = int(float(mu))
    if re.search(r'\bnever_unlimited\s*=\s*true', e): sp['neverUnlimited'] = True
    if re.search(r'\brecursive\s*=\s*true', e): sp['recursive'] = True
    fl = g(r'\bspawn_requires_flag\s*=\s*"([a-z0-9_]+)"')
    if fl: sp['unlock'] = fl
    rp = re.search(r'related_projectiles\s*=\s*\{([^}]*)\}', e)
    if rp:
        parts = [p.strip() for p in rp.group(1).split(',') if p.strip()]
        files = [p.strip('"') for p in parts if p.startswith('"')]
        nums = [p for p in parts if re.fullmatch(r'\d+', p)]
        sp['related'] = files
        if nums: sp['relatedCount'] = int(nums[0])
    body = action_body(e) or ''
    ops, special_lines = [], []
    # statement-level scan
    lines = [l.strip() for l in body.split('\n') if l.strip()]
    skip_block = 0
    j = 0
    while j < len(lines):
        l = lines[j]
        # benign clamp blocks: if ( c.xxx ... ) then ... end   (single or multi-line)
        m = re.match(r'^if\s*\(?\s*c\.([a-z_]+)\s*[<>=~]+.*then', l)
        if m and m.group(1) != 'fire_rate_wait':
            # skip to matching end (simple, no nesting expected)
            k = j
            while k < len(lines) and not re.match(r'^end\b', lines[k]) and not (k == j and l.rstrip().endswith('end')):
                k += 1
            if m.group(1) == 'speed_multiplier': ops.append(['multClamp'])
            j = k + 1; continue
        mm = None
        if (mm := re.match(r'^c\.fire_rate_wait\s*=\s*c\.fire_rate_wait\s*([+-])\s*' + NUM + r'$', l)):
            ops.append(['cd', float(mm.group(2)) * (1 if mm.group(1) == '+' else -1)])
        elif (mm := re.match(r'^c\.fire_rate_wait\s*=\s*' + NUM + r'$', l)):
            ops.append(['cdSet', float(mm.group(1))])
        elif (mm := re.match(r'^current_reload_time\s*=\s*current_reload_time\s*(?:-\s*ACTION_DRAW_RELOAD_TIME_INCREASE\s*)?([+-])\s*' + NUM + r'$', l)):
            ops.append(['rt', float(mm.group(2)) * (1 if mm.group(1) == '+' else -1)])
        elif (mm := re.match(r'^current_reload_time\s*=\s*' + NUM + r'$', l)):
            ops.append(['rtSet', float(mm.group(1))])
        elif (mm := re.match(r'^c\.spread_degrees\s*=\s*c\.spread_degrees\s*([+-])\s*' + NUM + r'$', l)):
            ops.append(['spread', float(mm.group(2)) * (1 if mm.group(1) == '+' else -1)])
        elif (mm := re.match(r'^c\.speed_multiplier\s*=\s*c\.speed_multiplier\s*\*\s*' + NUM + r'$', l)):
            ops.append(['mult', float(mm.group(1))])
        elif (mm := re.match(r'^c\.lifetime_add\s*=\s*c\.lifetime_add\s*([+-])\s*' + NUM + r'$', l)):
            ops.append(['life', float(mm.group(2)) * (1 if mm.group(1) == '+' else -1)])
        elif (mm := re.match(r'^c\.damage_projectile_add\s*=\s*c\.damage_projectile_add\s*([+-])\s*' + NUM + r'$', l)):
            ops.append(['dmg', float(mm.group(2)) * (1 if mm.group(1) == '+' else -1)])
        elif (mm := re.match(r'^c\.extra_entities\s*=\s*c\.extra_entities\s*\.\.\s*"([^"]*)"$', l)):
            for x in [y for y in mm.group(1).split(',') if y]:
                ops.append(['extra', x])
        elif (mm := re.match(r'^add_projectile\(\s*"([^"]+)"\s*\)$', l)):
            ops.append(['proj', mm.group(1)])
        elif (mm := re.match(r'^add_projectile_trigger_hit_world\(\s*"([^"]+)"\s*,\s*(\d+)\s*\)$', l)):
            ops.append(['trig', 'hit', mm.group(1), int(mm.group(2)), 0])
        elif (mm := re.match(r'^add_projectile_trigger_death\(\s*"([^"]+)"\s*,\s*(\d+)\s*\)$', l)):
            ops.append(['trig', 'death', mm.group(1), int(mm.group(2)), 0])
        elif (mm := re.match(r'^add_projectile_trigger_timer\(\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$', l)):
            ops.append(['trig', 'timer', mm.group(1), int(mm.group(3)), int(mm.group(2))])
        elif (mm := re.match(r'^draw_actions\(\s*(\d+)\s*,\s*true\s*\)$', l)):
            ops.append(['draw', int(mm.group(1))])
        elif re.match(r'^(c|shot_effects)\.[a-z_0-9]+\s*=', l) or re.match(r'^c\.[a-z_]+\s*=', l):
            pass  # unmodeled stat (damage types, explosion, bounces, effects...)
        elif re.match(r'^(BaabInstruction|baab_instruction|OnActionPlayed)', l):
            pass
        else:
            special_lines.append(l)
        j += 1
    sp['ops'] = ops
    if special_lines:
        sp['special'] = True
        unknown[sid] = special_lines
    spells.append(sp)

# ---- projectile XML stats
cache = {}
class Node:
    def __init__(self, tag, attrib): self.tag, self.attrib, self.children = tag, attrib, []
    def get(self, k, d=None): return self.attrib.get(k, d)
    def __iter__(self): return iter(self.children)
TAG = re.compile(r'<(/?)([A-Za-z_][\w.]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(/?)>', re.S)
ATTR = re.compile(r'([\w.:-]+)\s*=\s*"([^"]*)"')
def parse_lenient(txt):
    root = Node('R', {}); stack = [root]
    for m in TAG.finditer(txt):
        close, tag, attrs, selfclose = m.groups()
        if close:
            for k in range(len(stack) - 1, 0, -1):
                if stack[k].tag == tag: del stack[k:]; break
            continue
        n = Node(tag, {a: v for a, v in ATTR.findall(attrs)})
        stack[-1].children.append(n)
        if not selfclose: stack.append(n)
    return root
def load_xml(path):
    if path in cache: return cache[path]
    fp = DATA + path.replace('data/', '', 1)
    if not os.path.exists(fp):
        cache[path] = None; return None
    txt = open(fp, encoding='utf-8', errors='replace').read()
    txt = re.sub(r'<!--.*?-->', '', txt, flags=re.S)
    root = parse_lenient(txt)
    ent = next((c for c in root.children if c.tag == 'Entity'), None)
    cache[path] = ent
    return ent

def comps(path, depth=0):
    """Return dict comp_name -> attrs, resolving <Base> inheritance."""
    ent = load_xml(path)
    if ent is None or depth > 6: return {}
    out = {}
    for child in ent:
        if child.tag == 'Base':
            base = comps(child.get('file'), depth + 1)
            for k, v in base.items(): out[k] = dict(v)
            for ov in child:
                out.setdefault(ov.tag, {}).update(ov.attrib)
                for sub in ov: out.setdefault(ov.tag + '/' + sub.tag, {}).update(sub.attrib)
        else:
            out.setdefault(child.tag, {}).update(child.attrib)
            for sub in child: out.setdefault(child.tag + '/' + sub.tag, {}).update(sub.attrib)
    return out

def fnum(x, d=None):
    try: return float(x)
    except (TypeError, ValueError): return d

projectiles = {}
def proj_stats(path):
    if path in projectiles: return projectiles[path]
    c = comps(path)
    pc = c.get('ProjectileComponent')
    vc = c.get('VelocityComponent', {})
    if not pc:
        projectiles[path] = None; return None
    st = {
        'smin': fnum(pc.get('speed_min'), 60.0), 'smax': fnum(pc.get('speed_max'), fnum(pc.get('speed_min'), 60.0)),
        'life': fnum(pc.get('lifetime'), -1.0), 'lifeRand': fnum(pc.get('lifetime_randomness'), 0.0),
        'term': fnum(vc.get('terminal_velocity'), 1000.0),
        'applyTerm': vc.get('apply_terminal_velocity', '1') not in ('0', 'false'),
        'grav': fnum(vc.get('gravity_y'), 400.0), 'fric': fnum(vc.get('air_friction'), 0.55),
        'dmg': fnum(pc.get('damage'), 0.0),
    }
    ex = c.get('ProjectileComponent/config_explosion', {})
    if ex.get('explosion_radius'): st['exR'] = fnum(ex.get('explosion_radius'))
    if ex.get('damage'): st['exD'] = fnum(ex.get('damage'))
    projectiles[path] = st
    return st

all_paths = set()
for sp in spells:
    for op in sp['ops']:
        if op[0] == 'proj': all_paths.add(op[1])
        if op[0] == 'trig': all_paths.add(op[2])
    for r in sp.get('related', []): all_paths.add(r)
for pth in sorted(all_paths): proj_stats(pth)
missing = [p for p in all_paths if projectiles.get(p) is None]

# ---- compact output for the page
sh = lambda p: p.replace('data/entities/', '')
def num(x): return int(x) if isinstance(x, float) and x.is_integer() else x
out_spells = []
for s in spells:
    o = {'id': s['id'], 'name': s['name'], 'g': s['group'], 'mana': num(s['mana'])}
    for k_src, k in [('uses', 'uses'), ('unlock', 'unlock'), ('relatedCount', 'rc')]:
        if k_src in s: o[k] = s[k_src]
    if s.get('neverUnlimited'): o['nu'] = 1
    if s.get('recursive'): o['rec'] = 1
    if s.get('related'): o['rel'] = [sh(x) for x in s['related']]
    ops = []
    for op in s['ops']:
        op = list(op)
        if op[0] == 'extra':
            if 'nolla' in op[1]: ops.append(['nolla'])
            continue
        if op[0] == 'proj': op[1] = sh(op[1])
        if op[0] == 'trig': op[2] = sh(op[2])
        ops.append([num(v) for v in op])
    o['ops'] = ops
    out_spells.append(o)
out_proj = {}
for k, v in projectiles.items():
    if not v: continue
    # [speed_min, speed_max, lifetime, lifetime_randomness, terminal_velocity (0 = uncapped), damage x25, explosion damage x25, explosion radius]
    out_proj[sh(k)] = [num(x) for x in [v['smin'], v['smax'], v['life'], v['lifeRand'], v['term'] if v['applyTerm'] else 0.0,
                                        round(v['dmg'] * 25, 3), round(v.get('exD', 0) * 25, 3), v.get('exR', 0)]]
with open(args.out, 'w', encoding='utf-8') as fh:
    fh.write("/* Generated by tools/build_data.py from the game's spell and projectile files. Do not edit by hand. */\n")
    fh.write('const GAME_SPELLS=' + json.dumps(out_spells, separators=(',', ':'), ensure_ascii=False) + ';\n')
    fh.write('const GAME_PROJ=' + json.dumps(out_proj, separators=(',', ':')) + ';\n')
print(len(spells), 'spells;', len(unknown), 'with special logic;', len(out_proj), 'projectiles ->', os.path.normpath(args.out))
if args.v:
    for k, v in unknown.items(): print(k, '|', ' ;; '.join(v)[:300])
    print('No flight data (static or non-projectile entities):', len(missing))
