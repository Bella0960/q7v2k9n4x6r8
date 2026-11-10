# MAOMAO Storage Architecture, Backup, and Migration Plan

## 1. Scope: three different storage systems

Never combine these into one “storage-full” diagnosis.

| System | What it stores | Current finding |
|---|---|---|
| Git repository | Source code and static assets | Approx. 90.1 MiB in the recursive file tree |
| GitHub Actions artifacts/cache | CI output such as APK artifacts | APK upload failed because GitHub reported Artifact storage quota reached; this is not browser localStorage |
| Browser origin storage | User's roles, chats, memories, settings, books, media, and other app data | Mixed localStorage + IndexedDB; data is local to the browser origin/device |

Cloudflare deployment currently publishes static dist assets. It is not a user-data database or sync layer.

Browser storage is scoped to the origin, browser profile, and device. Changing domains or using another browser/profile can make local data appear absent. Do not promise cloud synchronization.

## 2. Current storage inventory (verified from source)

### localStorage — current primary use

| Key/domain | Current role | Known concern |
|---|---|---|
| chat_history_<id> | Full serialized message array per role or group | No overall history cap; image/sticker fields may contain data URLs; largest localStorage risk |
| ai_custom_characters | Character list; avatar data URLs may be embedded | Large avatars add to localStorage usage |
| phone_data_v2 | Role-scoped app data root: phoneData[contactId][appId] | Not a universal replacement for all old keys; some domains still use separate keys |
| chat_memories_<id> and chat summary keys | Long-term memory, summary settings/state | Memory item cap exists; chat history cap does not |
| phone_worldbooks, phone_groups, myProfile | Worldbooks, groups, user profile | Still use separate legacy/global keys |
| moments, forum_posts, settings and app-specific keys | Social feed, forum and application data | Some image-bearing structures may still add substantial strings |
| home_custom_wallpaper and other legacy keys | Legacy wallpaper/settings compatibility | Wallpaper store can fall back to legacy localStorage |
| home_icon_presets_v1 / home_icon_active_preset_v1 | Saved icon-set metadata and currently selected preset ID | Icon image copies are stored separately in the shared wallpapers IndexedDB store |
| ds_image_v1 / ds_postcard_v1 / ds_polaroid_v1 / ds_dialog_v1 / ds_social_v1 | Desktop widget text plus legacy Base64 photos | Read-only compatibility fallback: new widget photos are written to IndexedDB first |
| music_local_tracks | Local music metadata | Audio Blob itself is in IndexedDB, metadata remains in localStorage |
| maomao_reader_bg_v1 | Reading background | Source comments cap the data URL at 600,000 characters |

PhoneStorage provides a common API and error-result namespace, but not every existing caller uses it. Some legacy pages still access localStorage directly. Do not assume all keys have already migrated.

### IndexedDB databases and backup status

| Database | Version / stores | Main consumer | Current backup observation |
|---|---|---|---|
| maomao-media-store | v2: wallpapers (out-of-line key), audio (keyPath id) | shared/js/wallpaper-store.js and music/music.html | Listed in backup.js. wallpapers included. audio record's blob field is explicitly excluded, so the actual audio file is not included by that target rule. |
| `maomao-media-store.wallpapers` records keyed `home_icon_preset_img_v1_<presetId>_<appId>` | Saved icon-set image copies | settings/icon-settings.html | Included in the existing wallpapers backup/restore path |
| `maomao-media-store.wallpapers` records keyed `home_widget_image_v1_<widgetId>_<field>` | Desktop widget photos (image / postcard / polaroid / dialog / social) | index.html via shared/js/wallpaper-store.js | Included in the existing wallpapers backup/restore path; legacy `ds_*` localStorage values stay untouched as fallback. Restore validates the whole store first: any malformed record aborts that store and keeps the device's current photos |
| maomao_diary_photo_store_v1 | v1: photos (keyPath key) | diary/diary.html | Listed in backup.js |
| maomao-reading-library | v1: books (keyPath id), comments (keyPath id) | library/library.html | Listed in backup.js |
| maomao-font-presets | v1: presets (keyPath id, includes Blob) | shared/js/font-loader.js, settings/font-settings.html, theme-store/theme-store.html | Listed in backup.js; Blob serialized as Base64 with 30 MiB per-record and 90 MiB per-store source limits |
| maomao-assets | v2: assets, blobs, refs, image_records | shared/js/phone/storage/media-repository.js | Listed in backup.js; assets/blobs/refs and generated-image records are exported together; Blob payloads use Base64 limits with atomic whole-database exclusion when a limit is exceeded |
| maomao-restore-point | v1, restore-point helper store | settings/js/backup.js | Internal restore safety mechanism, not ordinary user content; inspect its lifecycle during backup refactor |

