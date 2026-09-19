import type { Metric, Plan } from '../config.ts';
import { HttpError } from '../http.ts';
import type { Graph } from './graph.ts';

/**
 * Entitlements seam: the one question feature code asks before metered work,
 * and the one place usage is recorded. Pricing is configuration: a plan maps
 * metrics to limits. The open-source default allows everything and records
 * nothing.
 *
 *   await entitlements.require(workspaceId, 'archive.saves.monthly');
 *   …do the work…
 *   await entitlements.record(workspaceId, 'archive.saves.monthly');
 */
export interface Entitlements {
  /** Throws 402 `limit_reached` when `amount` more would exceed the workspace's plan. */
  require(workspaceId: string, metric: Metric, amount?: number): Promise<void>;
  record(workspaceId: string, metric: Metric, amount?: number): Promise<void>;
  /** Current usage and limits, for display. */
  usage(workspaceId: string): Promise<{ plan: string; metrics: Partial<Record<Metric, { used: number; limit: number | null }>> }>;
}

export function unlimited(): Entitlements {
  return {
    async require() {},
    async record() {},
    async usage() { return { plan: 'unlimited', metrics: {} }; },
  };
}

const METRICS: Metric[] = ['investigations', 'captures.monthly', 'archive.saves.monthly', 'snapshots.monthly', 'watches', 'storage.bytes'];
const period = (metric: Metric, now: Date) => (metric.endsWith('.monthly') ? now.toISOString().slice(0, 7) : 'all');

/** Plan limits enforced from `Usage` documents (one per workspace, metric and period). */
export function planEntitlements(graph: Graph, plans: Record<string, Plan>, now = () => new Date()): Entitlements {
  async function planOf(workspaceId: string): Promise<{ name: string; plan: Plan }> {
    const [ws] = await graph.sql<{ plan?: string }>('SELECT plan FROM Workspace WHERE id=:id', { id: workspaceId });
    const name = ws?.plan || 'unlimited';
    return { name, plan: plans[name] ?? { limits: {} } };
  }
  const usageKey = (workspaceId: string, metric: Metric) => `${workspaceId}|${metric}|${period(metric, now())}`;
  async function used(workspaceId: string, metric: Metric): Promise<number> {
    const [row] = await graph.sql<{ total: number }>('SELECT total FROM Usage WHERE key=:key', { key: usageKey(workspaceId, metric) });
    return row?.total ?? 0;
  }
  return {
    async require(workspaceId, metric, amount = 1) {
      const { name, plan } = await planOf(workspaceId);
      const limit = plan.limits[metric];
      if (limit === undefined) return;
      const current = await used(workspaceId, metric);
      if (current + amount > limit) {
        throw new HttpError(402, `Your ${name} plan allows ${limit.toLocaleString('en-US')} for ${metric}. Upgrade the workspace plan to continue.`, 'limit_reached', { metric, limit, used: current, plan: name });
      }
    },
    async record(workspaceId, metric, amount = 1) {
      // One row per workspace, metric and period; the unique key makes the upsert atomic.
      await graph.sql('UPDATE Usage SET total = ifnull(total, 0) + :n, workspaceId=:ws, metric=:m, period=:p UPSERT WHERE key=:key', { key: usageKey(workspaceId, metric), ws: workspaceId, m: metric, p: period(metric, now()), n: amount });
    },
    async usage(workspaceId) {
      const { name, plan } = await planOf(workspaceId);
      const metrics: Partial<Record<Metric, { used: number; limit: number | null }>> = {};
      for (const m of METRICS) metrics[m] = { used: await used(workspaceId, m), limit: plan.limits[m] ?? null };
      return { plan: name, metrics };
    },
  };
}
