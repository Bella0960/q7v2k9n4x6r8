# MAOMAO interactive tutorial

The desktop app `教程` is an API-first technical handbook for the phone simulator. The six priority lessons are continuous reference articles with a real settings-page link. Routine app guides retain step-by-step walkthroughs and collapsed local testing tools. The technical courses appear first; routine desktop navigation stays in the secondary directory.

## Current coverage

- 56 guides total, including every one of the 29 desktop app shortcuts (including the Tutorial app itself).
- Chat-specific sections: composer `+` menu, conversation settings, reply-bubble modes, proactive contact vs. follow-up, role stickers, avatar archive / pair builder, generated-image gallery, private/public images, image recognition, and chat memory/time options.
- 12 FAQs centered on API credentials, versioned Base URLs, HTTP error codes, image generation, MiniMax credentials, and sampling parameters.
- Six API-first courses: getting API access; Base URL and /v1; HTTP 400/401/403/404/429/5xx and 200-with-incompatible-response; Temperature / Top P / Tokens; separate image model and endpoint; MiniMax with Group ID / Voice ID and explicit non-verification, including a truthful distinction from the unverified MIX setting.
- Technical topics use a continuous editorial article rather than requiring step-by-step checkbox completion. Official developer-platform links are reference entry points, not verified live menus.
- The API connection test sends a short, real chat request using CURRENT form input, requires a nonempty `choices[].message.content` text reply and HTTPS, and redacts any echoed Key in errors, explains result/failure, and tells the user to save separately. It does not test image or voice services. API profile save now edits the entry in the same storage-backed list (rather than a detached copy) and verifies writes; active profile switching and its mirror are covered by the contract checks.
- Settings pages link directly to their relevant handbook chapter using `#guide=...`, and the landing page contains a local-only connection-error explainer. No API Key is entered into or transmitted by the handbook.
- Existing per-guide checklist, steps, free-text notes, and export remain accessible under collapsed sections. Checking off a lesson never implies a network or real-device pass. If localStorage rejects a write, the UI displays a visible warning instead of pretending the note was saved.

## Update on every user-visible feature merge

1. Update `tutorial/tutorial.js`:
   - add a dated entry to `GUIDE_UPDATES` with the merged PR and user-visible change;
   - add or revise the relevant `GUIDES` item with exact labels and actual navigation paths;
   - add a practical exercise plus an expected result;
   - update `FAQS` when a new recurring user question or limitation appears;
   - update the `APPS` quick directory and the matching `app-*` guide whenever a desktop shortcut is added, renamed, or moved.
2. Keep `tutorial/tutorial.html` stepper and article controls and matching handlers in `tutorial/tutorial.js` in sync. When a technical article step is added, update `TECH_CHAPTERS` titles as well. Test article/legacy transitions, closing, links, previous/next and resumed progress.
3. Update the contract suite in `tests/tutorial-page-contract.test.mjs` and browser suite in `tests/tutorial-mobile-browser.mjs`. Contracts check routes, FAQs, article controls, API errors and profile-write failures without a real Key. Playwright checks phone layout and interaction at 320 / 375 / 390 / 430 / 768 CSS pixels, direct links to the real `#api` settings panel, modal focus trapping and restoration, legacy steps, non-mutating article reading and simulated storage failure.
4. Keep `sw.js` app-shell entries and cache version in sync with every tutorial HTML/JS asset version change.
5. Do not mark a feature as tested merely because its source or setting exists. In particular, role proactive-contact checks, cloud autonomous messages, Web Push delivery, and lock-screen notifications are separate acceptance items.
6. Keep unresolved phone reports visible as `待真机复测` with the specific reproduction details. Never describe an unverified fix as complete.
7. The dedicated `.github/workflows/tutorial-regression.yml` check enforces this on pull requests: changes to user-facing app paths must include a `tutorial/tutorial.js` update. Keep the update history and exact step locations current so a passing contract check also means the guide catalog was deliberately touched.
8. Do not put API keys, passwords, private chat text, personal phone numbers, or private media into tutorial notes or exported test reports.

## Local data and privacy

The tutorial checklist, step progress, and notes are saved in the current browser under `maomao_tutorial_progress_v1`. They do not write to chat history, role profiles, role avatar archives, image galleries, or app business data. Clearing tutorial progress only removes this one key.

## Release gate

This PR is a draft. The 21 current tutorial contract callback bodies were independently run under a V8 test shim with connector-fetched source and all 32 referenced page routes confirmed in the GitHub branch. The browser test script was syntax-checked but has NOT been run in Chromium. These checks do not substitute for Node's native runner, Vite build or actual phone acceptance. GitHub Actions jobs on the branch have returned failure before any job steps started (`steps=[]`); that is a CI infrastructure limitation, not a passing test suite or evidence of a code failure. Before merging or deploying: run `npm run test:tutorial`, `npm run test:tutorial:browser` (requires Playwright Chromium), relevant PWA/chat tests, `npm run build`, then do real phone acceptance of text API, image generation and any supported voice flow. The tutorial CI workflow now includes the contract suite, Playwright mobile smoke and Vite build, but the known runner/usage limitation has prevented these steps from actually executing. MiniMax voice synthesis is **not** declared implemented simply because credentials can be stored locally.
