# Shrink a VRM/GLB for phones: downscale the big textures, then repack the binary chunk.
# usage: python3 -I slim_vrm.py in.vrm out.vrm
import json, struct, io, sys
from PIL import Image
src, dst = sys.argv[1:3]
b = open(src, 'rb').read()
clen, = struct.unpack('<I', b[12:16]); j = json.loads(b[20:20 + clen]); bs = 20 + clen + 8
LIMIT = {'Body_00': 1024, 'Body_00_nml': 1024, 'Thumbnail': 256}
views = j['bufferViews']; img_view = {im['bufferView']: im for im in j['images']}
out = bytearray()
for vi, bv in enumerate(views):
    d = b[bs + bv.get('byteOffset', 0): bs + bv.get('byteOffset', 0) + bv['byteLength']]
    im = img_view.get(vi)
    if im is not None and im.get('name') in LIMIT:
        p = Image.open(io.BytesIO(d)); n = LIMIT[im['name']]
        if max(p.size) > n:
            p = p.resize((n * p.size[0] // max(p.size), n * p.size[1] // max(p.size)), Image.LANCZOS)
            buf = io.BytesIO(); p.save(buf, 'PNG', optimize=True); d = buf.getvalue()
    while len(out) % 4: out.append(0)
    bv['byteOffset'] = len(out); bv['byteLength'] = len(d); out += d
while len(out) % 4: out.append(0)
j['buffers'][0]['byteLength'] = len(out)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(dst, 'wb').write(glb); print(len(b), '->', len(glb))
