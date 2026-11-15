import checkpointOperator from './founder-checkpoint-runner.js';
import { runPrivateFounderBackup } from './founder-backup-runner.js';
import { runPrivateFounderContinuity } from './founder-continuity-runner.js';
export { FounderRecoveryTarget } from './founder-recovery-target.js';

export default {
  fetch: checkpointOperator.fetch,
  async scheduled(controller, env, ctx) {
    const audit = env.RELEASE_AUDIT;
    const continuity = await audit?.get('founder-continuity:activation', { type: 'json' });
    if (continuity) {
      ctx.waitUntil((async () => {
        const result = await runPrivateFounderContinuity({ env, activation: continuity });
        await audit.put('founder-continuity:last-attempt', JSON.stringify({ ...result, executedAt: Date.now() }));
        if (!result.ok) throw new Error(result.code);
      })());
      return;
    }
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
