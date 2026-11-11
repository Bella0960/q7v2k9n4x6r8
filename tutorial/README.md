# MAOMAO interactive tutorial

The desktop app `教程` is the user-facing guide and test notebook for the phone simulator. It is not a static help page: each guide has a one-step-at-a-time walkthrough, route locator, a real-page link, practical exercises, and a collapsed test notebook. The technical courses appear first; routine desktop navigation stays in the secondary directory.

## Current coverage

- 56 guides total, including every one of the 29 desktop app shortcuts (including the Tutorial app itself).
- Chat-specific sections: composer `+` menu, conversation settings, reply-bubble modes, proactive contact vs. follow-up, role stickers, avatar archive / pair builder, generated-image gallery, private/public images, image recognition, and chat memory/time options.
- 11 FAQs centered on API credentials, versioned Base URLs, HTTP error codes, image generation, MiniMax credentials, and sampling parameters.
- Six API-first courses: getting API access; Base URL and /v1; HTTP 400/401/403/404/429/5xx and 200-with-incompatible-response; Temperature / Top P / Tokens; separate image model and endpoint; MiniMax with Group ID / Voice ID and explicit non-verification.
- Technical topics use a continuous editorial article rather than requiring step-by-step checkbox completion. Official developer-platform links are reference entry points, not verified live menus.
- The API connection test sends a short, real chat request using CURRENT form input, validates a compatible `choices` response, explains result/failure, and tells the user to save separately. It does not test image or voice services.
- Settings pages link directly to their relevant handbook chapter using `#guide=...`, and the landing page contains a local-only connection-error explainer. No API Key is entered into or transmitted by the handbook.
- Existing per-guide checklist, steps, free-text notes, and export remain accessible under collapsed sections. Checking off a lesson never implies a network or real-device pass.

## Update on every user-visible feature merge

1. Update `tutorial/tutorial.js`:
   - add a dated entry to `GUIDE_UPDATES` with the merged PR and user-visible change;
   - add or revise the relevant `GUIDES` item with exact labels and actual navigation paths;
   - add a practical exercise plus an expected result;
   - update `FAQS` when a new recurring user question or limitation appears;
   - update the `APPS` quick directory and the matching `app-*` guide whenever a desktop shortcut is added, renamed, or moved.
2. Keep `tutorial/tutorial.html` stepper and article controls and matching handlers in `tutorial/tutorial.js` in sync. When a technical article step is added, update `TECH_CHAPTERS` titles as well. Test article/legacy transitions, closing, links, previous/next and resumed progress.
3. Add/update contract checks in `tests/tutorial-page-contract.test.mjs`. The suite checks app routes, FAQ and article controls, links, and an isolated connection-test matrix with mock HTTP errors and no real key or network request.
4. Keep `sw.js` app-shell entries and cache version in sync with every tutorial HTML/JS asset version change.
5. Do not mark a feature as tested merely because its source or setting exists. In particular, role proactive-contact checks, cloud autonomous messages, Web Push delivery, and lock-screen notifications are separate acceptance items.
6. Keep unresolved phone reports visible as `待真机复测` with the specific reproduction details. Never describe an unverified fix as complete.
7. The dedicated `.github/workflows/tutorial-regression.yml` check enforces this on pull requests: changes to user-facing app paths must include a `tutorial/tutorial.js` update. Keep the update history and exact step locations current so a passing contract check also means the guide catalog was deliberately touched.
8. Do not put API keys, passwords, private chat text, personal phone numbers, or private media into tutorial notes or exported test reports.

## Local data and privacy

The tutorial checklist, step progress, and notes are saved in the current browser under `maomao_tutorial_progress_v1`. They do not write to chat history, role profiles, role avatar archives, image galleries, or app business data. Clearing tutorial progress only removes this one key.

## Release gate

This PR is a draft. Source syntax, mocked DOM/article interaction, and isolated 15-case connection-failure scenarios were checked during development. GitHub Actions jobs on the branch have returned failure before any job steps started (`steps=[]`); that is a CI infrastructure limitation, not a passing test suite or evidence of a code failure. Before merging or deploying: run `npm run test:tutorial`, all relevant PWA/chat tests, `npm run build`, verify a browser at mobile and desktop widths, and run real API, image, and voice acceptance separately. MiniMax voice synthesis is **not** declared implemented simply because credentials can be stored locally.
