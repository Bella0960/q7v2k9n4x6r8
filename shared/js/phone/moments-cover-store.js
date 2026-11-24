/* Dedicated Moments cover storage: independent of desktop and profile backgrounds. */
(function (root) {
    'use strict';
    var DB = 'maomao-moments-cover', STORE = 'covers', KEY = 'main';
    function transact(mode, operation) {
        return new Promise(function (resolve, reject) {
            var req = root.indexedDB.open(DB, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onerror = function () { reject(req.error); };
            req.onblocked = function () { reject(new Error('封面存储被占用')); };
            req.onsuccess = function () {
                var db = req.result, tx, result;
                try {
                    tx = db.transaction(STORE, mode);
                    var op = operation(tx.objectStore(STORE));
                    op.onsuccess = function () { result = op.result; };
                    tx.oncomplete = function () { db.close(); resolve(result); };
                    tx.onabort = tx.onerror = function () { db.close(); reject(tx.error || new Error('封面存储失败')); };
                } catch (e) { db.close(); reject(e); }
            };
        });
    }
    function get() {
        return transact('readonly', function (store) { return store.get(KEY); }).then(function (record) {
            return record && typeof record.dataUrl === 'string' ? record.dataUrl : '';
        });
    }
    function save(dataUrl) {
        if (typeof dataUrl !== 'string' || !/^data:image\\/(?:jpeg|png|webp);base64,/i.test(dataUrl))
            return Promise.reject(new Error('封面格式无效'));
        return transact('readwrite', function (store) {
            return store.put({dataUrl:dataUrl,updatedAt:Date.now()}, KEY);
        }).then(get).then(function (saved) {
            if (saved !== dataUrl) throw new Error('封面保存校验失败');
            return true;
        });
    }
    root.MomentsCoverStore = {get:get, save:save};
})(window);
