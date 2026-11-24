# MEND: Frontend Visual Design, Typography, Layout & Polish

> **Purpose**: Step-by-step instructions for an agent to fix every visual design, typography, layout, responsive, and polish problem in this project.
>
> **Codebase**: React 18 + TypeScript + Vite. Main CSS at `src/style.css` (~53 KB, 99 lines of densely packed CSS). Dice CSS at `src/components/DiceTray.css`. HTML shell at `index.html`. Background image `bg-asset.webp` (275 KB). Board data/colors at `src/data/board.ts`.
>
> **Rules**: Preserve the existing palette and art direction (parchment/green/terracotta heritage aesthetic). Don't switch to Tailwind or a component library. Keep CSS vanilla. The goal is to fix what's broken and elevate what's mediocre — not redesign from scratch.

---

## TABLE OF CONTENTS

1. [P0 — Fix Missing Font Imports (Critical)](#1-p0--fix-missing-font-imports-critical)
2. [P0 — Legibility: Board Tile Text Sizing](#2-p0--legibility-board-tile-text-sizing)
3. [P0 — Mobile Layout: Sidebar and Board Scaling](#3-p0--mobile-layout-sidebar-and-board-scaling)
4. [P1 — Unify the Design Language (Kill the Conflict)](#4-p1--unify-the-design-language-kill-the-conflict)
5. [P1 — Button and Interactive Element Polish](#5-p1--button-and-interactive-element-polish)
6. [P1 — Color System: Ownership & Set Visibility](#6-p1--color-system-ownership--set-visibility)
7. [P1 — Typography Hierarchy Cleanup](#7-p1--typography-hierarchy-cleanup)
8. [P2 — Hub Center: Breathing Room & Visual Hierarchy](#8-p2--hub-center-breathing-room--visual-hierarchy)
9. [P2 — Player Cards: Information Density Fix](#9-p2--player-cards-information-density-fix)
10. [P2 — Deed Card (Title Deed Modal) Polish](#10-p2--deed-card-title-deed-modal-polish)
11. [P2 — Lobby Page Visual Polish](#11-p2--lobby-page-visual-polish)
12. [P3 — Scrollbar Styling](#12-p3--scrollbar-styling)
13. [P3 — Favicon and Meta Tags](#13-p3--favicon-and-meta-tags)
14. [P3 — Print Stylesheet](#14-p3--print-stylesheet)
15. [P3 — Dark Mode Foundation](#15-p3--dark-mode-foundation)

---

## 1. P0 — Fix Missing Font Imports (Critical)

### What's wrong
The entire design depends on three Google Fonts:
- **Playfair Display** — headlines, tile names, deed titles, hub logo, lobby hero text
- **DM Sans** — body text, UI labels, buttons
- **DM Mono** — currency figures, monospace labels, eyebrow text, timer, log entries

However, `index.html` has **no `<link>` or `@import` for any of them**. There's also no `@import` in `style.css`. If these fonts aren't installed locally on the user's machine (they won't be on 99% of devices), the entire site falls back to system fonts (Times New Roman for serif, Arial for sans-serif, Courier New for monospace), which completely destroys the visual identity.

### How to fix

**Step 1**: Add Google Fonts to `index.html`, inside `<head>`, before the Vite script:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
```

**Step 2**: Verify the font stacks in `style.css` have proper fallbacks. Find each occurrence and confirm:
```css
/* Should already be present, but verify these patterns exist: */
font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
font-family: 'DM Mono', 'Cascadia Mono', 'Fira Mono', monospace;
```

Currently many rules just say `'DM Mono',monospace` or `'Playfair Display',serif` — these are acceptable fallback chains but add `Georgia` after `Playfair Display` for a more graceful degradation since Georgia is ubiquitous and closer in character to Playfair than Times New Roman.

**Step 3**: Add `font-display: swap` behavior. The Google Fonts URL with `&display=swap` already handles this, but verify there's no flash of invisible text (FOIT) by checking that the CSS `:root` rule's `font-family` uses `'DM Sans'` with a system-ui fallback:
```css
:root {
  font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
```

This is already close to what's in line 1 of `style.css` (`:root{font-family:'DM Sans',sans-serif;...}`), but add `system-ui` and `-apple-system` between `'DM Sans'` and `sans-serif`.

---

## 2. P0 — Legibility: Board Tile Text Sizing

### What's wrong
Tile labels use `font-size: clamp(5px, 0.7vw, 9px)` on some breakpoints. At 5–6px, text is literally unreadable. The `clamp()` minimum values across the CSS are:

| Element | Current min | Acceptable min |
|---------|------------|---------------|
| `.tile-name` (property) | `7px` | `9px` |
| `.tile-name` (special) | `6px` | `8px` |
| `.tile-price` | `5px` | `7px` |
| `.tile-number` | `5px` | `7px` |
| `.corner-meta` | `5px` | `7px` |

### How to fix

**Step 1**: Find and update every `clamp()` for tile text. The pattern to search for in `style.css` is `clamp(` within tile-related selectors. Update the **minimum** values:

```css
/* Tile names — property, transport, utility */
.tile-property .tile-name,
.tile-transport .tile-name,
.tile-utility .tile-name {
  font-size: clamp(9px, 0.75vw, 11px); /* was clamp(7px, ...) or clamp(8px, ...) */
}

/* Tile names — special tiles (tax, chance, chest, club) */
.tile-tax .tile-name,
.tile-chance .tile-name,
.tile-chest .tile-name,
.tile-club .tile-name {
  font-size: clamp(8px, 0.65vw, 10px); /* was clamp(7px, ...) */
}

/* Corner tiles */
.tile-start .tile-name,
.tile-jail .tile-name,
.tile-rest .tile-name,
.tile-gotojail .tile-name {
  font-size: clamp(9px, 0.9vw, 13px); /* was clamp(8px, ...) */
}

/* Tile prices */
.tile-property .tile-price,
.tile-transport .tile-price,
.tile-utility .tile-price {
  font-size: clamp(7px, 0.62vw, 9px); /* was clamp(5px, ...) in some places */
}

/* Tile numbers */
.tile-number {
  font-size: clamp(7px, 0.58vw, 9px); /* was clamp(5px, ...) */
}

/* Corner meta text */
.corner-meta {
  font-size: clamp(7px, 0.55vw, 8px); /* was clamp(5px, ...) */
}
```

**Step 2**: On mobile (`@media(max-width: 760px)`), the tile name override is:
```css
.tile-property .tile-name, .tile-transport .tile-name, .tile-utility .tile-name {
  font-size: clamp(7px, .78vw, 9px);
}
```
Update the minimum to `8px`:
```css
font-size: clamp(8px, 1.5vw, 10px);
```

**Step 3**: For the mobile `@media(max-width: 680px)` breakpoint, the tile-name goes down to `clamp(5px, 1.45vw, 8px)`. Raise minimum:
```css
font-size: clamp(7px, 1.5vw, 9px);
```

---

## 3. P0 — Mobile Layout: Sidebar and Board Scaling

### What's wrong
On mobile (`max-width: 680px`):
- The sidebar is set to `display: none` in one media query but then resurrected as floating elements in the overlay system (player list becomes a fixed-bottom 3-column grid, controls become floating pills). This creates a confusing layered UI where floating elements overlap the board.
- The board tries to fill the viewport but the `min()` formula can make it too small or overflow.
- Touch targets on tiles are as small as 28px × 28px.

### How to fix

**Step 1**: Establish a clear mobile hierarchy — the board should take priority, with controls in a bottom sheet that slides up on demand:

```css
@media (max-width: 680px) {
  .play-layout {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }

  .board-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    min-height: 0;
  }

  .board {
    /* Board takes the smaller of available height or width */
    width: min(calc(100vw - 8px), calc(100dvh - 140px));
    height: min(calc(100vw - 8px), calc(100dvh - 140px));
  }

  /* Bottom control strip — always visible, 60px tall */
  .sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: auto;
    max-height: 50dvh;
    width: 100vw;
    background: #f7f5ed;
    border-top: 1px solid #d1d6cb;
    padding: 8px 12px;
    z-index: 8;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: max-height 300ms cubic-bezier(0.22, 1, 0.36, 1);
    overflow-y: auto;
  }

  .sidebar.collapsed {
    max-height: 56px;
    overflow: hidden;
  }
}
```

**Step 2**: Increase mobile touch targets. Add minimum touch areas to tiles:
```css
@media (max-width: 680px) {
  .tile {
    /* Ensure minimum interactive area even if visually smaller */
    min-width: 32px;
    min-height: 32px;
    position: relative;
  }

  /* Invisible expanded touch target */
  .tile::before {
    content: '';
    position: absolute;
    inset: -3px;
    z-index: 0;
  }
}
```

**Step 3**: For the floating player list on mobile, increase card size and simplify:
```css
@media (max-width: 760px) {
  .sidebar .player-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 5px;
  }

  .sidebar .player-card {
    padding: 8px;
    min-height: 44px; /* Apple HIG minimum */
  }
}
```

---

## 4. P1 — Unify the Design Language (Kill the Conflict)

### What's wrong
The app has two conflicting visual systems:

1. **Heritage / Luxury** — warm parchment backgrounds, embossed brass border ornaments on the hub (`hub-corners`), `color-mix()` tinted tile backgrounds, serif headlines
2. **Neo-Brutalist** — hard-edge `box-shadow: 4px 4px 0 #181715` on deed cards, trade modals, and rules modal; stark black borders

These don't coexist well. The board and game shell feel like a premium tabletop game, but the modals feel like a Figma template from a different project.

### How to fix — Go Full Heritage

**Step 1**: Replace the brutal box-shadows on modals. Find every instance of `box-shadow: 4px 4px 0 #181715` or `box-shadow: 5px 5px 0 #181715` in `style.css` and replace:

```css
/* FROM: */
box-shadow: 4px 4px 0 #181715;

/* TO: */
box-shadow: 0 8px 32px rgba(25, 39, 31, 0.18), 0 2px 8px rgba(25, 39, 31, 0.08);
```

This applies to:
- `.place-card` (deed card) — line 12 area of style.css
- `.trade-modal` — line 15 area
- `.rules-modal` — line 20 area

**Step 2**: Replace the hard `border: 1px solid #181715` on these modals with the softer green border used elsewhere:
```css
/* FROM: */
border: 1px solid #181715;

/* TO: */
border: 1px solid #49594d;
```

**Step 3**: The floating pills (`.sidebar .side-heading`, `.sidebar .side-controls`, `.sidebar .asset-button`, `.sidebar .side-toolrow button`) already use soft shadows (`box-shadow: 2px 2px 0 #303a3226`) — these are fine. Keep them.

**Step 4**: The `.place-card-head` has `border-top-width: 16px` for the color bar on deed cards. This is good and heritage-appropriate — keep it, but soften the top corners:
```css
.place-card {
  border-radius: 2px;      /* Barely rounded — still feels formal/printed */
  overflow: hidden;         /* Clip the color bar to the border radius */
}
```

**Step 5**: The setup modal and room lobby card don't have the brutal shadow — they use the overlay system cleanly. Leave them as-is.

---

## 5. P1 — Button and Interactive Element Polish

### What's wrong
- Disabled buttons just use `opacity: .35; cursor: not-allowed` with no explanation of **why** they're disabled
- Hover states are minimal (`background: #1f3129` on primary, `background: #e8e6dd` on secondary)
- No focus-visible outlines for keyboard users
- Active (pressed) state just does `transform: translateY(1px)` — functional but could be more tactile

### How to fix

**Step 1**: Add focus-visible outlines:
```css
.primary:focus-visible,
.secondary:focus-visible,
.icon-btn:focus-visible {
  outline: 2px solid #c97e55;
  outline-offset: 2px;
}
```

**Step 2**: Improve hover states with subtle lift:
```css
.primary:hover:not(:disabled) {
  background: #1f3129;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(31, 49, 41, 0.2);
}

.secondary:hover:not(:disabled) {
  background: #eae8de;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(31, 49, 41, 0.08);
}
```

**Step 3**: Improve the pressed state:
```css
.primary:active:not(:disabled) {
  transform: translateY(0px);
  box-shadow: none;
  background: #172a21;
}
```

**Step 4**: Add tooltip text for disabled buttons where context matters. In the JSX, when a button is disabled, add a `title` attribute:
```tsx
<button
  disabled={!canBuild}
  title={canBuild ? undefined : buildReason}  // buildReason already exists in the code
  onClick={...}
>
  + Build House
</button>
```

The `buildReason` variable already exists in `App.tsx` with specific messages like "Own the complete color set to build", "Build evenly across the color set", "Not enough cash" — just surface it as a `title`.

---

## 6. P1 — Color System: Ownership & Set Visibility

### What's wrong
Ownership is indicated by:
1. A tiny 7px colored dot in the top-right corner of the tile (`.owner-dots`)
2. A faint `color-mix(in srgb, var(--owner-color) 8%, ...)` background tint
3. A `color-mix(in srgb, var(--owner-color) 42%, transparent)` inset border

The 8% tint is nearly invisible. On a cream background, 8% of `#db674e` (Player 1's red-orange) produces a color that's indistinguishable from the base cream. Colorblind users can't distinguish ownership at all.

### How to fix

**Step 1**: Increase the ownership tint from 8% to 14%:
```css
.tile.owned {
  background: color-mix(in srgb, var(--owner-color) 14%, color-mix(in srgb, var(--set-color) 9%, #faf8f1));
}
```

**Step 2**: Increase the inset border from 42% to 55%:
```css
.tile.owned {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--owner-color) 55%, transparent),
              inset -1px 0 #716e63, inset 0 -1px #716e63;
}
```

**Step 3**: Make the owner dot larger and add the player's initial:
In `App.tsx`, the owner-dots element is currently:
```tsx
<span className="owner-dots" title={`Owned by ${owners[0].name}...`} />
```

Replace with an SVG that shows the initial:
```tsx
{owners.length > 0 && (
  <span className="owner-dot" style={{ background: owners[0].color }} title={`Owned by ${owners[0].name}`}>
    {owners[0].name.charAt(0).toUpperCase()}
  </span>
)}
```

```css
.owner-dot {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid #faf8f1;
  z-index: 5;
  display: grid;
  place-items: center;
  font: 600 7px/1 'DM Sans', sans-serif;
  color: white;
  text-shadow: 0 0 2px rgba(0,0,0,0.3);
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}
```

**Step 4**: For colorblind accessibility, add a subtle pattern overlay to owned tiles (optional but recommended):
```css
.tile.owned::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    45deg,
    transparent 0 6px,
    color-mix(in srgb, var(--owner-color) 8%, transparent) 6px 7px
  );
  pointer-events: none;
  z-index: 1;
}
```

---

## 7. P1 — Typography Hierarchy Cleanup

### What's wrong
The typography has good bones (Playfair for display, DM Sans for body, DM Mono for data) but the size hierarchy is inconsistent:

- The hub logo says `font: 700 clamp(15px, 2.1vw, 28px) 'Playfair Display'` — at 15px it's barely visible
- Eyebrow text is `font-size: 9px` everywhere — too small and no variation
- The lobby hero `h1` is `clamp(60px, 7vw, 98px)` — this is good
- The `.hub-message` is `clamp(8px, 0.8vw, 11px)` — the primary game feedback at 8px is too small
- Currency amounts in player cards are `font: 500 11px 'DM Mono'` — could be slightly larger as it's the most-glanced-at number

### How to fix

**Step 1**: Establish a type scale and apply it consistently. Here's the target:

| Role | Font | Size | Weight |
|------|------|------|--------|
| Hero heading (lobby) | Playfair Display | `clamp(56px, 7vw, 96px)` | 700 |
| Section heading (modals) | Playfair Display | `clamp(22px, 3vw, 28px)` | 600 |
| Hub logo | Playfair Display | `clamp(18px, 2.2vw, 30px)` | 700 |
| Tile name (property) | Playfair Display | `clamp(9px, 0.75vw, 11px)` | 600 |
| Hub message (game feedback) | DM Sans | `clamp(10px, 0.85vw, 12px)` | 500 |
| Eyebrow label | DM Mono | `9px` | 500 |
| Currency (player card) | DM Mono | `12px` | 500 |
| Currency (hub/large) | DM Mono | `14px` | 500 |
| Log entries | DM Mono | `9px` | 400 |
| Small labels | DM Mono | `8px` | 400 |
| Minimum readable text | Any | `7px` | — |

**Step 2**: Apply these sizes. Key CSS changes:

```css
/* Hub logo — increase minimum */
.hub-logo b {
  font: 700 clamp(18px, 2.2vw, 30px) 'Playfair Display', Georgia, serif;
}

/* Hub message — the main game feedback text needs to be readable */
.hub-message {
  font-size: clamp(10px, 0.85vw, 12px);
  font-weight: 500;
  color: #4a5a4e; /* Slightly darker for readability */
}

/* Player money in sidebar cards */
.player-money {
  font: 500 12px 'DM Mono', monospace;
}

/* Eyebrow — keep at 9px but ensure letter-spacing is consistent */
.eyebrow {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: #748077;
}
```

**Step 3**: Make the turn banner text slightly larger so it's clear at a glance whose turn it is:
```css
.turn-banner {
  font-size: clamp(10px, 0.9vw, 12px);
  font-weight: 600;
  height: 30px;
  padding: 0 16px;
}
```

---

## 8. P2 — Hub Center: Breathing Room & Visual Hierarchy

### What's wrong
The hub (center of the board) crams the logo, turn banner, dice, message, action buttons, rules strip, and log into a tight space. On smaller screens, elements touch and overlap. The log takes a fixed `105px` height which steals space from the interactive elements.

### How to fix

**Step 1**: Reduce log to 3 visible entries instead of 5, and decrease its height:
```css
.hub-log {
  height: 80px;
  min-height: 80px;
  max-height: 80px;
}
.log-lines {
  height: 65px;
  max-height: 65px;
}
```

In `App.tsx`, change `game.log.slice(0, 5)` to `game.log.slice(0, 3)` for the visible log entries.

**Step 2**: Add spacing between hub sections:
```css
.hub {
  padding: 3% 5% 0;
  gap: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.dice-tray {
  margin: 4px 0 2px;
}

.hub-actions {
  margin: 4px 0;
  min-height: 36px; /* Reserve space so layout doesn't jump when buttons appear/disappear */
}
```

**Step 3**: Make the rules strip slimmer:
```css
.rules-strip {
  height: 20px;
  font-size: clamp(6px, 0.5vw, 7px);
}
```

---

## 9. P2 — Player Cards: Information Density Fix

### What's wrong
Each player card shows: avatar initial, name, status label, cash, asset count, jail/loan badges, net worth, and a "Leave" button. On mobile this is too much. The card heights vary unpredictably based on badge count.

### How to fix

**Step 1**: Set a consistent card height:
```css
.player-card {
  min-height: 72px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
```

**Step 2**: Move net worth into a tooltip on hover rather than always showing it:
```css
.worth {
  max-height: 0;
  overflow: hidden;
  transition: max-height 200ms ease;
  border: 0;
  padding: 0;
  margin: 0;
}

.player-card:hover .worth,
.player-card.active .worth {
  max-height: 30px;
  border-top: 1px solid #eaebe3;
  margin-top: 5px;
  padding-top: 5px;
}
```

**Step 3**: Make the "Leave / bankrupt" button less prominent — it currently looks like a regular action button:
```css
.player-leave {
  opacity: 0;
  transition: opacity 200ms;
}
.player-card:hover .player-leave {
  opacity: 1;
}
```

---

## 10. P2 — Deed Card (Title Deed Modal) Polish

### What's wrong
The deed card popup is functional but has some visual issues:
- The rent table has dotted leader lines (`.rent-table td:first-child:after`) that use `position: absolute` and can clip or overlap on narrow viewports
- The building row icons (houses/hotel) use Lucide icons which look like UI elements, not game pieces
- The "MORTGAGED" status text is a plain label, not visually distinct

### How to fix

**Step 1**: Replace the dotted leaders with a simpler border approach:
```css
/* Remove the pseudo-element leaders */
.rent-table td:first-child:after { display: none; }

/* Add subtle row striping instead */
.rent-table tr:nth-child(even) td {
  background: rgba(0, 0, 0, 0.02);
}
```

**Step 2**: Style the mortgage status prominently:
```css
.deed-status {
  display: inline-block;
  margin-top: 7px;
  padding: 4px 8px;
  font: 600 7px 'DM Mono', monospace;
  letter-spacing: 0.1em;
}

/* Mortgaged state: red-ish warning */
.deed-status.mortgaged {
  background: #f4e0d8;
  border-color: #c8907a;
  color: #9e4a35;
}

/* Full set state: green success */
.deed-status.full-set {
  background: #dbeede;
  border-color: #8ab890;
  color: #2d6e3a;
}
```

This requires adding the class conditionally in `App.tsx` — where the deed status is rendered, add class names based on the status text.

**Step 3**: Increase the building row icon size for visibility:
```css
.building-row svg {
  width: 20px;
  height: 20px;
}

.building-row span {
  width: 30px;
  height: 26px;
}
```

---

## 11. P2 — Lobby Page Visual Polish

### What's wrong
The lobby is the strongest visual part of the app — the split layout with the board mockup on the right is a good idea. Issues:
- The `.art-board` (miniature board preview) uses hardcoded grid positions (`at0` through `at11`) which only place 12 tiles and leave the rest of the grid empty
- The lobby right panel (`lobby-art`) has two decorative circles (`:before`, `:after`) that use `vw` units for size, which can overflow on ultra-wide displays
- The room controls section looks cramped and has inconsistent spacing

### How to fix

**Step 1**: Cap the decorative circles:
```css
.lobby-art:before {
  width: min(90vw, 800px);
  height: min(90vw, 800px);
}
.lobby-art:after {
  width: min(65vw, 600px);
  height: min(65vw, 600px);
}
```

**Step 2**: Add spacing to room controls:
```css
.room-controls {
  margin-top: 20px;
  padding: 16px 0;
  gap: 10px;
}

.room-controls > div {
  gap: 6px;
}

.room-controls button {
  padding: 9px 14px;
  font-size: 10px;
  font-weight: 600;
}
```

**Step 3**: Make the room status area more prominent when a room is active:
```css
.room-status {
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #c8cfbe;
  background: #e8ebe2;
  border-radius: 2px;
}
```

---

## 12. P3 — Scrollbar Styling

### What's wrong
The log panel (`.log-lines`), asset list (`.asset-list`), rules grid (`.rules-grid`), and player list (`.player-list`) all have `overflow: auto` but use the default browser scrollbar, which looks jarring against the heritage aesthetic.

### How to fix

```css
/* Thin, themed scrollbar for all scrollable areas */
.log-lines,
.asset-list,
.player-list,
.rules-grid,
.card-reference-grid ol,
.room-lobby-body,
.setup-body,
.trade-sides section {
  scrollbar-width: thin;
  scrollbar-color: #b5b8a8 transparent;
}

/* WebKit browsers */
.log-lines::-webkit-scrollbar,
.asset-list::-webkit-scrollbar,
.player-list::-webkit-scrollbar,
.rules-grid::-webkit-scrollbar {
  width: 5px;
}

.log-lines::-webkit-scrollbar-thumb,
.asset-list::-webkit-scrollbar-thumb,
.player-list::-webkit-scrollbar-thumb,
.rules-grid::-webkit-scrollbar-thumb {
  background: #b5b8a8;
  border-radius: 3px;
}

.log-lines::-webkit-scrollbar-track,
.asset-list::-webkit-scrollbar-track,
.player-list::-webkit-scrollbar-track,
.rules-grid::-webkit-scrollbar-track {
  background: transparent;
}
```

---

## 13. P3 — Favicon and Meta Tags

### What's wrong
`index.html` has no favicon, no Open Graph meta tags, and no description meta tag. If someone shares the URL on WhatsApp/Discord/Twitter, it shows a blank preview with no image or description.

### How to fix

**Step 1**: Create a simple favicon. Generate an SVG favicon that uses the ₹ symbol in the brand circle:
```html
<!-- In <head> of index.html -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='46' fill='%23344139' stroke='%23d98558' stroke-width='3'/><text x='50' y='68' text-anchor='middle' font-size='52' font-family='Georgia,serif' fill='%23d98558'>₹</text></svg>">
```

**Step 2**: Add meta tags:
```html
<meta name="description" content="Business India Edition — a classic property trading board game for 2–6 players. Play online from your own devices.">
<meta property="og:title" content="Business — India Edition">
<meta property="og:description" content="Create a room, invite your friends, and build a property empire. 2–6 players, no accounts needed.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
```

**Step 3**: Add `apple-mobile-web-app-capable` for better PWA behavior:
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

---

## 14. P3 — Print Stylesheet

### What's wrong
If someone tries to print the game state (e.g., for a record), they get an unusable mess.

### How to fix

Add a print media query at the end of `style.css`:
```css
@media print {
  .sidebar, .hub-actions, .board-caption, .side-controls,
  .reconnect-banner, .trade-notice, .place-overlay, .drawer-back {
    display: none !important;
  }

  .game-shell, .play-layout {
    height: auto;
    overflow: visible;
  }

  .board {
    width: 100%;
    height: auto;
    page-break-inside: avoid;
  }

  .hub-log {
    max-height: none;
    height: auto;
  }

  .log-lines {
    max-height: none;
    overflow: visible;
  }
}
```

---

## 15. P3 — Dark Mode Foundation

### What's wrong
No dark mode support. Many users (especially gamers) prefer dark mode. The current palette is entirely light.

### How to fix

**Step 1**: Define CSS custom properties for the palette. At the top of `style.css`, wrap the existing colors in custom properties:
```css
:root {
  --bg-primary: #f4f1e9;
  --bg-secondary: #faf8f1;
  --bg-board: #dedfd5;
  --bg-hub: #e8e9dc;
  --bg-card: #fbfaf4;
  --bg-overlay: rgba(25, 39, 31, 0.6);

  --text-primary: #222b28;
  --text-secondary: #69756f;
  --text-muted: #879188;

  --border-primary: #d1d6cb;
  --border-dark: #716e63;

  --accent-green: #31443a;
  --accent-terracotta: #cd7953;
  --accent-gold: #c9a227;

  --btn-primary-bg: #31443a;
  --btn-primary-text: #ffffff;
}
```

**Step 2**: Add a dark mode variant:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a2420;
    --bg-secondary: #232e28;
    --bg-board: #2a3530;
    --bg-hub: #1e2a24;
    --bg-card: #263029;
    --bg-overlay: rgba(10, 18, 14, 0.75);

    --text-primary: #e2e5df;
    --text-secondary: #a3afa6;
    --text-muted: #728072;

    --border-primary: #3d4a42;
    --border-dark: #4a5548;

    --accent-green: #5a7d68;
    --accent-terracotta: #d9926e;
    --accent-gold: #d4b44a;

    --btn-primary-bg: #4a6d55;
    --btn-primary-text: #f0f2ed;
  }
}
```

**Step 3**: Replace hardcoded color values throughout `style.css` with the CSS variables. This is a large find-and-replace task — start with the most visible elements (backgrounds, text, borders) and work outward.

> **Note**: This is a foundation step. Full dark mode conversion will take multiple passes. The priority is to set up the variable system so future color changes only need to update the `:root` values.

---

## ORDER OF IMPLEMENTATION

1. **Fix font imports** (Section 1) — 2 minutes, eliminates the single biggest visual bug
2. **Legibility: tile text sizing** (Section 2) — small CSS changes, huge readability improvement
3. **Unify design language** (Section 4) — replace brutal shadows with soft ones
4. **Typography hierarchy** (Section 7) — establish consistent sizing
5. **Button polish** (Section 5) — focus states, hover improvements
6. **Color system: ownership** (Section 6) — make ownership visible
7. **Hub breathing room** (Section 8) — declutter the center
8. **Mobile layout** (Section 3) — fix the mobile experience
9. **Deed card polish** (Section 10) — modal cleanup
10. **Player cards** (Section 9) — information density
11. **Lobby polish** (Section 11) — landing page improvements
12. **Scrollbars** (Section 12) — visual consistency
13. **Favicon & meta** (Section 13) — sharing and identity
14. **Print stylesheet** (Section 14) — nice-to-have
15. **Dark mode foundation** (Section 15) — future-proofing
