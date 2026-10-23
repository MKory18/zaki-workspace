import { describe, expect, it } from "vitest";
import { restoreFocus, rememberFocus, type CloseEvent, type Focusable } from "@/lib/focus-return";

function element(connected = true): Focusable & { focused: number } {
  const el = {
    focused: 0,
    isConnected: connected,
    focus() {
      el.focused += 1;
    },
  };
  return el;
}

function closeEvent(prevented = false): CloseEvent & { prevented: boolean } {
  const event = {
    prevented,
    get defaultPrevented() {
      return event.prevented;
    },
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

describe("rememberFocus: who had focus when the dialog opened", () => {
  it("remembers the focused element (the button that opened the dialog)", () => {
    const button = element();
    expect(rememberFocus({ activeElement: button, body: {} })).toBe(button);
  });

  it("remembers nothing when the page itself had focus: there is nothing to go back to", () => {
    const body = element();
    expect(rememberFocus({ activeElement: body, body })).toBeNull();
    expect(rememberFocus({ activeElement: null, body })).toBeNull();
    expect(rememberFocus({ activeElement: undefined, body })).toBeNull();
  });

  it("remembers nothing on the server (there is no document) or when the active thing cannot take focus", () => {
    expect(rememberFocus(null)).toBeNull();
    expect(rememberFocus(undefined)).toBeNull();
    expect(rememberFocus({ activeElement: { tagName: "svg" }, body: {} })).toBeNull();
  });
});

describe("restoreFocus: giving it back when the dialog closes", () => {
  it("focuses the opener and tells Radix not to also try its own thing", () => {
    const opener = element();
    const event = closeEvent();
    expect(restoreFocus(opener, event)).toBe(true);
    expect(opener.focused).toBe(1);
    expect(event.prevented).toBe(true);
  });

  it("does nothing when the caller already handled the event (the caller decides where focus goes)", () => {
    const opener = element();
    expect(restoreFocus(opener, closeEvent(true))).toBe(false);
    expect(opener.focused).toBe(0);
  });

  it("does nothing, and leaves Radix's default (its own Trigger) alone, when nothing was remembered", () => {
    const event = closeEvent();
    expect(restoreFocus(null, event)).toBe(false);
    expect(event.prevented).toBe(false);
  });

  it("does not focus an opener that has left the page (a menu item that closed with its menu)", () => {
    const gone = element(false);
    const event = closeEvent();
    expect(restoreFocus(gone, event)).toBe(false);
    expect(gone.focused).toBe(0);
    expect(event.prevented).toBe(false);
  });
});
