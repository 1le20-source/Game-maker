# Body Studio — module contract

> **Duplicate-run guard.** The hair, clothing, anatomy and UI modules are
> being built by a second build run whose prompts contain the line
> `BUILD-ID: parallel-2`. If you are a module agent whose task is **hair,
> clothing, anatomy or ui** and your prompt does *not* contain that line, stop
> now. Don't touch any file, and return a report whose summary is
> `skipped: duplicate of parallel-2 run`. Skin and motion agents are not
> affected.

Body Studio (`body-studio/index.html`) is a browser character creator. It builds a
realistic adult human from MakeHuman's CC0 base mesh: any gender, age and build,
with real motion and emotion, a full 360° view, and the insides (skeleton,
organs, muscles, vessels) as anatomy layers. This file is the contract that
every module is written against.

## Hard rules

- **No build step, no ES modules.** Each file is a classic `<script>` wrapped in
  `(function () { 'use strict'; ... })();`. It reads `window.THREE` (three.js
  **r159**, vendored at `lib/three.min.js`) and the shared namespace `window.BS`.
  The page must also work when `index.html` is opened from disk (file://), so
  don't use `fetch`, workers loaded by URL, or any network asset. There are no
  three.js addons (no `examples/jsm`, no OrbitControls/EffectComposer/loaders):
  write what you need yourself.
- **Everything is procedural or comes from `assets/body-data.js`.** No image
  files: build textures with `<canvas>` or `DataTexture`.
- **Content.** People are adults only (age slider 18–90). Outfits always cover
  underwear areas: the minimum outfit is underwear, and nothing models
  genitals. Anatomy layers are educational, in the style of a medical atlas.
- **Ownership.** Edit only the files your task names. Shared files
  (`core.js`, `human.js`, `app.js`, `params.js`, `index.html`) are read-only
  for module agents. If you need a core change, work around it inside your
  module and describe the change in your final report.
- **Style.** Match the existing code: 2-space indent, single quotes,
  `const`/`let`, short purposeful comments, no dead code. Keep each module
  self-contained.
- **Performance.** It must stay smooth on a laptop iGPU and usable on a phone.
  The body is about 54k vertices and 107k triangles with 8-bone skinning. Watch
  per-frame CPU work: no allocations in `update()`, and reuse vectors.

## Coordinates

Units are meters. +Y is up, the feet stand on y = 0, and the character faces
+Z. **+X is the character's left**, so `.L` bones sit at +X. `human.group` stays
at the origin. Walking moves the root bone via `human.rootOffset`, and turning
rotates the root bone's pose.

## Load order (`index.html`)

`three.min.js` → `assets/body-data.js` → `params.js` → `core.js` → `human.js`
→ `app.js` → `stage.js` → `skin.js` → `motion.js` → `hair.js` → `clothing.js`
→ `anatomy.js` → `ui.js`, then a boot script runs
`new BS.App(#stage).init()` and then `BS.UI(app, #ui)`.

## Modules

```js
BS.registerModule({ name: 'hair', order: 10, create(app) { return instance; } });
```

The instance may implement any of:

- `onParams(params)`: called after every change to the body or its
  appearance. The human has already been re-shaped and the skeleton refit.
- `update(dt, t)`: called every frame in ascending `order`.
- `dispose()`

Frame order is: `motion` (0) writes `human.pose` → the app calls
`human.applyPose()` (bone matrices and `human.boneMats` are now posed) →
`hair` (10) → `clothing` (15) → `anatomy` (20) → `skin` (30) → render.

The instance is stored at `app.modules[name]`. Errors in `create` or `update`
are caught and logged, so one broken module doesn't take down the page.

## `app` (BS.App, js/app.js)

| member | meaning |
|---|---|
| `app.scene`, `app.camera`, `app.renderer` | three.js objects (ACES tone mapping, sRGB, PCFSoft shadows, `localClippingEnabled = true`) |
| `app.orbit` | `BS.OrbitRig`: `.target`, `.yaw`, `.pitch`, `.dist`, `.autoRotate`, `.frame(target, dist, yaw, pitch, instant)` |
| `app.human` | the `BS.Human` (below) |
| `app.D` | decoded data (`faceUnits`, `bodyUnits`, `bones`, `boneIndex`, `targets`, `groups`, `eye`, …) |
| `app.params` | current params object (see `BS.defaultParams()` in params.js) |
| `app.setParams(p)` | re-shape and notify modules (~60–120 ms). The UI coalesces calls |
| `app.focus(name)` | camera presets: `body front back side upper face faceFront faceSide torso legs hands feet` |
| `app.modules` | module instances by name |
| `app.query` | `URLSearchParams` of the page |
| `app.quality` | `'high' \| 'medium' \| 'low'` (set with `?quality=`) |
| `app.on('frame', fn(dt,t))`, `app.on('params', fn(p))` | hooks |
| `app.stage` | from `BS.buildStage` in stage.js: `{ lights:{hemi,key,fill,rimL,rimR}, floor, contact }` |

## `human` (BS.Human, js/human.js)

| member | meaning |
|---|---|
| `group` | root `Group` holding every mesh |
| `body` | `SkinnedMesh`: Catmull–Clark-smoothed MakeHuman body, material `human.skinMat` |
| `bodyGeo` attributes | `position`, `normal` (rest pose, meters), `restPos` (copy of the rest position, for procedural textures that stick to skin), `skinIndex/skinWeight` + `skinIndex2/skinWeight2` (8 bones), `region` = (lips, eyelids, face, ears), `region2` = (nails, areola, mouth interior, 0). Regions are 0..1 masks |
| `teeth`, `tongue` | `{ mesh }`: SkinnedMesh helper parts |
| `eyes` | `SkinnedMesh` (MakeHuman high-poly eyes, both eyes; has `uv`), material `human.eyeMat` |
| `bones[i]`, `skeleton` | MakeHuman default rig, 163 bones (names in `app.D.bones[i].name`; see list below) |
| `boneIndex(name)` | index lookup |
| `fit[i]` | rest-pose world frame of bone i: `{head:[x,y,z], tail:[x,y,z], x, y, z, length}`. Y runs along the bone; X is MakeHuman's roll axis |
| `joint(name, 'head' \| 'tail')` | `Vector3` of a bone end, rest pose, world |
| `restGlobal[i]`, `restGlobalQuat[i]` | rest-pose world matrix and quaternion of bone i |
| `pose[i]` | **local pose rotation** (Quaternion) in MakeHuman's convention: bone = parent · restLocal · pose. Motion writes these |
| `rootOffset` | `Vector3` added to the root bone position (walking, jumping) |
| `resetPose()` | all poses to identity, `rootOffset` to 0 |
| `worldAxisQuat(i, axis, angle)` | local pose quat equal to rotating bone i about a rest-world axis (+X = left, +Y up, +Z forward) |
| `aimQuat(i, dir)` | local pose quat swinging bone i's rest direction to `dir` (rest-world), e.g. arms down: `aimQuat(upperarm01.L, (0.14,-1,0.03))` |
| `rotate(nameOrIndex, q)` | `pose[i].multiply(q)` |
| `applyPose()` | pushes pose to the bones. The app calls it after motion |
| `boneMats[i]` | posed skinning matrices (`bone.matrixWorld · boneInverse`), valid after `applyPose` |
| `skinPoint(restVec3, idx, wts, out, offset)` | CPU skinning, matches the GPU exactly |
| `bodyVertex(i, out)` | posed world position of smoothed-body vertex i |
| `baseVertex(v, out)`, `baseRest(v, out)` | posed and rest positions of a **base-mesh** vertex (any group, including helpers) |
| `P` | morphed base mesh, decimeters (`x0.1` = meters; then y − `human.ground`) |
| `S` | subdivision stencils (`S.nOut` vertices, `S.tris`) |
| `subWeights` | `{ idx: Uint16Array(n*8), wts: Float32Array(n*8) }` for the smoothed body |
| `addShapeListener(fn(human, P))` | runs after each re-shape |
| `skinMat`, `eyeMat` | materials (created by `BS.makeSkinMaterial(human)` / `BS.makeEyeMaterial(human)` if skin.js defines them) |

Helpers in `BS`:

- `BS.skinned8(material)`: patches any built-in material for 8-bone skinning.
  Every material you put on a SkinnedMesh that shares the body's attributes
  **must** use it.
- `BS.patch(material, cacheKey, fn(shader))`: chains `onBeforeCompile` hooks.
  Several features can patch one material.
- `BS.depthMaterials(mesh)`: 8-bone depth and distance materials for shadows.
- `BS.setSkinAttributes(geo, idx8, wts8, n)`
- `BS.blendFaceUnits(D, {UnitName: weight}, out)` → `{boneIndex: Quaternion}`,
  which you multiply onto `human.pose[boneIndex]`. This is MakeHuman's own
  facial rig.
- `BS.SKIN_TONES`, `BS.HAIR_COLORS`, `BS.EYE_COLORS`, `BS.DETAILS`, `BS.PRESETS`, `BS.defaultParams()`

### Face pose units (`app.D.faceUnits`)

Rest, LeftBrowDown, RightBrowDown, LeftOuterBrowUp, RightOuterBrowUp,
LeftInnerBrowUp, RightInnerBrowUp, NoseWrinkler, LeftUpperLidOpen,
RightUpperLidOpen, LeftUpperLidClosed, RightUpperLidClosed, LeftLowerLidUp,
RightLowerLidUp, LeftEyeDown, RightEyeDown, LeftEyeUp, RightEyeUp,
LeftEyeturnRight, RightEyeturnRight, LeftEyeturnLeft, RightEyeturnLeft,
LeftCheekUp, RightCheekUp, CheeksPump, CheeksSuck, NasolabialDeepener,
ChinLeft, ChinRight, ChinDown, ChinForward, lowerLipUp, lowerLipDown,
lowerLipBackward, lowerLipForward, UpperLipUp, UpperLipBackward,
UpperLipForward, UpperLipStretched, JawDrop, JawDropStretched, LipsKiss,
MouthMoveLeft, MouthMoveRight, MouthLeftPullUp, MouthRightPullUp,
MouthLeftPullSide, MouthRightPullSide, MouthLeftPullDown, MouthRightPullDown,
MouthLeftPlatysma, MouthRightPlatysma, TongueOut, TongueUshape, TongueUp,
TongueDown, TongueLeft, TongueRight, TonguePointUp, TonguePointDown.

`app.D.bodyUnits` holds MakeHuman's body pose units, also as
`{boneIndex: [x,y,z,w]}`.

### Bones

root, spine05 (pelvis) → spine04 → spine03 → spine02 → spine01 → neck01 →
neck02 → neck03 → head → jaw, eye.L/R (via special06/special05),
tongue00–07, plus facial bones (levator*, oris*, risorius*, temporalis*,
oculi*, orbicularis03/04 = upper/lower lids, special01/03/04).
Arms: clavicle.L → shoulder01.L → upperarm01.L → upperarm02.L → lowerarm01.L
→ lowerarm02.L → wrist.L → metacarpal1–4.L → finger2-1..5-3, plus
finger1-1..3 (thumb from wrist). breast.L/R (from spine02).
Legs: pelvis.L → upperleg01.L → upperleg02.L → lowerleg01.L → lowerleg02.L →
foot.L → toe1-1…toe5-3. The same set exists on the right (.R).

The rest pose is MakeHuman's A-pose: arms about 45° down, palms facing down
and forward, legs straight. The skeleton is refit on every shape change, so
never cache rest positions across `onParams`.

## Params (`app.params`, defaults in `BS.defaultParams()`)

- **Shape:** `gender` (0 = female … 1 = male, anything between),
  `age` (years, 18–90), `muscle`, `weight`, `height`, `proportions` (0..1),
  `african/asian/caucasian` (mix), `breastSize`, `breastFirmness`, and
  `details {key: -1..1}` (see `BS.DETAILS`).
- **Skin:** `skinTone` (0..1 → `BS.SKIN_TONES`), `undertone` (0 cool … 1 warm),
  `freckles`, `blush`, `skinShine`, `bodyHair`, `veins`, `lipColor`, `makeup`.
- **Eyes:** `eyeColor` (key of `BS.EYE_COLORS`), `eyeColorHex` (overrides when
  set), `heterochromia`.
- **Hair:** `hairStyle`, `hairColor` (key of `BS.HAIR_COLORS`), `hairColorHex`,
  `hairLength`, `hairVolume`, `curl`, `browStyle`, `browThickness`, `beard`,
  `lashLength`.
- **Outfit:** `outfit`, `outfitColor`, `outfitColor2`.

Modules may add their own params with sensible defaults. Read them with
fallbacks (`p.x ?? default`) because saved characters can predate a param.

## Cross-module state (read defensively, it may be absent)

- `app.modules.motion.state`:
  `{ breath: 0..1 inhale, breathRate (per min), heartRate (bpm), heartPhase 0..1, emotion, emotionAmount, action, talking }`
- `human.skinUniforms`: an object of three.js uniforms that skin.js exposes:
  - `uFlush` {value 0..1}: emotional blush
  - `uWet` {value 0..1}: sweat or tears sheen
  - `uXray` {value 0..1}: 0 = normal skin, 1 = ghostly see-through shell
  - `uTime`

  motion and anatomy write these.
- `app.modules.clothing.setOpacity(a)`: anatomy fades clothes along with the
  skin.

## Testing (headless Chromium + SwiftShader)

A static server is already running at `http://localhost:8123/` (serving the
repo root). If it isn't, start it with
`cd /home/user/Game-maker && nohup http-server -p 8123 -s -c-1 . >/dev/null 2>&1 &`.

- **Screenshot:**
  `node /tmp/claude-0/-home-user-Game-maker/b5929d9e-11f2-5cbd-82e0-c8eb61a4201f/scratchpad/shot.js "<url>" out.png 900 900`
  waits for `window.done`. Then read the PNG to look at it. Write your PNGs to
  your own folder under that scratchpad.
- **Evaluate JS:**
  `node /tmp/claude-0/-home-user-Game-maker/b5929d9e-11f2-5cbd-82e0-c8eb61a4201f/scratchpad/evalpage.js "<url>" "<expression>"`
  waits for `window.done || window.ready`.
- **URL:** `http://localhost:8123/body-studio/index.html?ui=0&t=2&cam=face`
  - `ui=0` hides the UI.
  - `t=<seconds>` steps the simulation deterministically at 60 fps, renders
    once and sets `window.done`.
  - `cam=` picks a camera preset.
  - `only=skin,hair` starts only those modules.
  - `p=<url-encoded JSON>` overrides params.
  - `preset=Woman|Man|Androgynous|Athlete|Curvy|Plus-size|Elder|East Asian`.
  - Modules read their own dev params from `app.query`: motion reads
    `action`, `emotion` and `amount`; anatomy reads `layers` and `cut`.
- Rendering is software (SwiftShader), so each screenshot takes several
  seconds. Batch them.
- Check the browser console output that the scripts print. A module must not
  log errors.

## Running inside the game (Serenity Hands)

The spa game (`/home/user/Game-maker/index.html`) uses Body Studio people for
every client, staff member, date and the player, through
`js/game-bridge.js`. That file hosts the **skin, hair and clothing** modules
once per person, against a stand-in `app`:

```js
{ human, D, scene: personRootGroup, camera, renderer /* may be undefined until the first render */,
  params, quality: 'low' | 'medium', query: new URLSearchParams(''), modules: {}, on(), orbit: { target, autoRotate },
  focus() {}, time, game: true }
```

There is no `stage`, `setParams`, `screenshot` or UI. Write those modules so
that the following hold:

- **Many instances.** Up to about 15 people can exist at once. Keep no
  globals or singletons that assume one human, and make `dispose()` free every
  geometry, material and texture you created.
- **Parented and transformed.** The game moves, rotates and uniformly scales
  the parent of `human.group`, and a person may lie on a massage table (rotated
  90°).
  - Put your meshes under `human.group` (or bind them to `human.skeleton` as a
    SkinnedMesh), positioned in human-local space: the space of
    `human.restAttr`, `human.fit` and `human.joint()`.
  - Don't add world-space meshes to `app.scene`.
  - Physics may run in world space (`bone.matrixWorld`,
    `human.boneMats`, `human.bodyVertex()` are world space), but convert the
    results back to `human.group`'s local space for rendering
    (`human.group.matrixWorld` inverse).
  - Gravity is world −Y.
- **Detail level can change at runtime.** `human.setSmooth(false/true)`
  replaces `human.bodyGeo` (13k-vertex base mesh vs 54k smoothed), along with
  `human.S`, `human.subWeights` and `human.masks`, then re-runs `setParams`
  and the shape listeners. The bridge then disposes your instance and creates
  a fresh one. Never cache `bodyGeo`, `S` or vertex counts across instances.
  Read them from `human` when you build. Attributes you add to the body
  geometry must be (re)attached to the *current* `human.bodyGeo` inside your
  build/`onParams`.
- **Budget.** At `quality: 'low'`, a person should cost very little: reduce
  strand counts and segments by about 10× versus `'high'`. Keep each
  person's per-frame `update()` well under 1 ms at `'low'`.
- **Outfits the game asks for.** These are `params.outfit` values (colours in
  `outfitColor` / `outfitColor2`):
  - `casual` (most clients)
  - `formal` (linen / shirt and trousers)
  - `sport` (tank and shorts)
  - `dress`
  - `scrubs` (spa staff: tunic and trousers)
  - `underwear` (clients lying on the massage table under a towel: plain
    briefs, plus a bra for anyone who'd wear one)

Run the game with `http://localhost:8123/index.html`. A Playwright helper
that clicks "New game" and screenshots is at
`/tmp/claude-0/-home-user-Game-maker/b5929d9e-11f2-5cbd-82e0-c8eb61a4201f/scratchpad/gameshot.js`
(usage in its header).