The database register is a code-derived inventory, not a complete audit of every browser profile's live IndexedDB data. Add a startup/runtime diagnostic to enumerate actual databases where supported and report database names, versions, stores, record counts, and approximate sizes without exposing message content.

### Critical facts

- ConversationRepository currently uses the configured result storage adapter around chat_history_<id>; it is not yet backed by IndexedDB.
- Its getPage method currently reads the complete history array and slices it in memory. This is not disk-level paging.
- MediaRepository supports Blob storage, SHA-256-based IDs, de-duplication, and reference records. The registered `maomao-assets` v2 database also stores generated-image metadata in `image_records`; image bytes remain in `blobs` and chat/gallery records reference them by assetId.
- Diary photos use IndexedDB but store a data field (source currently uses strings/data URLs), not necessarily Blob.
- Local music files use IndexedDB audio records, but backup.js excludes the blob field. Decide whether music should be included in a full backup or separately exportable.
- Backup.js includes several fixed IndexedDB database/store definitions. Any new DB/store must be registered and covered by restore tests at the same time it is introduced.

## 3. Target architecture

Use a small, explicit set of storage responsibilities.

### A. localStorage: small preferences and pointers only

Keep:
- active role/group IDs;
- theme and UI preferences;
- small feature flags;
- small indexes or last-opened pointers where needed.

Do not use it for:
- entire chat histories;
- Base64 images/audio/video;
- imported book bodies;
- large custom fonts;
- large media collections.

### B. IndexedDB: structured user data

Target domains:
- characters and role metadata;
- groups and conversation metadata;
- messages, ordered by conversation and message timestamp/ID;
- long-term memories and summaries;
- worldbook definitions and role bindings;
- app-specific structured state;
- sync/export metadata and schema versions.

Do not prematurely merge every existing DB into one physical database. Prefer one authoritative core-data DB and the existing media DB, while retaining mature specialist DBs (books, fonts, diary photos) until their migration benefit is demonstrated. Maintain a central database registry for all of them.

### C. MediaRepository / Blob store: binary data

Use the existing maomao-assets repository rather than inventing a second media system, after backup support is complete.

Messages should reference media by assetId. The renderer should resolve assetId to a Blob/object URL. Every object URL must be revoked when no longer needed. Reuse identical assets by hash when safe. Store MIME type, byte size, owner type/id, creation time, hash, and reference metadata.

A media cleanup job must only delete assets proven to have zero valid references. It must never guess from file age or missing thumbnails.

## 4. Conversation schema direction

The target is a durable conversation store, not one ever-growing JSON array.

Proposed conceptual entities (exact schema needs a separate review before implementation):

- conversations: conversationId, roleId/groupId, type, title/meta, createdAt, updatedAt, schemaVersion.
- messages: messageId/mid, conversationId, sequence or timestamp index, role/sender, message type, full legacy-compatible payload, createdAt, schemaVersion.
- attachments/media: assetId references; legacy data URLs remain readable until migration completes.
- migration_state: source key, target database, schema version, copied count, verified count, completion marker.

Preserve unknown/extension fields in messages. Do not collapse role/text/content, img/desc, type, silent, mode, scene, memberId, group metadata, card payloads, or other rich message fields.

## 5. Safe, non-destructive migration sequence

Never begin with “move then delete.” Follow this order:

