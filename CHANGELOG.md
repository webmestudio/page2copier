# Changelog

## 2.2.0

### Rebranding & Features

- **Rebranded to Page2Copier**: Upgraded brand name across the extension, UI, context menus, and documentation.
- **Save this page as HTML**: One-click full-page HTML saving with self-contained stylesheets, embedded canvas images, live form state preservation, and sanitized script tags for safe offline archiving.
  - Dedicated primary action in popup ("Save as HTML" with emerald glow theme).
  - Dedicated shortcut `Alt+Shift+S`.
  - Context menu entry "Save page as HTML".
  - Background listener and inter-process messaging (`captureHtml`, `capturePageHtml`).
- **Save this page as PNG**: Full-page high-resolution PNG image capture powered by CDP `Page.captureScreenshot` with multi-slice `OffscreenCanvas` stitching for extra-tall pages.
  - Dedicated primary action in popup ("Save as PNG" with sky glow theme).
  - Dedicated shortcut `Alt+Shift+I`.
  - Context menu entry "Save page as PNG".
  - Seamless download integration (`savePng`).

## 2.1.0

### Features

- **Pick Element to HTML**: Interactively select any DOM element on the page and export it as standalone, styled HTML.
  - Retains all computed CSS styles, stylesheets, and custom properties (`var(--...)`).
  - Converts `<canvas>` elements to embedded data URLs.
  - Preserves form input states, checkboxes, and select dropdown values.
  - Automatically resolves relative URLs for images, hyperlinks, video posters, and `style` url attributes.
  - Mode toggle (`M` key) inside the element picker to effortlessly switch between PDF and HTML target formats.
  - Dedicated shortcut `Alt+Shift+H` and context menu entry.

## 2.0.0

A complete rewrite. Nothing from version 1 survives except the name and the idea.

### Rendering

- **Removed html2canvas, jsPDF and html2pdf entirely.** Roughly 2.4 MB of
  bundled libraries are gone. The extension now ships no rendering dependency of
  any kind.
- **Text mode**: PDFs are produced by `Page.printToPDF` over the DevTools
  protocol, which is Chrome's own print pipeline. Text is real text, links are
  live, files are a fraction of the size.
- **Screen media emulation** during printing, so the PDF keeps the layout you
  were looking at instead of falling back to a site's print stylesheet.
- **Snapshot mode**: a second pipeline that captures painted pixels sheet by
  sheet through `Page.captureScreenshot`, for canvas, WebGL, blend modes and
  backdrop filters. Link areas are mapped into the PDF so links still work.
- **Fit to width**: the layout is scaled so the whole document width lands on
  the sheet. This is the fix for content being cut off at the right edge.
- Snapshot slices are clipped to the compositor's texture limits, so pages of
  any height work without seams or blank bands.

### Fidelity

- The document is scrolled end to end before capture so lazy loaders and
  viewport triggered images fire.
- Deferred images are forced eager, `data-src` fallbacks are committed, and both
  images and web fonts are awaited.
- Consent walls, chat widgets, app install bars and full screen overlays are
  removed.
- Pinned elements are unpinned, so a sticky header appears once rather than on
  every sheet.
- Inner scroll panes are unrolled and collapsed `<details>` are opened.
- Page breaks avoid splitting images, tables, figures and code blocks.
- Animations are paused so nothing is captured mid transition.
- Every mutation is journalled and reverted after the capture, including empty
  style attributes.

### Features

- Element picker with keyboard resizing, cutting the sheet to the picked block.
- Selection capture.
- Reader mode, with its own typography and a masthead.
- Batch capture of every tab in a window into a dated folder.
- Save a linked page from the right click menu without opening it.
- Per site presets that override the global defaults.
- One continuous sheet with no page breaks.
- Header and footer templates with title, address, page numbers and date.
- Colour scheme forcing through `prefers-color-scheme` emulation.
- Custom layout width for rendering responsive sites at desktop size.
- Lossless snapshots, and snapshot resolution up to 4x.
- File name templates and an optional download subfolder.
- Keyboard shortcuts and a context menu.
- In page progress indicator, so closing the popup does not lose the capture.

### Interface

- New glass design system shared by the popup and the settings page, built on an
  indigo to cyan palette with frosted surfaces.
- New settings page covering output, fidelity, headers, snapshot quality, saving
  and site presets.
- New logo, icon set, store tiles and store screenshots.
- Reduced motion is respected throughout.

### Under the hood

- Manifest V3 with a module service worker.
- One capture per tab, enforced, with the debugger detached in a `finally` block
  so a failure cannot leave a session dangling.
- Blocked pages fail with a readable explanation instead of hanging.
- Large PDFs are downloaded through a blob URL minted in an offscreen document,
  rather than a data URL.
- A dependency free PDF writer for snapshot mode: JPEG data is embedded as
  `DCTDecode` without re-encoding, lossless captures as raw RGB under
  `FlateDecode`.

## 1.1

- The original html2canvas based converter.
