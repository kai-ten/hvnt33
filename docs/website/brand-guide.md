# hvnt33 brand guide

This guide steers hvnt33.com and anything else that speaks for hvnt33 in public. The technical rules for the website (stack, versions, security, responsive design, quality gates) are in [site-spec.md](site-spec.md). Both files are binding for people and agents building the site. When a rule here conflicts with taste, the rule wins until this file is changed.

## 1. What hvnt33 is

HVNT33 is a desktop browser built for investigation. It searches every engine at once, records what each engine showed, captures evidence in one keystroke, keeps its own timestamped archive of the web, and hands captures to an AI agent that files them into a case graph where every claim points back to its source. Local cases run on the investigator's own machine with no HVNT33 account and no telemetry. HVNT33 Cloud is the optional paid service for hosted cases, collaboration and publishing.

The people it is for: OSINT researchers, investigative journalists, threat intelligence analysts, fact checkers, due diligence and trust and safety teams. They are skeptical, technical, and allergic to marketing.

### The line

| Where | Text |
|---|---|
| Headline (home page `h1`) | **Every secret is a mosaic of public pieces.** |
| Line under the headline | The browser for OSINT, investigative journalists, and threat intelligence analysts. |
| Keyword line (page titles, search results, link previews) | **The browser for OSINT** |

Why it works:

