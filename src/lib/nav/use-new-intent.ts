"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NEW_PARAM } from "./new-actions";

/**
 * A page's half of «جديد»: when the address says `?new=<value>` (the wheel sent the person here), run
 * `open` once — the page opens its own form — and take the parameter off the address, so a reload or the
 * back button does not open it again. `ready` waits for what the form needs (a list still loading).
 *
 * Arriving from another page and pressing «جديد» while already on the page both work: the hook follows
 * the search parameters, not the first render.
 *
 * The parameter is taken off with `history.replaceState` (Next 14.1+ keeps `useSearchParams` in step with
 * it), NOT `router.replace`: a router navigation fetches the page again and the (app) loading boundary
 * can remount it — the form that was just opened would close before anybody saw it.
 */
export function useNewIntent(value: string, open: () => void, ready = true): void {
  const params = useSearchParams();
  const pathname = usePathname();
  const wanted = params?.get(NEW_PARAM) === value;
  const run = useRef(open);
  run.current = open;

  useEffect(() => {
    if (!wanted || !ready) return;
    run.current();
    const rest = new URLSearchParams(params?.toString() ?? "");
    rest.delete(NEW_PARAM);
    const query = rest.toString();
    window.history.replaceState(null, "", `${pathname ?? "/"}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [wanted, ready, params, pathname]);
}
