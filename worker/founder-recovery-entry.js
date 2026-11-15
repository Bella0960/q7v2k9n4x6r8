import checkpointOperator from './founder-checkpoint-runner.js';
import { runPrivateFounderBackup } from './founder-backup-runner.js';
export { FounderRecoveryTarget } from './founder-recovery-target.js';

export default {
  fetch: checkpointOperator.fetch,
  async scheduled(controller, env, ctx) {
    const audit = env.RELEASE_AUDIT;
    const activation = await audit?.get('founder-backup:activation', { type: 'json' });
    if (activation) {
      ctx.waitUntil((async () => {
        const result = await runPrivateFounderBackup({ env, activation });
        await audit.put('founder-backup:last-attempt', JSON.stringify({ ...result, executedAt: Date.now() }));
        if (!result.ok) throw new Error(result.code);
      })());
      return;
    }
    return checkpointOperator.scheduled(controller, env, ctx);
  }
};
