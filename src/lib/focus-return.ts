/**
 * Giving focus back to whoever had it before a dialog or a sheet opened. Pure (no React, no browser
 * globals: the document is handed in), so it is unit-tested.
 *
 * Why it exists: when a Radix dialog closes it returns focus to its own `Trigger`. A dialog opened from
 * state (a button sets `open`: every `<Modal open …>` call site) has no Trigger, so focus would fall to the
 * page and a keyboard user would start again from the top. The opener is remembered when the panel is first
 * rendered (before anything inside it can take focus, an `autoFocus` field included) and focused on close.
 */

/** What can be given focus again. */
export interface Focusable {
  focus(): void;
  readonly isConnected: boolean;
}

/** The part of the event Radix hands to `onCloseAutoFocus` that matters here. */
export interface CloseEvent {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

function isFocusable(value: unknown): value is Focusable {
  return typeof value === "object" && value !== null && typeof (value as Focusable).focus === "function";
}

/**
 * The element that has focus now, unless it is the page itself (nothing to go back to). `doc` is the
 * `document`, or null on the server.
 */
export function rememberFocus(doc: { activeElement: unknown; body: unknown } | null | undefined): Focusable | null {
  if (!doc) return null;
  const active = doc.activeElement;
  if (!active || active === doc.body || !isFocusable(active)) return null;
  return active;
}

/**
 * Focus the opener on close. Does nothing — and leaves Radix's own behaviour (the Trigger, if there is one)
 * to run — when the caller already handled the event, when nothing was remembered, or when the opener has
 * left the page in the meantime.
 */
export function restoreFocus(opener: Focusable | null, event: CloseEvent): boolean {
  if (event.defaultPrevented) return false;
  if (!opener || !opener.isConnected) return false;
  event.preventDefault();
  opener.focus();
  return true;
}
