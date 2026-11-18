const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const plugin = fs.readFileSync(__dirname + '/index.js','utf8');
const FIXED = '按建议剧情发展往下继续';
const PREFIX = '建议剧情发展：';
const REMINDER = '（本轮不再附加剧情建议。）';
function make(source, messages, options={}) {
  const callbacks={};
  const saved = [{is_user:false,mes:options.reply || '<content>前面发生的剧情，这里是一段足够长的叙事文字，包含了正在发生的场景，人物说话和行动状态。</content>'},
    {is_user:true,mes:source}];
  const context={chat:saved,eventSource:{on(name,cb){callbacks[name]=cb}},event_types:{
    CHAT_COMPLETION_PROMPT_READY:'prompt',CHAT_COMPLETION_SETTINGS_READY:'settings'
  }};
  const sandbox={SillyTavern:{getContext:()=>context},console:{info(){},warn(){},error(){}}};
  vm.runInNewContext(plugin,sandbox);
  assert.equal(sandbox.__STORY_DIRECTION_VERSION,'1.6.1');
  callbacks.settings({messages});
  return {messages,status:sandbox.__STORY_DIRECTION_STATUS, callbacks};
}
function req(source, prompt){return [
 {role:'system',content:prompt},
 {role:'assistant',content:'<content>前面发生的剧情，这里是一段足够长的叙事文字，包含了正在发生的场景，人物说话和行动状态。</content>\n<File>补充档案</File>'},
 {role:'user',content:source},
 {role:'assistant',content:'Understood. I will stay in character.'},
 {role:'user',content:'Output Format Protocol: begin <thinking>...'}
];}
const source='我轻轻敲了敲房门。';
{
  const {messages,status}=make(source,req(source,'世界说明\n最新剧情：'+source+'\n结尾'));
  assert.equal(messages[0].content,'世界说明\n最新剧情：'+FIXED+'\n结尾');
  assert.equal(messages[1].content.includes('</content>\n\n'+PREFIX+source+'\n\n'+REMINDER+'\n<File>'),true);
  assert.equal(messages.filter(m=>m.role==='user').length,1);
  assert.equal(messages.at(-1).content,'Output Format Protocol: begin <thinking>...');
  assert.equal(status.latest.macroHits,1);
}
{
  const {messages}=make(source,req(source,'<约束>不复述<叙事输入>。</约束>\n<叙事输入>\n'+source+'\n</叙事输入>'));
  assert.equal(messages[0].content.includes('<叙事输入>\n'+FIXED+'\n</叙事输入>'),true);
}
{
  const {messages,status}=make(source,req(source,'世界的结构完全不包含用户这轮输入'));
  assert.equal(messages[0].content,'世界的结构完全不包含用户这轮输入');
  assert.equal(messages[1].content.includes(PREFIX),false);
  assert.equal(status.latest.ok,undefined);
}
{
  const multiline='我轻轻敲了敲房门。\n随后转身离开了教室。';
  const {messages}=make(multiline,req(multiline,'前文\r\n'+multiline.replace(/\n/g,'\r\n')+'\r\n后文'));
  assert.equal(messages[0].content.includes('前文\r\n'+FIXED+'\r\n后文'),true);
  assert.equal(messages[1].content.includes(PREFIX+multiline+'\n\n'+REMINDER),true);
}
{
  const short='嗯';
  const {messages}=make(short,req(short,'情绪嗯。\n'+short+'\n结尾'));
  assert.equal(messages[0].content,'情绪嗯。\n'+FIXED+'\n结尾');
}
{
  const {messages}=make(source,req(source,'序章：{{lastUserMessage}}，这里还有设定。'));
  assert.equal(messages[0].content.includes('序章：'+FIXED+'，'),true);
}
{
  const ms=[{role:'system',content:'故事背景'}, {role:'user',content:'剧情输入：'+source},
  {role:'assistant',content:'<content>之前有足够长度的剧情内容，人物在屋里做了一些行动并表达意图。</content>'},
  {role:'user',content:source}];
  const {messages}=make(source,ms);
  assert.equal(messages[1].content,'剧情输入：'+FIXED);
  assert.equal(messages.filter(m=>m.role==='user' && m.content===source).length,0);
}
{
  const ms=[{role:0,content:[{type:'text',text:'剧情：'+source}]},
  {role:2,content:'<content>前面发生的剧情，这里是一段足够长的叙事文字，包含了正在发生的场景，人物说话和行动状态。</content>'},
  {role:1,content:source}];
  const {messages}=make(source,ms);
  assert.equal(messages[0].content[0].text.includes('剧情：'+FIXED),true);
  assert.equal(messages[1].content.includes(PREFIX+source),true);
}
{
  const ms=req(source,'本轮：'+source);
  const {messages,callbacks}=make(source,ms);
  callbacks.prompt({chat:messages,dryRun:false});
  assert.equal(messages[0].content,'本轮：'+FIXED);
  assert.equal(messages[1].content.split(PREFIX+source).length,2);
}
{
  const ms=[{role:'system',content:'本轮：'+source},{role:'assistant',content:'Understood. I will stay in character.'}, {role:'user',content:'格式协议'}];
  const {messages,status}=make(source,ms);
  assert.equal(messages[0].content,'本轮：'+FIXED);
  assert.equal(messages.some(m=>m.role==='assistant' && m.content === PREFIX+source+'\n\n'+REMINDER),true);
  assert.equal(status.latest.added.startsWith('回退'),true);
}
console.log('All 10 local extension tests passed');
