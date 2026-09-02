# Concord Design System

This document describes the design that Concord uses today. It is a durable design-to-code contract, not a backlog of speculative visual ideas.

## Sources of truth

Use these sources in this order:

1. `design.pen` defines brand foundations, visual direction, reusable component intent, and logo explorations.
2. `apps/desktop/src/renderer/styles.css` defines the shipped layout, responsive behavior, and contextual component adaptations.
3. Vue components define product behavior, state, accessibility semantics, and final UI copy.

When they appear to differ, preserve the visual intent from `design.pen` and use the CSS behavior appropriate to the actual viewport. Update this guide only for enduring rules.

## Product character

Concord is a private screen-sharing room for small groups. It should feel like a quiet, focused control room: social enough for conversation, restrained enough to keep shared content dominant.

The brand promise is:

> A private room to show your screen and stay in the conversation.

The voice is **calm, direct, private, and clear**. Copy should be short, specific, and reassuring. Avoid marketing language, gamer slang, and inflated claims.

### Identity principles

- **One signal color:** citrine marks primary action, focus, selection, and live or transitional states.
- **Stage first:** shared video owns the dominant region of the room.
- **Useful softness:** corners feel human but never bubbly.
- **No gamer costume:** no mascot, neon purple, decorative chrome, or visual imitation of Discord.

The interface should be matte, technical, and quiet. Decoration must support hierarchy or state; it must not compete with the shared screen.

## Foundations

### Color

Concord is dark by default. There is no light-theme specification.

| Role | Token | Value | Usage |
|---|---|---:|---|
| Canvas | `--bg` | `#0B0D10` | App background, video stage, inputs |
| Surface | `--surface` | `#12151A` | Sidebars, top bar, panels |
| Raised surface | `--surface-raised` | `#191D24` | Secondary controls, elevated regions |
| Soft surface | `--surface-soft` | `#20252E` | Hover and disabled states |
| Border | `--border` | `#2B313C` | Default separators and outlines |
| Strong border | `--border-strong` | `#3A424F` | Emphasis and hover outlines |
| Primary text | `--text` | `#F7F7F4` | Headings and important labels |
| Secondary text | `--text-soft` | `#C3C7CE` | Body copy and secondary controls |
| Muted text | `--text-muted` | `#858C98` | Metadata and technical labels |
| Signal | `--accent` | `#F4C84A` | Primary actions, focus, selection, live state |
| Signal hover | `--accent-strong` | `#DFAF16` | Primary hover |
| Signal ink | `--accent-ink` | `#241D08` | Text and icons on citrine |
| Signal surface | `--accent-soft` | `#2A2413` | Selected and active backgrounds |
| Success | `--success` | `#55C98A` | Connected and healthy states |
| Danger | `--danger` | `#F06464` | Errors, destructive actions, disconnected state |

Use citrine as a signal, not as decoration. Large yellow areas, ornamental gradients, and persistent glow weaken the hierarchy. Derived danger surfaces and the modal backdrop are calculated in CSS with `color-mix()`.

### Typography

- UI family: **Geist**, with Inter and system UI fallbacks.
- Technical family: **Geist Mono**, with a monospace fallback.
- Geist Mono is reserved for room codes, statuses, timestamps, compact metadata, and uppercase section labels.
- Most UI text is 11–14px. Panel headings are 16–24px. Display text ranges from 32–52px where space permits.
- Typical weights are 500–650. Use weight and color before increasing size.
- Headings use tight negative tracking. Technical labels use positive tracking and may be uppercase.
- The wordmark is 28px in the welcome view and 20px in the compact room header.

Do not introduce another display font without first updating the `.pen` foundations and bundled font assets.

### Spacing, shape, and borders

The base spacing rhythm is 8px:

- Small: 8px
- Medium: 16px
- Large: 24px

The core radii are:

- `--radius-sm: 8px` for controls, tiles, and compact rows
- `--radius-md: 12px` for larger cards and dialogs
- `--radius-lg: 16px` for foundation-level panels

Use 4px only for very small overlays or thumbnail details. Fully rounded shapes are limited to status dots, notification counts, and switches.

Surfaces normally use a one-pixel border instead of a shadow. Shadows are reserved for true overlays, such as the mobile chat panel. Never add glassmorphism, heavy elevation, or ambient purple glow.

### Motion

Interaction transitions are 150ms and limited to color, border, background, and compact state changes. Reconnecting may pulse; loading may spin. Avoid bounce, overshoot, parallax, decorative shimmer, or layout theater.

Honor `prefers-reduced-motion: reduce` by disabling nonessential transitions and animations.

## Brand and logo

The wordmark is **Concord**, set in Geist with a tight, confident lockup. The current application intentionally renders the wordmark only.

