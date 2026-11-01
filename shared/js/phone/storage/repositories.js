/* ============================================================
 * repositories.js  ——  聚合入口：一次性加载全部 Repository 类
 *
 * 加载顺序（必须）：
 *   1. phone_storage.js        （提供 PhoneStorage.result、PhoneStorage.Repository 基类）
 *   2. storage/repository.js   （基类本身）
 *   3. storage/*.js            （各领域 Repository）
 *   4. repositories.js         （本文件，仅做统一 re-export 和便捷实例）
 *
 *   <script src="shared/js/phone/phone_storage.js"></script>
 *   <script src="shared/js/phone/storage/repository.js"></script>
 *   <script src="shared/js/phone/storage/character-repository.js"></script>
 *   <script src="shared/js/phone/storage/profile-repository.js"></script>
 *   <script src="shared/js/phone/storage/group-repository.js"></script>
 *   <script src="shared/js/phone/storage/settings-repository.js"></script>
 *   <script src="shared/js/phone/storage/conversation-repository.js"></script>
 *   <script src="shared/js/phone/storage/memory-repository.js"></script>
 *   <script src="shared/js/phone/storage/worldbook-repository.js"></script>
 *   <script src="shared/js/phone/storage/repositories.js"></script>
 *
 * 便捷用法：
 *   var repos = PhoneStorage.repos;
 *   repos.characters.save(newChar);
 *   repos.conversations.appendMessage(contactId, msg);
 *
 * 本文件仅聚合，不创建任何单例实例（避免过早访问 localStorage 引发副作用）。
 * 所有实例化按需调用工厂函数（见下）。
 * ============================================================ */

(function (global) {
    'use strict';

    var _PS = global.PhoneStorage = global.PhoneStorage || {};

    // 防御性检查：基类缺失时直接跳过聚合，不抛错（允许部分加载）
    if (!_PS.Repository) {
        console.warn('[PhoneStorage.repos] Repository base class not loaded; repos aggregator skipped.');
        return;
    }

    var Factories = {
        characters:  function (storage) { return new _PS.CharacterRepository(storage); },
        profile:     function (storage) { return new _PS.ProfileRepository(storage); },
        groups:      function (storage) { return new _PS.GroupRepository(storage); },
        settings:    function (storage) { return new _PS.SettingsRepository(storage); },
        conversations:function (storage) { return new _PS.ConversationRepository(storage); },
        memories:    function (storage) { return new _PS.MemoryRepository(storage); },
        worldbooks:  function (storage) { return new _PS.WorldbookRepository(storage); }
    };

    /**
     * 按需工厂：repos.characters(storage?) → CharacterRepository 实例
     * 不缓存，每次调用新建（调用方可以自行缓存）。
     */
    _PS.repos = Factories;

    /**
     * 一次性创建全部实例（便于某些页面只需要 import 一次）。
     * 返回 { characters, profile, groups, settings, conversations, memories, worldbooks }
     */
    _PS.createAllRepos = function (storage) {
        return {
            characters:   Factories.characters(storage),
            profile:      Factories.profile(storage),
            groups:       Factories.groups(storage),
            settings:     Factories.settings(storage),
            conversations:Factories.conversations(storage),
            memories:     Factories.memories(storage),
            worldbooks:   Factories.worldbooks(storage)
        };
    };

})(window);
