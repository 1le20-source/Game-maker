#!/usr/bin/env python3
"""Build Body Studio's data file from MakeHuman's CC0 assets.

Usage:
  build_assets.py <makehuman repo> <mpfb2 repo> <out.js>

<makehuman repo> is a checkout of github.com/makehumancommunity/makehuman
(only makehuman/data and makehuman/core/transformations.py are read) and
<mpfb2 repo> a checkout of github.com/makehumancommunity/mpfb2 (only the skin
region masks in src/mpfb/data/textures are read). Both projects release these
assets under CC0 1.0.

The output is a JS file that sets window.BODY_DATA = {meta, bin}, where bin is
a base64 gzip of every numeric array and meta is plain JSON describing where
each array lives. Shipping it as a script (not a fetched .bin) keeps Body
Studio working when index.html is opened straight from disk.
"""
import base64
import collections
import gzip
import io
import json
import os
import re
import sys

import numpy as np
from PIL import Image

MH, MPFB, OUT = sys.argv[1:4]
DATA = os.path.join(MH, 'makehuman', 'data')
sys.path.insert(0, os.path.join(MH, 'makehuman', 'core'))
import transformations as tm  # noqa: E402  (Gohlke's, as bundled by MakeHuman)

# ---------------------------------------------------------------- base mesh
coords, uvs, faces = [], [], collections.OrderedDict()
group = None
for line in open(os.path.join(DATA, '3dobjs', 'base.obj')):
    w = line.split()
    if not w:
        continue
    if w[0] == 'v':
        coords.append([float(x) for x in w[1:4]])
    elif w[0] == 'vt':
        uvs.append([float(x) for x in w[1:3]])
    elif w[0] == 'g':
        group = w[1]
    elif w[0] == 'f':
        corners = [c.split('/') for c in w[1:]]
        faces.setdefault(group, []).append([(int(c[0]) - 1, int(c[1]) - 1) for c in corners])
coords = np.array(coords, np.float64)
uvs = np.array(uvs, np.float64)

RENDER_GROUPS = ['body', 'helper-tongue', 'helper-upper-teeth', 'helper-lower-teeth',
                 'helper-l-eyelashes-1', 'helper-l-eyelashes-2', 'helper-r-eyelashes-1', 'helper-r-eyelashes-2']
keep = set()
for g in RENDER_GROUPS + ['helper-l-eye', 'helper-r-eye']:
    for f in faces[g]:
        keep.update(v for v, _ in f)
for g in faces:
    if g.startswith('joint-'):
        for f in faces[g]:
            keep.update(v for v, _ in f)
keep = sorted(keep)
remap = -np.ones(len(coords), np.int64)
remap[keep] = np.arange(len(keep))
NV = len(keep)
print('kept vertices', NV, 'of', len(coords))

# ------------------------------------------------------------------ binary
blob = io.BytesIO()
sections = {}


def put(name, arr):
    arr = np.ascontiguousarray(arr)
    pad = (-blob.tell()) % 4
    blob.write(b'\0' * pad)
    sections[name] = [blob.tell(), int(arr.size), arr.dtype.name]
    blob.write(arr.tobytes())


put('coords', coords[keep].astype(np.float32).ravel())
put('uvs', uvs.astype(np.float32).ravel())
groups_meta = {}
for g in RENDER_GROUPS:
    fv = np.array([[remap[v] for v, _ in f] for f in faces[g]], np.uint16)
    ft = np.array([[t for _, t in f] for f in faces[g]], np.uint16)
    assert (fv >= 0).all()
    put('f:' + g, fv.ravel())
    put('ft:' + g, ft.ravel())
    groups_meta[g] = len(fv)

# ---------------------------------------------------------- skin masks (UV)
# MPFB's region masks are painted on the default UV layout; sample them at
# each vertex so the browser gets per-vertex lips/eyelids/nails/... weights.
MASKS = ['lips', 'eyelids', 'face', 'ears', 'fingernails', 'toenails', 'aureolae', 'inside-mouth']
mask_vals = np.zeros((NV, len(MASKS)), np.float32)
for mi, m in enumerate(MASKS):
    im = np.asarray(Image.open(os.path.join(MPFB, 'src/mpfb/data/textures/mpfb_%s.jpg' % m)).convert('L'), np.float32) / 255
    H, W = im.shape
    for f in faces['body']:
        for v, t in f:
            u, vv = uvs[t]
            x = min(W - 1, max(0, int(u * W)))
            y = min(H - 1, max(0, int((1 - vv) * H)))
            # small box filter: the masks are soft-edged already
            val = im[max(0, y - 2):y + 3, max(0, x - 2):x + 3].mean()
            r = remap[v]
            mask_vals[r, mi] = max(mask_vals[r, mi], val)
