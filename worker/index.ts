import { PrismaClient } from "@prisma/client";

/**
 * Zaki Workspace worker.
 * Phase 1 has no scheduled jobs yet — this placeholder only proves DB
 * connectivity and keeps the container alive with a health ticker.
 * Future jobs (idempotent, with retries): Telegram processing, automation
 * rules, recurring task generation, AI summarization, notification fan-out.
 */
const prisma = new PrismaClient();

const TICK_MS = 60_000;

async function tick(): Promise<void> {
  const taskCount = await prisma.task.count();
  console.log(JSON.stringify({ event: "worker.tick", taskCount }));
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ event: "worker.start" }));
  await tick();
  setInterval(() => {
    tick().catch((err) => {
      console.error(JSON.stringify({ event: "worker.tick_error", message: String(err) }));
    });
  }, TICK_MS);
}

main().catch((err) => {
  console.error(JSON.stringify({ event: "worker.fatal", message: String(err) }));
  process.exit(1);
});
