# Legacy Asset Audit

**Snapshot:** `main` at `f0cf6c74f0272219ebe4aa9e5a8c21fea7e49273` · **2026-11-11**
**Scope:** `apps/settings/` legacy CSS candidates. This is a read-only audit; no files were deleted.

## Findings

| File | Size | Current in-repo consumer | Build behavior |
|---|---:|---|---|
| `apps/settings/settings.css` | 12,271 bytes | No source reference found. Current `settings/settings.html` links `settings/css/settings.css`, not this file. | Vite static-resource plugin copies it because `.css` is allowed and `apps/` is not excluded. |
| `apps/settings/views.css` | 14,771 bytes | No source reference found; search for `.app-view` returns this file only. | Vite static-resource plugin copies it for the same reason. |

## Evidence

- Repository search for `apps/settings` returned documentation mentions only; no HTML, JS, or CSS consumer was returned.
- Repository search for `.app-view` returned `apps/settings/views.css` only. The current settings page does not contain `.app-view` markup.
- `settings/settings.html` loads `css/settings.css` (which resolves to `settings/css/settings.css`) and `../shared/css/mobile-fit.css`; it does not reference `apps/settings/`.
- `settings/css/settings.css` is 17,314 bytes, while `apps/settings/settings.css` is 12,271 bytes. They are not byte-identical; do not replace or delete one based solely on the legacy header comment.
- `vite.config.js` walks the repository for static resources. `excludedDirs` does not include `apps`, and `allowedExtensions` includes `.css`, so both legacy files are copied into `dist/apps/settings/`.

## Verdict

**Classification: unreferenced by current in-repo page source, but still shipped in the build output.** This is a cleanup candidate, not a safe-to-delete finding.

Do not delete either file in this task. Before removal, require:

1. Confirmation that no external bookmark, embed, user-installed customization, or older client requests these exact static paths.
2. A build artifact comparison proving no current HTML/CSS/JS or generated manifest references them.
3. An explicit owner decision to remove them; then run build and deployed-path regression checks.

## Remaining GOV-003 work

- Review other candidate files/directories only when they are named by the remediation backlog or proven by source/build analysis.
- Keep historical audit pages, previews, fonts, icons, and uploaded media out of automatic deletion based on age or lack of launcher links.
- No application code or production data changed in this audit.