put('masks', np.clip(mask_vals * 255 + 0.5, 0, 255).astype(np.uint8).ravel())

# ------------------------------------------------------------------ targets
TD = os.path.join(DATA, 'targets')


def read_target(rel):
    idx, d = [], []
    for line in open(os.path.join(TD, rel + '.target')):
        if line.startswith('#'):
            continue
        w = line.split()
        if len(w) != 4:
            continue
        r = remap[int(w[0])]
        if r < 0:
            continue
        idx.append(r)
        d.append([float(x) for x in w[1:]])
    return np.array(idx, np.int64), np.array(d, np.float64).reshape(-1, 3)


names = []
G, A3, LV3 = ['female', 'male'], ['young', 'old'], ['min', 'average', 'max']
for g in G:
    for a in A3:
        for m in LV3:
            for wt in LV3:
                names.append('macrodetails/universal-%s-%s-%smuscle-%sweight' % (g, a, m, wt))
for e in ['african', 'asian', 'caucasian']:
    for g in G:
        for a in A3:
            names.append('macrodetails/%s-%s-%s' % (e, g, a))
for g in G:
    for a in A3:
        for h in ['min', 'max']:
            names.append('macrodetails/height/%s-%s-averagemuscle-averageweight-%sheight' % (g, a, h))
        for p in ['ideal', 'uncommon']:
            names.append('macrodetails/proportions/%s-%s-averagemuscle-averageweight-%sproportions' % (g, a, p))
for a in A3:
    for c in LV3:
        for fm in LV3:
            if c == fm == 'average':
                continue
            names.append('breast/female-%s-averagemuscle-averageweight-%scup-%sfirmness' % (a, c, fm))
LR = lambda base: ['l-' + base, 'r-' + base]
PAIR = lambda base, a='decr', b='incr': [base + '-' + a, base + '-' + b]
detail = []
detail += ['head/head-' + s for s in ['oval', 'round', 'rectangular', 'square', 'triangular', 'invertedtriangular', 'diamond']]
detail += ['head/' + t for t in PAIR('head-fat') + PAIR('head-age')]
detail += ['neck/' + t for t in PAIR('neck-double') + PAIR('neck-scale-horiz')]
for d in ['forehead', 'eyebrows', 'eyes', 'nose', 'mouth', 'ears', 'chin', 'cheek', 'bodyshapes']:
    for fn in sorted(os.listdir(os.path.join(TD, d))):
        if fn.endswith('.target'):
            detail.append(d + '/' + fn[:-7])
detail += ['torso/' + t for t in PAIR('torso-vshape') + PAIR('torso-muscle-dorsi') + PAIR('torso-muscle-pectoral')]
detail += ['hip/' + t for t in PAIR('hip-scale-horiz') + PAIR('hip-waist', 'down', 'up')]
detail += ['stomach/' + t for t in PAIR('stomach-pregnant')]
detail += ['buttocks/' + t for t in PAIR('buttocks-volume')]
for part in ['upperarm', 'lowerarm', 'upperleg', 'lowerleg']:
    for kind in ['fat', 'muscle']:
        for side in LR(part + '-' + kind):
            detail += ['armslegs/' + t for t in PAIR(side)]
for side in LR('hand-scale') + LR('foot-scale'):
    detail += ['armslegs/' + t for t in PAIR(side)]
for m in ['bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ', 'shoulder-dist', 'upperarm-circ', 'upperarm-length',
          'lowerarm-length', 'thigh-circ', 'calf-circ', 'upperleg-height', 'lowerleg-height', 'neck-circ', 'neck-height']:
    detail += ['measure/' + t for t in PAIR('measure-' + m)]
names += detail
names += ['pelvis/pelvis-tone-decr', 'pelvis/pelvis-tone-incr']

targets_meta = []
all_idx, all_d = [], []
EPS = 2e-4  # 0.02 mm: below anything visible
for n in names:
    if not os.path.exists(os.path.join(TD, n + '.target')):
        continue
    idx, d = read_target(n)
    if len(idx):
        keepmask = np.abs(d).max(1) > EPS
        idx, d = idx[keepmask], d[keepmask]
    if not len(idx):
        continue
    # a fixed 0.015 mm step: finer than anything visible, and the small
    # integers it produces compress far better than a per-target full range
    scale = max(1.5e-4, float(np.abs(d).max()) / 32767)
    q = np.round(d / scale).astype(np.int16)
    targets_meta.append([n, len(idx), scale])
    all_idx.append(np.diff(idx, prepend=0).astype(np.uint16))
    all_d.append(q)
