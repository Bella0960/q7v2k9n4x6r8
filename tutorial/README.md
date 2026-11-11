# MAOMAO interactive tutorial

The desktop app `教程` is the user-facing guide and test notebook for the phone simulator. It is not a static help page: each guide has a one-step-at-a-time walkthrough, route locator, a small interface-location illustration, a real-page link, and a practical exercise.

## Current coverage

- 50 guides total, including every one of the 29 desktop app shortcuts (including the Tutorial app itself).
- Chat-specific sections: composer `+` menu, conversation settings, reply-bubble modes, proactive contact vs. follow-up, role stickers, avatar archive / pair builder, generated-image gallery, private/public images, image recognition, and chat memory/time options.
- 11 FAQs covering common entry-point confusion, per-role isolation, image prerequisites, private-gallery auto-send behavior, background push limitations, and recording Bugs.
- Local per-guide test checkbox, step-by-step progress, free-text issue notes, and exportable test report.

## Update on every user-visible feature merge

1. Update `tutorial/tutorial.js`:
   - add a dated entry to `GUIDE_UPDATES` with the merged PR and user-visible change;
   - add or revise the relevant `GUIDES` item with exact labels and actual navigation paths;
   - add a practical exercise plus an expected result;
   - update `FAQS` when a new recurring user question or limitation appears;
   - update the `APPS` quick directory and the matching `app-*` guide whenever a desktop shortcut is added, renamed, or moved.
2. Keep `tutorial/tutorial.html` stepper controls and the matching event handlers in `tutorial/tutorial.js` in sync. Test previous/next, closing, resume progress, external app opening, and step completion.
3. Add/update contract checks in `tests/tutorial-page-contract.test.mjs`. The checks must confirm every desktop app shortcut has a guide, every quick-link route resolves to an HTML page, and all stepper/FAQ controls exist.
4. Keep `sw.js` app-shell entries and cache version in sync with every tutorial HTML/JS asset version change.
5. Do not mark a feature as tested merely because its source or setting exists. In particular, role proactive-contact checks, cloud autonomous messages, Web Push delivery, and lock-screen notifications are separate acceptance items.
6. Keep unresolved phone reports visible as `待真机复测` with the specific reproduction details. Never describe an unverified fix as complete.
7. The dedicated `.github/workflows/tutorial-regression.yml` check enforces this on pull requests: changes to user-facing app paths must include a `tutorial/tutorial.js` update. Keep the update history and exact step locations current so a passing contract check also means the guide catalog was deliberately touched.\n8. Do not put API keys, passwords, private chat text, personal phone numbers, or private media into tutorial notes or exported test reports.

## Local data and privacy

The tutorial checklist, step progress, and notes are saved in the current browser under `maomao_tutorial_progress_v1`. They do not write to chat history, role profiles, role avatar archives, image galleries, or app business data. Clearing tutorial progress only removes this one key.
