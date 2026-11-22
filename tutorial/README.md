# MAOMAO interactive tutorial

The desktop app `教程` is the user-facing guide and test notebook for the phone simulator. It is not a static help page: each guide has a one-step-at-a-time walkthrough, route locator, a small interface-location illustration, a real-page link, and a practical exercise.

## Current coverage

- 54 guides total, including every one of the 29 desktop app shortcuts (including the Tutorial app itself).
- Chat-specific sections: composer `+` menu, conversation settings, reply-bubble modes, proactive contact vs. follow-up, role stickers, avatar archive / pair builder, generated-image gallery, private/public images, image recognition, and chat memory/time options.
- 11 FAQs covering common entry-point confusion, per-role isolation, image prerequisites, private-gallery auto-send behavior, background push limitations, and recording Bugs.
- Local per-guide test checkbox, step-by-step progress, free-text issue notes, and exportable test report.

## Reader-first editorial manual and release policy

- The tutorial is an **editorial book-style reader**, not a QA dashboard. Keep the cover, chapter index, a compact expandable chapter per feature, and the one-step walkthrough. The personal test notebook is secondary, folded by default.
- Preserve all desktop app guides, deep links, FAQs, progress checkboxes and free-text notes. The persistence key remains `maomao_tutorial_progress_v1`; never migrate it merely for visual changes.
- Maintain chapter copy and actual navigation paths when user-facing features change; keep the README, guide, quick-launch index and contract test aligned. A small internal feature adjustment does **not** become a new user-visible release entry.
- `OFFICIAL_RELEASE_NOTES` in `tutorial.js` is a strictly curated **public release bulletin**. Only add a version once it has genuinely been approved and publicly shipped. Use the complete structured fields `version`, `date`, `approved:true`, `status:'published'`, `title`, and up to four plain-language `highlights`.
- Do not publish internal PR numbers, raw task IDs, provisional QA claims, tiny layout fixes, patch-by-patch engineering reports or unverified claims as official notes. If no official release is approved, the bulletin deliberately says so instead of inventing a version.
- The existing tutorial CI regression workflow still checks that relevant feature-guide changes update `tutorial/tutorial.js`, but it does not authorize a public release. Keep the current app-shell assets `sw.js` synchronized with the tutorial JS cache version; do not reset user storage.
- Background push, device system notifications, actual Android/iOS acceptance, API model output and unverified feature quality must never be marked as passing just because local static tests passed.

## Local data and privacy

The tutorial checklist, step progress, and notes are saved in the current browser under `maomao_tutorial_progress_v1`. They do not write to chat history, role profiles, role avatar archives, image galleries, or app business data. Clearing tutorial progress only removes this one key.