# indices are delta-coded per target and the int16 deltas are stored as
# separate low/high byte planes: both make the gzip stream much smaller
put('t:idx', np.concatenate(all_idx))
dq = np.concatenate(all_d).ravel().view(np.uint8).reshape(-1, 2)
put('t:lo', dq[:, 0].copy())
put('t:hi', dq[:, 1].copy())
print('targets', len(targets_meta), 'entries', sum(t[1] for t in targets_meta))

# ----------------------------------------------------------------- skeleton
skel = json.load(open(os.path.join(DATA, 'rigs', 'default.mhskel')))
order = []
while len(order) < len(skel['bones']):
    for bn, bd in skel['bones'].items():
        if bn not in order and (not bd.get('parent') or bd['parent'] in order):
            order.append(bn)
joint_names = []


def joint_ref(jn):
    if jn not in joint_names:
        joint_names.append(jn)
    return joint_names.index(jn)


bones = []
for bn in order:
    bd = skel['bones'][bn]
    roll = bd.get('rotation_plane')
    if isinstance(roll, str):
        roll = [roll]
    elif not isinstance(roll, list):
        roll = []
    planes = [[joint_ref(j) for j in skel['planes'][p]] for p in roll if p in skel['planes']]
    bones.append({'name': bn, 'parent': order.index(bd['parent']) if bd.get('parent') else -1,
                  'head': joint_ref(bd['head']), 'tail': joint_ref(bd['tail']), 'planes': planes})
joints = [[int(remap[v]) for v in skel['joints'][jn]] for jn in joint_names]
assert all(v >= 0 for j in joints for v in j)

# skin weights: the 8 strongest bones per vertex (8-bone skinning in the shader)
wfile = json.load(open(os.path.join(DATA, 'rigs', 'default_weights.mhw')))['weights']
per_v = collections.defaultdict(list)
for bn, lst in wfile.items():
    bi = order.index(bn)
    for v, w in lst:
        r = remap[v]
        if r >= 0:
            per_v[r].append((w, bi))
K = 8
sidx = np.zeros((NV, K), np.uint8)
swt = np.zeros((NV, K), np.uint16)
for v in range(NV):
    lst = sorted(per_v[v], reverse=True)[:K]
    if not lst:
        lst = [(1.0, order.index('head'))]
    tot = sum(w for w, _ in lst)
    q = [int(round(w / tot * 65535)) for w, _ in lst]
    q[0] += 65535 - sum(q)
    for k, ((w, bi), qq) in enumerate(zip(lst, q)):
        sidx[v, k] = bi
        swt[v, k] = qq
put('skin:idx', sidx.ravel())
put('skin:w', swt.ravel())

# ------------------------------------------------- face pose units (BVH)
# Replicates MakeHuman's bvh.py: auto Z-up detection, channel-to-axis mapping
# and euler composition, yielding each bone's local pose rotation (matPose).
D = np.pi / 180


def load_bvh(path):
    lines = open(path).read().split('\n')
    pos = 0
    jl = []  # (name, parent, offset, channels)
    stack = []
    while True:
        w = lines[pos].split()
        pos += 1
        if not w:
            continue
        if w[0] in ('ROOT', 'JOINT'):
            jl.append({'name': w[1], 'parent': stack[-1] if stack else None, 'channels': [], 'end': False})
            cur = len(jl) - 1
        elif w[0] == 'End':
            jl.append({'name': None, 'parent': stack[-1], 'channels': [], 'end': True})
            cur = len(jl) - 1
        elif w[0] == '{':
            stack.append(cur)
        elif w[0] == '}':
            stack.pop()
        elif w[0] == 'OFFSET':
            jl[cur]['offset'] = np.array([float(x) for x in w[1:4]])
        elif w[0] == 'CHANNELS':
            jl[cur]['channels'] = w[2:]
        elif w[0] == 'MOTION':
            break
    nframes = int(lines[pos].split()[1])
    pos += 2
    frames = [np.array([float(x) for x in lines[pos + i].split()]) for i in range(nframes)]
    # Z-up guess, as MakeHuman: compare the y/z extent of a spine segment
    byname = {j['name']: i for i, j in enumerate(jl) if j['name']}
    ref = byname.get('spine01')
    child = next(i for i, j in enumerate(jl) if j['parent'] == ref)
    zup = abs(jl[child]['offset'][1]) <= abs(jl[child]['offset'][2])
    out = {}
    for fi, data in enumerate(frames):
        c = 0
        for j in jl:
            n = len(j['channels'])
            vals = data[c:c + n]
            c += n
            if j['end'] or not n:
                continue
            order_, angles = '', []
            for ch, val in zip(j['channels'], vals):
                if ch == 'Xrotation':
                    order_ = 'x' + order_
                    angles.append(D * val)
                elif ch == 'Yrotation':
                    if zup:
                        order_ = 'z' + order_
                        angles.append(-D * val)
                    else:
                        order_ = 'y' + order_
                        angles.append(D * val)
                elif ch == 'Zrotation':
                    order_ = ('y' if zup else 'z') + order_
                    angles.append(D * val)
            if len(angles) < 3:
                continue
            m = tm.euler_matrix(angles[2], angles[1], angles[0], axes='s' + order_)
            q = tm.quaternion_from_matrix(m)  # w, x, y, z
            if abs(q[0]) < 0.99999:
                if q[0] < 0:
                    q = -q
                out.setdefault(fi, {})[j['name']] = [round(float(q[1]), 6), round(float(q[2]), 6),
                                                     round(float(q[3]), 6), round(float(q[0]), 6)]
    return out


