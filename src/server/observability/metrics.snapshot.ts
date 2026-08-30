import { OutboxStatus, WebhookEventStatus } from "@prisma/client";
import { db } from "@/server/db/client";
import { evaluateAlerts, snapshotJson, type MetricAlert, type MetricsSnapshot } from "@/server/observability/metrics";

// ---------------------------------------------------------------------------
// Database-scraped gauge sources for the metrics snapshot. Kept in a separate
// file from the pure registry so metrics.ts never imports the db client (the
// test-environment trap: importing db transitively requires TEST_DATABASE_URL).
// Both reads are bounded single-row scrapes riding the (status, availableAt)
// and (status, receivedAt) indexes.
// ---------------------------------------------------------------------------

export interface QueueGauges {
  outboxOldestPendingAgeSeconds: number | null;
  webhookOldestUnprocessedAgeSeconds: number | null;
}

function ageSeconds(oldest: Date | undefined | null, now: number): number | null {
  if (!oldest) return null;
  return Math.max(0, (now - oldest.getTime()) / 1000);
}

export async function collectQueueGauges(): Promise<QueueGauges> {
  const now = Date.now();
  const [outboxOldest, webhookOldest] = await Promise.all([
    db.outboxEvent.findFirst({
      where: { status: OutboxStatus.PENDING },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    db.webhookEvent.findFirst({
      where: { status: WebhookEventStatus.RECEIVED },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    }),
  ]);

  return {
    outboxOldestPendingAgeSeconds: ageSeconds(outboxOldest?.availableAt, now),
    webhookOldestUnprocessedAgeSeconds: ageSeconds(webhookOldest?.receivedAt, now),
  };
}

export interface MetricsReport {
  metrics: MetricsSnapshot;
  alerts: MetricAlert[];
  gauges: QueueGauges;
}

/** Full scrape: registry snapshot + queue-lag gauges + alert evaluation. */
export async function buildMetricsReport(): Promise<MetricsReport> {
  const gauges = await collectQueueGauges();
  const metrics = snapshotJson({
    outbox_oldest_pending_age_seconds: gauges.outboxOldestPendingAgeSeconds,
    webhook_oldest_unprocessed_age_seconds: gauges.webhookOldestUnprocessedAgeSeconds,
  });
  const alerts = evaluateAlerts({ outboxOldestPendingAgeSeconds: gauges.outboxOldestPendingAgeSeconds });
  return { metrics, alerts, gauges };
}
