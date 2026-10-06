# Generation contract

Run a complete example from the repository root:

```sh
npm run diagram:convert -- --html tests/fixtures/diagram-generated.html --manifest tests/fixtures/diagram-generated.labels.json --out document.json --title "処理"
```

The converter reads a static HTML source and a version 1 manifest. The manifest selects ordinary prose by `proseIds` and SVG figures by `sourceSvgId`. Each diagram entry has `definition` with `version`, UUID `id`, `description` and `labels`. The output adds normalized `svg` and `css` to that definition. Coordinates and line height use SVG user units.

Each label has stable `id`, `name`, `frame`, `decorations` and `slots`. Each slot has `id`, `name`, SVG group `element`, a positive rectangular `region`, `lineHeight` and `align` of `start`, `middle` or `end`. The region is local to the slot group. Decorations name fixed SVG elements. Editable values exist in SVG text only.

Choose one source representation per slot:

- A normalized group containing plain `text` lines with single `x` and `y` coordinates. Each line carries `data-break-before`. Its first line uses `none`; later soft wraps use `soft` and intentional newlines use `hard`. All lines use the same effective style. Transform the group to rotate the label.
- A `sources` entry containing `labelId`, `slotId`, explicit `sourceIds` and `kind: "svg-text"`. Source IDs identify plain SVG text elements under the same parent coordinate frame, in intentional line order. Each source becomes a line; subsequent lines become hard breaks. Put differently styled ranges in separate slots. Put transforms on their parent group.
- A `sources` entry with `kind: "html-text"`. Each source ID identifies a `foreignObject` with one child div containing one plain text line, explicit pixel line height, zero padding/border, normal horizontal writing and no transform. Its color becomes SVG fill. The converter refuses richer HTML labels with a source-specific regeneration message.

Use families and faces in `src/content/diagram-fonts.ts`. The converter serves packaged Fontsource assets locally and blocks external requests. It freezes SVG presentation styles inherited from the source page. Original backgrounds, cards and columns remain outside the imported figure. Every figure text node must belong to an editable slot or an explicitly declared fixed decoration. Missing IDs and duplicate IDs fail; label identity is never inferred from identical strings or nearby coordinates.

Use `Geist`, `Geist Mono`, `Instrument Serif`, `Noto Sans JP` or `Noto Serif` with faces in the local catalog. Declare `Noto Sans JP` explicitly for Japanese or as a fallback after the chosen Latin family. Unknown family names require regeneration.

The standard `https://fonts.googleapis.com/css2` stylesheet declaration may remain in the source when its requested family names are supported. The converter treats this link as metadata and removes it before browser rendering. Packaged local faces supply the fonts. Static `@media print`, screen and media queries may remain, with their nested values checked for external references. The conversion captures the screen appearance; print rules remain source metadata. Other external stylesheet links, font imports and `@font-face` rules are refused.

Generate source without scripts, event attributes or external resources. Static styles may use local SVG paint references. The app's shared parser validates SVG and CSS before output, and the converter loads the local fonts and checks actual line bounds against each slot's region. Unsupported styles, fonts or labels require regeneration rather than silently changing the figure.

The output compact HTML contains common-format prose and `<figure data-diagram-id="UUID"><figcaption>説明</figcaption></figure>` references. It carries no SVG or page layout. On update, keep other document parts and figure references from the latest document. Reusing a reference does not require sending its SVG again.
