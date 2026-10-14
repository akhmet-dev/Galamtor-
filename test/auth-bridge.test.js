const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../public/auth-bridge.js'),'utf8');
const state='a'.repeat(64), origin='https://galamtor.web.app';
function fixture() {
  const messages=[], requests=[], listeners={}, buttons={};
  const opener={postMessage:(message,target)=>messages.push({message,target})};
  const status={textContent:''},cancelButton={hidden:false,addEventListener:(name,callback)=>buttons[name]=callback};
  vm.runInNewContext(source, {
    URLSearchParams, AbortSignal, setTimeout:()=>1,clearTimeout:()=>{},
    location:{search:`?state=${state}&origin=${encodeURIComponent(origin)}`},history:{replaceState(){}},
    window:{opener,addEventListener:(name,callback)=>listeners[name]=callback},
    document:{title:'QA bridge',getElementById:id=>id==='status'?status:cancelButton},
    fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>({ok:true,code:'complete'})};}
  });
  const send=(overrides={},data={})=>listeners.message({origin,source:opener,data:{type:'galamtor-auth-credential',state,googleIdToken:'qa-google-id',...data},...overrides});
  return {messages,requests,status,send,buttons};
}

test('bridge ignores a wrong sender origin, source window or nonce', async()=>{
  const f=fixture();
  await f.send({origin:'https://evil.example'});
  await f.send({source:{}});
  await f.send({}, {state:'b'.repeat(64)});
  assert.equal(f.requests.length,0);assert.equal(f.messages.length,1);
});

test('bridge accepts only bounded token strings and never forwards account fields', async()=>{
  const f=fixture();
  for(const token of [null,{},' ','x'.repeat(16385)]) await f.send({}, {googleIdToken:token});
  assert.equal(f.requests.length,0);
  await f.send({}, {email:'qa@example.invalid',password:'qa-placeholder'});
  const payload=JSON.parse(f.requests[0].body);
  assert.deepEqual(Object.keys(payload).sort(),['googleAccessToken','googleIdToken','state']);
  assert.equal(payload.googleIdToken,'qa-google-id');
});

test('bridge confirmation sends only acknowledgment back and discards credential replays', async()=>{
  const f=fixture();await f.send();await f.send();
  assert.equal(f.requests.length,1);
  const reply=f.messages.at(-1);
  assert.equal(reply.target,origin);assert.equal(reply.message.ok,true);assert.equal(reply.message.code,'complete');
  assert.deepEqual(Object.keys(reply.message).sort(),['code','ok','state','type']);
});

test('bridge cancellation sends only state to the local server', async()=>{
  const f=fixture();await f.send({}, {type:'galamtor-auth-cancel'});
  assert.equal(f.requests[0].url,'/cancel');assert.deepEqual(JSON.parse(f.requests[0].body),{state});
  await f.send();assert.equal(f.requests.length,1);assert.equal(f.messages.at(-1).message.code,'auth/cancelled');
});

test('late cancellation explains an already confirmed account instead of claiming cancellation', async()=>{
  const f=fixture();await f.send();await f.send({}, {type:'galamtor-auth-cancel'});
  assert.equal(f.requests.length,1);assert.equal(f.messages.at(-1).message.code,'auth/already-complete');
});
