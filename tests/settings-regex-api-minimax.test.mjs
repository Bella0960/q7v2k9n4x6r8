import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext, Script} from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const regexPage = read('worldbook/settings/regex-settings.html');
const regexPolicySource = read('shared/js/phone/chat-regex-policy.js');
const api = read('settings/js/settings.js');
const tts = read('shared/js/phone/minimax-tts.js');
const ttsPage = read('settings/minimax-tts.html');
const chat = read('chat/chat/chat-detail.html');
const chatSettings = read('chat/chat/chat-settings.html');
function fragment(src, start, end) {
    const a = src.indexOf(start), b = src.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'source fragment ' + start);
    return src.slice(a, b);
}
function storage(values={}, failKey='') {
    const map = new Map(Object.entries(values));
    return {
        getItem: k => map.has(k) ? map.get(k) : null,
        setItem(k,v) {
            if (k === failKey) throw Error('QuotaExceededError');
            map.set(k,String(v));
        },
        removeItem:k=>map.delete(k),
        snapshot:()=>Object.fromEntries(map)
    };
}
function regexHarness(ls) {
    const inline = regexPage.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const source = fragment(inline, 'var DEFAULT_RULES = [','    function render() {');
    const win = {localStorage:ls};
    runInNewContext(regexPolicySource, {window:win});
    const settings = new Function('localStorage','window',source +
        '\nreturn {DEFAULT_RULES,loadRules,saveRules};')(ls,win);
    return {...settings,policy:win.ChatRegexPolicy};
}
function apiHarness(ls) {
    const source = fragment(api,'function commitApiSettings(','function getActiveProfile() {');
    return new Function('localStorage','API_STORAGE_KEY',source +
        '\nreturn commitApiSettings;')(ls,'api_settings');
}
test('legacy custom regex rules survive a missing v2 marker', () => {
    const custom = [{id:'mine',name:'老用户自定义',pattern:'test',replacement:'pass',enabled:true}];
    const ls = storage({regex_rules:JSON.stringify(custom)});
    const rules = regexHarness(ls).loadRules();
    assert.deepEqual(rules,custom);
    assert.equal(ls.getItem('regex_rules'),JSON.stringify(custom));
});
test('broken built-in ID and multiline XML rules are repaired without changing custom rules', () => {
    const ls = storage(), harness = regexHarness(ls);
    const r = harness.DEFAULT_RULES;
    const id = r.find(v=>v.id==='r_builtin_id');
    assert.equal('1234'.replace(new RegExp(id.pattern,'g'),id.replacement),'1234');
    const xml = r.find(v=>v.id==='r_builtin_xml');
    assert.equal('<output>甲\n乙</output>'.replace(new RegExp(xml.pattern,'g'),xml.replacement),'甲\n乙');
    const legacy = [
        {id:'r_builtin_id',name:'ID',pattern:'^\\d{4}$',replacement:'$1',enabled:true,builtin:true},
        {id:'mine',pattern:'important',replacement:'ok',enabled:true}
    ];
    ls.setItem('regex_rules',JSON.stringify(legacy));
    const fresh = harness.loadRules();
    assert.equal('1234'.replace(new RegExp(fresh[0].pattern,'g'),fresh[0].replacement),'1234');
    assert.equal(fresh[1].pattern,'important');
});
test('invalid or quota-failed regex storage is never silently replaced', () => {
    const ls=storage({regex_rules:'{malformed-json'}), h=regexHarness(ls);
    assert.deepEqual(h.loadRules(),[]);
    assert.equal(h.saveRules([{id:'new'}]),false);
    assert.equal(ls.getItem('regex_rules'),'{malformed-json');
    const quota=storage({},'regex_rules');
    assert.equal(regexHarness(quota).saveRules([{id:'new'}]),false);
});

