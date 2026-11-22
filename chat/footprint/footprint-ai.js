/* Character footprint generator contract: persona + living timeline in, validated JSON out.
 * No network, filesystem, DOM writes or paid API calls in this module.
 */
(function (root) {
  'use strict';
  function text(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max || 30000) : '';
  }
  function selectedApi(storage) {
    if (!storage) return {};
    var mirror = typeof storage.getApiConfig === 'function' ? storage.getApiConfig() : {};
    if (!mirror || typeof mirror !== 'object' || Array.isArray(mirror)) mirror = {};
    var id = typeof storage.getActiveProfileId === 'function'
      ? String(storage.getActiveProfileId() || '').trim() : '';
    if (!id) return mirror;
    var list = typeof storage.getApiProfiles === 'function' ? storage.getApiProfiles() : [];
    var active = Array.isArray(list) ? list.find(function (item) {
      return item && String(item.id) === id;
    }) : null;
    if (!active) throw new Error('选中的 API 方案不存在，请重新选择');
    var config = Object.assign({}, mirror, active);
    config.apiKey = text(active.apiKey, 5000);
    config.model = text(active.model, 300);
    config.baseUrl = text(active.baseUrl, 1500);
    return config;
  }
  function context(role, date) {
    if (!role || typeof role !== 'object' || !role.id) throw new Error('请选择真实角色');
    // The entire saved persona is retained (the existing editor limits it to 30k).
    // No inferred profession, time-of-day, morning routine or generic characters.
    var names = ['persona','personality','profession','occupation','background','backstory',
      'bio','description','character','story','world','era','setting','speechStyle','tone',
      'systemPrompt','prompt','lifeLine'];
    var result = { id:String(role.id), name:text(role.name, 160), date:String(date) };
    names.forEach(function (key) {
      var value = text(role[key], key === 'persona' ? 30000 :
        key === 'lifeLine' ? 16000 : 8000);
      if (value) result[key] = value;
    });
    if (Array.isArray(role.lifeEvents)) {
      result.lifeEvents = role.lifeEvents.filter(function(event) {
        return event && typeof event === 'object';
      }).slice(0,30).map(function(event) {
        return {
          date:text(event.date,40), title:text(event.title,200),
          detail:text(event.detail,1500), status:text(event.status,90),
          people:Array.isArray(event.people)
            ? event.people.filter(function(v){return typeof v === 'string';}).slice(0,10).join('、')
            : text(event.people,300)
        };
      });
    }
    if (Array.isArray(role.npcCharacters)) {
      result.relationships = role.npcCharacters.filter(function(item) {
        return item && typeof item === 'object';
      }).slice(0,12).map(function(item) {
        return {name:text(item.name,90),relation:text(item.relation,90),
          currentStatus:text(item.currentStatus,200)};
      });
    }
    return result;
  }
  function prompts(role, date) {
    var detail = context(role, date);
    return {
      system: [
        '你只负责记录一位虚构角色在指定日期的足迹。事实依据仅来自给定角色档案、时代世界观、职业、性格、背景与现有生活线。',
        '不能套用现代城市或固定生物钟。不得强加早起、早餐午餐晚餐、规律上班、睡前总结等通用模板；不要求任何一天包含这些活动。',
        '角色可能是昼夜颠倒的人、处于修仙世界的人、旅行者或完全不同的存在：时间与行动必须首先服从该角色自己的人设、生活线和所在世界，而不是现实生活常识。',
        '生成 4 至 9 条该角色这一天真实、有细节、前后连贯的足迹；时间自然分布，可从凌晨开始、下午才醒或只记录某些时段，不要求从起床到入睡。',
        '各条必须呈现可区分的行动、状态和符合人物口吻的私密心声。不要称自己是 AI、系统、模型或写作助手；不要把设定中的事件写成不存在的用户聊天事实。',
        '只返回一个严格合法的 JSON 对象，结构为 {"entries":[{"time":"HH:mm","action":"具体行动","status":"此刻的心情或状态","thought":"角色第一人称心声"}]}。',
        'time 使用24小时制 HH:mm，action/status/thought 均为非空字符串；严禁 JSON 外出现解释、Markdown、代码围栏或任何其他文字。'
      ].join('\n'),
      user: '请严格根据下面这位角色当天最新档案及生活线生成足迹。不存在的信息不要擅自补成固定作息：\n' +
        JSON.stringify(detail)
    };
  }
  function stripTrailingCommas(input) {
    var out='', quote=false, escape=false;
    for (var i=0;i<input.length;i++) {
      var char=input[i];
      if (quote) {
        out+=char;
        if (escape) escape=false;
        else if (char==='\\') escape=true;
        else if (char==='"') quote=false;
        continue;
      }
      if (char==='"') {quote=true;out+=char;continue;}
      if (char===',') {
        var j=i+1;
        while(j<input.length && /\s/.test(input[j]))j++;
        if(input[j]==='}'||input[j]===']')continue;
      }
      out+=char;
    }
    return out;
  }
  function parseJsonSafe(raw, adapter) {
    var src=text(raw,120000).replace(/^\uFEFF/,'');
    if(!src)return null;
    var parsed = adapter && typeof adapter.parseJSON === 'function'
      ? adapter.parseJSON(src) : null;
    if(parsed && parsed.ok)return parsed.data;
    // Reuse the project's balanced extractor first. Then tolerate only trailing
    // commas outside strings; never parse executable code or fabricate fields.
    var candidates=[src];
    var fenced=src.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(fenced)candidates.push(fenced[1]);
    var openings=src.match(/\{/g);
    if(openings && openings.length) {
      // Tries balanced candidates starting at the first JSON object without
      // greedily including braces from prose or strings.
      var start=src.indexOf('{');
      for(var p=start;p<src.length;p++){
        if(src[p]!=='{')continue;
        var depth=0,inString=false,escaped=false;
        for(var k=p;k<Math.min(src.length,p+120000);k++){
          var c=src[k];
          if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
          if(c==='"'){inString=true;continue;}
          if(c==='{')depth++;
          if(c==='}') {depth--;if(depth===0){candidates.push(src.slice(p,k+1));break;}if(depth<0)break;}
        }
        if(candidates.length>8)break;
      }
    }
    for(var i=0;i<candidates.length;i++){
      try{return JSON.parse(stripTrailingCommas(candidates[i]));}catch(_){}
    }
    return null;
  }
  function normalize(data) {
    var rows=Array.isArray(data)?data:
      data && (Array.isArray(data.entries)?data.entries:
        Array.isArray(data.footprints)?data.footprints:
        Array.isArray(data.items)?data.items:null);
    if(!rows || rows.length<3 || rows.length>12)
      throw new Error('模型未返回足够的结构化足迹（需 3 至 12 条），原记录未改动');
    var seen=Object.create(null);
    var out=rows.map(function(item,index) {
      if(!item||typeof item!=='object'||Array.isArray(item))
        throw new Error('第 '+(index+1)+' 条足迹不是对象');
      var time=text(item.time,20),action=text(item.action,140),
        status=text(item.status,90),thought=text(item.thought,260);
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!action||!status||!thought)
        throw new Error('第 '+(index+1)+' 条缺少 time/action/status/thought 或时间格式错误');
      if(seen[time])throw new Error('足迹时间重复，请重新生成');
      seen[time]=true;
      return {time:time,action:action,status:status,thought:thought};
    });
    out.sort(function(a,b){return a.time.localeCompare(b.time)});
    return out;
  }
  function parse(response, adapter) {
    var candidate=response && response.ok ? response.data : null;
    if(!candidate && response && typeof response.raw==='string')
      candidate=parseJsonSafe(response.raw,adapter);
    if(!candidate)throw new Error('模型没有返回有效 JSON，原记录未改动');
    return normalize(candidate);
  }
  function toRecords(entries,roleId,date) {
    return entries.map(function(item,index) {
      return {
        id:String(roleId)+'-'+String(date)+'-'+String(index)+'-'+item.time.replace(':',''),
        time:item.time, action:item.action,status:item.status,thought:item.thought,
        // Compatibility with old footprint renderers and saved records.
        title:item.action,desc:item.thought,tag:item.status,loc:item.action,
        origin:'character_ai_json_v1'
      };
    });
  }
  function writeDay(storage, roleId, date, entries, expectedRaw) {
    if(!storage || !roleId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))
      throw new Error('角色或日期无效');
    var key='footprint_'+String(roleId);
    var original=storage.getItem(key);
    if (arguments.length >= 5 && original !== expectedRaw)
      throw new Error('生成期间足迹被其他页面修改，未覆盖最新记录');
    var document={};
    if(original!==null){
      try{document=JSON.parse(original);}catch(_){throw new Error('旧足迹数据已损坏，未覆盖原数据');}
      if(!document||typeof document!=='object'||Array.isArray(document))
        throw new Error('旧足迹格式异常，未覆盖原数据');
    }
    if(storage.getItem(key)!==original)
      throw new Error('足迹已被其他页面修改，未覆盖');
    document[String(date)]=toRecords(normalize(entries),roleId,date);
    storage.setItem(key,JSON.stringify(document));
    var check=storage.getItem(key);
    if(check!==JSON.stringify(document))throw new Error('存储未能确认成功，原内容需检查');
    return document[String(date)];
  }
  root.FootprintAI=Object.freeze({
    context:context,prompts:prompts,parse:parse,normalize:normalize,
    toRecords:toRecords,writeDay:writeDay,selectedApi:selectedApi
  });
})(typeof window!=='undefined'?window:globalThis);