`design.pen` contains a primary lockup and three mark explorations—Joystick, Broken Orbit, and Crossed Signal. These are design studies, not interchangeable production assets. Do not redraw them in CSS, inline SVG, or an approximate icon. A mark should enter the application only after one direction is selected and its final asset is exported.

The warm signal color and dark room surfaces must remain consistent across the wordmark, app icon, and any future mark.

## Layout

### Welcome view

The welcome experience is an open two-column composition, not a card floating inside another card.

- Maximum content width: 1120px.
- Desktop columns: approximately `1.35fr / 1fr`.
- The left side carries the product promise and privacy note.
- The right side contains name, room entry, invite context, and the create-room alternative.
- A single vertical rule separates message from action.
- The web footer sits below the main composition and remains visually quiet.

At 800px and below, the columns stack and the divider becomes horizontal. At 540px and below, padding and heading size contract while actions remain easy to reach.

### Room view

The room is a full-viewport application shell:

- Top bar: 56px, with compact brand, room code, and connection state.
- Participant rail: 216px on wide screens.
- Stage: flexible and dominant.
- Chat panel: 320px when open.

The stage has a compact heading, the media canvas, and a bottom control row. Metadata belongs below the image rather than on top of shared content. A single or focused share fills the canvas; multiple shares use a responsive grid with an 8px gap.

At 1100px and below, the participant and chat rails become narrower and call controls hide their secondary labels. At 800px and below, participants become a horizontal strip and chat becomes a right-side overlay. At 540px and below, the top bar wraps, stage padding contracts, and call controls become compact vertical items.

### Source picker

The capture picker is a focused utility, not a decorative modal.

- Maximum size: 960 × 760px within the viewport.
- Structure: header, scrollable source area, options, and confirmation footer.
- Source previews preserve a 16:9 ratio.
- Quality choices distinguish motion (`1080p · 30 FPS`) from sharpness (`1080p · 15 FPS`).
- System audio is a separate switch with contextual help and a warning when voice is active.
- On narrow screens, options stack and footer actions expand to the available width.

## Components and states

### Actions

- **Primary:** citrine background with dark ink; use for the next or principal action.
- **Secondary:** raised dark surface with a neutral border.
- **Danger:** soft dark-red surface, red border emphasis, and red text.
- **Ghost or utility:** transparent until hover; use sparingly.

`design.pen` shows 44px reference buttons and a 44px icon target. The shipped layout may use 40px controls or 32px compact icon buttons where density requires it. Compact controls still need clear focus, an accessible name, and sufficient surrounding space.

### Inputs

Text inputs are at least 44px high, use the canvas background, and have an 8px radius. Hover strengthens the border; keyboard focus uses a two-pixel citrine outline with visible offset. Room codes use Geist Mono and uppercase tracking.

### Participants

A participant row contains an initial avatar, truncated name, human-readable voice or connection state, and a small presence signal. Speaking uses the citrine surface plus an inset signal bar. The `.pen` reference is a spacious 280 × 58px row with a 38px avatar; the room rail intentionally compacts this to a 32px avatar.

### Media

Video sits on the deepest background and uses `object-fit: contain`; never crop shared content for visual drama. Each tile keeps its live state, participant name, audio state, and recovery action in a footer. Focus is an explicit user action and must be reversible.

### Chat

Chat is a secondary room panel, not a competing destination. It communicates that messages are session-only, uses citrine for sender emphasis, and keeps timestamps and counters in Geist Mono. The composer always shows readiness, length, and error state.

### Status language

- Green: connected or healthy.
- Citrine: sharing, joining, reconnecting, selected, or active.
- Red: disconnected, failed, destructive, or invalid.
- Neutral: private, idle, muted, or informational.

Color must never be the only state cue. Pair it with a label, icon, shape, or position.

## Accessibility contract

- Keep keyboard focus visible on every interactive element.
- Preserve semantic buttons, labels, live regions, dialog roles, and state attributes from the Vue components.
- The source picker traps focus, closes with Escape, restores previous focus, and makes the room inert while open.
- Support keyboard navigation and a minimum viewport width of 320px.
- Do not place essential information only in hover states.
- Maintain readable contrast across primary, muted, success, and danger states.
- Test actual keyboard flow, screen-reader announcements, zoom, and color contrast; visual inspection alone is not proof of compliance.

## Design maintenance

When changing the interface:

1. Update `design.pen` first for brand foundations or reusable component intent.
2. Update `styles.css` for shipped layout, responsive behavior, and contextual variants.
3. Update Vue components for semantics, state, behavior, or copy.
4. Update this guide only when the enduring design contract changes.

Before merging a visual change, compare the affected screen against `design.pen` and verify desktop, 1100px, 800px, 540px, reduced-motion, keyboard-focus, empty, loading, error, selected, disabled, and reconnecting states as applicable.
