/**
 * SillyTavern Chat Completion extension v1.6.1.
 * In outgoing prompt-only messages, replace the expanded {{lastUserMessage}}
 * with a fixed instruction WITHOUT relying on <叙事输入> tags.
 * Append the original to the most recent real assistant story, as in v1.4.
 * Neither saved chats nor the preset are modified.
 *
 * NOTE: SillyTavern normally expands the macro before either of these events.
 * We therefore match its expanded value using the last saved user message.
 * Exact provenance of arbitrary identical text cannot be recovered at this stage.
 */
(() => {
  'use strict';
  const VERSION = '1.6.1';
  const NAME = '[剧情建议外置 v1.6.1]';
  const SETTINGS_KEY = 'story_direction_after_reply';
  const PANEL_ID = 'storydir_settings_panel';
  const CHECKBOX_ID = 'storydir_enabled_toggle';
  const memorySettings = {enabled: true};
  const FIXED = '按建议剧情发展往下继续';
  const PREFIX = '建议剧情发展：';
  const REMINDER = '（本轮不再附加剧情建议。）';
  const MACRO = /\{\{\s*lastUserMessage\s*\}\}/gi;
  const status = {
    version: VERSION, loaded: false, enabled: true, panelMounted: false, promptReadyCalls: 0, settingsReadyCalls: 0,
    latest: null, lastMutation: null, error: null,
  };
  globalThis.__STORY_DIRECTION_VERSION = VERSION;
  globalThis.__STORY_DIRECTION_STATUS = status;

  // Persisted per SillyTavern user; default is ON to retain v1.5 behavior.
  function getSettings() {
    const context = globalThis.SillyTavern?.getContext?.();
    const all = context?.extensionSettings;
    if (!all || typeof all !== 'object') return memorySettings;
    if (!all[SETTINGS_KEY] || typeof all[SETTINGS_KEY] !== 'object') {
      all[SETTINGS_KEY] = {enabled: true};
    }
    if (typeof all[SETTINGS_KEY].enabled !== 'boolean') {
      all[SETTINGS_KEY].enabled = true;
    }
    return all[SETTINGS_KEY];
  }

  function enabled() {
    status.enabled = getSettings().enabled === true;
    return status.enabled;
  }

  // A small, persistent checkbox in Extensions > Extension settings.
  // No toasts, alerts, notifications, or per-message popups are generated.
  function mountSettingsPanel() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(PANEL_ID)) {
      status.panelMounted = true;
      return;
    }
    const host = document.getElementById('extensions_settings2')
      || document.getElementById('extensions_settings');
    if (!host) {
      console.warn(NAME, '扩展设置容器尚未找到；尝试在页面就绪时再次加载');
      return;
    }
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'storydir-settings';

    const heading = document.createElement('div');
    heading.className = 'storydir-heading';
    heading.textContent = '剧情建议外置 v1.6.1';

    const label = document.createElement('label');
    label.className = 'checkbox_label storydir-checkbox';
    label.htmlFor = CHECKBOX_ID;
    const input = document.createElement('input');
    input.id = CHECKBOX_ID;
    input.type = 'checkbox';
    input.checked = enabled();
    const labelText = document.createElement('span');
    labelText.textContent = '启用剧情建议外置';
    label.appendChild(input);
    label.appendChild(labelText);

    const note = document.createElement('div');
    note.className = 'storydir-help';
    note.textContent = '勾选：替换最新用户消息宏，并在上一轮 AI 正文后追加剧情建议。取消勾选：下一次发送起停止所有修改。运行时不弹窗。';

    panel.appendChild(heading);
    panel.appendChild(label);
    panel.appendChild(note);
    host.appendChild(panel);
    input.addEventListener('change', () => {
      const state = getSettings();
      state.enabled = input.checked;
      status.enabled = state.enabled;
      const ctx = globalThis.SillyTavern?.getContext?.();
      try {
        ctx?.saveSettingsDebounced?.();
      } catch (err) {
        status.error = '开关保存失败：' + String(err);
        console.error(NAME, status.error);
      }
    });
    status.panelMounted = true;
  }

  const norm = value => String(value ?? '').replace(/\r\n/g, '\n').trim();
  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isRole = (m, role) => {
    const codes = {system: 0, user: 1, assistant: 2, developer: 3};
    return m && (m.role === role || m.role === codes[role]);
  };
  const isPrefill = s => /^(Understood\b|I will\b|I understand\b|Certainly[,.]|Okay[,.])/i.test(norm(s)) && norm(s).length < 1200;
  const slotsFor = m => {
    if (!m) return [];
    if (typeof m.content === 'string') return [{get: () => m.content, set: t => {m.content = t;}}];
    if (Array.isArray(m.content)) return m.content.filter(p => p && typeof p.text === 'string' && (!p.type || p.type === 'text'))
      .map(p => ({get: () => p.text, set: t => {p.text = t;}}));
    return [];
  };
  const readSlot = m => slotsFor(m)[0] ?? null;
  const getChat = () => globalThis.SillyTavern?.getContext?.()?.chat || [];
  const lastSaved = isUser => {
    const chat = getChat();
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i];
      if (m && m.is_user === isUser && !m.is_system && typeof m.mes === 'string' && norm(m.mes)) return m.mes;
    }
    return '';
  };
  const isStoredHistoryText = (role, content) => {
    if (role !== 'user' && role !== 'assistant') return false;
    const trimmed = norm(content);
    return getChat().some(m => m && !m.is_system && typeof m.mes === 'string'
      && Boolean(m.is_user) === (role === 'user') && norm(m.mes) === trimmed);
  };
  const replaceExpanded = (text, source) => {
    // Direct macro token is unusual at this stage, but is safe to replace.
    if (MACRO.test(text)) {
      MACRO.lastIndex = 0;
      const count = [...text.matchAll(MACRO)].length;
      MACRO.lastIndex = 0;
      return {text: text.replace(MACRO, FIXED), count, kind: '原始宏'};
    }
    MACRO.lastIndex = 0;
    const original = norm(source);
    if (!original || original === FIXED || original === PREFIX + FIXED) return null;
    // Keep line-break flexibility: chat and prompt text can use different EOLs.
    const pattern = escapeRegex(original).replace(/\n/g, '\\r?\\n');
    // For short inputs do not replace normal substrings elsewhere in a preset.
    // They must appear as the full line or between literal XML-like tags.
    if (original.length < 8) {
      const boundary = new RegExp('(^|[\\r\\n>])([ \\t]*)(' + pattern + ')(?=[ \\t]*(?:\\r?\\n|<|$))', 'g');
      const matches = [...text.matchAll(boundary)];
      if (!matches.length) return null;
      return {text: text.replace(boundary, (_, before, indent) => before + indent + FIXED),
        count: matches.length, kind: '短输入独立片段'};
    }
    const re = new RegExp(pattern, 'g');
    const matches = [...text.matchAll(re)];
    if (!matches.length) return null;
    return {text: text.replace(re, () => FIXED), count: matches.length, kind: '宏展开文本'};
  };
  const afterBody = (content, suggestion) => {
    const matches = [...content.matchAll(/<\/content\s*>/gi)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const at = last.index + last[0].length;
      return content.slice(0, at) + '\n\n' + suggestion + content.slice(at);
    }
    return content.trimEnd() + '\n\n' + suggestion;
  };
  const lastRealAssistant = (messages, saved) => {
    const target = norm(saved);
    if (target) for (let i = messages.length - 1; i >= 0; i--) {
      if (!isRole(messages[i], 'assistant')) continue;
      const c = norm(readSlot(messages[i])?.get());
      if (isPrefill(c) || c.length < 50) continue;
      if (c === target || (c.length >= 100 && target.includes(c)) || (target.length >= 100 && c.includes(target))) return i;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!isRole(messages[i], 'assistant')) continue;
      const c = readSlot(messages[i])?.get();
      if (typeof c === 'string' && !isPrefill(c) && /<content(?:\s[^>]*)?>[\s\S]*?<\/content\s*>/i.test(c)) return i;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!isRole(messages[i], 'assistant')) continue;
      const c = readSlot(messages[i])?.get();
      if (typeof c === 'string' && norm(c).length > 120 && !isPrefill(c)) return i;
    }
    return -1;
  };
  function apply(messages, stage, dryRun = false) {
    const info = {
      stage, dryRun, messageCount: Array.isArray(messages) ? messages.length : null,
      macroHits: 0, changedMessages: 0, tag: '未处理', added: '未处理', originalChars: 0,
    };
    status.latest = info;
    if (!Array.isArray(messages)) {info.error = '未获取到消息数组'; return;}
    if (dryRun) {info.tag = '预览/干运行（未修改）'; return;}
    const original = lastSaved(true);
    if (!norm(original)) {info.error = '当前聊天未找到最新用户原话'; return;}
    info.originalChars = original.length;

    // Only change prompt-like slots; avoid previously saved dialogue, assistant
    // stories, and standalone actual user messages. The user may use any tag.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const eligible = isRole(m, 'system') || isRole(m, 'developer') || isRole(m, 'user');
      if (!eligible) continue;
      const role = isRole(m, 'system') ? 'system' : isRole(m, 'developer') ? 'developer' : 'user';
      for (const slot of slotsFor(m)) {
        const before = slot.get();
        if (role === 'user' && (norm(before) === norm(original) || isStoredHistoryText(role, before))) continue;
        const replaced = replaceExpanded(before, original);
        if (!replaced || replaced.text === before) continue;
        slot.set(replaced.text);
        info.macroHits += replaced.count;
        info.changedMessages++;
        (info.matchedRoles ??= []).push(role);
      }
    }
    info.tag = info.macroHits > 0 ? '已替换宏展开内容' : '未发现可替换的宏展开内容';
    const suggestionKey = PREFIX + norm(original);
    const suggestion = suggestionKey + '\n\n' + REMINDER;
    const suggestionExists = messages.some(m => isRole(m, 'assistant')
      && slotsFor(m).some(s => s.get().includes(suggestionKey)));
    if (!info.macroHits) {
      // An earlier event may have processed this same request already.
      // Do not insert a new suggestion unless a macro was actually matched.
      if (suggestionExists) {
        info.tag = '先前阶段已处理';
        info.added = '已经存在';
        info.ok = true;
      } else {
        info.error = '没有找到 {{lastUserMessage}} 对应内容；已跳过剧情追加';
        console.warn(NAME, info);
      }
      return;
    }
    if (suggestionExists) {
      info.added = '已经存在';
    } else {
      const i = lastRealAssistant(messages, lastSaved(false));
      if (i >= 0) {
        const slot = readSlot(messages[i]);
        slot.set(afterBody(slot.get(), suggestion));
        info.added = `上一轮 assistant 正文后（序号 ${i}）`;
      } else {
        // Preserve v1.4 behavior when no real assistant story is in context.
        let at = messages.findIndex(m => isRole(m, 'assistant') && isPrefill(readSlot(m)?.get()));
        if (at < 0) at = messages.length;
        messages.splice(at, 0, {role:'assistant', content: suggestion});
        info.added = '回退：独立 assistant 建议（无可用历史正文）';
      }
    }
    // Preserve v1.4: remove an exact raw outgoing user message, not a format
    // protocol; the saved chat remains intact and still supplies the macro.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isRole(messages[i], 'user') && slotsFor(messages[i]).length === 1
          && norm(readSlot(messages[i]).get()) === norm(original)) {
        messages.splice(i, 1);
        info.rawUserRemoved = true;
        break;
      }
    }
    info.ok = true;
    if (info.macroHits || (info.added !== '已经存在' && info.added !== '未处理')) {
      status.lastMutation = {...info};
    }
    // Diagnostic data is available via __STORY_DIRECTION_STATUS; no per-turn notice.
  }
  try {
    const context = globalThis.SillyTavern?.getContext?.();
    const events = context?.eventTypes ?? context?.event_types;
    if (!context?.eventSource?.on || !events) {
      status.error = '无法读取 SillyTavern 事件接口';
      console.error(NAME, status.error);
      return;
    }
    enabled();
    if (events.APP_READY || events.APP_INITIALIZED) {
      context.eventSource.on(events.APP_READY || events.APP_INITIALIZED, mountSettingsPanel);
    } else if (typeof document !== 'undefined' && document.readyState !== 'loading') {
      mountSettingsPanel();
    }
    if (events.CHAT_COMPLETION_PROMPT_READY) {
      context.eventSource.on(events.CHAT_COMPLETION_PROMPT_READY, e => {
        status.promptReadyCalls++;
        if (!enabled()) {
          status.latest = {stage:'prompt-ready', skipped:'插件已关闭'};
          return;
        }
        try {apply(e?.chat, 'prompt-ready', Boolean(e?.dryRun));}
        catch (err) {status.error = String(err); console.error(NAME, err);}
      });
    }
    if (events.CHAT_COMPLETION_SETTINGS_READY) {
      context.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, e => {
        status.settingsReadyCalls++;
        if (!enabled()) {
          status.latest = {stage:'settings-ready', skipped:'插件已关闭'};
          return;
        }
        try {apply(e?.messages, 'settings-ready');}
        catch (err) {status.error = String(err); console.error(NAME, err);}
      });
    }
    status.loaded = true;
    // Loaded silently. Diagnostics remain accessible in __STORY_DIRECTION_STATUS.
  } catch (err) {
    status.error = String(err);
    console.error(NAME, err);
  }
})();
