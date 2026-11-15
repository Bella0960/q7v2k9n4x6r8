using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "sqlite-disk", disk = (path = "./workerd-sqlite", writable = true)), (name = "drill", worker = (
   modules = [
          (name = "tests/founder-logical-backup.workerd.js", esModule = embed "founder-logical-backup.workerd.js"),
          (name = "scripts/release/founder-logical-backup.mjs", esModule = embed "../scripts/release/founder-logical-backup.mjs"),
          (name = "worker/lib/crypto.js", esModule = embed "../worker/lib/crypto.js"),
          (name = "worker/lib/migrations.js", esModule = embed "../worker/lib/migrations.js"),
          (name = "worker/migrations/0001_init.js", esModule = embed "../worker/migrations/0001_init.js"),
          (name = "worker/migrations/0002_autonomy_metadata.js", esModule = embed "../worker/migrations/0002_autonomy_metadata.js"),
          (name = "worker/migrations/0003_device_pairing.js", esModule = embed "../worker/migrations/0003_device_pairing.js"),
          (name = "worker/migrations/0004_character_context_version.js", esModule = embed "../worker/migrations/0004_character_context_version.js"),
          (name = "worker/migrations/0005_push_delivery_retries.js", esModule = embed "../worker/migrations/0005_push_delivery_retries.js"),
          (name = "worker/migrations/0006_outbound_inbox_index.js", esModule = embed "../worker/migrations/0006_outbound_inbox_index.js"),
          (name = "worker/migrations/0007_activity_dedupe.js", esModule = embed "../worker/migrations/0007_activity_dedupe.js"),
          (name = "worker/migrations/0008_context_source_device.js", esModule = embed "../worker/migrations/0008_context_source_device.js"),
          (name = "worker/migrations/0009_activity_result_staging.js", esModule = embed "../worker/migrations/0009_activity_result_staging.js"),
          (name = "worker/migrations/0010_outbound_lifecycle_receipts.js", esModule = embed "../worker/migrations/0010_outbound_lifecycle_receipts.js"),
          (name = "worker/migrations/0011_outbound_device_receipts.js", esModule = embed "../worker/migrations/0011_outbound_device_receipts.js"),
          (name = "worker/migrations/0012_mao_accounts.js", esModule = embed "../worker/migrations/0012_mao_accounts.js"),
          (name = "worker/migrations/0013_mao_account_restore_state.js", esModule = embed "../worker/migrations/0013_mao_account_restore_state.js"),
          (name = "worker/migrations/0014_mao_admin_directory_indexes.js", esModule = embed "../worker/migrations/0014_mao_admin_directory_indexes.js"),
          (name = "worker/migrations/0015_mao_account_audit_cursor.js", esModule = embed "../worker/migrations/0015_mao_account_audit_cursor.js"),
          (name = "worker/migrations/0016_mao_global_audit_cursor.js", esModule = embed "../worker/migrations/0016_mao_global_audit_cursor.js"),
          (name = "worker/migrations/0017_mao_social.js", esModule = embed "../worker/migrations/0017_mao_social.js"),
          (name = "worker/migrations/0018_mao_social_e2ee.js", esModule = embed "../worker/migrations/0018_mao_social_e2ee.js"),
          (name = "worker/migrations/0019_mao_social_e2ee_media.js", esModule = embed "../worker/migrations/0019_mao_social_e2ee_media.js"),
          (name = "worker/migrations/0020_cloud_autonomous_context.js", esModule = embed "../worker/migrations/0020_cloud_autonomous_context.js")
   ],
   compatibilityDate = "2026-10-27",
   bindings = [
      (name="SOURCE", durableObjectNamespace="Source"),
      (name="TARGET", durableObjectNamespace="Target")
   ],
   durableObjectNamespaces = [
      (className="Source", uniqueKey="backup-drill-source", enableSql=true),
      (className="Target", uniqueKey="backup-drill-target", enableSql=true)
   ],
   durableObjectStorage = (localDisk="sqlite-disk")
 ))]
);
