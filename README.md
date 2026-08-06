<div align="center">

# Vkusnaya Kompaniya — bakery landing page

Single-page site for a bakery and kitchen with two locations in Samara, Russia.
Built with **Astro 5**, no UI framework, ~5 kB of JavaScript on the wire.

[![Astro](https://img.shields.io/badge/Astro-5.18-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
![JS shipped](https://img.shields.io/badge/JS%20shipped-5.4%20kB-6f7546)
![Lighthouse mobile](https://img.shields.io/badge/Lighthouse%20mobile-99%20·%20100%20·%20100%20·%20100-brightgreen)
![Lighthouse desktop](https://img.shields.io/badge/Lighthouse%20desktop-100%20·%20100%20·%20100%20·%20100-brightgreen)

**English** · [Русский](README.ru.md)

<img src="docs/screenshots/hero.webp" alt="Hero section on desktop" width="900">

</div>

## Screenshots

| Showcase | Contacts |
|---|---|
| <img src="docs/screenshots/cakes.webp" alt="Cake showcase with filters" width="440"> | <img src="docs/screenshots/contacts.webp" alt="Contacts with schedule and Yandex map" width="440"> |

| Mobile — hero | Mobile — showcase | Mobile — contacts |
|---|---|---|
| <img src="docs/screenshots/mobile-hero.webp" alt="Mobile hero" width="240"> | <img src="docs/screenshots/mobile-cakes.webp" alt="Mobile showcase" width="240"> | <img src="docs/screenshots/mobile-contacts.webp" alt="Mobile contacts" width="240"> |

## Highlights

- **No UI framework.** The page has four interactive pieces — a sticky menu, showcase
  filters, "show more", and two lazy iframes. All four are covered by the platform, so
  React would only add weight.
- **Opening status computed in the browser** against `Europe/Samara`, not baked into the
  HTML at build time — a static "Open now" would lie to everyone visiting at night.
- **Business hours live in one place.** A `Schedule` tuple in `src/data/site.ts` renders
  the human-readable table, the status pill and the `openingHours` field of the
  schema.org markup, and it is covered by tests.
- **Reviews come from the official Yandex Maps widget.** Review texts belong to their
  authors and cannot be copied onto a third-party site; only the aggregate numbers are
  quoted, with a link to the source.
- **Images are content, not decoration.** AVIF via `astro:assets`, explicit `srcset`,
  the LCP frame preloaded from the same origin.
- **Accessible by default.** Every text step holds ≥4.5:1 contrast, focus is visible,
  the map and reviews have `noscript` fallbacks, and the page has a skip link.

## Tech stack

| | |
|---|---|
| Framework | [Astro 5](https://astro.build) — static output, zero hydration |
| Language | TypeScript (strict), plain CSS with custom properties |
| Images | `astro:assets` → AVIF, `<Image />` + `getImage()` for the preload |
| Fonts | Montserrat Variable, self-hosted, only Cyrillic and Latin subsets |
| SEO | JSON-LD `@graph` of two `Bakery` nodes, OpenGraph, sitemap, `robots.txt` |
| Tests | `node:assert` — no test runner, Node reads the TypeScript directly |

## Getting started

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve the built site
npm run check    # types and .astro diagnostics
npm test         # schedule and opening-status logic
```

> **Windows note.** Run from a path that matches the on-disk letter case
> (`D:\Code\Projects\…`, not `D:\code\projects\…`). On a mismatch Astro loses compile
> metadata and **silently drops all CSS** from the build.

## Project structure

| Path | What lives there |
|---|---|
| `src/data/site.ts` | contacts, business hours, addresses, every outbound link |
| `src/data/catalog.ts` | cakes, desserts, room photos, order steps, `srcset` helpers |
| `src/data/site.check.ts` | assertions for the schedule and status logic |
| `src/components/` | one component per section of the page |
| `src/layouts/BaseLayout.astro` | meta, OpenGraph, JSON-LD, fonts, LCP preload |
| `src/scripts/lazy-frame.ts` | lazy iframes for the map and reviews, location switching |
| `src/styles/global.css` | design tokens, buttons, shared patterns |
| `handoff/` | original design handoff — reference only, never shipped |

Content changes go into `src/data/`. Section copy lives in the components; everything
enumerable (showcase items, locations, links) lives in the data files.

## How it stays fast

- **CSS is inlined** into the document — no render-blocking stylesheet request.
- **`@font-face` is declared by hand** for the Cyrillic and Latin subsets only. Importing
  the font package pulled in `latin-ext`, `cyrillic-ext` and `vietnamese` — 100+ kB of
  subsets the page never renders a glyph from.
- **The LCP image is preloaded** with the same `srcset`/`sizes` the markup uses, so the
  browser starts the fetch before it parses the page.
- **Sections below the fold are skipped** until they are scrolled into view
  (`content-visibility: auto`). The trade-off is documented in the CSS: anchor jumps are
  instant instead of smooth, because unrendered sections only estimate their height.
- **Third-party widgets are deferred.** Yandex Maps and the reviews widget mount through
  an `IntersectionObserver` and never touch the critical path.

Measured with Lighthouse 12 against a gzip-serving production build: mobile
99 / 100 / 100 / 100 (median of five runs), desktop 100 / 100 / 100 / 100.

## Responsive scale

The design was drawn for three fixed widths — 390 / 834 / 1440. In production those are
custom properties that switch at `768px` and `1200px`:

| | mobile | tablet | desktop |
|---|---|---|---|
| side padding | 18 | 36 | 72 |
| content width | 354 | 762 | 1296 |
| H1 / H2 | 34 / 25 | 47 / 33 | 66 / 42 |
| section padding | 44 | 64 | 92 |
| columns: cakes / desserts | 2 / 2 | 3 / 3 | 4 / 3 |

At the three reference widths the numbers match the design to the pixel; in between they
interpolate with `clamp()`.

## Tests

`npm test` runs `src/data/site.check.ts` — the only logic on the page that cannot be
verified by looking at it, since it depends on the weekday, the time of day and the
Samara time zone:

- schedule → human-readable rows and schema.org `openingHours`
- opening and closing boundaries (open at exactly 08:00, closed at exactly 21:00)
- Saturday's later opening, and midnight rollover into the next day's hours
- Russian plural forms for the rating counters

No runner and no dependencies: `node:assert` plus Node's native TypeScript support.

## Related

| | |
|---|---|
| Delivery shop | [vkusdostavka.shop](https://vkusdostavka.shop/) |
| Catering | [vkusnayakompania.ru](https://vkusnayakompania.ru/) |
| Apps | [App Store](https://apps.apple.com/app/id6477568088) · [Google Play](https://play.google.com/store/apps/details?id=com.foodpicasso.cateringvkusnaya) |
| Social | [VK](https://vk.ru/vkusnayakompania) · [Telegram](https://t.me/vkusnayakompania) |