fpu = json.load(open(os.path.join(DATA, 'poseunits', 'face-poseunits.json')))['framemapping']
fbvh = load_bvh(os.path.join(DATA, 'poseunits', 'face-poseunits.bvh'))
face_units = {}
for fi, name in enumerate(fpu):
    if fi in fbvh:
        face_units[name] = {order.index(b): q for b, q in fbvh[fi].items() if b in order}
body_units = {}
for name, d in json.load(open(os.path.join(DATA, 'poseunits', 'body-poseunits.json')))['poses'].items():
    body_units[name] = {order.index(b): [q[1], q[2], q[3], q[0]] for b, q in d.items() if b in order}

# --------------------------------------------------------------- eye proxy
eye_v, eye_vt, eye_f = [], [], []
for line in open(os.path.join(DATA, 'eyes', 'high-poly', 'high-poly.obj')):
    w = line.split()
    if not w:
        continue
    if w[0] == 'v':
        eye_v.append([float(x) for x in w[1:4]])
    elif w[0] == 'vt':
        eye_vt.append([float(x) for x in w[1:3]])
    elif w[0] == 'f':
        eye_f.append([[int(x) - 1 for x in c.split('/')[:2]] for c in w[1:]])
refs, rw, offs, scales = [], [], [], {}
in_verts = False
for line in open(os.path.join(DATA, 'eyes', 'high-poly', 'high-poly.mhclo')):
    w = line.split()
    if not w or w[0].startswith('#'):
        continue
    if w[0] in ('x_scale', 'y_scale', 'z_scale'):
        scales[w[0][0]] = [int(remap[int(w[1])]), int(remap[int(w[2])]), float(w[3])]
    elif w[0] == 'verts':
        in_verts = True
    elif in_verts and re.match(r'^\d', w[0]):
        if len(w) == 1:
            refs.append([int(remap[int(w[0])])] * 3)
            rw.append([1, 0, 0])
            offs.append([0, 0, 0])
        else:
            refs.append([int(remap[int(x)]) for x in w[0:3]])
            rw.append([float(x) for x in w[3:6]])
            offs.append([float(x) for x in w[6:9]])
    elif in_verts:
        in_verts = False
assert len(refs) == len(eye_v)
assert all(r >= 0 for rr in refs for r in rr)
# split quads of the eye proxy into a corner list (v, vt)
eye_tris = []
for f in eye_f:
    for k in range(1, len(f) - 1):
        eye_tris += [f[0], f[k], f[k + 1]]
eye_tris = np.array(eye_tris, np.uint16)
put('eye:refs', np.array(refs, np.uint16).ravel())
put('eye:w', np.array(rw, np.float32).ravel())
put('eye:off', np.array(offs, np.float32).ravel())
put('eye:uv', np.array(eye_vt, np.float32).ravel())
put('eye:tris', eye_tris.ravel())

meta = {
    'source': 'MakeHuman 1.x base mesh hm08, targets, default rig and pose units; MPFB2 skin masks. All CC0 1.0.',
    'nVerts': NV,
    'nUV': len(uvs),
    'groups': groups_meta,
    'masks': MASKS,
    'targets': targets_meta,
    'bones': bones,
    'joints': joints,
    'faceUnits': face_units,
    'bodyUnits': body_units,
    'eye': {'nVerts': len(eye_v), 'scales': scales},
    'sections': sections,
}
raw = blob.getvalue()
gz = gzip.compress(raw, 9, mtime=0)
print('binary %.2f MB, gzip %.2f MB' % (len(raw) / 1e6, len(gz) / 1e6))
with open(OUT, 'w') as fo:
    fo.write('// Generated by tools/build_assets.py from MakeHuman and MPFB2 assets (CC0 1.0). Do not edit.\n')
    fo.write('window.BODY_DATA={meta:')
    fo.write(json.dumps(meta, separators=(',', ':')))
    fo.write(',bin:"')
    fo.write(base64.b64encode(gz).decode())
    fo.write('"};\n')
print('wrote', OUT, '%.2f MB' % (os.path.getsize(OUT) / 1e6))
