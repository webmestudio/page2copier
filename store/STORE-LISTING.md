# Chrome Web Store listing

## Name

Page2Copier

## Short description (132 character limit)

> Save any web page as a PDF or standalone HTML that looks exactly like the screen. Clean styles, live links, nothing cut off.

(124 characters)

## Category

Productivity / Workflow & Planning

## Detailed description

Most web capture tools repaint your page with their own half finished copy of
CSS, then hand you a file with broken layouts, blank boxes and half the article
missing. Page2Copier does not do that. It renders through Chrome's own engine, the
same one that painted the tab in front of you. What you see is what you save.

**Save as PDF or Clean Standalone HTML**

Save the entire page as a pristine PDF or as a clean, self-contained HTML file.
HTML export automatically inlines external stylesheets, resolves relative asset
URLs, embeds canvas graphics, preserves live form state, and sanitizes runtime scripts
for safe offline archiving and viewing.

**Two ways to capture PDF, one click**

Text mode drives the browser print pipeline, so the text in your PDF is real
text. You can select it, search it, copy it, and the links still work. Files
come out small.

Snapshot mode reads the painted pixels instead, sheet by sheet. Use it for
canvas, WebGL, maps, charts, blend modes and frosted glass effects, the things
that only exist once they have been drawn. Links are still added as clickable
areas.

**It handles the things that usually go wrong**

Wide layouts are scaled to fit the sheet instead of being sliced down the
middle. The whole document is scrolled first so lazy loaded images and infinite
feeds actually appear. Cookie walls, chat bubbles and app install bars are
removed. Sticky headers are unpinned so they show once instead of on all forty
sheets. Panels that only reveal three lines at a time are unrolled. Tables and
code blocks are kept whole across page breaks.

Every change is reverted the moment the file is written. Your tab is left
exactly as it was.

**Save a page, a block, or a sentence**

Point at any part of the page with the element picker, use the arrow keys to
widen or narrow the outline, and click. Save the element as a custom-sized PDF,
a cropped high-resolution PNG image, or export it as clean standalone HTML with all
styles and assets preserved. Or highlight some text and save just that. Or use reader
mode to keep the article alone, set in book typography with a masthead showing where it
came from.

**Set it once, per site**

Paper size, orientation, margins, headers, footers, file naming and snapshot
quality, all with sensible defaults. Any site can pin its own preset, so your
documentation site prints as a clean article while your dashboard is captured as
a pixel snapshot, without you touching a setting again.

**The rest**

Save every tab in a window at once into a dated folder. Right click a link to
save the page behind it without opening it yourself. Press Alt+Shift+P for the
page PDF, Alt+Shift+S for the page HTML, Alt+Shift+I for PNG, and Alt+Shift+E for the
element picker. Progress appears in the page, so closing the popup does not lose track of it.

**Private by design**

No servers, no accounts, no analytics, no telemetry, no network requests. Pages
are rendered on your machine and files go directly to your downloads folder. Settings
stay in your own browser profile. The source is on GitHub.

Free and open source. MIT licensed.

## Permission justifications

**debugger**
Required to call Page.printToPDF and Page.captureScreenshot, the DevTools
protocol commands that render a page through Chrome's own engine. These are the
entire reason the output matches the screen, and no other API exposes them.
Attachment is scoped to the single tab the user asked to save, lasts only for
that capture, and is released in a finally block.

**scripting**
Used to inject the preparation routines that load deferred images, remove
overlays, unroll scroll panes and then revert all of it, plus the element picker
and the progress indicator.

**activeTab / tabs**
Needed to identify the tab being saved, to read its title and address for the
file name, and to iterate open tabs for batch capture.

**host_permissions (all urls)**
The extension is for saving any page the user chooses, so it cannot know in
advance which sites are involved. No page data is transmitted anywhere.

**downloads**
Writes the finished PDF or HTML to the user's downloads folder.

**storage**
Stores settings and per site presets in the user's own browser profile.

**contextMenus**
Adds the right click entries for page (PDF/HTML/PNG), selection, element (PDF/PNG/HTML), link and reader mode.

**offscreen**
A service worker cannot create blob URLs. A single offscreen document turns the
finished PDF or HTML into a blob URL so large files can be downloaded without being
squeezed through a data URL.

## Single purpose statement

Page2Copier converts web pages, or parts of them, into PDF or standalone HTML files that match what
the browser displays. Every permission and every feature serves that one job.

## Assets

| Asset | File | Size |
| --- | --- | --- |
| Icon | `icons/icon128.png` | 128x128 |
| Small promo tile | `store/tiles/small-promo-440x280.png` | 440x280 |
| Marquee tile | `store/tiles/marquee-1400x560.png` | 1400x560 |
| Screenshot 1 | `store/screenshots/1-hero.png` | 1280x800 |
| Screenshot 2 | `store/screenshots/2-nothing-cut-off.png` | 1280x800 |
| Screenshot 3 | `store/screenshots/3-two-engines.png` | 1280x800 |
| Screenshot 4 | `store/screenshots/4-pick-anything.png` | 1280x800 |
| Screenshot 5 | `store/screenshots/5-per-site.png` | 1280x800 |
