import { db } from "@/server/db/client";
import { logger } from "@/server/observability/logger";
import { dispatchPendingOutbox } from "@/server/modules/notifications/outbox.dispatcher";

const MAX_EVENTS_PER_RUN = 500;

async function main(): Promise<void> {
  // One bounded sweep performs one retention cleanup, one abandoned-lease
  // recovery, and one indexed queue read. This avoids repeating maintenance
  // queries while still keeping a single cron run finite.
  const result = await dispatchPendingOutbox({ limit: MAX_EVENTS_PER_RUN });
  logger.info("Scheduled outbox dispatch completed", { ...result });
  if (result.failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  logger.error("Scheduled outbox dispatch crashed", { error });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