- **Insider language.** The mosaic theory is the intelligence community's own doctrine: harmless public fragments, put together, can reveal what no single one does. Analysts and investigators recognize it at once, and recognizing it tells them the product was made by one of them.
- **A curiosity gap.** The headline promises a secret and withholds it. The reader wants to know which pieces and how they fit (Loewenstein's information-gap theory), and the subline answers with the product.
- **The line under it names the audience and nothing else.** The mosaic beside it does the explaining.
- **The browser for OSINT** carries the search keyword in every `<title>` and preview, where it is what people type.

Also approved, for other places: "Remember what the internet forgets" (the archive feature's heading) and "Find it. Keep it. Prove it." (short form, for social cards).

The text lives in one place, `apps/web/src/lib/site.ts`. Never rotate or animate between alternatives.

## 2. The idea behind the brand

**Occultum** is Latin for hidden. The occult, before it meant candles and robes, meant only this: what is concealed. hvnt33 is the tool that takes what is concealed and puts it in the light, with the receipts.

So the brand is not spooky. It is the moment a lamp is lifted in an archive. Everything visual and verbal follows from three ideas:

1. **Revealing.** Darkness is the default surface; content is what the light falls on.
2. **Recording.** The look of ledgers, manuscripts, case files and printed evidence. Things written down so they can be checked.
3. **Proving.** Precision over mood. Every claim on the site can be verified in the product or the repository.

The idea in one line is **Nihil occultum** ("nothing hidden"), from the Vulgate. It guides the brand; it is not printed on the site: *nihil enim est opertum quod non revelabitur, et occultum quod non scietur* (Matthew 10:26, "for there is nothing covered that shall not be revealed, and hidden that shall not be known").

## 3. Name and wordmark

- The name is **HVNT33**, in capitals, everywhere a reader sees it: the wordmark, headings and running text. Only things a reader might type or copy keep the lowercase spelling: the domain (hvnt33.com), the repository, commands, file and folder names, package names.
- The V stands for U, as Roman inscriptions carved it. It is read "hunt thirty-three".
- 33 is the number of the hidden in the occult tradition. The site never explains the 33 beyond one line on an About page. Mystery that is explained on every page stops being mystery.
- The wordmark is set in the display face (section 6), in capitals, tracked +14%.
- Clear space around the wordmark: the height of the "h". Minimum width: 72px on screen.
- Don't outline it, gradient it, glow it, skew it, animate it, or put it in a pill.

### The mark

The emblema's figure on its own: the pyramid and the eye, cut from the floor with its own grout and nothing around it, on a transparent background. A pyramid of sandstone courses, a capstone floating above a clear gap, the eye in the capstone's lower third with a red iris. No frame, no field, no rays. It is the favicon, the desktop app's icon and the mark in the footer. The header carries the wordmark alone.

It is laid tile by tile by `apps/web/scripts/mark.ts` from the palette in `apps/web/src/lib/stone.ts`, the same stones as the hero. No image model draws it. Each size has its own drawing, so tiles land on whole pixels and detail drops out as the mark shrinks instead of blurring:

| Size | Drawing | Used for |
|---|---|---|
| `icon.svg` | The fine drawing on a 96-tile grid, colours as classes, about 55 KB gzipped | Browser favicon; the browser scales it to the tab |
| 256 to 1024px | Fine tesserae (about 4.4px each at 1024) over grout: outlines laid as rows of tiles along each edge with a pale halo row outside, sandstone blocks in staggered courses, each block cut from its own shade and lit from the left, a capstone that brightens toward the eye, lids laid along their curves, the iris in red rings with a dark rim, pupil and one ivory glint | macOS icon, large lockups |
| 32 to 128px | Tiles on whole pixels, no grout: a one-tile outline, courses by colour, the eye as ivory with a red iris | Small Dock and Finder sizes |
| 16px | A 16 by 16 map laid by hand in the script | The desktop icon's smallest size |

The site uses the pyramid alone, on a transparent background, except `apple-icon.png`, which sits on travertine because iOS fills a transparent touch icon with black.

**The desktop icon** (macOS, Windows and Linux) sets the pyramid in a tile so it sits with the other apps in the Dock, the taskbar and a launcher: Apple's icon grid (an 824px body with 185px corners on a 1024px canvas), a field of travertine laid in rows, three halo rows of pale stone following the figure, and a dark line and a red fillet laid along the rounded edge. From 256px up it is laid in fine tesserae; at 128px and below it is flat travertine with a red fillet and the pyramid on whole pixels. `appTile` in `scripts/mark.ts` draws it. The dark outline and pale halo keep the silhouette clear on light and dark backgrounds.

- `node scripts/mark.ts <dir>` (in `apps/web`) writes every size and a proof sheet on stone and on black. Look at it before installing.
- `node scripts/mark.ts --install` writes `src/app/icon.svg`, `src/app/apple-icon.png` and the desktop app's icons (`apps/desktop/build-resources/icon.icns`, `icon.ico`, `icon.png`). Never edit those files by hand; change the script and install again.
- Don't redraw, recolour, outline, animate or place the mark on a coloured badge. Don't scale a large drawing down in place of a small one.

## 4. Latin, used properly

The domain already swaps U for V. The site extends that, carefully. Latin is seasoning. Used everywhere, it becomes a costume.

### Where Latin goes

| Place | Example |
|---|---|
| Wordmark | HVNT33 |
| Roman numerals, carved beside ledger entries (never on section headings) | I, II, III |
| The 404 page | Non inventum. The page isn't here. |
| Docs running head (the small repeated line at the top of a docs page, as in a printed book) | Liber I · Getting started |

### V for U

In **headings only**, every u is drawn as a v, as Roman inscriptions carved it: EVERY SECRET IS A MOSAIC OF PVBLIC PIECES. That covers the headline, section and page headings, the wordmark and small caps labels (everything set in Castoro Titling). Body text, buttons, navigation and metadata keep their u, for normal reading.

- **Drawn, not spelled.** The text keeps its real u. A small companion font (`apps/web/public/fonts/vu-CastoroTitling-Regular.woff2`, built by `apps/web/scripts/v-for-u.py`) draws u and U with the v and V glyphs, first in the display stack for those two characters only. Screen readers, search, copy and paste, and find in page all see the real words.
- The Open Graph image, which is a picture, carves its V directly.

### Rules

- **English carries the meaning.** A visitor who reads no Latin loses nothing. Latin is never the only label on a button, link, heading or form field.
- **One Latin phrase per screen**, at most.
- **Only phrases from the approved list below.** No machine-translated Latin. If a new phrase is wanted, check it against a real dictionary or a Latinist and add it here with its translation.
- No fake Latin, no lorem-ipsum jokes, no Latin puns on English words.

### Approved Latin

| Latin | Meaning | Use |
|---|---|---|
| Nihil occultum | Nothing hidden | The idea behind the brand; not printed on the site |
| Fiat lux | Let there be light | Sparingly; the "reveal" moment in the hero, or a release name |
| Incipit | Here it begins | The first line of the Getting started page, as a manuscript would open |
| Non inventum | Not found | 404 |
| Quaerere / QVAERERE | To seek | Search feature, section numbering only |
| Capere | To take, seize | Capture feature |
| Servare | To keep, preserve | Archive feature |
| Probare | To test, prove | Verification feature |
| Nectere | To bind, connect | Connections and the case map |
| Liber | Book | Docs running head |

## 5. Voice and writing rules

hvnt33 writes like a good investigator's case notes: exact, plain, a little dry, sure of what it knows and open about what it doesn't.

### Voice

- **Specific.** "Records the rank, title, URL and snippet of every result each engine showed you" beats "powerful search insights".
- **Verifiable.** Every claim on the site can be checked in the app, the docs or the source. If it can't be, cut it.
- **Plain.** Short words, active voice, second person ("you"), present tense.
- **Calm.** No hype, no urgency, no exclamation marks.
- **Honest about limits.** macOS only today, unsigned builds today, a route hides your IP not your identity. Say these things on the site, near the claim they qualify. Skeptical readers trust a product that states its limits.

### The banned list

These are the marks of machine-written or template marketing copy. None of them appear anywhere on the site, in docs, or in commit messages about the site.

**Punctuation**

1. **No em dashes (—) and no en dashes (–).** Not in headings, not in body text, not in alt text, not in metadata. Also no spaced hyphen standing in for one (" - "). Use a period, comma, colon or parentheses instead. Number ranges are written with "to": "macOS 14 or later", "6 to 24 hours".
2. No exclamation marks.
3. No ellipses for drama. An ellipsis appears only inside a real quote that was shortened.
4. No emoji anywhere on the site. Unicode symbols that belong to the product's world are fine: ⌘ ⇧ ↵ ¶ § † ☞.
5. Straight quotes in code, curly quotes (“ ” ‘ ’) in prose.

**Layout words**

6. **No eyebrows.** An eyebrow is the small, usually uppercase, often tinted label placed above a heading ("FEATURES", "WHY HVNT33", "HOW IT WORKS", "NEW"). The heading says what the section is; nothing sits on top of it. Section numbering (II.) sits on the heading's own line, inside the same element.
7. No pill badges ("✨ New", "Beta", "Open source") above or beside headlines.
8. No "Trusted by" logo rows, testimonials, user counts or star counts until they are real, sourced and approved by the user.

**Words and phrases**

9. Banned words: unlock, unleash, supercharge, elevate, empower, seamless(ly), effortless(ly), revolutionize, game-changer, cutting-edge, next-generation, state-of-the-art, robust, leverage, harness (as a verb), streamline, delve, dive in, deep dive, embark, journey, tapestry, realm, landscape (figurative), ever-evolving, navigate (figurative), testament, pivotal, crucial, vital, paramount, holistic, synergy, best-in-class, world-class, all-in-one, one-stop, magic(al), superpower, 10x, AI-powered (say what the agent does instead).
10. Banned constructions:
    - "It's not just X, it's Y." / "Not X. Y." / "X isn't Y. It's Z."
    - "Whether you're an X or a Y, ..."
    - "In today's fast-paced / digital / ever-changing world ..."
    - "Say goodbye to X." / "Meet X." / "Introducing X."
    - "From X to Y, hvnt33 has you covered."
    - Rhetorical questions as headings ("Tired of juggling tabs?").
    - Three adjectives in a row ("fast, private, and powerful"). Lists of three are fine when they are three real things.
    - Sentence fragments for drama ("Every engine. Every result. Every time.").
    - Headings in the form "Title: Subtitle" where the subtitle restates the title.
    - Closing lines that summarize what the section just said.
11. No bold phrases sprinkled through paragraphs for emphasis. Bold is for UI labels the reader will look for ("press **Snapshot now**").
12. Headings in sentence case: "Capture evidence in one keystroke", not "Capture Evidence In One Keystroke".

### Before and after

| Don't | Do |
|---|---|
| Supercharge your OSINT workflow with AI-powered investigation. | Search seven engines at once and keep a record of what each one showed you. |
| Capture — and never lose — critical evidence. | Highlight a passage, press ⌘⇧S, and the quote, its page and its citation are saved to the case. |
| FEATURES / Everything you need, all in one place | II. What it does |
| Your data. Your machine. Your rules. | Local cases live in ArcadeDB and a checksummed evidence vault on your computer. They need no HVNT33 account and send no telemetry. |
| Built for the modern investigator 🔍 | Built for investigators who need to show their work. |

### Mechanical check

The site's CI fails if any of these appear in content or components (the exact check is in [site-spec.md](site-spec.md#content-lint)):

- the characters `—` and `–`
- the banned words in rule 9 (whole-word, case-insensitive)
- emoji code points
- `!` at the end of a sentence in prose

A lint pass doesn't make writing good, but it keeps the obvious tells out.

## 6. Visual identity

The look is **Lapis**: a Roman floor and a Roman inscription, in warm travertine. Carved capitals with generous spacing, a mosaic emblema laid tile by tile, the Greek key, and red painted into the stone the way Roman inscriptions were painted with minium. It should feel like a monument that records the truth: beautiful, exact, made by hand. Never a fantasy book, a costume, or a template.

A dark variant, **Nox** (black stone, ivory tiles), is offered through the lamp toggle. Lapis is the default whatever the visitor's system prefers.

### Principles

These came out of the work on the landing page. They are the reason it looks the way it does.

1. **Real Roman craft, not Roman costume.** Every ornament is a thing Romans actually made: opus tessellatum and vermiculatum, the Greek key, minium-red letters, the sinopia underdrawing. If an element can't be named in those terms, it probably doesn't belong.
2. **Laid, not scattered.** Tiles sit in a frame, in rows, with mortar between them. Loose tiles floating on the page read as pixel art.
3. **Lines follow their direction.** In a mosaic, tiles are laid along the lines they draw (opus vermiculatum), and a halo row of cream sets each line off from the field. That flow is what makes it beautiful rather than blocky.
4. **Beauty over restraint.** The site should have character and movement. Quiet is good; empty is not. When in doubt, add craft, not chrome.
5. **One idea, carried through.** Public pieces come together into proof. The mosaic, the story, the tile lines and the headline all say that.
6. **Width to breathe.** Content runs to 96rem and the hero is full-bleed. Don't cage the page in a narrow column.

### Color

Contrast ratios were computed against WCAG 2.2; any new pairing needs the same check, and the accessibility tests check every page in both themes.

| Token | Lapis (default) | Nox (dark stone) | Use | Contrast on bg (Lapis / Nox) |
|---|---|---|---|---|
| `--bg` | `#EBE5D8` travertine | `#151311` | Page | |
| `--bg-raised` | `#E1D9C8` | `#201D19` | Code blocks in the docs, story plaques | |
| `--text` | `#1D1A16` | `#ECE6D8` | Body and headings | 13.8 / 14.9 |
| `--text-dim` | `#5A5245` | `#A8A08F` | Secondary text, captions, metadata | 6.1 / 7.1 |
| `--rubric` | `#A3261A` minium red | `#E2664F` | Links, tesserae, the red of the mosaic, the primary button | 5.9 / 5.5 |
| `--gilt` | `#6F5314` bronze | `#D0A75A` | Keyboard keys. Rare. | 5.7 / 8.3 |
| `--rule` | `#C9BEA8` | `#38322A` | Decorative hairlines only | |
| `--rule-strong` | `#857760` | `#7D725E` | Borders that carry meaning | 3.5 / 3.4 |

Primary button: `--rubric` fill with `--on-rubric` text (6.4 on Lapis, 5.5 on Nox). Focus: a 2px `--rubric` outline on buttons and inputs; links show focus as a heavy red underline, never a box.

**The mosaic palette** (in `apps/web/src/lib/stone.ts`, one set per theme, shared by the hero and the mark): mortar, cream field stones, band stones, black, minium red, gold for rays and corner lines, sandstone and darker course stones for the pyramid, pale gold for the capstone, ivory for the eye. Each tile picks from a few close shades so the stone varies the way real stone does. Change these together, never one at a time.

**Black marble** is the one dark surface in Lapis: command blocks, `#1D1A16` with ivory text and gold prompts.

### Type

| Role | Face | Notes |
|---|---|---|
| Display | **Castoro Titling** | Capitals drawn after Roman inscriptions. Headlines, section headings, the wordmark, numerals. Always uppercase (by CSS; the markup keeps normal case), tracked +4% for headings and wider for small caps labels. |
| Text | **Castoro** (roman and italic) | Body, docs prose, the quoted evidence. |
| Interface | **IBM Plex Sans** | Navigation, buttons, notes, docs navigation. Small and quiet. |
| Evidence and code | **IBM Plex Mono** | Commands, shortcuts, metadata, timestamps, hashes. |

All four are OFL, loaded through `next/font` so they are served from the site. The headline is sized with the viewport's height as well as its width, so it never crowds the header.

### The Roman vocabulary

The components that make the site look like itself. Use these; don't invent parallel ones.

| Element | What it is | Where | Code |
|---|---|---|---|
| **Emblema** | The framed mosaic panel: Greek key border, a red square centred in each corner joined to the key's middle tile by gold lines, a red fillet, a tessellated field, and the Eye of Providence (section 7) | Home hero, right of the headline; below it on phones | `Mosaic.tsx` |
| **Meander band** | The same Greek key as a full-width band, drawn from the same bitmap | **Once**, directly below the hero. Nowhere else: repeated, it turns tacky | `.meander` in `globals.css` |
| **Carved numerals** | Large Roman numerals cut into the stone with an incised shadow; decoration, drawn by CSS so it is never read as text | Beside each entry of the home ledger | `.carved` |
| **Tessera** | A 3 by 3 cluster of red tiles, the emblema's corner square as a mark | Before the story's steps (red for the scene on show, stone for the others) and the principles' headings | `Tessera` in `Ornaments.tsx` |
| **The tile film** | A second, simpler mosaic (black line, cream band, red fillet) that re-lays itself scene by scene as the reader scrolls | The story section | `Story.tsx` |
| **Inscriptions** | Ledger entries: carved numeral, title in capitals, text | "What it does" | `.inscription` |
| **Black marble plaques** | Command blocks with an inset double frame | Wherever commands appear | `.term` |
| **The Greek key** | One continuous line that turns in on itself and runs into the next unit, 10 cells by 7. Never the hook-on-a-baseline pattern, which reads as a row of G's. In the emblema each side is fitted to whole units and stops at its middle tile (the 4th of 7 rows) at both ends; a gold line runs straight on from there to the red square centred in the corner | Emblema border, meander band | `key` in `Mosaic.tsx` |
| **Interpuncts** | · between Latin words, running heads and metadata | Throughout | |
| **The mark** | The emblema's pyramid and eye on their own, drawn per size (section 3) | Favicon, desktop icon, touch icon, footer | `scripts/mark.ts` |

### The Eye of Providence

The one occult emblem the brand uses, and only in the hero emblema, laid in stone. Its proportions were tuned by eye, and they matter:

- The pyramid rises from the base in **courses of equal height** (a mortar row, then three rows of block), with joints every six tiles, staggered by half.
- The **capstone floats** above a clear gap and is noticeably smaller than the pyramid; the eye sits in its lower third and is modest, not a cartoon.
- **Gold rays** radiate from the eye, alternating long and short. Rays the border would clip into stubs are left out, and so is the lowest ray on each side, so the pyramid's slopes stand in clean stone.
- The iris is laid in **red rings** with a black pupil and one ivory glint.

The eye appears in two places only: the hero emblema and the mark (section 3). Don't repeat it as decoration anywhere else.

### Motifs that are banned

- pentagrams, inverted crosses, goats, skulls, blood, candles, hooded figures, tarot, zodiac wheels
- blackletter, fake parchment burns, "ancient scroll" edges, Cinzel-style fantasy lettering
- glitch text, matrix rain, Guy Fawkes masks
- loose tiles scattered outside a frame (pixel art)
- the motto or any Latin inscription as a decorative band on the page

### Shape and surface

- Corners: 2px on inputs and buttons, 0 elsewhere.
- No drop shadows, glass or blur. Depth comes from stone: mortar lines, inset frames, carved shadows.
- The header is solid stone, never translucent.
- No uniform card grids. Features are inscriptions in a ledger.

### Imagery

- Real product screenshots only, of the fictional demo case (`npm run demo`). Never a real person, a real case, or the user's own terminal or tabs.
- Crop to the part that proves the claim; on phones show one panel.
- Frame with a 1px `--rule-strong` border and a mono caption: "Fig. 3. The Search Lab comparing ranks across four engines."
- No AI illustrations, stock photos, 3D renders or blobs.

## 7. Motion

The site should feel alive and made by hand. Motion tells the product's story: scattered public pieces come together into proof.

- **Laying the emblema** (home hero). The mortar appears first with a pale underdrawing of the figure (the *sinopia* Roman mosaicists painted before laying tiles). The border and field are laid in a diagonal sweep, the pyramid rises course by course from its base, the capstone is outlined, the rays spread outward, and the eye opens last. About four and a half seconds. Afterwards the pointer rakes a soft light across the stone (only where there is stone). Drawn on a canvas from one fixed seed, so it is the same panel on every visit.
- **How a secret comes together** (home). A tile film: a mosaic that re-lays itself as the reader scrolls. The whole section is held in place while it plays (mosaic left and steps right on wide screens, mosaic above the steps on phones), so the reader always sees the picture and the words together. Four scenes from the fictional demo case: six documents scattered; archived in stacks with a red seal and a clock for the timestamp; turned into records, each a medallion with its emblem (a bust for a person, an anchor for the port, columns for the firm, a sealed document for the contract), joined by links that each carry a gold tile for the quote that proves them; then the reveal, where everything else sinks into the stone and the founder, the port and the firm are laid in red with gold halos, forming the V. Between scenes only the tiles whose color changes turn over, in a sweep. The three steps never change and never spread apart: the step whose scene is on show is in full ink with a red tessera, the others fall back to `--text-faded` (`#6F6451` on Lapis, `#857D6A` on Nox, both still AA). The red finale plays under Connect. No caption or conclusion: the picture says it.
- **Chisel.** Display headings are unveiled from the top down, as if the letters were being cut, when a page opens and when a section scrolls into view.
- **Rise.** Sections and entries rise into place as they enter the viewport. Hero text follows the headline in a short stagger.
- **Page transitions.** Each page fades in on navigation.

Rules:

- Motion follows the reader: it is triggered by load, scroll or the pointer, and it settles. Nothing loops.
- `prefers-reduced-motion` gets the finished state of everything, with no pinning: the full emblema, the assembled story, all sections visible.
- Without JavaScript, the server-rendered page is the finished state. Content hidden for a reveal becomes visible on its own after a few seconds even if scripts fail.
- Animate `transform`, `opacity` and `clip-path`, never layout properties on large elements.
- Still banned: scroll hijacking (overriding the scroll speed), cursor followers, marquees, typing effects, counting-up numbers, parallax on text.

## 8. Page architecture

The detailed information architecture and content sources are in [site-spec.md](site-spec.md#information-architecture).

**Home**, in order:

1. **Hero**: the headline, the audience line, the two calls to action (**Download HVNT33**, **The Founding 100**) and the platform line on the left; the emblema on the right. Nothing else. The headline and audience line remain unchanged.
2. The meander band, once.
3. **How a secret comes together**: the tile film, mosaic left and steps right.
4. **What it does**: six inscriptions, then a link to all fourteen features.
5. **Research you can stand behind**: three principles, each with a tessera, the last with the evidence-verification commands on black marble.
6. **Keep the investigation alive**: the optional Cloud service, its three visibility states and the long-term public archive.
7. **Investigations, with the receipts**: the published research, newsletter and community.
8. **Open the browser tonight**: requirements, the download button and the install commands on black marble.
9. The footer, below a hairline.

Section headings carry no numerals. Headings are plain carved capitals.

No "Get started free", no "Book a demo", no newsletter popup, no testimonials.

**Investigations**: the owner's research and newsletter. A list of posts (date, title in carved capitals, summary) beside a subscribe plaque; each post a readable column with a running head and the subscribe form at its end. The form's heading is "Get the next investigation"; its promise is only what is true: by email, when it's published, one-click unsubscribe. **Cloud**: the hosted service, the Founding 100 and the long-term social archive of source-linked investigations. Never imply that private research is public by default. **Community**: the public Discord, its research-safety boundary and the private Founders rooms. **Features**: every shipped feature, one ledger entry each, each ending with a link to its doc. **Download**: opens with *Incipit*; the exact commands, what each does, how to know it worked, and what to do when it didn't. **Docs**: a book, with a running head, § anchors, † footnotes for limits, and a table of contents in the margin on wide screens. **Footer**: the mark, the wordmark, license and links. No colophon.

## 9. Design history

What was tried and why it changed, so the site doesn't drift back.

| Tried | Why it went |
|---|---|
| A dark "illuminated manuscript" look in IM Fell English | Read as a fantasy book, not Latin. Rome is carved capitals and stone, not English pamphlet type. |
| "The browser for people who find things out." | Flat: it named a trait, not a desire. Replaced by the mosaic headline. |
| A long subline explaining the product | The emblema explains it. The line under the headline names the audience only. |
| A NIHIL · OCCVLTVM frieze at the top and in the footer | Felt like a gimmick. Latin stays in small places (running heads, *Incipit*, *Non inventum*). |
| Almost no motion, by rule | Made the site lifeless. Motion is now part of the brand (section 7). |
| Loose tiles scattered across the hero | Looked like pixel art. Tiles are laid in a framed panel. |
| A hook-on-a-baseline "key" | Read as a row of G's. The border uses the true Greek key. |
| A connection graph as the emblema's figure | Replaced by the Eye of Providence at the user's request; the graph lives on in the story section. |
| A focus box around the wordmark | Ugly on a carved wordmark. Link focus is a red underline. |
| Roman numerals on every section heading, in tabulae ansatae | Tacky. Section headings are plain. (Carved numerals on the ledger's entries stay.) |
| A Greek key band between every section and above the footer | Tacky when repeated. One band, below the hero. |
| Story text that swapped the steps for the conclusion in the same place | Text that changes under the reader is disorienting. Text stays put; the picture changes. |
| Story cards sliding into a graph | Plain boxes and lines. Replaced by the tile film, a second mosaic that re-lays itself. |
| A conclusion paragraph and a source note under the story | Unneeded; the mosaic's red finale makes the point. |
| A colophon in the footer (*Explicit*, typefaces, no cookies) | Clutter. The footer is the mark, the name, the license and links. |
| V for U in all text | Hard to read in paragraphs. It stays in headings, where it reads as carving. |
| Story passages spaced a screen apart, scrolling past a held mosaic | The words drifted far from the picture. The section is held whole; the steps stay together. |
| Lowercase hvnt33 | The name is HVNT33 everywhere readers see it. |
| A hedera (ivy leaf) divider between sections | Read as a heart. Sections are separated by space alone. |
| Gold lines meeting the middle of the key's end bar, then a square moved off-centre to the key's inner row | The key stops at its middle tile at both ends, the gold line runs straight on, and the red square stays centred in the corner. |
| The seal (a V in a double ring with III III cut into the rim) as the favicon, app icon and footer mark | A V in a ring said little at a glance. Replaced everywhere by the emblema's pyramid and eye, laid by `scripts/mark.ts`. |

## 10. Checklist before anything ships

- [ ] No em dash, en dash, emoji or exclamation mark (content lint passes).
- [ ] No eyebrow labels, pills, badge rows or fake social proof.
- [ ] Every product claim links to the doc or code that proves it.
- [ ] Every limit that qualifies a claim is stated next to it.
- [ ] Latin only from the approved list, never as decoration, never the only label.
- [ ] V for U in headings only; body text keeps its u.
- [ ] The name is HVNT33 wherever readers see it (the content lint checks this).
- [ ] Only brand tokens and the mosaic palette used for color; new pairings contrast-checked.
- [ ] New ornament comes from the Roman vocabulary (section 6), not invented alongside it.
- [ ] Screenshots are real, current, demo data only, and cropped for phones.
- [ ] Works and looks deliberate at 320px wide and at 2560px wide, in Lapis and Nox.
- [ ] Reduced motion shows the finished state of everything, with nothing moving or pinned.
