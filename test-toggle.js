const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(__dirname + '/index.js','utf8');

function createDom() {
  const nodes = new Map();
  class Node {
    constructor(tag) { this.tagName=tag;this.children=[];this.listeners={};this.checked=false; this.className=''; this._id=''; }
    set id(v){this._id=v; nodes.set(v,this)}
    get id(){return this._id}
    appendChild(n){this.children.push(n);return n}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
    emit(name){for(const fn of this.listeners[name]??[])fn()}
  }
  const document = {
    readyState:'complete',
    createElement: tag => new Node(tag),
    getElementById: id => nodes.get(id)??null,
  };
  const container = new Node('div');container.id='extensions_settings2';
  return {document};
}
function load(settings, dom) {
  const callbacks={};let saves=0;
  const reply='<content>上一轮 AI 的剧情正文，这里包含足够长度用来通过插件匹配，并允许追加原本的剧情走向。</content>';
  const input='我轻轻敲了敲房门。';
  const cx = {
    extensionSettings:settings,
    chat:[{is_user:false,mes:reply},{is_user:true,mes:input}],
    saveSettingsDebounced:()=>{saves++},
    eventSource:{on(name,fn){callbacks[name]=fn}},
    event_types:{APP_READY:'app_ready',CHAT_COMPLETION_PROMPT_READY:'prompt',CHAT_COMPLETION_SETTINGS_READY:'settings'},
  };
  const sandbox = {SillyTavern:{getContext:()=>cx},document:dom.document,console:{info(){},warn(){},error(){}}};
  vm.runInNewContext(script,sandbox);
  callbacks.app_ready();
  const checkbox = dom.document.getElementById('storydir_enabled_toggle');
  const mk = () => [
    {role:'system',content:'<叙事输入>\n'+input+'\n</叙事输入>'},
    {role:'assistant',content:reply},
    {role:'user',content:input},
  ];
  return {callbacks,checkbox,mk,cx,sandbox,getSaves:()=>saves};
}
const settings = {};
const dom = createDom();
const a = load(settings,dom);
assert.ok(dom.document.getElementById('storydir_settings_panel'),'panel mounted');
assert.equal(a.checkbox.checked,true,'defaults on');
let msgs = a.mk();
a.callbacks.settings({messages:msgs});
assert.ok(msgs[0].content.includes('按建议剧情发展往下继续'),'on transforms prompt');
assert.ok(msgs[1].content.includes('建议剧情发展：我轻轻敲了敲房门。\n\n（本轮不再附加剧情建议。）'),'on appends suggestion and reminder');
a.checkbox.checked=false;a.checkbox.emit('change');
assert.equal(settings.story_direction_after_reply.enabled,false,'off saved');
assert.equal(a.getSaves(),1,'save called');
msgs=a.mk();const snapshot=JSON.stringify(msgs);
a.callbacks.settings({messages:msgs});
assert.equal(JSON.stringify(msgs),snapshot,'off makes zero changes');
assert.equal(a.sandbox.__STORY_DIRECTION_STATUS.enabled,false);
a.checkbox.checked=true;a.checkbox.emit('change');
assert.equal(settings.story_direction_after_reply.enabled,true,'on saved');
msgs=a.mk();a.callbacks.settings({messages:msgs});
assert.ok(msgs[0].content.includes('按建议剧情发展往下继续'),'on again transforms');
// Existing preference is read when a fresh browser page loads.
settings.story_direction_after_reply.enabled=false;
const refreshed=load(settings,createDom());
assert.equal(refreshed.checkbox.checked,false,'off persisted across reload');
msgs=refreshed.mk();const raw=JSON.stringify(msgs);
refreshed.callbacks.settings({messages:msgs});
assert.equal(JSON.stringify(msgs),raw,'persisted off skips');
console.log('All toggle / persistence / silent-mode tests passed');
