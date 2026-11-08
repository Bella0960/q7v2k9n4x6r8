import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const tutorialPath = resolve(here, '../tutorial/tutorial.html');
const html = readFileSync(tutorialPath, 'utf8');
const index = readFileSync(resolve(here, '../index.html'), 'utf8');
const sw = readFileSync(resolve(here, '../sw.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
const tutorialWorkflow = readFileSync(resolve(here, '../.github/workflows/tutorial-regression.yml'), 'utf8');
const novelPage = readFileSync(resolve(here, '../novel/novel.html'), 'utf8');
const minimaxPage = readFileSync(resolve(here, '../settings/minimax-tts.html'), 'utf8');
const worldbookPage = readFileSync(resolve(here, '../worldbook/worldbook/worldbook.html'), 'utf8');
const cafePage = readFileSync(resolve(here, '../cafe/cafe.html'), 'utf8');
const libraryPage = readFileSync(resolve(here, '../library/library.html'), 'utf8');
const backupScript = readFileSync(resolve(here, '../settings/js/backup.js'), 'utf8');
const settingsPage = readFileSync(resolve(here, '../settings/settings.html'), 'utf8');

function readExtraLessons(source) {
  const match = source.match(/var extraLessons=(\[[\s\S]*?\]);\nlessons=lessons\.concat\(extraLessons\);/);
  assert.ok(match, 'additional feature lessons must be a valid JSON lesson collection');
  return JSON.parse(match[1]);
}

function readPage(relativePath) {
  const path = resolve(dirname(tutorialPath), relativePath);
  assert.ok(existsSync(path), 'guided tour page does not exist: ' + relativePath);
  return readFileSync(path, 'utf8');
}

function assertSelectorExists(source, selector, label) {
  const ids = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  for (const id of ids) {
    assert.ok(source.includes('id="' + id + '"') || source.includes("id='" + id + "'"), label + ' missing #' + id);
  }
  const attrs = [...selector.matchAll(/\[([a-zA-Z_-][\w-]*)(?:=["\\']([^"\\']+)["\\'])?\]/g)];
  for (const [, attr, value] of attrs) {
    assert.ok(source.includes(attr), label + ' missing [' + attr + ']');
    if (value) assert.ok(source.includes(value), label + ' missing selector value ' + value);
  }
  const classes = [...selector.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((m) => m[1]);
  for (const name of classes) {
    assert.ok(source.includes(name), label + ' missing .' + name);
  }
}

test('tutorial progress safely normalizes corrupted and outdated local storage', () => {
  const functionMatch = html.match(/function loadProgress\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(functionMatch, 'loadProgress must remain independently testable');
  const lessons = [
    { id: 'desktop', steps: [{}, {}] },
    { id: 'chat', steps: [{}, {}, {}] }
  ];
  const read = (saved) => {
    const fn = runInNewContext('(' + functionMatch[0] + ')', {
      KEY: 'maomao_tutorial_progress_v1',
      lessons,
      localStorage: { getItem: () => JSON.stringify(saved) }
    });
    return JSON.parse(JSON.stringify(fn()));
  };

  assert.deepEqual(read({
    done: 'corrupt',
    steps: { desktop: 'not-an-array', chat: [0, 2, 9, -1, '1', 1, 1] },
    last: { unexpected: true }
  }), {
    done: {},
    steps: { chat: [0, 2, 1] },
    last: 'desktop'
  });

  assert.deepEqual(read({
    done: { desktop: true, removedLesson: true, chat: 'yes' },
    steps: { chat: [2, 0, 0, 99] },
    last: 'chat'
  }), {
    done: { desktop: true },
    steps: { chat: [2, 0] },
    last: 'chat'
  });
});

test('tutorial app is linked from the desktop and included in the default layout', () => {
  assert.match(index, /data-href="tutorial\/tutorial\.html"[^>]*data-drag="app_tutorial"[^>]*data-name="教程"/);
  assert.match(index, /'app_tutorial'\s*\]/);
  assert.match(index, /addTutorialShortcutToExistingLayouts/);
  assert.equal(existsSync(tutorialPath), true);
});

test('tutorial offers the learning path, progress tracking and at least 50 lessons', () => {
  assert.match(html, /maomao_tutorial_progress_v1/);
  assert.match(html, /学习进度/);
  assert.match(html, /从这里，学会使用小手机/);
  assert.match(html, /data-step/);
  assert.match(html, /data-answer/);
  assert.match(html, /continueBtn/);
  const extra = readExtraLessons(html);
  assert.ok(extra.length >= 26, 'expected detailed app-by-app lessons in addition to the core course');
  const ids = new Set(extra.map((lesson) => lesson.id));
  for (const id of [
    'forum-post', 'music-player', 'takeout-order', 'couple-space',
    'growth-progress', 'daily-companion', 'cafe-management',
    'reading-workflow', 'envelope-letter', 'diary-journal',
    'novel-workshop', 'dream-travel', 'game-hall', 'offline-mode',
    'chat-rich-features', 'theme-store-guide', 'poster-archive', 'live-room',
    'desktop-widgets', 'chat-compose-and-media', 'chat-settings-and-autonomy',
    'group-chat-interactions', 'character-network', 'novel-author-tools',
    'cafe-menu-stock', 'novel-workflow'
  ]) assert.ok(ids.has(id), 'missing detailed lesson: ' + id);
});

test('guided tours load same-origin pages and their selector targets exist in real source files', () => {
  assert.match(html, /id="tourModal"/);
  assert.match(html, /id="tourFrame"/);
  assert.match(html, /function openGuidedTour\(lesson\)/);
  assert.match(html, /frame\.contentDocument/);
  assert.match(html, /data-maomao-tour-old-style/);
  assert.match(html, /library-settings/);
  const baseTours = [
    { path: '../settings/settings.html', selectors: ['#api-provider','#api-url','#api-key','#api-model','#btn-fetch-models','#settingsForm button[type="submit"]','#btn-test-connection','#api-image-model','#api-image-endpoint'] },
    { path: '../settings/minimax-tts.html', selectors: ['#enableToggle','#versionRow','#apiKey','#groupId','#modelGrid','#saveBtn'] },
    { path: '../settings/image-generation.html', selectors: ['#characterSelect','#appearance','#styleKeywords','#saveRole','#scene','#privateImage','#generateImage','#gallery'] },
    { path: '../worldbook/worldbook/worldbook.html', selectors: ['#btnAddFooter','#edName','#btnEditSave'] },
    { path: '../settings/font-settings.html', selectors: ['#fontUrlInput','#applyFontBtn','.file-pick','#fontSchemeName','#saveFontPresetBtn','#fontSizePreview','#restoreFontDefaults'] },
    { path: '../worldbook/characters/characters.html', selectors: ['#editRoleName','#editRolePersona','#editRoleTone','#editRoleAppearance','#editRoleStyleKeywords','#btnSaveRole'] }
  ];
  for (const tour of baseTours) {
    const page = readPage(tour.path);
    for (const selector of tour.selectors) assertSelectorExists(page, selector, tour.path);
  }
  const extra = readExtraLessons(html);
  const tourLessons = extra.filter((lesson) => lesson.tour);
  assert.ok(tourLessons.length >= 13, 'expected at least 13 detailed real-page tours');
  for (const lesson of tourLessons) {
    assert.ok(lesson.tour.url.startsWith('../'), 'tour must stay on the MAOMAO origin: ' + lesson.id);
    assert.ok(lesson.tour.steps.length >= 3, 'tour too short: ' + lesson.id);
    for (const step of lesson.tour.steps) {
      assert.ok(step.selector, 'tour step has no selector: ' + lesson.id);
      const stepPage = readPage(step.page || lesson.tour.url);
      assertSelectorExists(stepPage, step.selector, lesson.id + ' / ' + (step.page || lesson.tour.url));
    }
  }
  assert.match(html, /右侧是真实 MAOMAO 页面/);
});

test('chat guided tours follow the real list, detail and settings pages', () => {
  const listPage = readPage('../chat/chat/chat.html');
  const detailPage = readPage('../chat/chat/chat-detail.html');
  const settingsPage = readPage('../chat/chat/chat-settings.html');
  assertSelectorExists(listPage, '.chat-slim-card', 'chat list');
  assertSelectorExists(listPage, '.chat-group-card', 'group chat list');

  const tourBlock = (id) => {
    const start = html.indexOf("addTourConfig('" + id + "'");
    assert.ok(start >= 0, 'missing guided tour config: ' + id);
    const next = html.indexOf("\naddTourConfig('", start + 1);
    const end = next >= 0 ? next : html.indexOf('\nvar apps=', start);
    assert.ok(end > start, 'unterminated guided tour config: ' + id);
    return html.slice(start, end);
  };

  const compose = tourBlock('chat-compose-and-media');
  for (const selector of ['#chat-input', '#voice-input-btn', '#plus-action-btn', '.plus-item[data-feat="img"]']) {
    assertSelectorExists(detailPage, selector, 'chat compose / detail page');
    assert.ok(compose.includes("page:'../chat/chat/chat-detail.html',selector:'" + selector + "'"), 'chat compose step must target detail page: ' + selector);
  }

  const settings = tourBlock('chat-settings-and-autonomy');
  assertSelectorExists(detailPage, '#btn-more-menu', 'chat settings / detail page');
  assert.ok(settings.includes("page:'../chat/chat/chat-detail.html',selector:'#btn-more-menu'"));
  for (const selector of ['#actionBackground', '#pinToggle', '#memCard', '#actionSearchHistory', '#actionTimeAware', '#autoMomentToggle', '#proactiveContactToggle', '#proactiveContactInterval', '#followUpToggle', '#autoCommentToggle', '#autoInteractToggle']) {
    assertSelectorExists(settingsPage, selector, 'chat settings page');
    assert.ok(settings.includes("page:'../chat/chat/chat-settings.html',selector:'" + selector + "'"), 'settings step must target chat-settings page: ' + selector);
  }

  const group = tourBlock('group-chat-interactions');
  for (const selector of ['#plus-action-btn', '.plus-item[data-feat="group-poll"]', '#groupComposerQuestion', '#groupComposerOptions', '#groupComposerSubmit']) {
    assertSelectorExists(detailPage, selector, 'group interaction / detail page');
    assert.ok(group.includes("page:'../chat/chat/chat-detail.html',selector:'" + selector + "'"), 'group interaction step must target detail page: ' + selector);
  }

  assert.ok(html.includes('new URL(step.page||tour.url,window.location.href)'), 'guided tours must navigate to the page assigned to each step');
  assert.ok(html.includes('guidedFrameNavigationPending'), 'the iframe must only refocus after tutorial-controlled navigation, not user navigation');
});

test('tutorial app directory contains every desktop app shortcut with valid local routes', () => {
  const appBlock = html.match(/var apps=\[([\s\S]*?)\n\];/);
  assert.ok(appBlock, 'app directory must declare its desktop app map');
  const entries = [...appBlock[1].matchAll(/\['([^']+)','([^']+)','([^']+)'\]/g)];
  assert.ok(entries.length >= 29, 'expected a directory entry for every desktop app');
  const desktopNames = [...index.matchAll(/<button\\b(?=[^>]*\\bdata-drag="app_[^"]+")[^>]*\\bdata-name="([^"]+)"/g)].map((m) => m[1]);
  const directoryNames = entries.map((entry) => entry[1]);
  const indexNames = new Set(desktopNames);
  assert.equal(new Set(directoryNames).size, directoryNames.length, 'tutorial app directory must not contain duplicate names');
  assert.equal(directoryNames.length, desktopNames.length, 'tutorial directory must have one entry for every desktop application');
  for (const name of desktopNames) {
    assert.ok(directoryNames.includes(name), 'desktop app missing from tutorial directory: ' + name);
  }
  for (const entry of entries) {
    assert.ok(indexNames.has(entry[1]), 'missing desktop app in directory: ' + entry[1]);
    assert.ok(existsSync(resolve(dirname(tutorialPath), entry[3])), 'missing app route: ' + entry[3]);
  }
});

test('guided save steps verify real success and failure messages instead of manual checkboxes alone', () => {
  const extra = readExtraLessons(html);
  const cases = [
    ['forum-post', '#submitPost', '帖子已发布', '本机存储空间不足'],
    ['diary-journal', '#saveEntry', '已保存到你的日记', '照片保存失败'],
    ['envelope-letter', '#saveDraftButton', '草稿已保存', '保存失败'],
    ['reading-workflow', '#confirmBookImport', '加入书架', '书籍保存失败'],
    ['novel-workflow', '#saveWork', '作品设定已保存', '本机存储空间不足']
  ];
  for (const [id, selector, successText, failureText] of cases) {
    const lesson = extra.find((item) => item.id === id);
    assert.ok(lesson && lesson.tour, 'missing guided lesson: ' + id);
    const step = lesson.tour.steps.find((item) => item.selector === selector);
    assert.ok(step && step.verify, 'save step must define result verification: ' + id);
    assert.equal(step.verify.selector, '#toast');
    assert.ok(step.verify.success.some((text) => text.includes(successText)), 'missing success signal: ' + id);
    assert.ok(step.verify.failure.some((text) => text.includes(failureText)), 'missing failure signal: ' + id);
    assert.ok(step.verify.recovery.length > 10, 'missing recovery guidance: ' + id);
  }

  assert.match(html, /selector:'#wbToast',success:\['新建成功'\]/);
  assert.match(html, /selector:'#toast',success:\['已保存 TTS 设置'\]/);
  assert.match(html, /new MutationObserver\(inspect\)/);
  assert.match(html, /跳过核验并继续/);
});

test('guided verification distinguishes storage failure from a later successful retry', () => {
  const start = html.indexOf('function stopGuidedVerification()');
  const end = html.indexOf('function closeGuidedTour()', start);
  assert.ok(start >= 0 && end > start, 'guided verification helpers must remain a contiguous unit');
  const helperSource = html.slice(start, end);

  let lastObserver = null;
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; lastObserver = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const classes = new Set();
  const toast = {
    textContent: '',
    classList: { contains: (name) => classes.has(name) }
  };
  const ui = {
    tourVerification: { className: '', textContent: '' },
    tourNext: { textContent: '' },
    tourHint: { textContent: '' }
  };
  const sandbox = {
    MutationObserver: FakeMutationObserver,
    $: (id) => ui[id],
    activeTourLesson: null,
    activeTourIndex: 0
  };
  runInNewContext(
    "var guidedVerificationObserver=null,guidedVerificationState='none',guidedVerificationMessage='',guidedVerificationOverride=false;\n" + helperSource,
    sandbox
  );

  sandbox.beginGuidedVerification({
    verify: {
      selector: '#toast',
      success: ['已保存'],
      failure: ['保存失败'],
      recovery: '释放浏览器存储空间后重试。'
    }
  }, { querySelector: () => toast });
  assert.equal(sandbox.guidedVerificationState, 'waiting');

  toast.textContent = '保存失败：存储空间不足';
  classes.add('show');
  lastObserver.callback();
  assert.equal(sandbox.guidedVerificationState, 'failure');
  assert.match(ui.tourVerification.textContent, /释放浏览器存储空间后重试/);

  classes.delete('show');
  lastObserver.callback();
  toast.textContent = '已保存';
  lastObserver.callback();
  classes.add('show');
  lastObserver.callback();
  assert.equal(sandbox.guidedVerificationState, 'success');
  assert.match(ui.tourVerification.textContent, /已确认页面反馈：已保存/);

  sandbox.stopGuidedVerification();
  assert.equal(lastObserver.disconnected, true);
});

test('reader cleanup deletes books and comments in one IndexedDB transaction', async () => {
  const start = libraryPage.indexOf('function idbDeleteLocalBooksAndComments(removedIds)');
  const end = libraryPage.indexOf('function updateLocalBookFallback(removedIds)', start);
  assert.ok(start >= 0 && end > start, 'atomic reader cleanup transaction helper must exist');
  const helper = libraryPage.slice(start, end).trim().replace(/;$/, '');

  function fakeDatabase(commentRows) {
    const operations = [];
    let commentRequest;
    const transaction = {
      error: new Error('transaction failed'),
      objectStore(name) {
        if (name === 'books') {
          return { delete: (id) => operations.push({ store: name, id }) };
        }
        return {
          getAll() {
            commentRequest = { result: commentRows, onsuccess: null, onerror: null };
            return commentRequest;
          },
          delete: (id) => operations.push({ store: name, id })
        };
      },
      abort() { this.aborted = true; if (this.onabort) this.onabort(); }
    };
    const db = {
      transaction(names, mode) {
        assert.deepEqual(names, ['books', 'comments']);
        assert.equal(mode, 'readwrite');
        return transaction;
      }
    };
    return { db, transaction, operations, get commentRequest() { return commentRequest; } };
  }

  const fake = fakeDatabase([
    { id: 'comment-1', bookId: 'book-1' },
    { id: 'comment-2', bookId: 'book-2' }
  ]);
  const remove = runInNewContext('(' + helper + ')', {
    openReaderDb: () => Promise.resolve(fake.db),
    Promise,
    Set
  });
  const pending = remove(['book-1']);
  await Promise.resolve();
  assert.ok(fake.commentRequest && typeof fake.commentRequest.onsuccess === 'function');
  fake.commentRequest.onsuccess();
  fake.transaction.oncomplete();
  await pending;
  assert.deepEqual(fake.operations, [
    { store: 'books', id: 'book-1' },
    { store: 'comments', id: 'comment-1' }
  ]);

  const failed = fakeDatabase([{ id: 'comment-1', bookId: 'book-1' }]);
  const removeFailed = runInNewContext('(' + helper + ')', {
    openReaderDb: () => Promise.resolve(failed.db),
    Promise,
    Set
  });
  const rejected = removeFailed(['book-1']);
  await Promise.resolve();
  failed.commentRequest.onerror();
  await assert.rejects(rejected, /transaction failed|本地书籍删除/);
});

test('backup import snapshots IndexedDB before overwriting data and rolls back across databases', () => {
  const captureAt = backupScript.indexOf('captureIndexedDbRestorePoint(obj.indexedDB)');
  const localRestoreAt = backupScript.indexOf('var ok = restore(incoming)');
  const idbRestoreAt = backupScript.indexOf('restoreIndexedDBWithRollback(obj.indexedDB, idbRestorePoint)');
  assert.ok(captureAt >= 0 && captureAt < localRestoreAt, 'IndexedDB snapshot must be captured before localStorage changes');
  assert.ok(localRestoreAt < idbRestoreAt, 'IndexedDB restore starts only after localStorage write');
  assert.match(backupScript, /for \(var j = restored\.length - 1; j >= 0; j--\)/);
  assert.match(backupScript, /await restoreDatabase\([\s\S]{0,180}?restorePoint\.snapshots\[previous\.db\], true\)/);
  assert.match(backupScript, /var allRollbackOk = localRollbackOk && localRollbackVerify\.ok/);
  assert.match(backupScript, /部分回滚未能确认；本机恢复点已保留/);
  assert.match(backupScript, /RESTORE_POINT_IDB_MAX_BYTES/);
});

test('backup tutorial explains per-database rollback and retained recovery points', () => {
  const start = html.indexOf("{id:'backup'");
  const end = html.indexOf("\n{id:'api-errors'", start);
  assert.ok(start >= 0 && end > start, 'backup lesson must exist');
  const lesson = html.slice(start, end);
  assert.match(lesson, /每个数据库内部的多个表使用同一事务/);
  assert.match(lesson, /之前已成功恢复的数据库和 localStorage 也会回滚/);
  assert.match(lesson, /恢复点会保留/);
  assert.match(lesson, /超过安全容量/);
  assert.match(lesson, /普通备份只包含本地音频元数据/);
  assert.match(lesson, /相同 ID 的本地原文件/);
  assert.match(lesson, /音频文件本体需要另行转移并重新导入/);
  assert.match(lesson, /导出恢复点抢救包/);
  assert.match(lesson, /它是只读抢救材料/);
  assert.match(lesson, /抢救包可能含 API 密钥/);
  assert.match(backupScript, /db\.transaction\(storeNames, 'readwrite'\)/);
  assert.match(backupScript, /restoreIndexedDBWithRollback\(obj\.indexedDB, idbRestorePoint\)/);
  assert.match(backupScript, /RESTORE_POINT_IDB_MAX_BYTES/);
  assert.match(backupScript, /部分回滚未能确认；本机恢复点已保留/);
});

test('recovery-point rescue export is discoverable, read-only, and warns about sensitive contents', () => {
  assert.match(settingsPage, /id="rowExportRecoveryPoints"/);
  assert.match(backupScript, /rowExportRecoveryPoints/);
  assert.match(backupScript, /createRecoveryPointRescuePackage/);
  assert.match(backupScript, /createRecoveryRescueZip/);
  assert.match(backupScript, /恢复点抢救包已准备好/);
  assert.match(backupScript, /抢救包会包含当前仍可读取的原始恢复记录/);
  assert.match(backupScript, /原始恢复点未删除/);
  assert.match(backupScript, /rowDownloadRecoveryRescue/);
  assert.match(backupScript, /不是可直接导入的普通备份文件/);
});

test('reader cleanup walkthrough explains the destructive scope and verifies the real result', () => {
  const extra = readExtraLessons(html);
  const lesson = extra.find((item) => item.id === 'reader-cleanup');
  assert.ok(lesson && lesson.tour, 'reader cleanup must have a dedicated walkthrough');
  assert.match(lesson.lead, /批量清理/);
  assert.match(lesson.lead, /备份/);
  assert.match(lesson.tour.steps[0].text, /只有在你确实想清空/);
  assert.match(lesson.tour.steps[0].text, /系统确认框/);
  const step = lesson.tour.steps[0];
  assert.equal(step.selector, '#clearRow');
  assert.equal(step.verify.selector, '#toast');
  assert.ok(step.verify.success.includes('已清空本地书籍'));
  assert.ok(step.verify.failure.includes('清空失败'));
  assert.ok(step.verify.recovery);
  assertSelectorExists(libraryPage, '#clearRow', 'reader cleanup action');
  assertSelectorExists(libraryPage, '#toast', 'reader cleanup feedback');
});

test('reader bulk cleanup is transactional and never silently succeeds after IndexedDB errors', () => {
  assert.match(libraryPage, /db\.transaction\(\['books', 'comments'\], 'readwrite'\)/);
  assert.match(libraryPage, /commentsRequest\.onsuccess\s*=\s*function/);
  assert.match(libraryPage, /commentsRequest\.onerror\s*=\s*function/);
  assert.match(libraryPage, /tx\.oncomplete\s*=\s*function/);
  assert.match(libraryPage, /tx\.onabort\s*=\s*function/);
  assert.match(libraryPage, /return idbDeleteLocalBooksAndComments\(removedIds\)\.catch/);
  assert.match(libraryPage, /rollbackFallback\(\)/);
  assert.match(libraryPage, /var localBooksCleanupBusy = false/);
  assert.match(libraryPage, /if \(localBooksCleanupBusy\) return/);
  assert.doesNotMatch(libraryPage, /idbDelete\('books',[\s\S]{0,120}?catch\(function\s*\(\)\s*\{\s*\}\)/);
});

test('reader cleanup restores fallback books and comments if a write fails', () => {
  const start = libraryPage.indexOf('function updateLocalBookFallback(removedIds)');
  const end = libraryPage.indexOf('function removeLocalBooks()', start);
  assert.ok(start >= 0 && end > start, 'fallback cleanup helper must exist');
  const helper = libraryPage.slice(start, end).trim().replace(/;$/, '');
  const bookKey = 'maomao_reader_local_books_v1';
  const commentKey = 'maomao_reader_comments_v1';
  const originalBooks = JSON.stringify([{ id: 'book-1' }, { id: 'book-2' }]);
  const originalComments = JSON.stringify([{ id: 'note-1', bookId: 'book-1' }, { id: 'note-2', bookId: 'book-2' }]);

  function storage(failCommentWrite) {
    const map = new Map([[bookKey, originalBooks], [commentKey, originalComments]]);
    let shouldFail = failCommentWrite;
    return {
      map,
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) {
        if (key === commentKey && shouldFail) { shouldFail = false; throw new Error('QuotaExceededError'); }
        map.set(key, String(value));
      },
      removeItem(key) { map.delete(key); }
    };
  }

  const brokenStorage = storage(true);
  const updateBroken = runInNewContext('(' + helper + ')', { localStorage: brokenStorage, Set, JSON });
  assert.throws(() => updateBroken(['book-1']), /QuotaExceededError/);
  assert.equal(brokenStorage.getItem(bookKey), originalBooks, 'book fallback must roll back after comment write fails');
  assert.equal(brokenStorage.getItem(commentKey), originalComments, 'comment fallback must remain unchanged');

  const goodStorage = storage(false);
  const updateGood = runInNewContext('(' + helper + ')', { localStorage: goodStorage, Set, JSON });
  const rollback = updateGood(['book-1']);
  assert.deepEqual(JSON.parse(goodStorage.getItem(bookKey)), [{ id: 'book-2' }]);
  assert.deepEqual(JSON.parse(goodStorage.getItem(commentKey)), [{ id: 'note-2', bookId: 'book-2' }]);
  rollback();
  assert.equal(goodStorage.getItem(bookKey), originalBooks);
  assert.equal(goodStorage.getItem(commentKey), originalComments);
});

test('cafe custom dish save rolls back in-memory state when persistence fails', () => {
  assert.match(cafePage, /function save\(\)\{try\{localStorage\.setItem\('maomao_cafe_state_v1',JSON\.stringify\(st\)\);return true;\}catch\(e\)\{return false;\}\}/);
  assert.match(cafePage, /var previousState=JSON\.stringify\(st\)/);
  assert.match(cafePage, /if\(!save\(\)\)\{st=JSON\.parse\(previousState\);toast\('菜品保存失败：请检查浏览器存储空间。'\);return;\}/);
  assert.match(cafePage, /toast\(old\?'菜品配方已更新。':'新菜品已加入菜单。'\)/);
});

test('every guided save verifier points to a real toast and an existing action control', () => {
  const extra = readExtraLessons(html);
  const cases = [
    ['forum-post', '#submitPost', '../forum/forum.html'],
    ['diary-journal', '#saveEntry', '../diary/diary.html'],
    ['envelope-letter', '#saveDraftButton', '../envelope/envelope.html'],
    ['reading-workflow', '#confirmBookImport', '../library/library.html'],
    ['novel-workflow', '#saveWork', '../novel/novel.html'],
    ['cafe-menu-stock', '[data-save-dish]', '../cafe/cafe.html']
  ];
  for (const [id, actionSelector, pagePath] of cases) {
    const lesson = extra.find((item) => item.id === id);
    const step = lesson && lesson.tour.steps.find((item) => item.selector === actionSelector);
    assert.ok(step && step.verify, id + ' must declare a verified save step');
    assertSelectorExists(readPage(pagePath), actionSelector, id + ' action');
    assertSelectorExists(readPage(pagePath), step.verify.selector, id + ' result feedback');
    assert.ok(step.verify.success.length > 0 && step.verify.failure.length > 0);
    assert.ok(step.verify.recovery);
  }

  const worldbook = html.slice(html.indexOf("addTourConfig('worldbook'"), html.indexOf("addTourConfig('fonts'"));
  const tts = html.slice(html.indexOf("addTourConfig('minimax-tts'"), html.indexOf("addTourConfig('image-generate'"));
  assert.match(worldbookPage, /wbToast/);
  assert.match(worldbook, /selector:'#wbToast',success:\['新建成功'\]/);
  assert.match(tts, /selector:'#toast',success:\['已保存 TTS 设置'\]/);
  assert.match(minimaxPage, /id="toast"/);
});

test('novel and MiniMax settings do not claim save success when local storage fails', () => {
  assert.match(novelPage, /function persist\(\)\{try\{localStorage\.setItem\(KEY,JSON\.stringify\(db\)\);renderStats\(\);return true\}catch\(e\)\{toast\('本机存储空间不足，请先导出作品备份'\);return false\}\}/);
  assert.match(novelPage, /\$\('saveWork'\)\.onclick=\(\)=>\{syncWork\(\);if\(!persist\(\)\)return;renderAll\(\);toast\('作品设定已保存'\)\}/);
  assert.match(minimaxPage, /function save\(cfg\)\s*\{\s*try \{ localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(cfg\)\); return true; \}\s*catch \(e\) \{ return false; \}\s*\}/);
  assert.match(minimaxPage, /if \(!save\(cfg\)\) \{ showToast\('保存失败：请检查浏览器存储空间'\); return; \}/);
});

test('desktop widget fallback preserves the tutorial shortcut and renders guided-tour controls', () => {
  const widgetPage = readPage('../desktop/widgets.html');
  const fallbackStart = widgetPage.indexOf('if (!cur) { cur =');
  assert.ok(fallbackStart >= 0, 'widget page must keep a safe fallback layout');
  const fallbackEnd = widgetPage.indexOf('}; }', fallbackStart);
  assert.ok(fallbackEnd > fallbackStart, 'widget fallback layout must be complete');
  assert.match(widgetPage.slice(fallbackStart, fallbackEnd), /'app_tutorial'/,
    'the fallback layout must preserve the tutorial desktop shortcut');
  assert.match(widgetPage, /li\.className = 'widget-item'/,
    'widget rows are rendered dynamically for the tutorial target');
  assert.match(widgetPage, /btn\.className = 'w-btn'/,
    'widget actions are rendered dynamically for the tutorial target');
  assert.match(html, /selector:'\.widget-item'/);
  assert.match(html, /selector:'\.widget-item \.w-btn'/);
});

test('API practice stays local-only and MIX is not given invented connection details', () => {
  assert.match(html, /没有发出网络请求，也没有保存任何内容/);
  assert.match(html, /当前状态：待确认/);
  assert.match(html, /没有找到能够确认名称为「MIX」的独立配置入口/);
  assert.doesNotMatch(html, /XMLHttpRequest|navigator\.sendBeacon|fetch\s*\(/);
  assert.match(html, /API Key 是账户凭证/);
  assert.match(html, /教程不会读取或显示输入框里的密钥/);
  assert.doesNotMatch(html, /getElementById\(['\"]api-key['\"]\)\s*\.value/);
});

test('novel workshop guide reflects current local-template behavior', () => {
  const extra = readExtraLessons(html);
  const lesson = extra.find((item) => item.id === 'novel-workshop');
  assert.ok(lesson);
  const body = [lesson.lead, ...lesson.steps.map((step) => step.join(' ')), ...lesson.tips.map((tip) => tip.join(' '))].join(' ');
  assert.match(body, /本地/);
  assert.match(body, /真实 AI 生成尚未接入/);
});

test('PWA caches the tutorial app and dedicated CI runs tests, layout check and build', () => {
  assert.match(sw, /phone-app-pwa-v177/);
  assert.match(sw, /'\.\/tutorial\/tutorial\.html'/);
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-app-contract.test.mjs');
  assert.match(tutorialWorkflow, /npm run test:tutorial/);
  assert.match(tutorialWorkflow, /npm run test:desktop:layout/);
  assert.match(tutorialWorkflow, /npm run build/);
});
