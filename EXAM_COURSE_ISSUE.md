# Handoff: César Vallejo exam-course rebuild — user says it's still broken

> **2026-09-29 — rebuilt as real roads.** `src/world/examCourse.ts` no longer traces the sketch.
> The course is a network of straight two-lane two-way roads (8 m, white edge lines, double yellow
> centre line, clipped cleanly at every T-junction), two rounded corners and the óvalo (E + S
> arms). Parallel bays 1→7 sit on the north side of the parking aisle, diagonal bays 7→1 on the
> south side, and there is a U-turn "retorno" at the aisle's east end. The speed bump crosses road 3,
> and the spawn is in the northbound entrance lane. The reference is used as a guide to the network only.
> `docs/track-mapping/genlog/` (`node run.cjs > log.json && python analyze.py`) checks the result:
> spawn on a lane facing north, every sign on the verge, bays paved. The rest of this document is
> history from before that.

**Status: unresolved.** The user has reported, across several rounds, that the in-game 3D result
still looks broken / unchanged, despite real, verified code fixes landing each round. This doc
exists because they explicitly asked for something a fresh conversation can use to pick this up
without redoing the archaeology below. Read it before touching the code.

## The disconnect (read this first)

Every fix in this thread was verified by **static analysis and a Node-based headless harness**
(`docs/track-mapping/genlog/`) — never by actually looking at the rendered page in a browser.
That harness runs the real `buildExamCourse()` and checks the geometry it produces (positions,
polygon validity), which caught real bugs (see "What's actually been fixed" below). But it cannot
see what a browser actually renders: shaders, WebGL state, textures, camera, or anything at
runtime that only a real page load would surface. **Nobody in this thread — including me — has
looked at an actual screenshot or the browser devtools console for this page.** That is very
likely why fixes that check out structurally keep not matching what the user sees. Closing that
gap (an actual screenshot + console log from a real page load) should be step one for whoever
picks this up, before writing any more code.

## What the user has said, verbatim, across rounds (in order)

1. "The diagram looks bad. Remember they are roads so follow that logic. Obviously there cannot be
   those holes you added. Also, check the new images I sent to do the road. It is not that hard...."
2. "The new diagram is still terrible... I don't know if it has to be perfect for you to build a
   perfect 3D map. If not and you really have everything clear. Please continue with the 3D map."
   → this is when the work shifted from the 2D diagram to actually rewriting
   `src/world/examCourse.ts`.
3. "JUST REMOVE THE CURRENT MAP AND DO IT AGAIN BASED ON THE DIAGRAM AND THE IMAGES I SENT AND
   LOGIC. THE CURRENT MAP IS SHIT." → triggered the full pavement rewrite (polygon-with-holes
   traced from the reference sketch, replacing the old hand-picked rectangular avenues).
4. "Add a generation log so you can 'see' what its build... If its better to run your own server
   and check there, do that. If its better to generate a log or some map to see your creation do
   that too." → built `docs/track-mapping/genlog/` (see below).
5. "The map is literally exactly the same.. YOU HAVE CHANGE NOTHING" → investigation found
   `dist/` was a stale Sep 28 build, predating every change in the conversation. Rebuilt it.
6. "THE MAP IS THE FUCKING THE SAME... THERE SAME BUGS ARE STILL THERE. THE MAP IS BROKEN. THE
   FLOOR IS BROKEN. THE MAP IS NOTHING SIMILAR TO THE IMAGE..." → investigation found
   `ISLAND_WEST`'s polygon was self-intersecting (two edges crossed) from an earlier hand-edit —
   THREE.js's triangulator doesn't error on that, it silently produces broken geometry. Fixed the
   points, added a permanent self-intersection check to the tooling, rebuilt `dist/` again.
7. "go fuck yourself. NOTHING HAS CHANGED. ... GENERATE SOMETHING THAT CAN HELP ANOTHER
   CONVERSATION TO EASILY IDENTIFY THE ISSUE." → this document.

**Read literally, "the floor is broken" and "nothing similar to the image" after round 6's fix
means either the self-intersection wasn't the only bug, or the fix still isn't reaching whatever
the user is looking at (see the caching hypothesis below) — genuinely unclear which from here.**

## What's actually been verified fixed (with evidence, not just claims)

