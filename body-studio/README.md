# Body Studio

Create your own human: any gender identity, any age from 18 to 90, any height, build or ancestry. The body
is a realistic scanned-style human mesh, not boxes or blobs, and it breathes, blinks, moves and feels. Spin it
a full 360°, zoom into the face, then look inside: skeleton, organs, muscles, blood vessels and nerves, fitted
to the body you made.

Open `body-studio/index.html` in a modern browser (Chrome, Edge, Firefox, or Safari 16.4+), on desktop or
phone. It also opens from the game's title screen (**🧬 Body Studio**). There's nothing to install, and it
works straight from disk. Its sister page, **Clothes Studio** (`body-studio/clothes.html`), designs clothing
and home or spa textiles.

## What you can do

- **Identity.** Choose woman, man, trans woman, trans man, non-binary, genderfluid, agender, intersex or
  Two-Spirit, and set your own pronouns. Identity never limits the body: every slider stays open to everyone.
- **Body.** The body slider runs from female to male, with any value in between. Height is set in real
  centimetres (135–215 cm). The marker shows the realistic average for that body: women average about
  163 cm and men about 177 cm, but anyone can be any height. Also set:
  - age, weight (with a kg and BMI estimate), waist, muscle and proportions
  - an ancestry mix, and breast size and firmness
  - 13 body-type silhouettes (hourglass, pear, apple, rectangle, inverted triangle, column, diamond and
    more)
  - over 40 sliders for the torso, chest, hips, legs and arms
- **Face.** Choose a head shape, then adjust the eyes, brows, nose, mouth, jaw and chin, cheeks and ears with
  about 60 sliders.
- **Skin.** Pick any tone from very fair to very deep, plus undertone, freckles, moles, vitiligo, stretch
  marks, tan lines, blush, shine, veins and body hair. The skin uses subsurface-scattering shading and
  pore-level detail, and fine lines deepen with age.
- **Makeup.** Choose none (a bare face), natural, everyday, soft glam, glam, smoky eye, bold lip, graphic liner
  or editorial. Set the intensity and your own lipstick, eyeshadow and nail colours.
- **Hair.** Strand hair comes in many styles (buzz, crew, short, medium, bob, long, wavy, curly, afro,
  ponytail, bun and braid) and colours, with length, volume and curl controls, greying with
  age, and physics. You can also set eyebrows, eyelashes, facial hair and body hair.
- **Eyes.** Pick from the iris colours or choose your own, with optional heterochromia.
- **Outfits.** Choose underwear, swimwear, sportswear, T-shirt and jeans, a dress, shirt and trousers, or
  scrubs. Each is made from a real fabric (jersey, denim, satin, wool, cotton, spandex) and drapes over the
  body's form. Underwear is always the minimum. The Clothes Studio lets you change any piece's fabric, pattern
  and colour.
- **Motion.** Idle breathing, blinking and glances, plus walking, running, dancing, waving, sitting, exercise
  and more. The person can look at the camera and talk.
- **Emotion.** Over a dozen emotions combine face, body language, breathing and blushing. Some animate, such as
  laughing and crying.
- **Inside.** Turn on the skin x-ray, muscles, skeleton, organs, vessels or nerves.
  - The heart beats and the lungs breathe.
  - Internal reproductive organs follow a separate anatomy setting.
  - The cross-section cut slices the body, and you can tap a structure to learn what it is.
- **Clothes Studio** (`clothes.html`, or **Design in Clothes Studio** on the Outfit tab).
  - *Wardrobe:* dress any of your characters piece by piece. Choose the fabric (cotton, jersey, denim, linen,
    silk, satin, wool, knit, fleece, leather, lace, velvet and more), a print (stripes, plaid, gingham, dots,
    floral, camo, herringbone, chevron, paisley…), two colours and the print size. Saving sends the wardrobe
    back to Body Studio and to the copies of that character in Serenity Hands.
  - *Home & Spa:* massage-table sheets, bath towels, blankets, knitted throws, bed sheets, yoga mats and
    massage mats. Cloth is simulated with real weight, stiffness and friction per fabric: it drapes over the
    table, the bed or the towel rail, and you can pick it up and drop it. Mats roll up and unroll. **Use in
    Serenity Hands** puts your table sheet, towel or blanket into the spa.
- **Characters.** Load a preset or use a realistic randomizer (height by sex, BMI, ageing, ancestry and
  colouring). You also get undo and redo, named saves, JSON export and import, and screenshots.

**Controls:**

- Drag to spin the person 360°. On a phone, use one finger.
- Scroll or pinch to zoom.
- Right-drag or two fingers to pan.

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| Space | Auto-spin |
| 1 to 5 | Camera presets |
| R | Randomize |
| Ctrl+Z | Undo |

## In Serenity Hands

Every person in the spa game is a realistic Body Studio human driven by the game's own walking, sitting,
massage-table and date poses: clients, staff, dates, the guard and you.

- **Your characters can visit.** In Body Studio, open the **Serenity Hands** menu and choose **Send to Serenity
  Hands**. That character then turns up at the spa as a client, with their pronouns and identity.
- **You can play as one.** Choose **Play as my therapist**, or pick one in the game under *Your therapist → 🧬
  Body Studio*.
- **On the massage table**, clients wear underwear under the towel drape. Touch zones, redness, oil, the tension
  view and turning over all work on the real body.
- **Textiles from the Clothes Studio** (table sheet, towel, blanket) dress the massage tables and the mansion
  bed.

## How it works

- **The human.** The body is MakeHuman's `hm08` base mesh, smoothed once with Catmull–Clark subdivision in
  the browser. Gender, age, muscle, weight, height, proportions, ancestry and the detail sliders blend 440 of
  MakeHuman's scanned morph targets, using the same weighting rules as MakeHuman.
- **Height.** Height is solved to the exact centimetre (`BS.setHeightCm`).
- **Rig.** MakeHuman's 163-bone default skeleton is refit to every body shape, with 8-bone skinning. Facial
  expressions use MakeHuman's facial pose units.
- **Rendering.** three.js r159, with procedural textures and fabrics (no image files) and a studio light rig.
- **Code.**
  - `js/core.js`: data, morphing, subdivision, skeleton fit, height solver
  - `js/human.js`: three.js character, pose API, CPU skinning, detail levels
  - `js/app.js`: renderer, orbit camera, module system
  - one module per feature: `skin.js`, `motion.js`, `hair.js`, `clothing.js` (with `fabric.js`),
    `anatomy.js` and `ui.js`
  - `textiles.js` (cloth solver, textile rendering) and `clothes.js` (the Clothes Studio page)
  - `game-bridge.js`: the people in Serenity Hands
  - `dev/CONTRACT.md` documents the module API.
- **Data.** `assets/body-data.js` is generated by `tools/build_assets.py` from the MakeHuman and MPFB2
  repositories. See the script header for how to rebuild it.

## Credits and licenses

- **MakeHuman** base mesh, morph targets, default skeleton and weights, pose units and eye proxy
  (makehumancommunity/makehuman) are released under **CC0 1.0** by the MakeHuman team.
- **MPFB2** skin region masks (makehumancommunity/mpfb2) are released under **CC0 1.0**.
- **three.js** r159 (`lib/three.min.js`) is © three.js authors, under the MIT license (`lib/three.LICENSE`).
