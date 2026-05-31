# Badge Rendering Spike Findings

## Recommended rendering stack

Use direct runtime raster rendering with:

- `tiny-skia = "0.11.4"` for anti-aliased vector shapes, rounded square fields, rings, chips, strokes, and PNG output.
- `ab_glyph = "0.2.32"` for bundled-font text rendering.
- Bundled Inter variable TTF at `badge-spike\fonts\Inter.ttf` plus `badge-spike\fonts\OFL.txt`. This keeps the Tauri app independent of installed Windows fonts.

This is the best fit for Streamliner badges because the visual language is small and fixed: colored workstream field, 2-4 character initials, and six event marks. Direct tiny-skia code is compact, deterministic, pure Rust, and avoids the extra SVG parser/rendering stack unless designer-authored SVG assets become important.

## Options evaluated

### 1. tiny-skia + ab_glyph: recommended

Implemented in this spike. Strengths:

- Pure Rust; no native/system image libraries.
- Crisp vector rasterization at both 256x256 and 48x48.
- Easy runtime parameterization from registry fields: workstream hex color and short name.
- Direct generation to PNG for Windows toast `appLogoOverride`.
- Dependency tree is small: `tiny-skia` pulls `png` and path/math helpers; `ab_glyph` pulls TTF parsing/rasterization.

Tradeoffs:

- More manual geometry than SVG.
- Text layout is intentionally simple. For 2-4 Latin initials this is fine; use `cosmic-text` only if shaping/multiscript support is required.

### 2. resvg + usvg + tiny-skia: good authoring model, heavier runtime

Current crates.io versions observed: `resvg = "0.47.0"` and `usvg = "0.47.0"`.

SVG templating would be the most designer-friendly approach if the six event glyphs become more intricate or if design wants to iterate in Figma/Illustrator and export SVG paths. The runtime model would be: fill an SVG template with workstream color/initials/event mark, parse with usvg, render with resvg/tiny-skia.

I do not recommend it as the first implementation because these badges are simple enough to author directly, and SVG adds parser/font-resolution complexity and a larger dependency surface. It remains a strong second choice for future designer-supplied assets.

### 3. image + imageproc + ab_glyph: acceptable, less ideal

Current crates.io versions observed: `image = "0.25.10"` and `imageproc = "0.26.2"`.

This would work for rectangles, circles, and text, but the tiny-skia path/stroke model is a cleaner match for anti-aliased vector badge geometry and future icon paths. `image` is still useful if the app later needs compositing, resizing, or format conversions beyond direct PNG output.

### 4. png crate alone: floor only

Current crates.io version observed: `png = "0.18.1"`; tiny-skia currently uses `png = "0.17.16"` transitively.

The `png` crate alone is only an encoder/decoder. It can write solid pixel buffers but does not provide shapes, strokes, anti-aliasing, text, or glyph rasterization. It is not sufficient for rich badges except as a low-level output layer.

## Working spike code

Cargo project:

- `badge-spike\Cargo.toml`
- `badge-spike\src\main.rs`
- `badge-spike\fonts\Inter.ttf`
- `badge-spike\fonts\OFL.txt`

The renderer generates all combinations of:

- Workstreams: `STR` / purple `#6D5DFB`, `API` / blue `#0078D4`, `DB` / green `#0E7A3B`.
- Events: `online` dot, `pr-created` plus, `pr-approved` check, `issue-closed` x, `reconciled` equals, `done` star.
- Sizes: `256x256` and `48x48`.

Run command:

~~~powershell
cargo run --release --manifest-path "C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\badges\badge-spike\Cargo.toml"
~~~

## Sample images produced

Directory: `C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\badges\samples`

