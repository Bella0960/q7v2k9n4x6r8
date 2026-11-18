/* MiniMax TTS: opt-in speech synthesis. No automatic billable requests.
 * Existing localStorage keys are preserved; generated audio stays in memory.
 * Caller explicitly supplies a Voice ID or uses the role-specific override.
 */
(function (global) {
    'use strict';
    var NS = global.PhoneMiniMaxTTS = {};
    var STORAGE_KEY = 'minimax_tts_config';
    var ROOTS = { cn:'https://api.minimaxi.com', global:'https://api.minimax.io' };
    var LEGACY_MODELS = {
        'speech-01':'speech-01-turbo',
        'speech-02':'speech-02-turbo'
    };
    var memoryAudio = new Map();
    var MAX_CACHE = 12;

    function read(key) {
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }
    function config() {
        try {
            var parsed = JSON.parse(read(STORAGE_KEY) || 'null');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) { return {}; }
    }
    function voiceForRole(roleId) {
        var stored = read('minimax_voice_id_' + String(roleId || ''));
        if (stored) return String(stored).trim();
        try {
            var chars = JSON.parse(read('ai_custom_characters') || '[]');
            if (!Array.isArray(chars)) return '';
            var role = chars.find(function (r) { return r && String(r.id) === String(roleId); });
            return role ? String(role.minimaxVoiceId || role.voiceId || role.voice_id || '').trim() : '';
        } catch (error) { return ''; }
    }
    function audioBlob(value) {
        var encoded = String(value || '').replace(/\s/g, '');
        if (!encoded || encoded.length > 30000000) throw Error('语音数据为空或超过本机允许的大小');
        var bytes;
        if (/^(?:[0-9a-fA-F]{2})+$/.test(encoded)) {
            bytes = new Uint8Array(encoded.length / 2);
            for (var j = 0; j < bytes.length; j++) bytes[j] = parseInt(encoded.substr(j * 2, 2), 16);
        } else {
            var binary;
            try { binary = global.atob(encoded); }
            catch (e) { throw Error('语音数据编码不受支持'); }
            bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        }
        if (!bytes.length) throw Error('语音数据为空');
        return new Blob([bytes], {type:'audio/mpeg'});
    }
    function readableText(raw) {
        return String(raw || '')
            .replace(/\[中译[:：][\s\S]*?\]/g, '')
            .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
            .trim().slice(0, 500);
    }

    NS.readConfig = config;
    NS.voiceForRole = voiceForRole;
    NS.isEnabledForRole = function (roleId) {
        return config().enabled === true &&
            read('minimax_chat_enabled_' + String(roleId || '')) === '1';
    };
    NS.synthesize = async function (options) {
        options = options || {};
        var cfg = config();
        if (!cfg.enabled || !cfg.apiKey) throw Error('请先在设置中启用 MiniMax 并保存 API Key');
        var roleId = String(options.roleId || '');
        if (!options.preview && (!roleId || !NS.isEnabledForRole(roleId)))
            throw Error('请先在当前角色的聊天设置中启用 MiniMax 语音');
        var voiceId = String(options.voiceId || voiceForRole(roleId)).trim();
        if (!voiceId) throw Error('请先填写该角色的 MiniMax Voice ID');
        var text = readableText(options.text);
        if (!text) throw Error('没有可供合成的语音文字');
        var url = ROOTS[cfg.version === 'global' ? 'global' : 'cn'] + '/v1/t2a_v2';
        if (cfg.groupId) url += '?GroupId=' + encodeURIComponent(String(cfg.groupId).trim());
        var model = LEGACY_MODELS[cfg.model] || String(cfg.model || 'speech-02-turbo');
        var abort = new AbortController();
        var timeout = setTimeout(function () { abort.abort(); }, 60000);
        try {
            var response = await fetch(url, {
                method:'POST',
                headers:{
                    'Authorization':'Bearer ' + String(cfg.apiKey).trim(),
                    'Content-Type':'application/json'
                },
                body:JSON.stringify({
                    model:model, text:text, stream:false,
                    voice_setting:{voice_id:voiceId, speed:1, vol:1, pitch:0},
                    audio_setting:{sample_rate:32000, bitrate:128000, format:'mp3', channel:1}
                }),
                signal:abort.signal
            });
            if (!response.ok) throw Error('MiniMax 接口 HTTP ' + response.status + '，请检查版本、Key、模型及余额');
            var result = await response.json();
            var status = result && result.base_resp && Number(result.base_resp.status_code);
            if (status && status !== 0) throw Error('MiniMax 返回错误代码 ' + status + '，请检查 Voice ID / 模型');
            var audio = result && result.data && result.data.audio;
            return audioBlob(audio);
        } catch (error) {
            if (error && error.name === 'AbortError') throw Error('语音合成超时，请检查网络');
            throw error;
        } finally { clearTimeout(timeout); }
    };
    // Cache only the current page's generated clips; never store audio in
    // localStorage or trigger another paid request for the same message twice.
    NS.cached = function (cacheKey, options) {
        var key = String(cacheKey || '');
        if (!key) return NS.synthesize(options);
        if (memoryAudio.has(key)) return memoryAudio.get(key);
        var task = NS.synthesize(options).catch(function (error) {
            memoryAudio.delete(key);
            throw error;
        });
        memoryAudio.set(key, task);
        if (memoryAudio.size > MAX_CACHE) memoryAudio.delete(memoryAudio.keys().next().value);
        return task;
    };
})(window);
