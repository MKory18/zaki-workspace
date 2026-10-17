/** Direction-aware formatting helpers. */

// Hand-rolled names — hydration determinism (Node ICU vs browser ICU differ).
const MONTHS: Record<string, string[]> = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const WEEKDAYS: Record<string, string[]> = {
  ar: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  fr: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function monthsFor(locale: string): string[] {
  return MONTHS[locale] ?? MONTHS["en"]!;
}

/** "5 أكتوبر 2026" style date — identical output on server and client. */
export function fmtDMY(d: Date | string | number | null | undefined, locale = "ar"): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const months = monthsFor(locale);
  return `${date.getDate()} ${months[date.getMonth()]!} ${date.getFullYear()}`;
}

/** Short "5 أكتوبر" — identical on both sides. */
export function fmtShort(d: Date | string | number | null | undefined, locale = "ar"): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${monthsFor(locale)[date.getMonth()]!}`;
}

/** "14:05" local time — identical on both sides (same machine timezone). */
export function fmtTime(d: Date | string | number | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "5 أكتوبر 2026، 14:05" — for event tables & logs. */
export function fmtDateTime(d: Date | string | number | null | undefined, locale = "ar"): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${fmtDMY(date, locale)} ${fmtTime(date)}`;
}

/** Grouped number with plain commas — no locale separators. */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Weekday label for a 0-based index (0=Sunday) — deterministic. */
export function weekdayName(index: number, locale = "ar"): string {
  const list = WEEKDAYS[locale] ?? WEEKDAYS["en"]!;
  return list[((index % 7) + 7) % 7]!;
}

/** Month label for 0-based index + optional year — deterministic. */
export function monthName(index: number, locale = "ar"): string {
  return monthsFor(locale)[((index % 12) + 12) % 12]!;
}

/** Task priority presentation tokens shared by views (no business logic). */
export const PRIORITY_STYLES: Record<string, { label: string; color: string }> = {
  URGENT: { label: "Urgent", color: "#ef4444" },
  HIGH: { label: "High", color: "#f97316" },
  NORMAL: { label: "Normal", color: "#3b82f6" },
  LOW: { label: "Low", color: "#6b7280" },
  NONE: { label: "—", color: "#9ca3af" },
};

/** Direction-aware formatting helpers. */
export function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (!d) return "";
  return fmtShort(d, locale === "fr" ? "fr" : locale === "ar" ? "ar" : "en");
}

export function isOverdue(d: string | null | undefined): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

/** Deterministic avatar hue from the name — same on server and client. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0)).join("") || "?";
}
