# Concord visual implementation review

Date: 2026-08-31

**final result: passed against the supplied written design; Pencil comparison remains unavailable.** The voice and ephemeral-chat interface uses the existing dark/yellow Concord system and preserves the stage as the primary surface. This is not a claim of pixel fidelity to `design.pen` because no Pencil tool is exposed in this session.

## Implemented

- Centralized the specified dark/yellow tokens, locally hosted Geist/Geist Mono, 8/16/24px spacing, restrained borders, and reduced-motion styling.
- Open, asymmetrical welcome composition with primary create/invite action and a separate join-code area. Reserved feedback space prevents loading/error messages from moving the desktop form.
- Compact room bar, stable-width copy feedback, narrow participant rail, and a dominant media stage. Narrow layouts retain connection labels, participant names, leave/copy/share actions, and scrollable media.
- Source thumbnails with explicit selected labels, visible keyboard focus, quality radios, named audio control, and grouped footer actions. Desktop options remain visible while sources scroll; small or short windows scroll the dialog body.
- Compact media metadata outside video content, discoverable focus controls, readable audio/local/connection states, and non-overlapping error/notice banners.
- Dialog focus entry, Tab wrapping, Escape/backdrop dismissal, focus restoration, and an inert room behind the modal.
- A compact five-action call bar for microphone, room audio, screen, chat and leave, with icons, text labels, tooltips, pressed states and visible keyboard focus.
- Voice availability and speaking states in the participant list. Permission guidance stays secondary and never blocks screen sharing or chat.
- A 320px ephemeral chat drawer on wide screens and a full overlay below the room bar on narrow screens. Chat content is plain text, scrolls independently and keeps the stage geometry stable.

## Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed, renderer and Electron types plus token server |
| `pnpm test` | Passed: 28 desktop tests and 31 token-server tests |
| `pnpm lint` | Passed, zero warnings |
| `pnpm build:web` | Passed, both font files bundled |
| `git diff --check` | Passed |
| UTF-8 | Changed text files decode strictly; no replacement characters |
| Electron package | Passed with Electron Forge for Windows x64 |

Browser inspection used an isolated Chromium tab. The final voice/chat room was inspected at wide and narrow viewports with two participants, all five controls, the closed chat unread affordance and the open chat panel.

The current room passed an explicit page-overflow check at the narrow viewport. Participant names remained readable in the horizontal strip and all five call actions remained present. The chat overlay preserved the room bar and used the remaining viewport height.

Interaction checks covered room entry, opening and closing chat, focus restoration and responsive reflow. Network and participant presence were simulated in browser memory only; real Vue handlers and router were exercised. No fixtures or test routes were added to the application.

The synthetic stream reached `ended` after stop. No browser console errors or warnings were present on the clean final page. Sample contrast ratios: muted text on surface 5.40:1, on raised surface 4.99:1, on selected surface 4.56:1; primary button text 10.53:1. Reduced-motion rules were checked in source, not through OS preference emulation.

## Remaining gaps

- `design.pen` was neither parsed nor modified. Brand Foundations and Component Library could not be inspected or compared because no Pencil tool is exposed in this session.
- `ConcordBrand.vue` currently renders only the wordmark. The old text C and purple favicon were removed; the selected SVG mark and matching favicon are pending. The required 24/32/48px mark inspection is therefore also pending.
- Native Electron microphone permission, browser OS capture permissions, actual system audio and live remote SFU voice/DataChannel transmission need a runtime check. The project has no configured Cloudflare credentials in this workspace, so the required web ↔ web, Electron ↔ web and multi-participant live checks could not be run. Synthetic UI verification and service tests do not replace them.

Provide Pencil access or exports of Brand Foundations, Component Library, and the selected SVG to finish the reference comparison and brand asset integration.
