/**
 * Structured logger. Never log secrets or full payloads.
 * Usage: log.info("event.name", { meta })
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function level(): Level {
  return (process.env["LOG_LEVEL"] as Level) || "info";
}

function write(lv: Level, event: string, meta?: Record<string, unknown>) {
  if (ORDER[lv] < ORDER[level()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: lv,
    event,
    ...meta,
  });
  if (lv === "error") console.error(line);
  else if (lv === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, meta?: Record<string, unknown>) => write("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => write("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write("error", event, meta),
};