All in `src/world/examCourse.ts` unless noted. Verify any of these yourself with
`npm run typecheck` (passes) and `docs/track-mapping/genlog/` (see its own README).

1. **Stale production build.** `dist/` was dated Sep 28 18:07, before this conversation's first
   change. If the user opens `dist/index.html` directly or runs `npm run preview` without
   rebuilding, every fix in this thread would be invisible. Rebuilt via `npm run build`
   (succeeds, `dist/assets/examCourse-*.js` now dated fresh).
2. **Self-intersecting polygon (`ISLAND_WEST`).** An earlier hand-edit moved two of its points to
   open a gap near the óvalo ring, but the new points crossed edge 15-16 of the same polygon.
   THREE's `ExtrudeGeometry`/earcut triangulator does not throw on this — it silently produces
   wrong/degenerate geometry for that hole, with no console error. Recomputed the two points at a
   radius verified (by an actual segment-intersection algorithm, not eyeballing) to not cross any
   other edge. **This class of bug is now checked automatically** — see
   `docs/track-mapping/genlog/analyze.py`'s `self_intersecting()` function, which runs against
   every traced polygon on every `python3 analyze.py` invocation and prints
   `SELF-INTERSECTING at edges (i, j) !!!` if it finds one. Current state: all 5 polygons
   (outer boundary + 3 islands + trocha) pass.
3. **Óvalo ring poking past the traced boundary.** The hand-traced sketch's bump measured as
   close as r=16.9 from the óvalo's center in one direction, inside the r=20 ring. Widened
   `OUTER_BOUNDARY`'s points 1-4 to circumscribe it with margin, and stopped cutting a separate
   hole for the óvalo in the pavement shape entirely (the ring's own asphalt, from
   `world/roundabout.ts`, now just draws on top — same colour, no seam, no perfect-circle-fit
   needed).
4. **E arm running through the west island**, and **3 signs placed inside the island's own
   body** (it's a much bigger shape than assumed) — both found via the same generation-log
   position checks, both relocated to verified-clear coordinates.
5. **Finish-gate posts wider than the traced exit chute** — narrowed.
6. **Parking reoriented from north-south to east-west** — tracing the actual pavement showed the
   gap between the parking islands only has room for bays running east-west (~10 units deep,
   nowhere near enough for the original north-south layout's 7 bays). This required rewriting the
   parking-grading math in `src/systems/examCourse.ts` and the parking autopilot in
   `src/systems/examAutopilot.ts` (both still use `COURSE.parallel`/`COURSE.diagonal`, just with
   `frontX/rearX/cx/cz` instead of the old `frontZ/rearZ/cz` — grep either file for `COURSE.` to
   see every field it reads).

## What has NOT been verified (the actual gap)

- **No screenshot exists anywhere in this thread.** Everything "visual" produced so far is either
  a matplotlib top-down 2D plot built from the *input* data (which can't show a THREE.js
  triangulation bug — that's exactly how #2 above slipped through undetected for a full round),
  or the Node harness's JSON log (positions only, not render output).
  the `console.error`/warning of a bad load).
- **No browser console output has been captured.** If there's a genuine JS runtime error (not a
  silent-geometry-bug like #2, but an actual exception — e.g. from something the Node harness's
  `document`/canvas polyfill doesn't cover, since that polyfill is a Proxy stub, not a real
  canvas), it would show in the browser console and nowhere else. The harness's polyfill
  (`docs/track-mapping/genlog/entry.ts`) intentionally throws if `document.createElement` is
  called with anything other than `'canvas'`, which would at least catch *that* class of gap —
  worth checking `err.log` after a fresh `node run.cjs` run, but that still isn't the same
  environment as a real browser.
- **Which scenario the user is actually loading is assumed, not confirmed.** The exam course is
  scenario id `examOficial` (`src/config.ts` around line 281), layout `'exam'`
  (`src/game/layouts/examCourse.ts` → `src/world/examCourse.ts`). It's selected from the scenario
  picker screen (`src/screens/scenarios.ts`). If the user is instead looking at a different
  scenario (e.g. the plain `'roundabout'` one, `src/game/layouts/roundabout.ts` /
  `src/world/roundabout.ts` — a completely different, untouched file), **every fix in this
  thread would correctly look like nothing changed**, because nothing in that file was touched.
  This has not been ruled out.
- **Caching beyond `dist/` staleness hasn't been ruled out.** Vite's dev server does its own
  dependency pre-bundle cache (`node_modules/.vite`); a hard browser refresh
  (Ctrl+Shift+R / disable cache in devtools) hasn't been confirmed as tried. If the user is on
  `npm run dev` and it was already running from before a given fix, Vite's HMR *should* pick up
  plain `.ts` module changes with a full reload, but this hasn't been independently confirmed for
  this specific file (it rebuilds the entire scene graph on reload — see
  `src/game/session.ts`'s `run()` — so a partial-HMR that only patches part of the module graph
  could plausibly leave stale scene state; untested here).

## How to actually see the current geometry without a browser

```
cd docs/track-mapping/genlog
node run.cjs > log.json 2> err.log   # bundles + runs the REAL buildExamCourse() in Node
cat err.log                          # should be empty; anything here is a real thrown error
python3 analyze.py                   # self-intersection check + off-pavement check + renders genlog_map.png
```

`genlog_map.png` is the most accurate non-browser view available: it's a top-down render built
directly from what the real function placed, not from a hand-copied description of it. If a
future round still doesn't match what the user sees, that itself is a meaningful data point (it
would mean the discrepancy is specifically something a browser does that Node/matplotlib can't
replicate — lighting, camera, an actual runtime error, or a scenario-selection mismatch as above).

