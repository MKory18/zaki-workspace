import "./decor.css";
import { decorClass, type DecorKind } from "@/lib/themes/decor";
import { DecorVisibility } from "./decor-visibility";

/**
 * ONE AMBIENT LAYER, IN ONE OF THE FOUR PLACES IT IS ALLOWED.
 *
 *   kind="door"     the whole screen behind sign-in / set-up / onboarding (the parent is `relative` and fills the screen)
 *   kind="empty"    behind the sentence of a list with nothing in it (~320 px, centred)
 *   kind="sidebar"  the 72 px header of the navigation (a corner, turned, at the end away from the wordmark)
 *   kind="strip"    the thin hero strip of the Today page
 *
 * It is `aria-hidden` and the stylesheet gives it `pointer-events: none` and `z-index: 0`: it is behind the
 * content, it says nothing and it catches no click. A decoration that can be tabbed to or read out has become
 * content. The parent must be `relative` (and clip with `overflow-hidden`), and its content `relative` too, so
 * that it paints over the layer.
 *
 * ALL the behaviour is in `decor.css`, keyed on <html data-theme="…" data-decor="off|light|full"> — this is a
 * server component with no hooks and no props but its place, so any component can use it. What a theme draws,
 * and how loud, is `src/lib/themes/decor.ts`. `off` is the stylesheet not displaying the layer, which is also
 * why it costs the people who turned it off nothing: no picture is requested.
 *
 * ⚠️ Four places only. Never behind a table, a form, an order, a figure of money or a quantity:
 * `tests/themes-decor-guards.test.ts` sweeps the source and fails on a fifth place.
 *
 * The one thing it mounts is `DecorVisibility`, a client leaf that marks <html> while the tab is hidden so the
 * slow motion of the `full` level pauses (a render of nothing, shared by every layer on the page).
 */
export function ThemeDecor({ kind }: { kind: DecorKind }) {
  return (
    <div aria-hidden="true" className={decorClass(kind)}>
      {/*
        The door draws four things and a pseudo-element pair holds two: the rosette is ::before and the right
        corner ::after; these two are the left corner (the right one, turned) and the skyline. They are EMPTY
        boxes that paint nothing unless a composed theme gives them a rule.
      */}
      {kind === "door" ? (
        <>
          <i className="zk-decor-l" />
          <i className="zk-decor-b" />
        </>
      ) : null}
      <DecorVisibility />
    </div>
  );
}
