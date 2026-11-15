/* MAOMAO group AI turn: one write barrier for message-attached side effects.
 * Same message-history save owns vote/chain mutations; group governance,
 * relationships and private notices run only AFTER the reply is persisted.
 * No parallel chat engine or secondary group database is created.
 */
(function (root) {
  'use strict';
  if (root.GroupTurnEffects) return;
  function create() {
    var undos = [], after = [], finalized = false;
    function registerUndo(fn) {
      if (finalized || typeof fn !== 'function') return false;
      undos.push(fn);
      return true;
    }
    function registerAfterSave(fn) {
      if (finalized || typeof fn !== 'function') return false;
      after.push(fn);
      return true;
    }
    function finalize(replySaved) {
      if (finalized) return { ok:false, code:'ALREADY_FINALIZED' };
      finalized = true;
      if (replySaved !== true) {
        var undoErrors = 0;
        for (var i=undos.length-1; i>=0; i--) {
          try { undos[i](); } catch(e) { undoErrors++; }
        }
        return { ok:undoErrors===0, saved:false, rolledBack:undos.length,
          undoErrors:undoErrors, committed:0 };
      }
      var failed = 0, committed = 0;
      after.forEach(function (action) {
        try {
          var result = action();
          // Every handler must explicitly confirm success. An undefined, empty,
          // or malformed return value is NOT proof that storage committed.
          if (result === true || (result && result.ok === true)) committed++;
          else failed++;
        } catch (e) { failed++; }
      });
      return { ok:failed===0, saved:true, rolledBack:0, committed:committed,
        postCommitFailures:failed };
    }
    return Object.freeze({
      registerUndo:registerUndo,
      afterSave:registerAfterSave,
      finalize:finalize
    });
  }
  root.GroupTurnEffects=Object.freeze({ create:create });
})(typeof window!=='undefined'?window:globalThis);