test('regex runtime runs saved custom rules on actual AI text', () => {
    const ls=storage({regex_rules:JSON.stringify([
        {id:'mine',name:'语气调整',pattern:'你好',replacement:'您好',enabled:true}
    ])});
    const harness=regexHarness(ls);
    const cleanupSource=fragment(chat,'function applyAICleanup(text) {','// API 调用记录');
    const cleanup=new Function('window','localStorage',cleanupSource +
        '\nreturn applyAICleanup;')({ChatRegexPolicy:harness.policy},ls);
    assert.equal(cleanup('你好'), '您好。');
    assert.equal(harness.policy.applySaved('你好',ls),'您好');
});
test('old built-in regex patterns are repaired during real chat evaluation, without storage rewrite',()=>{
    const legacy=[
        {id:'r_builtin_id',builtin:true,name:'旧数字',pattern:'^\\d{4}
    const original={
        api_profiles_v1:JSON.stringify([{id:'old',apiKey:'old'}]),
        api_active_profile:'old',
        api_settings:JSON.stringify({apiKey:'old',model:'old-model'})
    };
    const bad=storage(original,'api_settings');
    const saved=apiHarness(bad)([{id:'new'}],'new',{model:'new-model'});
    assert.equal(saved,false);
    assert.deepEqual(bad.snapshot(),original);
    const okay=storage(original);
    assert.equal(apiHarness(okay)([{id:'new'}],'new',{model:'new-model'}),true);
    assert.equal(okay.getItem('api_active_profile'),'new');
    assert.equal(JSON.parse(okay.getItem('api_settings')).model,'new-model');
});
test('corrupt API profile bytes are never overwritten by a new profile', () => {
    const old='{"bad-not-array":true}', ls=storage({api_profiles_v1:old});
    assert.equal(apiHarness(ls)([{id:'new'}],'new',{model:'x'}),false);
    assert.equal(ls.getItem('api_profiles_v1'),old);
});
test('API temperature explicitly set to zero remains zero', () => {
    const code = fragment(api,'function collectFormFields() {','// 把方案对象写成');
    const fields={apiNameInput:{value:'A'},apiProviderSelect:{value:'custom'},
       apiUrlInput:{value:'https://mock.test/v1'},apiKeyInput:{value:'test'},
       apiModelInput:{value:'mock-model'},apiImageModelInput:{value:''},
       apiImageEndpointInput:{value:''},apiPromptInput:null,
       apiTemperatureInput:{value:'0'},apiMaxTokensInput:{value:''},
       apiTopPInput:{value:'1'},apiMemoryInput:{value:'20'},
       apiTimeAwareInput:{checked:true},window:{__loadedPrompt:''}};
    const collect = new Function(...Object.keys(fields),code +
        '\nreturn collectFormFields;')(...Object.values(fields));
    assert.equal(collect().temperature,0);
});
test('connection test rejects HTTP 200 with no assistant text',async()=>{
    const testBody=fragment(api,'async function testConnection() {','// 绑定测试连接按钮点击');
    const msg={textContent:'',style:{}}, button={disabled:false};
    const run=new Function('apiKeyInput','apiUrlInput','apiModelInput',
       'document','fetch','URL','AbortController','setTimeout','clearTimeout',
       'friendlyHttpError',testBody+'\nreturn testConnection;')(
       {value:'mock-key'},{value:'https://example.test/v1'},{value:'test-model'},
       {getElementById:id=>id==='test-msg'?msg:button},
       async()=>({ok:true,status:200,json:async()=>({choices:[]})}),
       URL,AbortController,()=>0,()=>{},()=>'' );
    await run();
    assert.match(msg.textContent,/测试失败/);
    assert.equal(button.disabled,false);
});
function ttsHarness(extra={}) {
    let calls=[],cfg={enabled:true,apiKey:'secret-synthetic',model:'speech-01',
        version:'global',groupId:'synthetic-group'};
    const ls=storage({
        minimax_tts_config:JSON.stringify(cfg),
        minimax_chat_enabled_role:'1',
        minimax_voice_id_role:'voice-demo'
    });
    if(extra.enabled === false)ls.setItem('minimax_chat_enabled_role','0');
    const window={localStorage:ls,atob,PhoneMiniMaxTTS:null};
    const response=async(url,opts)=>{calls.push({url,opts});return {
        ok:true,status:200,json:async()=>({base_resp:{status_code:0},data:{audio:'49443303'}})
    }};
    runInNewContext(tts,{
        window,fetch:extra.fetch || response,Blob,Uint8Array,AbortController,
        setTimeout,clearTimeout,Map,Error,encodeURIComponent
    });
    return {client:window.PhoneMiniMaxTTS,calls,ls};
}
test('MiniMax opt-in: no request when role switch is off',async()=>{
    const f=ttsHarness({enabled:false});
    await assert.rejects(f.client.synthesize({roleId:'role',text:'hello'}),/启用/);
    assert.equal(f.calls.length,0);
});
test('MiniMax requests real T2A payload and decodes hex MP3 in memory',async()=>{
    const f=ttsHarness();
    const blob=await f.client.synthesize({roleId:'role',text:'你好'});
    assert.equal(blob.type,'audio/mpeg');
    assert.equal(blob.size,4);
    assert.match(f.calls[0].url,/api.minimax.io\/v1\/t2a_v2\?GroupId=synthetic-group/);
    const body=JSON.parse(f.calls[0].opts.body);
    assert.equal(body.model,'speech-01-turbo');
    assert.equal(body.voice_setting.voice_id,'voice-demo');
    assert.equal(body.text,'你好');
    assert.equal(f.calls[0].opts.headers.Authorization,'Bearer secret-synthetic');
});
test('MiniMax in-page cache avoids duplicate billable fetch for one message',async()=>{
    const f=ttsHarness();
    await f.client.cached('role:mid1:hello',{roleId:'role',text:'hello'});
    await f.client.cached('role:mid1:hello',{roleId:'role',text:'hello'});
    assert.equal(f.calls.length,1);
});
test('MiniMax provider errors reject instead of showing fake success',async()=>{
    const f=ttsHarness({fetch:async()=>({
        ok:true,status:200,json:async()=>({base_resp:{status_code:1004},data:{audio:''}})
    })});
    await assert.rejects(f.client.synthesize({roleId:'role',text:'hello'}),/1004/);
});
test('UI wiring preserves manually triggered speech only and critical syntax',()=>{
    assert.match(chat,/PhoneMiniMaxTTS/);
    assert.match(chat,/data-act="|sheetItemHTML\('speak'/);
    assert.match(chat,/tts\.cached\(cacheKey/);
    assert.match(chatSettings,/id="minimaxRoleVoiceId"/);
    assert.match(chatSettings,/id="minimaxRoleEnabled"/);
    assert.match(ttsPage,/id="testTtsBtn"/);
    assert.match(ttsPage,/if \(!save\(cfg\)\)/);
    new Script(tts);
    new Script(api);
    for(const page of [regexPage,ttsPage,chatSettings,chat]){
        const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
        for(const m of scripts) if(m[1].trim())new Script(m[1]);
    }
});


test('MiniMax settings refuses fake save success on localStorage quota failure', () => {
    const inline = ttsPage.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const els = {};
    function element(id) {
        return els[id] ||= {
            id, value:'', checked:false, type:'password', textContent:'', hidden:false,
            classList:{add(){},remove(){},toggle(){}},
            addEventListener(event,fn){this['on'+event]=fn;},
            querySelectorAll(){return []}
        };
    }
    const localStorage=storage({},'minimax_tts_config');
    const document={getElementById:element};
    const window={PhoneMiniMaxTTS:{},addEventListener(){}};
    new Function('document','localStorage','window','setTimeout','clearTimeout',inline)(
        document,localStorage,window,()=>0,()=>{}
    );
    element('enableToggle').checked=true;
    element('apiKey').value='mock-secret';
    element('saveBtn').onclick();
    assert.match(element('toast').textContent,/保存失败/);
    assert.equal(localStorage.getItem('minimax_tts_config'),null);
});
test('MiniMax speech wiring is manually gated for received voice bubbles', () => {
    assert.match(chat,/window\.PhoneMiniMaxTTS\.isEnabledForRole\(speakerId\)/);
    assert.match(chat,/speakAIMessage\(message, voiceId/);
    assert.match(chat,/if \(e\.target\.closest\('audio'\)\) return;/);
    assert.match(chat,/if \(isAi && hasText && window\.PhoneMiniMaxTTS/);
});
,replacement:'$1',enabled:true},
        {id:'r_builtin_xml',builtin:true,name:'旧XML',pattern:'<output>(.*?)</output>',replacement:'$1',enabled:true}
    ];
    const raw=JSON.stringify(legacy),ls=storage({regex_rules:raw}),h=regexHarness(ls);
    assert.equal(h.policy.applySaved('1234',ls),'1234');
    assert.equal(h.policy.applySaved('<output>甲\n乙</output>',ls),'甲\n乙');
    assert.equal(ls.getItem('regex_rules'),raw);
});
test('unsaved visible presets do not silently run, and preview only uses persisted rules',()=>{
    const ls=storage(),h=regexHarness(ls);
    assert.equal(h.loadRules().length,7);
    assert.deepEqual(h.policy.readSavedRules(ls),[]);
    assert.equal(h.policy.applySaved('<output>你好</output>',ls),'<output>你好</output>');
    assert.equal(h.saveRules(h.loadRules()),true);
    assert.equal(h.policy.applySaved('<output>你好</output>',ls),'你好');
    assert.match(regexPage,/预览已保存规则/);
    assert.match(regexPage,/尚未生效/);
});
test('JSON repair presets cannot rewrite ordinary conversation text',()=>{
    const ls=storage({regex_rules:JSON.stringify([
        {id:'r_builtin_missingcomma',builtin:true,pattern:'\\}\\s*\\{',
            replacement:'},{',enabled:true}
    ])});
    const h=regexHarness(ls);
    assert.equal(h.policy.applySaved('我画了一个}{符号',ls),'我画了一个}{符号');
    assert.equal(h.policy.applySaved('[{}{}]',ls),'[{},{ }]'.replace(' ',''));
});
test('disabled user regex and malformed storage leave AI replies unchanged',()=>{
    const ls=storage({regex_rules:JSON.stringify([
        {id:'mine',pattern:'你好',replacement:'您好',enabled:false}
    ])});
    const h=regexHarness(ls);
    assert.equal(h.policy.applySaved('你好',ls),'你好');
    ls.setItem('regex_rules','broken json');
    assert.equal(h.policy.applySaved('你好',ls),'你好');
});

test('API three-key commit is all-or-nothing on quota and verifies the mirror', () => {
    const original={
        api_profiles_v1:JSON.stringify([{id:'old',apiKey:'old'}]),
        api_active_profile:'old',
        api_settings:JSON.stringify({apiKey:'old',model:'old-model'})
    };
    const bad=storage(original,'api_settings');
    const saved=apiHarness(bad)([{id:'new'}],'new',{model:'new-model'});
    assert.equal(saved,false);
    assert.deepEqual(bad.snapshot(),original);
    const okay=storage(original);
    assert.equal(apiHarness(okay)([{id:'new'}],'new',{model:'new-model'}),true);
    assert.equal(okay.getItem('api_active_profile'),'new');
    assert.equal(JSON.parse(okay.getItem('api_settings')).model,'new-model');
});
test('corrupt API profile bytes are never overwritten by a new profile', () => {
    const old='{"bad-not-array":true}', ls=storage({api_profiles_v1:old});
    assert.equal(apiHarness(ls)([{id:'new'}],'new',{model:'x'}),false);
    assert.equal(ls.getItem('api_profiles_v1'),old);
});
test('API temperature explicitly set to zero remains zero', () => {
    const code = fragment(api,'function collectFormFields() {','// 把方案对象写成');
    const fields={apiNameInput:{value:'A'},apiProviderSelect:{value:'custom'},
       apiUrlInput:{value:'https://mock.test/v1'},apiKeyInput:{value:'test'},
       apiModelInput:{value:'mock-model'},apiImageModelInput:{value:''},
       apiImageEndpointInput:{value:''},apiPromptInput:null,
       apiTemperatureInput:{value:'0'},apiMaxTokensInput:{value:''},
       apiTopPInput:{value:'1'},apiMemoryInput:{value:'20'},
       apiTimeAwareInput:{checked:true},window:{__loadedPrompt:''}};
    const collect = new Function(...Object.keys(fields),code +
        '\nreturn collectFormFields;')(...Object.values(fields));
    assert.equal(collect().temperature,0);
});
test('connection test rejects HTTP 200 with no assistant text',async()=>{
    const testBody=fragment(api,'async function testConnection() {','// 绑定测试连接按钮点击');
    const msg={textContent:'',style:{}}, button={disabled:false};
    const run=new Function('apiKeyInput','apiUrlInput','apiModelInput',
       'document','fetch','URL','AbortController','setTimeout','clearTimeout',
       'friendlyHttpError',testBody+'\nreturn testConnection;')(
       {value:'mock-key'},{value:'https://example.test/v1'},{value:'test-model'},
       {getElementById:id=>id==='test-msg'?msg:button},
       async()=>({ok:true,status:200,json:async()=>({choices:[]})}),
       URL,AbortController,()=>0,()=>{},()=>'' );
    await run();
    assert.match(msg.textContent,/测试失败/);
    assert.equal(button.disabled,false);
});
function ttsHarness(extra={}) {
    let calls=[],cfg={enabled:true,apiKey:'secret-synthetic',model:'speech-01',
        version:'global',groupId:'synthetic-group'};
    const ls=storage({
        minimax_tts_config:JSON.stringify(cfg),
        minimax_chat_enabled_role:'1',
        minimax_voice_id_role:'voice-demo'
    });
    if(extra.enabled === false)ls.setItem('minimax_chat_enabled_role','0');
    const window={localStorage:ls,atob,PhoneMiniMaxTTS:null};
    const response=async(url,opts)=>{calls.push({url,opts});return {
        ok:true,status:200,json:async()=>({base_resp:{status_code:0},data:{audio:'49443303'}})
    }};
    runInNewContext(tts,{
        window,fetch:extra.fetch || response,Blob,Uint8Array,AbortController,
        setTimeout,clearTimeout,Map,Error,encodeURIComponent
    });
    return {client:window.PhoneMiniMaxTTS,calls,ls};
}
test('MiniMax opt-in: no request when role switch is off',async()=>{
    const f=ttsHarness({enabled:false});
    await assert.rejects(f.client.synthesize({roleId:'role',text:'hello'}),/启用/);
    assert.equal(f.calls.length,0);
});
test('MiniMax requests real T2A payload and decodes hex MP3 in memory',async()=>{
    const f=ttsHarness();
    const blob=await f.client.synthesize({roleId:'role',text:'你好'});
    assert.equal(blob.type,'audio/mpeg');
    assert.equal(blob.size,4);
    assert.match(f.calls[0].url,/api.minimax.io\/v1\/t2a_v2\?GroupId=synthetic-group/);
    const body=JSON.parse(f.calls[0].opts.body);
    assert.equal(body.model,'speech-01-turbo');
    assert.equal(body.voice_setting.voice_id,'voice-demo');
    assert.equal(body.text,'你好');
    assert.equal(f.calls[0].opts.headers.Authorization,'Bearer secret-synthetic');
});
test('MiniMax in-page cache avoids duplicate billable fetch for one message',async()=>{
    const f=ttsHarness();
    await f.client.cached('role:mid1:hello',{roleId:'role',text:'hello'});
    await f.client.cached('role:mid1:hello',{roleId:'role',text:'hello'});
    assert.equal(f.calls.length,1);
});
test('MiniMax provider errors reject instead of showing fake success',async()=>{
    const f=ttsHarness({fetch:async()=>({
        ok:true,status:200,json:async()=>({base_resp:{status_code:1004},data:{audio:''}})
    })});
    await assert.rejects(f.client.synthesize({roleId:'role',text:'hello'}),/1004/);
});
test('UI wiring preserves manually triggered speech only and critical syntax',()=>{
    assert.match(chat,/PhoneMiniMaxTTS/);
    assert.match(chat,/data-act="|sheetItemHTML\('speak'/);
    assert.match(chat,/tts\.cached\(cacheKey/);
    assert.match(chatSettings,/id="minimaxRoleVoiceId"/);
    assert.match(chatSettings,/id="minimaxRoleEnabled"/);
    assert.match(ttsPage,/id="testTtsBtn"/);
    assert.match(ttsPage,/if \(!save\(cfg\)\)/);
    new Script(tts);
    new Script(api);
    for(const page of [regexPage,ttsPage,chatSettings,chat]){
        const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
        for(const m of scripts) if(m[1].trim())new Script(m[1]);
    }
});


test('MiniMax settings refuses fake save success on localStorage quota failure', () => {
    const inline = ttsPage.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const els = {};
    function element(id) {
        return els[id] ||= {
            id, value:'', checked:false, type:'password', textContent:'', hidden:false,
            classList:{add(){},remove(){},toggle(){}},
            addEventListener(event,fn){this['on'+event]=fn;},
            querySelectorAll(){return []}
        };
    }
    const localStorage=storage({},'minimax_tts_config');
    const document={getElementById:element};
    const window={PhoneMiniMaxTTS:{},addEventListener(){}};
    new Function('document','localStorage','window','setTimeout','clearTimeout',inline)(
        document,localStorage,window,()=>0,()=>{}
    );
    element('enableToggle').checked=true;
    element('apiKey').value='mock-secret';
    element('saveBtn').onclick();
    assert.match(element('toast').textContent,/保存失败/);
    assert.equal(localStorage.getItem('minimax_tts_config'),null);
});
test('MiniMax speech wiring is manually gated for received voice bubbles', () => {
    assert.match(chat,/window\.PhoneMiniMaxTTS\.isEnabledForRole\(speakerId\)/);
    assert.match(chat,/speakAIMessage\(message, voiceId/);
    assert.match(chat,/if \(e\.target\.closest\('audio'\)\) return;/);
    assert.match(chat,/if \(isAi && hasText && window\.PhoneMiniMaxTTS/);
});
