import { handleScheduled } from "../src/worker/scheduled";
import type { Env } from "../src/worker/env";

/**
 * cron 専用 Worker のエントリポイント。
 * Pages は cron トリガーに対応しないため、毎日3時のカタログ再検証はこの Worker が担う。
 */
export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