1. **Inventory:** find every reader/writer of chat_history_<id>, characters, memories, images, stickers, calls, date mode, group messages, wallet/forum integrations, search, backup, export, and import.
2. **Baseline:** capture current schema examples using synthetic fixtures; record counts, message order, stable IDs, role/group IDs, and all known fields. Never use real private chats as public fixtures.
3. **Backup coverage:** update backup.js for maomao-assets, media blobs/refs, and audio Blob inclusion or an explicitly documented separate-export route. Test backup and restore both ways.
4. **Preflight:** check IndexedDB availability and navigator.storage.estimate() where supported. Do not assume a fixed browser quota. Estimate required free space plus headroom; stop safely if insufficient.
5. **Shadow copy:** copy existing localStorage histories to IndexedDB without changing the source key. Process large histories in bounded batches; show progress and allow retry.
6. **Verification:** compare per-conversation message counts, stable IDs/mids, order, timestamps, role/group association, and a deterministic hash of normalized records. Verify media references and readable previews.
7. **Compatibility adapter:** route every known reader/writer through a single ConversationRepository adapter. Support old localStorage data and new IndexedDB data during the migration window. Avoid uncoordinated direct writes from pages.
8. **Controlled cutover:** set a per-conversation migration marker only after verification. New writes go to the authoritative IndexedDB path; old keys remain untouched as rollback snapshots. Do not continue unbounded duplicate writes to localStorage.
9. **Regression:** test private chat, group chat, offline date mode, search, message edits/deletes/regenerate, calls, wallet cards, forum share, moments, memories, context selection, backup restore, and phone browser flows.
10. **Soak and rollback:** keep rollback path and migration metadata for at least one stable release. If verification fails, keep the old store authoritative and report the exact failed conversation.
11. **Cleanup:** remove old localStorage chat keys only after multiple successful backups, verified restore, successful real-device acceptance, and explicit user approval. Default behavior is to retain old keys.

The migration must be resumable and idempotent. Running it twice must not duplicate messages or media.

## 6. Backup/restore requirements

Backup is a core safety feature, not a best-effort utility.

Required behavior:
- Versioned manifest listing every localStorage key group and IndexedDB database/store.
- Explicit count/size totals and skipped-record list.
- Every active database appears in one registry used by both export and import.
- Secrets excluded by default; user opt-in must be explicit, separately confirmed, and clearly labeled.
- User can export role-scoped data or a full-device backup, with dependency handling for referenced media.
- Restore validates the full archive before changing live data.
- Restore writes to staging or creates an automatic pre-restore snapshot; if any store fails, restore reports partial state and provides rollback.
- Restore validates roles, conversations, message totals, asset references, and book/font/diary record counts after writing.
- No silent partial success.
- Large backup operations are chunked/streamed where possible to avoid mobile memory spikes.
- Export must never silently omit Blob payloads. Exclusions must be visible in the export result.

## 7. Storage diagnostics and quota UX

Create a read-only storage diagnostics service and Settings UI.

Show:
- estimated origin usage and quota from navigator.storage.estimate() where supported;
- localStorage total and largest keys (key names and byte estimates only; never reveal content);
- IndexedDB database/store record counts and approximate sizes where measurable;
- largest role/conversation/media collections;
- last successful backup and most recent migration status;
- write failures and quota errors with timestamps.

Actions:
- export a backup;
- retry failed migration;
- inspect the largest storage categories;
- remove only selected disposable caches after confirmation.

Do not offer a “free space” button that clears everything. Do not auto-delete chats, memories, worldbooks, photos, or books. navigator.storage.persist() may be requested only with an honest explanation and must handle denial; it is not a guaranteed quota increase.

## 8. Browser/platform limitations

- localStorage and IndexedDB belong to the website origin and browser profile. Switching hostnames, protocols, browsers, or devices may expose a separate empty store.
- Browser quotas are implementation/device-dependent; estimate rather than hard-code a universal IndexedDB limit.
- Browser storage can be evicted under some conditions. Encourage regular exports and test restore.
- Private browsing, storage restrictions, and low disk space may affect availability.
- The app must keep clear error handling when IndexedDB is blocked/unavailable or quota is exceeded.

## 9. Storage migration acceptance checklist

- [ ] All current DBs and stores registered; no untracked active DB.
- [ ] Export includes every declared store and all required blobs.
- [ ] Restore into a clean browser profile reconstructs the same role, conversation, media, book, font, and diary counts.
- [ ] Legacy chat data is still readable.
- [ ] Private, group, online, and date-mode histories remain isolated and correctly ordered.
- [ ] Rich message payloads and unknown fields survive.
- [ ] Failed writes never display a false success state.
- [ ] Migration can resume after refresh/crash without duplicates.
- [ ] No original key is deleted automatically.
- [ ] Mobile storage diagnostics and backup/restore tested on a real phone browser.