- `samples\api-done-256px.png`
- `samples\api-done-48px.png`
- `samples\api-issue-closed-256px.png`
- `samples\api-issue-closed-48px.png`
- `samples\api-online-256px.png`
- `samples\api-online-48px.png`
- `samples\api-pr-approved-256px.png`
- `samples\api-pr-approved-48px.png`
- `samples\api-pr-created-256px.png`
- `samples\api-pr-created-48px.png`
- `samples\api-reconciled-256px.png`
- `samples\api-reconciled-48px.png`
- `samples\db-done-256px.png`
- `samples\db-done-48px.png`
- `samples\db-issue-closed-256px.png`
- `samples\db-issue-closed-48px.png`
- `samples\db-online-256px.png`
- `samples\db-online-48px.png`
- `samples\db-pr-approved-256px.png`
- `samples\db-pr-approved-48px.png`
- `samples\db-pr-created-256px.png`
- `samples\db-pr-created-48px.png`
- `samples\db-reconciled-256px.png`
- `samples\db-reconciled-48px.png`
- `samples\str-done-256px.png`
- `samples\str-done-48px.png`
- `samples\str-issue-closed-256px.png`
- `samples\str-issue-closed-48px.png`
- `samples\str-online-256px.png`
- `samples\str-online-48px.png`
- `samples\str-pr-approved-256px.png`
- `samples\str-pr-approved-48px.png`
- `samples\str-pr-created-256px.png`
- `samples\str-pr-created-48px.png`
- `samples\str-reconciled-256px.png`
- `samples\str-reconciled-48px.png`

## Small-size LEGIBILITY assessment

Viewed representative 48x48 outputs:

- `str-pr-approved-48px.png`: `STR` remains readable, and the green approval chip plus check mark reads clearly enough. This is a good toast-logo result.
- `api-issue-closed-48px.png`: `API` is readable; the red event chip is obvious; the white x is small but still understandable.
- `db-done-48px.png`: `DB` is very readable; the amber done chip is visible; the star is recognizable but close to the practical detail limit.

Honest limits:

- 2-3 initials work well at 48px. 4 initials will be marginal unless the font size is reduced and the letters are very wide-spaced/short. Prefer deriving a 2-3 char display monogram for toast badges even if the registry short name is longer.
- Event color is more glanceable than event glyph at 48px. The glyph should be treated as confirmation, not the only encoding.
- Simple marks survive best: dot, plus, check, x, equals. Star/detail shapes are least robust at 48px.
- A corner chip around 30-34% of badge width is a good compromise. Smaller chips lose glyph clarity; larger chips start to compete with initials.

## Recommended badge design

Use a rounded square badge:

1. Workstream identity:
   - Full field fill uses the registry hex color.
   - Centered bold initials in white or dark text depending on field luminance.
   - Use 2-3 chars for the toast logo; allow 4 chars only for larger hero/inline rendering.

2. Event identity:
   - Bottom-right circular chip with white separator ring.
   - Event-specific chip color plus a simple white mark:
     - ONLINE: green chip + solid dot.
     - PR Created: blue chip + plus.
     - PR Approved: green chip + check.
     - Issue Closed: red chip + x.
     - Reconciled: purple chip + equals/sync-like simple mark.
     - DONE: amber chip + star or check/star hybrid; consider using check if star fails in real Windows toast scaling.

3. Size strategy:
   - Generate at the final requested pixel size instead of scaling one raster down.
   - Produce 48/64/96 for toast/logo contexts and 256 for hero/inline previews.
   - Keep event marks as primitive vector geometry where possible rather than font glyphs for maximum small-size consistency.

## Effort and footprint notes

Measured on this Windows 11 machine with cargo 1.93.1:

- Clean release build after dependencies were cached: about 20.3 seconds.
- Incremental release run after code was built: about 0.18 seconds to run and regenerate 36 PNGs.
- Release spike executable: 1,591,808 bytes.
- Bundled Inter font: 876,576 bytes. A production app could subset or choose a smaller static weight to reduce this.
- `cargo tree` is modest: `ab_glyph` + `owned_ttf_parser` + `tiny-skia` + `png` and compression helpers.

Production effort estimate: low. The spike code can be lifted into a Tauri-side Rust module with a small API like `render_badge(workstream_color, initials, event_type, size) -> Vec<u8>`. The main remaining work is polishing exact colors/marks, adding tests/golden samples, and deciding whether to subset the font.

