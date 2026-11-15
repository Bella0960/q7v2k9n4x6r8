# Production Worker source parity / 安全发布配置

The live production \`mao\` Worker already implements CloudDatabase backed accounts,
wallet and push. The previous \`main/worker.js\` contained only static
\`ASSETS.fetch\` and the previous \`wrangler.jsonc\` omitted the Durable Object binding:
deploying that configuration would have silently destroyed live API routing.

This change restores **exactly** the 29 currently deployed source modules to the
private repository without fetching or committing any runtime secrets, accounts,
passwords or database rows. 26 modules were independently checked against the
existing integration branch. 3 changed modules were recovered from the *currently
running* production script version and checked against the live code fingerprint.

## Invariants

- Production Worker name stays \`mao\`, class stays \`CloudDatabase\`, migration
  remains the existing tag \`v1\`, compatibility date remains \`2026-10-27\`.
- Cloudflare production namespace is **the existing**
  \`178bf7c29fe741c18ffb8a903883549e\`.
  Never create a second namespace or bootstrap administrator.
- \`--keep-vars\` and \`keep_vars: true\` preserve the existing Cloudflare
  runtime settings. No secrets are serialized into source control.
- The existing \`ASSETS\` binding and run-worker-first setup must remain.
- Publishing any future feature must first pass
  \`node scripts/verify-production-worker-source.mjs\` and existing tests.
- If runtime bindings, namespace ID, login or push fail validation after
  deploying, roll back the Worker version; **never** delete or edit databases.

The previous production Worker version before this restoration is
\`90676d75-24b7-40cc-ac13-ea93289525b8\` for rollback reference only.

Do not combine this restoration with PR #285 account/wallet/theme marketplace
feature merges. It changes production source parity, not identity authority.