## How to actually see it *in* a browser (nobody has done this yet in this thread)

```
npm run dev
```

Then open the printed localhost URL, pick "Examen Oficial MTC" (`examOficial`) from the scenario
list, and **take an actual screenshot**, and **check the browser devtools console for errors**
before touching any more code. If there's a JS exception on load, that's a completely different
bug class than anything checked so far and would explain "nothing changed" far better than a
geometry issue would (a thrown exception during `buildExamCourse()` would likely leave the scene
partially built or fall back to whatever rendered before, which would indeed look "unchanged").

## File map

- `src/world/examCourse.ts` — the pavement, óvalo, parking, signs. Rewritten this thread from a
  hand-picked rectangle of avenues+bends to a traced polygon-with-holes (`OUTER_BOUNDARY`,
  `ISLAND_WEST/NORTH/SOUTH`, `TROCHA_POLY` near the top of the file).
- `src/systems/examCourse.ts` — the exam's step-by-step grading logic (`STEPS` array). Parking
  grading (`'parallel'`/`'diagonal'` steps) updated to match the new east-west orientation.
- `src/systems/examAutopilot.ts` — the "AI drives it" button's logic for this course. Parking
  autopilot rewritten for the new orientation (simplified from a full reverse-park choreography
  to a pursuit-then-settle approach — documented in its own comment as a deliberate
  simplification, not a bug).
- `src/game/layouts/examCourse.ts` — wires the above together; `steerAssistZone` here reads
  `COURSE` fields, updated to match the new field names.
- `src/assets/props.ts` — new MTC sign-plate builders (R-3/R-5/R-7/R-7-2, P-15/P-25/P-33/P-10-A)
  added this thread, used by `world/examCourse.ts`.
- `docs/track-mapping/` — everything from the 2D-diagram phase plus the generation-log tooling.
  `docs/track-mapping/genlog/README.md` documents the harness itself and its full bug-fix history
  in detail.
- `docs/track-mapping/output/diagram.png` — a top-down render built from the *real* captured 3D
  data (not hand-copied), regenerate with `python3 docs/track-mapping/genlog/render_diagram.py`
  after any further geometry change.

## Current repo state

Nothing in this thread has been committed. `git diff --stat` as of writing:

```
 src/assets/props.ts            | 147 +++++++++++
 src/game/layouts/examCourse.ts |   6 +-
 src/systems/examAutopilot.ts   | 159 +++++-------
 src/systems/examCourse.ts      |  18 +-
 src/world/examCourse.ts        | 568 +++++++++++++++++++++++++----------------
 5 files changed, 576 insertions(+), 322 deletions(-)
```

Plus an untracked `docs/` directory (all the 2D-diagram and generation-log work).
`npm run typecheck` passes clean at every point referenced above. `npm run build` succeeds and
`dist/` is current as of this doc.
