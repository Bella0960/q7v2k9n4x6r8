/* Regex editor UI. Contract: regex_rules array; no implicit migration or auto-install. */
(function (global) {
  'use strict';
  var POLICY = global.ChatRegexPolicy;
  var byId = function (id) { return document.getElementById(id); };
  var snapshot = null;
  var rules = [];
  var invalid = false;
  var editedId = null;
  var lastFocus = null;

  var META = {
    r_builtin_codeblock: ['文本包装', '去除整段回复外层的代码围栏'],
    r_builtin_jsonwrap: ['结构化内容', '仅原样输出 JSON 文本，通常无需开启'],
    r_builtin_missingcomma: ['结构化内容', '尝试补上 JSON 对象之间缺失的逗号'],
    r_builtin_trailingcomma: ['结构化内容', '尝试移除 JSON 末尾多余逗号'],
    r_builtin_xml: ['文本包装', '提取 <output> 标签中的文字，支持多行'],
    r_builtin_id: ['谨慎使用', '识别四位数字但不会改变内容，通常无需开启'],
    r_builtin_space: ['谨慎使用', '删除全部空格和换行，可能损坏正常对话']
  };

  function clone(item) { return Object.assign({}, item); }
  function notify(text, bad) {
    var element = byId('notify');
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('error', !!bad);
  }
  function readState() {
    try {
      snapshot = localStorage.getItem('regex_rules');
      invalid = false;
      // An unsaved preset catalog is visual guidance, not live rules.
      rules = snapshot === null ? [] : loadRules();
      if (global.__regexRulesReadError) invalid = true;
    } catch (error) {
      snapshot = null;
      rules = [];
      invalid = true;
    }
    return !invalid;
  }
  function systemRows() {
    var builtins = rules.filter(function (r) { return r && r.builtin === true; });
    var seen = new Set(builtins.map(function (r) { return String(r.id); }));
    DEFAULT_RULES.forEach(function (preset) {
      if (!seen.has(String(preset.id))) {
        builtins.push(Object.assign({}, preset, {enabled:false, availableOnly:true}));
      }
    });
    return builtins;
  }
  function activeCount() {
    return rules.filter(function (r) { return r && r.enabled === true; }).length;
  }
  function hasChanges() {
    try { return snapshot !== localStorage.getItem('regex_rules'); }
    catch (error) { return true; }
  }
  // Conditional save compares the last observed raw bytes before mutation.
  // If another tab edited rules, we never re-save an old snapshot.
  function persist(next, success) {
    if (invalid) { notify('原有规则无法安全读取，请先备份或修复数据。', true); return false; }
    if (hasChanges()) {
      notify('另一个窗口修改了规则。请刷新列表后再操作，以免覆盖新内容。', true);
      return false;
    }
    if (!saveRules(next, snapshot)) {
      notify('保存失败，旧规则仍在。请检查存储空间或刷新后重试。', true);
      return false;
    }
    try {
      snapshot = localStorage.getItem('regex_rules');
      rules = loadRules();
      if (!snapshot || invalid || global.__regexRulesReadError) throw Error('unverified');
    } catch (error) {
      notify('无法确认保存是否成功。请刷新检查，勿重复点击。', true);
      return false;
    }
    render();
    notify(success || '规则已保存');
    return true;
  }

  function textElement(tag, cls, content) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content != null) node.textContent = String(content);
    return node;
  }
  function appendRule(row, item, isSystem) {
    var holder = textElement('div','rule-item');
    var line = textElement('div','rule-row');
    var body = textElement('div','rule-row__body');
    body.appendChild(textElement('div','rule-row__title', item.name || '未命名规则'));
    var description = isSystem
      ? ((META[item.id] && META[item.id][1]) || '旧版本预设，可检查表达式后再启用')
      : '匹配文字并按设定替换；仅影响后续 AI 回复';
    body.appendChild(textElement('div','rule-row__desc',description));
    var stateText = item.availableOnly ? '尚未添加' : item.enabled ? '已启用' : '已停用';
    body.appendChild(textElement('div','rule-row__meta',stateText));
    var toggle = textElement('button','switch',item.enabled && !item.availableOnly ? 'ON' : 'OFF');
    toggle.type = 'button';
    toggle.setAttribute('role','switch');
    toggle.setAttribute('aria-checked', item.enabled && !item.availableOnly ? 'true' : 'false');
    toggle.setAttribute('aria-label',(item.name || '规则') + ' 启用开关');
    toggle.disabled = invalid;
    toggle.addEventListener('click',function () {
      var next = rules.map(clone);
      var index = next.findIndex(function (r) {return r && String(r.id) === String(item.id);});
      if (index < 0 && item.availableOnly) {
        next.push(Object.assign({},item,{availableOnly:undefined,enabled:true}));
      } else if (index >= 0) {
        next[index].enabled = !next[index].enabled;
      } else return;
      persist(next,'规则开关已更新，后续 AI 回复将使用新的状态。');
    });
    line.appendChild(body);
    line.appendChild(toggle);
    holder.appendChild(line);

    var details = textElement('details','rule-detail');
    var summary = textElement('summary','inline-btn','查看匹配方式与操作');
    details.appendChild(summary);
    var inner = textElement('div','rule-detail__inner');
    if (isSystem && META[item.id]) {
      inner.appendChild(textElement('div','rule-detail__label',META[item.id][0]));
    }
    inner.appendChild(textElement('div','rule-detail__label','匹配表达式'));
    inner.appendChild(textElement('code','rule-code',item.pattern || '（无）'));
    inner.appendChild(textElement('div','rule-detail__label','替换为'));
    inner.appendChild(textElement('code','rule-code',
      item.replacement === '' ? '（删除匹配内容）' : String(item.replacement ?? '（空）')));
    if (!isSystem) {
      var actions = textElement('div','rule-buttons');
      var edit = textElement('button','inline-btn','编辑规则');
      edit.type='button';
      edit.disabled=invalid;
      edit.addEventListener('click',function(){openEditor(String(item.id));});
      var remove = textElement('button','inline-btn danger','删除');
      remove.type='button';
      remove.disabled=invalid;
      remove.addEventListener('click',function() {
        if (!global.confirm('删除「' + (item.name || '未命名规则') + '」？已有聊天记录不会改变。')) return;
        var next = rules.filter(function(r){return String(r.id) !== String(item.id);});
        persist(next,'规则已删除。');
      });
      actions.appendChild(edit); actions.appendChild(remove);inner.appendChild(actions);
    }
    details.appendChild(inner);
    holder.appendChild(details);
    row.appendChild(holder);
  }

  function render() {
    var custom = byId('customRules'), presets = byId('presetRules');
    if (!custom || !presets) return;
    custom.replaceChildren();
    presets.replaceChildren();
    var own = rules.filter(function(r){ return r && r.builtin !== true; });
    if (!own.length) {
      custom.appendChild(textElement('div','empty-state',
        '还没有自定义规则。可以创建一条，例如把“你好呀呀”替换成“你好呀”。'));
    } else own.forEach(function (item) {appendRule(custom,item,false);});
    var available = systemRows();
    available.forEach(function(item){appendRule(presets,item,true);});
    byId('customCount').textContent = String(own.length);
    byId('presetCount').textContent = String(available.length);
    var total = activeCount();
    var dot = byId('statusDot');
    dot.classList.toggle('on',total > 0 && !invalid);
    var stat = byId('statusText');
    stat.textContent = invalid
      ? '规则数据不可读，已停止修改和执行，请保留原数据'
      : snapshot == null
      ? '还没有保存任何规则 · 当前不会处理 AI 回复'
      : total ? '已启用 ' + total + ' 条规则 · 影响后续 AI 回复'
              : '暂无启用的规则 · AI 回复保持原文';
    byId('presetWarning').textContent = snapshot == null
      ? '预设仅供参考，点击开关或手动添加后才会保存生效。'
      : '系统预设不等于推荐全部开启。请按需选择；旧配置会保留。';
    byId('regexApplyPreset').disabled = invalid;
    byId('regexApplyPreset').textContent =
      snapshot == null ? '添加推荐预设' : '补齐缺失的系统预设';
    byId('createRuleBtn').disabled = invalid;
    renderPreview();
  }

  function renderPreview() {
    var target = byId('previewOutput'), detail=byId('previewTrace');
    if (!target || !POLICY) return;
    var input = byId('previewInput').value.slice(0,1500);
    if (!input.trim()) {
      target.textContent = '处理后的文字会显示在这里。';
      target.classList.add('empty');
      detail.textContent = '输入原文，再点击「运行预览」。';
      return;
    }
    target.classList.remove('empty');
    if (invalid || snapshot == null) {
      target.textContent = input;
      detail.textContent = invalid ? '规则数据不可读，未执行任何替换。' :
        '当前没有保存规则，结果与原文相同。';
      return;
    }
    var saved = POLICY.readSavedRules(localStorage);
    var cursor = input, changed = [];
    saved.forEach(function (r) {
      if (!r || r.enabled !== true) return;
      var next = POLICY.applyText(cursor,[r]);
      if (next !== cursor) changed.push(r.name || '未命名规则');
      cursor = next;
    });
    var output = POLICY.applySaved(input,localStorage);
    target.textContent = output;
    detail.textContent = changed.length
      ? '本次发生替换：' + changed.join('、')
      : '本次没有匹配到需要修改的内容。';
  }

  function openEditor(id) {
    if (invalid) return;
    editedId = id || null;
    var current = editedId ? rules.find(function(r){return String(r.id) === editedId;}) : null;
    if (editedId && (!current || current.builtin === true)) return;
    lastFocus = document.activeElement;
    byId('sheetTitle').textContent = current ? '编辑规则' : '新建规则';
    byId('editName').value = current ? current.name || '' : '';
    byId('editPattern').value = current ? current.pattern || '' : '';
    byId('editReplacement').value = current ? String(current.replacement ?? '') : '';
    byId('editEnabled').checked = current ? current.enabled === true : true;
    byId('editSample').value = '';
    byId('editPreview').textContent = '填写示例文字后，可先预览再保存。';
    byId('editStatus').textContent = '';
    byId('sheetMask').classList.add('open');
    document.body.style.overflow = 'hidden';
    byId('editName').focus();
  }
  function closeEditor() {
    byId('sheetMask').classList.remove('open');
    document.body.style.overflow = '';
    editedId=null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }
  function draftRule() {
    var name=byId('editName').value.trim();
    var pattern=byId('editPattern').value.trim();
    var replacement=byId('editReplacement').value;
    if (!name || !pattern) throw Error('请填写规则名称和匹配表达式。');
    if (name.length > 80) throw Error('规则名称最多 80 个字符。');
    if (pattern.length > 512) throw Error('表达式不能超过 512 个字符。');
    if (replacement.length > 2000) throw Error('替换内容不能超过 2000 个字符。');
    try { new RegExp(pattern,'g'); }
    catch (error) { throw Error('表达式格式不正确：'+error.message); }
    return {name:name,pattern:pattern,replacement:replacement,
      enabled:byId('editEnabled').checked,builtin:false};
  }
  function previewDraft() {
    var target=byId('editPreview');
    try {
      var draft=draftRule();
      var example=byId('editSample').value.slice(0,700);
      if (!example) {target.textContent='请先输入一段示例文字。';return;}
      target.textContent = POLICY.applyText(example,[draft]);
      byId('editStatus').textContent='';
    } catch (error) {byId('editStatus').textContent=error.message;}
  }
  function saveDraft() {
    var draft;
    try {draft=draftRule();byId('editStatus').textContent='';}
    catch (error) {byId('editStatus').textContent=error.message;return;}
    var next = snapshot == null ? [] : rules.map(clone);
    if (editedId) {
      var index=next.findIndex(function(r){return String(r.id)===editedId;});
      if (index<0 || next[index].builtin===true) {
        byId('editStatus').textContent='规则已变化，请刷新页面再编辑。';return;
      }
      next[index]=Object.assign({},next[index],draft,{id:next[index].id,builtin:false});
    } else {
      var id='r_'+Date.now().toString(36);
      var seq=0;while(next.some(function(r){return String(r.id)===id;}))
        id='r_'+Date.now().toString(36)+'_'+(++seq);
      next.push(Object.assign({id:id},draft));
    }
    if (persist(next,editedId?'修改已保存。':'新规则已添加。')) closeEditor();
    else byId('editStatus').textContent='保存未成功。原规则没有被覆盖，请检查上方提示。';
  }
  function applyPreset() {
    if (invalid) return;
    if (!global.confirm('将未添加的系统预设加入列表，保留已有规则和开关状态。继续？')) return;
    var next=snapshot == null?[]:rules.map(clone);
    var seen=new Set(next.map(function(r){return String(r.id);}));
    DEFAULT_RULES.forEach(function(p) {
      if (!seen.has(String(p.id)))next.push(clone(p));
    });
    persist(next,'系统预设已加入。建议只开启确实需要的规则。');
  }
  function refresh() {
    readState();
    render();
    notify(invalid ? '原数据存在错误，未改动任何内容。' : '已读取最新保存的规则。',invalid);
  }
  function bind() {
    byId('createRuleBtn').addEventListener('click',function(){openEditor(null);});
    byId('regexApplyPreset').addEventListener('click',applyPreset);
    byId('previewRun').addEventListener('click',renderPreview);
    byId('editPreviewButton').addEventListener('click',previewDraft);
    byId('sheetSave').addEventListener('click',saveDraft);
    byId('sheetCancel').addEventListener('click',closeEditor);
    byId('sheetClose').addEventListener('click',closeEditor);
    byId('refreshRules').addEventListener('click',refresh);
    byId('sheetMask').addEventListener('click',function(event) {
      if (event.target === byId('sheetMask'))closeEditor();
    });
    document.addEventListener('keydown',function(event){
      if (event.key === 'Escape' && byId('sheetMask').classList.contains('open'))closeEditor();
    });
    document.querySelectorAll('[data-sample]').forEach(function(button){
      button.addEventListener('click',function(){
        byId('previewInput').value=button.getAttribute('data-sample');
        renderPreview();
      });
    });
    global.addEventListener('storage',function(event){
      if (event.key==='regex_rules') notify('规则已在其他窗口更新。刷新列表后可查看最新内容。',true);
    });
  }
  // Stable extension point for other settings modules and integration tests.
  global.RegexEditorUI = {
    render: render, refresh:refresh, preview:renderPreview,
    openEditor:openEditor, closeEditor:closeEditor,
    getStatus:function(){return{invalid:invalid,active:activeCount(),raw:snapshot};}
  };
  if (!POLICY) {
    var status=byId('notify');
    if (status)status.textContent='规则引擎未加载。已停止编辑，避免错误保存。';
    return;
  }
  readState();
  bind();
  render();
})(window);
