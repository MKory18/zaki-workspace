# Mobile and Chat Responsive Design

## Intent

Make the existing Zaki Workspace shell and chat screens feel consistent and usable on phones without rebuilding the UI or changing server behavior, permissions, routes, or chat actions.

## Goals

- Keep the current RTL layout, theme tokens, safe-area handling, and bottom navigation.
- Prevent horizontal overflow and accidental nested scrolling on narrow screens.
- Give the chat header, message list, attachments, and composer predictable space on phones.
- Preserve comfortable touch targets (at least 44px) and readable message content.
- Keep desktop behavior unchanged except where a shared responsive class improves both layouts.

## Non-goals

- No API, database, authorization, or message behavior changes.
- No new UI framework or dependency.
- No visual redesign of every application page.
- No replacement of the existing chat components or navigation model.

## Approaches considered

1. **Focused responsive pass (selected):** adjust existing shell and chat components with mobile-first utility classes, add targeted render/source tests, and verify at phone and desktop widths. Lowest risk and matches the existing responsive architecture.
2. **Whole-application responsive audit:** review every page and table in one change. Broader, but too large to verify safely and likely to mix unrelated layout changes.
3. **Chat-only visual redesign:** make chat resemble a separate messaging app with a new fixed composer and navigation. More visual change, but higher risk of breaking the current shell and scroll/read behavior.

## Design

### Shell

- Keep the desktop sidebar and mobile bottom navigation split at the existing `md` breakpoint.
- Make the mobile top bar actions fit without squeezing the space name or search control.
- Preserve top/bottom safe-area padding and ensure the page content ends above the fixed bottom navigation.
- Avoid introducing a second page-level horizontal scroll container.

### Chat home

- Keep the existing cards, topic sections, DM list, and action controls.
- Use mobile-safe wrapping and full-width controls where text currently competes for one row.
- Keep desktop max width and spacing.

### Conversation

- Make the conversation page consume the available shell height on phones.
- Keep one scrollable message log; keep the header and composer outside that log.
- Reduce phone-only horizontal padding while retaining readable gaps.
- Make long names, previews, links, and attachment names wrap or truncate instead of widening the viewport.
- Keep message bubbles capped on desktop and phone, with phone-specific width/padding tuned for narrow screens.
- Keep pinned/search/new-message controls within the available width.

### Composer and attachments

- Keep the existing attach, voice, send, edit, reply, upload-progress, and mention behavior.
- Make the input row shrink safely: the textarea may use remaining width, while action buttons remain fixed touch targets.
- Make attachment previews scroll or wrap cleanly on narrow screens and keep remove/progress controls usable.
- Add safe-area bottom spacing only at the conversation footer where needed, without double-padding the shell.

## Verification

- Add/extend source/render tests for mobile shell and conversation classes, overflow prevention, safe-area placement, and touch-target classes.
- Run focused chat and shell tests, typecheck, lint, build, and the existing unit suite.
- Run the local app in a real browser at narrow phone and desktop widths; inspect chat home, a conversation, long messages, attachments, reply/edit states, and bottom navigation.
- Record any unrelated existing test failures separately; do not change behavior outside this scope.

## Builder decisions

- Use existing Tailwind utilities and `globals.css`; no dependency additions.
- Prefer logical properties (`start/end`, `ps/pe`, `ms/me`) and existing theme tokens.
- Keep changes in a separate branch and in small commits, with one behavior-preserving responsive slice per commit.
