import type { ServerT } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/enums";
import { cn } from "@/lib/utils";
import type { Band, Light } from "@/lib/team-score";

/** The status light (تمام / انتبه / يحتاج تدخل) and the band (ممتاز / جيد / يحتاج دعم), always with their word: a colour alone says nothing. */

const LIGHT_STYLE: Record<Light, string> = {
  GREEN: "border-ok/40 bg-ok/10 text-ok",
  AMBER: "border-warn/40 bg-warn/10 text-warn",
  RED: "border-danger/40 bg-danger/10 text-danger",
};
const DOT: Record<Light, string> = { GREEN: "bg-ok", AMBER: "bg-warn", RED: "bg-danger" };

export function LightBadge({ light, suggested = false, t }: { light: Light | null; suggested?: boolean; t: ServerT }) {
  if (!light) return <span className="text-fg-muted">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs", LIGHT_STYLE[light], suggested && "border-dashed")} data-light={light} data-suggested={suggested ? "true" : undefined}>
      <span aria-hidden className={cn("size-2 rounded-full", DOT[light])} />
      {enumLabel("ReviewLight", light)}
      {suggested ? <span className="text-fg-muted">({t("teamdev.light.suggestion")})</span> : null}
    </span>
  );
}

const BAND_STYLE: Record<Band, string> = {
  excellent: "border-ok/40 bg-ok/10 text-ok",
  good: "border-info/40 bg-info/10 text-info",
  support: "border-warn/40 bg-warn/10 text-warn",
};

export function BandBadge({ band, t }: { band: Band | null; t: ServerT }) {
  if (!band) return <span className="text-fg-muted">—</span>;
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-xs", BAND_STYLE[band])} data-band={band}>
      {t(`teamdev.band.${band}`)}
    </span>
  );
}
