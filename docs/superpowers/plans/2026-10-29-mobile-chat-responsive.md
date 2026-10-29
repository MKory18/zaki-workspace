# Mobile and Chat Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the existing shell and chat UI on narrow screens without changing routes, permissions, APIs, or chat behavior.

**Architecture:** Keep the existing mobile/desktop split, bottom navigation, conversation scroll logic, and Tailwind/theme-token styling. Apply narrow, component-local responsive class changes to the shell, chat home, conversation header/screen, message bubbles, and composer; add source/render tests that pin the responsive contract.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict, Tailwind utilities, Vitest, existing browser testing workflow.

**Spec:** `docs/superpowers/specs/2026-10-29-mobile-chat-responsive-design.md`

## Status (2026-10-29)

Shipped on `feature/mobile-chat-responsive` in one slice instead of five commits, because the
whole change is class-only and one test file proves it (`tests/mobile-chat-responsive.test.ts`):

- `top-bar.tsx`: two rows on a phone (the space's name folds away below 380px), tighter gaps.
- `chat-home.tsx` / `space-topics.tsx`: `p-3` phone gutter that steps to `p-4`, `min-w-0`.
- `conversation-screen.tsx`: log gutter `px-2.5 py-3 md:p-3`, one scroll area kept.
- `message-item.tsx`: my bubbles start at the left of an RTL log, the others at the right
  (`flex-row-reverse` / `flex-row`), accent tint on mine, `min-w-0 break-words` so a long URL
  stays inside the bubble.
- `chat-composer.tsx`: `min-w-0` row and textarea, `gap-1.5 sm:gap-2`, 44px buttons kept.

`app-shell.tsx` and `bottom-nav.tsx` needed no change: the runtime check showed the bottom
navigation and the composer already clear each other at 360/375/390.

## Global Constraints

- Preserve current API, database, authorization, and message behavior.
- Use existing components, Tailwind utilities, logical RTL properties, and theme tokens.
- Add no dependency and no new color/font asset.
- Keep touch targets at least 44px where controls are interactive.
- No horizontal overflow or second page-level scroll container on phones.
- Every behavior-visible change gets a failing test before implementation.

## Review Focus

- A 320px-wide phone with a long space/conversation name must not create horizontal overflow; test shell and conversation classes for truncation and bounded width.
- The fixed bottom navigation plus safe-area inset must not cover the composer or last message; test shell/footer spacing classes.
- A long Arabic/Latin URL or attachment name must stay inside the message bubble; test message wrapping classes.
- Multiple attachments and the composer action row must remain usable on a narrow phone; test wrapping/overflow classes and fixed touch targets.
- Desktop layout must retain the current sidebar and conversation controls; test responsive classes preserve `md` behavior.

---

### Task 1: Mobile shell spacing and top navigation

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/shell/top-bar.tsx`
- Modify: `src/components/shell/bottom-nav.tsx`
- Test: `tests/shell-responsive.test.ts` (create)

**Interfaces:**
- Consumes: existing `AppShell`, `TopBar`, and `BottomNav` props.
- Produces: mobile shell classes that keep content above bottom navigation, keep safe-area padding, and prevent top-bar action overflow.

- [ ] **Step 1: Write failing render/source tests**
  - Render `AppShell` with existing test fixtures or inspect the three component sources.
  - Assert mobile content retains bottom safe-area spacing, top bar uses a bounded/truncating mobile space label, and bottom-nav links have the existing 44px+ target.
  - Assert the desktop `md` sidebar/top-bar behavior remains present.
- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/shell-responsive.test.ts --reporter=dot`

  Expected: FAIL on at least one new responsive assertion.
- [ ] **Step 3: Implement the smallest shell-only responsive adjustment**
  - Keep the current breakpoint and safe-area model.
  - Add only classes needed for min-width/overflow/truncation, action-row wrapping, and footer clearance.
  - Do not change navigation labels, links, or state.
- [ ] **Step 4: Run the focused test and verify it passes**
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/app-shell.tsx src/components/shell/top-bar.tsx src/components/shell/bottom-nav.tsx tests/shell-responsive.test.ts
  git commit -m "fix(ui): stabilize mobile shell layout"
  ```

### Task 2: Chat home mobile cards and lists

**Files:**
- Modify: `src/components/chat/home/chat-home.tsx`
- Modify: `src/components/chat/home/space-topics.tsx`
- Test: `tests/chat-home-responsive.test.ts` (create)

**Interfaces:**
- Consumes: existing `HomeDto`, guest/oversight behavior, and row-menu components.
- Produces: chat-home layout where headings, scope controls, topic rows, DMs, and action buttons wrap without widening the viewport.

- [ ] **Step 1: Write failing render/source tests**
  - Assert the chat home root has narrow-screen horizontal safety (`min-w-0`/bounded width), controls can wrap, and list links can shrink/truncate.
  - Assert existing chat labels and action links remain rendered.
- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/chat-home-responsive.test.ts --reporter=dot`
- [ ] **Step 3: Implement mobile-safe classes only**
  - Preserve card structure, API calls, menus, and permissions.
  - Use logical spacing and `min-w-0`, wrapping, and full-width mobile action treatment where needed.
- [ ] **Step 4: Run the focused test and verify it passes**
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/chat/home/chat-home.tsx src/components/chat/home/space-topics.tsx tests/chat-home-responsive.test.ts
  git commit -m "fix(chat): make conversation lists fit phones"
  ```

### Task 3: Conversation frame and message bubbles

**Files:**
- Modify: `src/components/chat/conversation/conversation-page-client.tsx`
- Modify: `src/components/chat/conversation/conversation-screen.tsx`
- Modify: `src/components/chat/conversation/conversation-header.tsx`
- Modify: `src/components/chat/message/message-item.tsx`
- Test: `tests/chat-responsive.test.ts` (create or extend existing chat render tests)

**Interfaces:**
- Consumes: current conversation fetch/realtime/read/scroll logic and `MessageItem` props.
- Produces: a phone conversation with one message scroll area, a bounded header, and bubbles that wrap long content without changing message actions.

- [ ] **Step 1: Write failing render/source tests**
  - Assert the conversation page remains `h-full min-h-0` and its frame has `min-w-0`.
  - Assert the message log is the only flex-growing overflow container and has narrow-screen-safe padding.
  - Assert header title/subtitle and message content use truncation/wrapping classes; assert desktop controls retain `md` visibility.
- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/chat-responsive.test.ts --reporter=dot`
- [ ] **Step 3: Implement the frame/header/bubble adjustments**
  - Preserve `ConversationScreen` state, scroll positioning, live refresh, read receipts, menus, and permissions.
  - Keep the pinned bar, search state, new-message button, and footer inside the available width.
  - Use logical classes and existing tokens; do not add a second scroll context.
- [ ] **Step 4: Run the focused test and verify it passes**
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/chat/conversation src/components/chat/message/message-item.tsx tests/chat-responsive.test.ts
  git commit -m "fix(chat): contain conversation layout on mobile"
  ```

### Task 4: Composer, attachments, and final runtime verification

**Files:**
- Modify: `src/components/chat/composer/chat-composer.tsx`
- Modify: `src/components/chat/conversation/conversation-screen.tsx` if footer-only classes are needed
- Test: `tests/chat-composer-responsive.test.ts` (create or extend `tests/chat-conversation-composer.test.ts`)

**Interfaces:**
- Consumes: current composer upload, voice, mention, reply, edit, and progress behavior.
- Produces: a composer whose input shrinks safely, controls remain touchable, and attachment previews wrap/scroll without overflow.

- [ ] **Step 1: Write failing render/source tests**
  - Assert the composer form and action row have `min-w-0`/safe flex behavior.
  - Assert textarea remains at least 44px high and action buttons retain 44px dimensions.
  - Assert attachments wrap or use bounded overflow and preserve progress/remove controls.
  - Assert recording/review controls retain their mobile-safe layout.
- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npx vitest run tests/chat-composer-responsive.test.ts --reporter=dot`
- [ ] **Step 3: Implement composer-only responsive classes**
  - Preserve all submit/upload/voice state transitions and existing Arabic strings.
  - Keep the shell responsible for global bottom-nav clearance; add only local footer safe-area spacing if runtime inspection proves it necessary.
- [ ] **Step 4: Run focused tests and full relevant checks**

  Run:
  - `npx vitest run tests/shell-responsive.test.ts tests/chat-home-responsive.test.ts tests/chat-responsive.test.ts tests/chat-composer-responsive.test.ts tests/chat-conversation-core.test.ts tests/chat-conversation-detail.test.ts tests/chat-conversation-message-item.test.ts --reporter=dot`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- [ ] **Step 5: Verify in a real browser**
  - Open the running app at a narrow phone viewport and a desktop viewport.
  - Inspect `/chat`, a conversation, long messages, attachments, reply/edit states, and bottom navigation.
  - Confirm no horizontal overflow, no covered composer, and no broken controls.
- [ ] **Step 6: Review diff and commit**

  ```bash
  git diff --check
  git status --short
  git add src/components/chat/composer/chat-composer.tsx src/components/chat/conversation/conversation-screen.tsx tests/chat-composer-responsive.test.ts
  git commit -m "fix(chat): make composer and attachments responsive"
  ```

### Task 5: Whole-branch verification and handoff

**Files:**
- No intended source changes.

- [ ] **Step 1: Run repository gates**
  - `npm test -- --reporter=dot`
  - `node scripts/lint-migrations.mjs`
  - `npm run scan:secrets`
  - `git diff --check`
- [ ] **Step 2: Separate unrelated baseline failures from this change**
  - Do not weaken tests or alter unrelated behavior to force green.
  - Record exact failing tests and their relation to this branch.
- [ ] **Step 3: Request independent review of the final diff**
- [ ] **Step 4: Report changed files, commits, browser verification, and any ⚠️/🔧 items**
