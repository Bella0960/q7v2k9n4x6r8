/*
 * Opt-in guarded history mutations for cooperating tabs.
 * Keep the existing chat_history_<id> key and every message field unchanged.
 * Legacy synchronous writers are not covered; never claim global atomicity.
 */
(function (global) {
    'use strict';

    function fail(code, meta) {
        var result = { ok: false, error: { code: code } };
        if (meta) result.meta = meta;
        return result;
    }

    function validMessage(message) {
        return !!message && typeof message === 'object' && !Array.isArray(message);
    }

    // Web Locks serialize writers. Chromium can deliver localStorage updates to
    // another renderer after the lock handoff, so acknowledge that visibility
    // before reporting a commit. No alternate history store is introduced.
    var writerId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var coordinatorPromise = null;
    var coordinatorScope = null;
    async function historyCoordinator(manager, scope) {
        if (typeof global.addEventListener !== 'function') return null; // injected storage adapters
        if (!global.BroadcastChannel || !manager.query) throw new Error('coordination unavailable');
        if (coordinatorPromise && coordinatorScope === scope) return coordinatorPromise;
        if (coordinatorPromise) (await coordinatorPromise).close();
        coordinatorScope = scope;
        coordinatorPromise = new Promise(function (resolve, reject) {
            var id = writerId;
            var prefix = 'maomao:chat-history-peer:' + scope + ':';
            var channel = new global.BroadcastChannel(prefix);
            var waits = new Map();
            var observations = new Map();
            var committed = new Map();
            var release;
            var closed = false;
            var dirty = false;
            function send(message) {
                if (!closed) channel.postMessage(Object.assign({ sender: id }, message));
            }
            function acknowledge(token, phase, target, key) { send({ token: token, phase: phase, target: target, dirty: dirty, known: committed.has(key), value: committed.get(key) }); }
            function onStorage() {
                observations.forEach(function (item, token) {
                    try {
                        if (global.localStorage.getItem(item.key) === item.value) {
                            committed.set(item.key, item.value);
                            acknowledge(token, 'visible', item.sender, item.key);
                            observations.delete(token);
                        }
                    } catch (error) {}
                });
            }
            channel.onmessage = function (event) {
                var message = event.data;
                if (!message || (message.target && message.target !== id)) return;
                if (message.phase === 'probe') acknowledge(message.token, 'ready', message.sender, message.key);
                if (message.phase === 'prepare') {
                    observations.set(message.token, message);
                    acknowledge(message.token, 'prepared', message.sender);
                    onStorage();
                }
                if (message.phase === 'cancel') observations.delete(message.token);
                var wait = waits.get(message.token + ':' + message.phase);
                if (wait && wait.peers.has(message.sender)) {
                    if (message.dirty) {
                        wait.reject(new Error('previous write unverified'));
                        return;
                    }
                    wait.values.push(message);
                    wait.peers.delete(message.sender);
                    if (!wait.peers.size) wait.resolve();
                }
            };
            function waitFor(token, phase, peers) {
                if (!peers.length) return Promise.resolve([]);
                return new Promise(function (resolveWait, rejectWait) {
                    var key = token + ':' + phase;
                    var timer = global.setTimeout(function () { waits.delete(key); send({ token: token, phase: 'cancel' }); rejectWait(new Error('storage visibility timeout')); }, 3000);
                    waits.set(key, {
                        peers: new Set(peers), values: [],
                        resolve: function () { global.clearTimeout(timer); var values = waits.get(key).values; waits.delete(key); resolveWait(values); },
                        reject: function (error) { global.clearTimeout(timer); waits.delete(key); rejectWait(error); }
                    });
                });
            }
            function close() {
                if (closed) return;
                closed = true;
                waits.forEach(function (wait) { wait.reject(new Error('page closed')); });
                channel.close();
                global.removeEventListener('storage', onStorage);
                global.removeEventListener('pagehide', close);
                if (release) release();
                coordinatorPromise = null;
            }
            var coordinator = {
                close: close,
                block: function () { dirty = true; },
                probe: async function (key) {
                    if (closed || dirty) throw new Error('storage coordinator unavailable');
                    var state = await manager.query();
                    var peers = state.held.filter(function (lock) {
                        return lock.name.startsWith(prefix) && lock.name !== prefix + id;
                    }).map(function (lock) { return lock.name.slice(prefix.length); });
                    var token = id + ':' + Math.random().toString(36).slice(2);
                    var ready = waitFor(token, 'ready', peers);
                    peers.forEach(function (peer) { send({ target: peer, token: token, phase: 'probe', key: key }); });
                    var replies = await ready;
                    var known = replies.filter(function (reply) { return reply.known; });
                    if (known.length) {
                        var expected = known[0].value;
                        if (known.some(function (reply) { return reply.value !== expected; })) throw new Error('storage peer mismatch');
                        var until = Date.now() + 3000;
                        while (global.localStorage.getItem(key) !== expected) {
                            if (Date.now() >= until) throw new Error('storage view did not synchronize');
                            await new Promise(function (resolveTask) { global.setTimeout(resolveTask, 0); });
                        }
                    }
                    return peers;
                },
                prepare: async function (key, value, peers) {
                    var token = id + ':' + Math.random().toString(36).slice(2);
                    var prepared = waitFor(token, 'prepared', peers);
                    // Install the observer wait before any peer can acknowledge it.
                    var visible = waitFor(token, 'visible', peers);
                    visible.catch(function () {}); // awaited after the primary write
                    peers.forEach(function (peer) {
                        send({ target: peer, token: token, phase: 'prepare', key: key, value: value });
                    });
                    await prepared;
                    return {
                        verified: async function () {
                            try { await visible; committed.set(key, value); }
                            catch (error) { dirty = true; throw error; }
                            finally { send({ token: token, phase: 'cancel' }); }
                        }
                    };
                }
            };
            global.addEventListener('storage', onStorage);
            global.addEventListener('pagehide', close);
            manager.request(prefix + id, { mode: 'exclusive' }, function () {
                if (closed) { reject(new Error('page closed')); return; }
                resolve(coordinator);
                return new Promise(function (resolveRelease) { release = resolveRelease; });
            }).catch(reject);
        });
        return coordinatorPromise;
    }

    // All operations use the same per-conversation lock. The entire
    // read/check/write/readback sequence runs inside the lock callback.
    async function withLatest(contactId, operation, initial) {
        var id = String(contactId == null ? '' : contactId);
        if (!id) return fail('VALIDATION_FAILED');
        var lockManager = global.navigator && global.navigator.locks;
        if (!lockManager || typeof lockManager.request !== 'function') return fail('LOCK_UNAVAILABLE');

        // Authenticated MAO pages expose a scoped Storage proxy. Match its
        // account identity in the lock name so two users with the same role
        // ID cannot block each other's browser tabs. Legacy pages keep the
        // original lock name for backward compatibility.
        var accountScope = global.__MAO_ACCOUNT_SCOPE__;
        var identityMeta = global.document && typeof global.document.querySelector === 'function'
            ? global.document.querySelector('meta[name="mao-account-id"]') : null;
        var declaredAccount = identityMeta && String(identityMeta.content || '').trim();
        if (declaredAccount && (!accountScope || accountScope.ready !== true ||
            accountScope.accountId !== declaredAccount)) return fail('ACCOUNT_SCOPE_UNAVAILABLE');
        var lockScope = accountScope && accountScope.ready === true && accountScope.accountId
            ? encodeURIComponent(String(accountScope.accountId)) + ':' : '';
        var key = 'chat_history_' + id;
        try {
            var coordinator = await historyCoordinator(lockManager, lockScope);
            return await lockManager.request('maomao:chat-history:' + lockScope + id, { mode: 'exclusive' }, async function () {
                var currentScope = global.__MAO_ACCOUNT_SCOPE__;
                var currentLockScope = currentScope && currentScope.ready === true && currentScope.accountId
                    ? encodeURIComponent(String(currentScope.accountId)) + ':' : '';
                if (currentLockScope !== lockScope) return fail('ACCOUNT_SCOPE_UNAVAILABLE');
                var peers = coordinator ? await coordinator.probe(key) : [];
                var raw;
                try { raw = global.localStorage.getItem(key); }
                catch (e) { return fail('DB_UNAVAILABLE'); }
                var latest;
                if (raw === null && initial !== undefined) {
                    // Read legacy history inside the same account/conversation lock.
                    var legacyRaw;
                    try { legacyRaw = global.localStorage.getItem('phone_data_v2'); }
                    catch (error) { return fail('DB_UNAVAILABLE'); }
                    var legacy;
                    try { legacy = legacyRaw === null ? {} : JSON.parse(legacyRaw); }
                    catch (error) { return fail('CORRUPT_DATA'); }
                    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return fail('CORRUPT_DATA');
                    var bucket = legacy[id];
                    if (bucket != null && (typeof bucket !== 'object' || Array.isArray(bucket))) return fail('CORRUPT_DATA');
                    if (bucket && bucket.chat != null && (typeof bucket.chat !== 'object' || Array.isArray(bucket.chat))) return fail('CORRUPT_DATA');
                    var history = bucket && bucket.chat && bucket.chat.history;
                    if (history != null && !Array.isArray(history)) return fail('CORRUPT_DATA');
                    latest = JSON.parse(JSON.stringify(history == null ? initial : history));
                } else {
                    if (raw === null) return fail('NOT_FOUND');
                    try { latest = JSON.parse(raw); }
                    catch (error) { return fail('CORRUPT_DATA'); }
                    if (!Array.isArray(latest)) return fail('CORRUPT_DATA');
                }

                var decision;
                try { decision = operation(latest); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (!decision || decision.ok !== true) return decision || fail('VALIDATION_FAILED');

                if (!Array.isArray(decision.value)) return fail('VALIDATION_FAILED');
                var meta = { contactId: id, total: decision.value.length };
                if (decision.alreadyPersisted) meta.alreadyPersisted = true;
                // Replays with an already-persisted mid must not rewrite the
                // entire history, which would also risk clobbering metadata.
                if (raw !== null && decision.alreadyPersisted && decision.value === latest) {
                    return { ok: true, value: decision.output, meta: meta };
                }
                var updated;
                try { updated = JSON.stringify(decision.value); }
                catch (e) { return fail('VALIDATION_FAILED'); }
                if (typeof updated !== 'string') return fail('VALIDATION_FAILED');

                // A browser adapter can commit setItem then throw, or reject a
                // post-write read. Never tell a caller to roll back media refs
                // unless we know the write did not persist.
                var writeAttempted = false;
                try {
                    writeAttempted = true;
                    var barrier = coordinator ? await coordinator.prepare(key, updated, peers) : null;
                    global.localStorage.setItem(key, updated);
                    if (global.localStorage.getItem(key) !== updated) {
                        if (coordinator) coordinator.block();
                        return fail('VERIFY_FAILED', { writeMayHavePersisted: true });
                    }
                } catch (e) {
                    var failure = e && (e.name === 'QuotaExceededError' ||
                        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') ? 'QUOTA_EXCEEDED' : 'DB_UNAVAILABLE';
                    try {
                        var found = global.localStorage.getItem(key);
                        if (found === updated) {
                            if (barrier) {
                                try { await barrier.verified(); }
                                catch (visibilityError) { return fail('VERIFY_FAILED', { writeMayHavePersisted: true }); }
                            }
                            meta.verifiedAfterWriteError = true;
                            return { ok: true, value: decision.output, meta: meta };
                        }
                        if (found === raw) return fail(failure);
                    } catch (probeError) {}
                    if (coordinator && writeAttempted) coordinator.block();
                    return fail(failure, writeAttempted ? { writeMayHavePersisted: true } : null);
                }
                if (barrier) {
                    try { await barrier.verified(); }
                    catch (error) { return fail('VERIFY_FAILED', { writeMayHavePersisted: true }); }
                }
                return { ok: true, value: decision.output, meta: meta };
            });
        } catch (e) {
            return fail('LOCK_FAILED');
        }
    }

    function guardAllows(guard, latest) {
        if (!guard) return true;
        try {
            // Guards are observers, never storage mutators. Give callbacks a
            // separate snapshot so a badly behaved guard cannot alter data.
            return guard(JSON.parse(JSON.stringify(latest))) === true;
        } catch (e) { return null; }
    }

    var ChatHistoryAtomic = {
        writerId: writerId,
        initializeIfAbsent: async function (contactId, initial) {
            if (!Array.isArray(initial)) return fail('VALIDATION_FAILED');
            return withLatest(contactId, function (latest) {
                return { ok: true, value: latest, output: latest, alreadyPersisted: true };
            }, initial);
        },

        // One or more ordinary/AI/group message bubbles are appended together.
        // The caller may check the latest state under the lock via guard.
        appendManyIf: async function (contactId, messages, guard) {
            if (!Array.isArray(messages) || !messages.length ||
                !messages.every(validMessage) ||
                (guard != null && typeof guard !== 'function')) return fail('VALIDATION_FAILED');

            return withLatest(contactId, function (latest) {
                var allowed = guardAllows(guard, latest);
                if (allowed === null) return fail('GUARD_FAILED');
                if (!allowed) return fail('STALE_CONTEXT');

                var pending = [];
                var seen = Object.create(null);
                for (var i = 0; i < messages.length; i++) {
                    var item = messages[i];
                    if (item.mid == null || String(item.mid) === '') {
                        pending.push(item);
                        continue;
                    }
                    var mid = String(item.mid);
                    if (Object.prototype.hasOwnProperty.call(seen, mid)) {
                        if (seen[mid] !== JSON.stringify(item)) return fail('CONFLICT');
                        continue;
                    }
                    seen[mid] = JSON.stringify(item);
                    var existing = null;
                    for (var j = 0; j < latest.length; j++) {
                        if (latest[j] && latest[j].mid != null && String(latest[j].mid) === mid) {
                            existing = latest[j];
                            break;
                        }
                    }
                    if (existing) {
                        if (JSON.stringify(existing) !== JSON.stringify(item)) return fail('CONFLICT');
                    } else {
                        pending.push(item);
                    }
                }
                var skipped = messages.length - pending.length;
                return {
                    ok: true, value: pending.length ? latest.concat(pending) : latest,
                    alreadyPersisted: pending.length === 0,
                    output: { appended: pending.length, skipped: skipped }
                };
            });
        },

        // Backward compatible response shape for the existing notifier.
        appendIf: async function (contactId, message, guard) {
            if (!validMessage(message)) return fail('VALIDATION_FAILED');
            var outcome = await ChatHistoryAtomic.appendManyIf(contactId, [message], guard);
            if (!outcome.ok) return outcome;
            return { ok: true, value: message, meta: outcome.meta };
        },

        // For edits, removals or regenerated replies: reject changes when
        // any other tab has modified this conversation since it was read.
        // Do not silently merge destructive operations with newer messages.
        replaceIfUnchanged: async function (contactId, expected, replacement) {
            if (!Array.isArray(expected) || !Array.isArray(replacement)) {
                return fail('VALIDATION_FAILED');
            }
            return withLatest(contactId, function (latest) {
                if (JSON.stringify(latest) !== JSON.stringify(expected)) {
                    return fail('CONFLICT');
                }
                return { ok: true, value: replacement, output: {
                    replaced: true
                } };
            });
        }
    };

    global.ChatHistoryAtomic = ChatHistoryAtomic;
})(window);
