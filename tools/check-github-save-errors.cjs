'use strict';
// 架空の fetch 応答だけを利用。実データ・実環境変数・ネットワーク・メールは読み込まない。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnsalon-github-error-'));
const file = path.join(dir, 'state.json'), diagnostic = file + '.github-error.json';
const fixtureSecret = 'ghp_SYNTHETIC_TEST_SECRET_1234567890', fixtureMail = 'test-customer@example.test';
let fetchImpl = async () => { throw new Error('unexpected network attempt'); };
const timers = [], logs = [];
const sandbox = { require, module: { exports: {} }, __dirname: path.dirname(file), Buffer, console: {log: (...xs)=>logs.push(xs.join(' '))},
  setInterval: (fn, ms) => { const t={fn,ms,unref(){}};timers.push(t);return t; }, setTimeout: () => ({unref(){}}),
  process: { on() {}, env: { DEMO_EPHEMERAL: '1', HP_MAIL: '0', DEMO_DATA: file, GH_TOKEN: fixtureSecret, GH_REPO: 'test/private', GH_BRANCH: 'main', OTHER_SECRET: 'test-extra-secret' } },
  fetch: (...args) => fetchImpl(...args) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'persist.js'), 'utf8') + '\nmodule.exports.audit={ghPut,ghSaveError,ghErrorCategory};', sandbox);
const a = sandbox.module.exports.audit, results = [], response = (status, data) => new Response(JSON.stringify(data), { status });
const check = async (name, fn) => { await fn(); results.push(name); };
const read = () => JSON.parse(fs.readFileSync(diagnostic, 'utf8'));
(async () => {
  const cases = [
    ['missing_sha', { message: 'Invalid request. "sha" wasn\'t supplied.' }],
    ['missing_sha', { errors: [{ field: 'sha', code: 'missing_field' }] }],
    ['sha_mismatch', { message: 'sha does not match expected value' }],
    ['size_limit', { message: 'content is too large, exceeds the maximum allowed size' }],
    ['rate_limit', { message: 'You have exceeded a secondary rate limit.' }],
    ['repository_rule', { message: 'Repository rule violations found' }],
    ['identity', { errors: [{ field: 'email', code: 'invalid', message: 'Invalid committer email' }] }],
    ['content_validation', { message: 'content is not valid Base64' }],
    ['unknown', { message: 'A previously unknown validation error' }],
  ];
  for (const [want, data] of cases) await check('分類 ' + want, async () => {
    const e = await a.ghSaveError(response(422, data), 'test-request', 'test-base64');
    assert(e.message.includes('category=' + want)); assert(!e.message.includes(data.message || '\u0000'));
    assert.equal(fs.statSync(diagnostic).mode & 0o777, 0o600);
  });
  await check('診断本文から資格情報/メール/URL/要求内容を除きログは固定語だけ', async () => {
    const request = '{"name":"テスト要求氏名","private":"テスト要求内容"}', content = 'U1lOVEhFVElDX1JFUVVFU1RfQ09OVEVOVA==';
    const malicious = `${fixtureSecret} test-extra-secret github_pat_UNKNOWN_FIXTURE_TOKEN Bearer UNKNOWN_TOKEN ${fixtureMail} https://example.test/?token=SECRET ${request} ${content}`;
    const e = await a.ghSaveError(response(422, { message: malicious, content: 'SHOULD_NOT_SAVE', errors: [{ field: fixtureMail, code: fixtureSecret, message: malicious, resource: 'SHOULD_NOT_SAVE' }, { field: 'sha', code: 'invalid' }] }), request, content);
    const out = fs.readFileSync(diagnostic, 'utf8');
    for (const secret of [fixtureSecret, 'test-extra-secret', 'UNKNOWN_FIXTURE_TOKEN', 'UNKNOWN_TOKEN', fixtureMail, 'https://', request, content, 'SHOULD_NOT_SAVE', 'テスト要求氏名']) { assert(!out.includes(secret)); assert(!e.message.includes(secret)); }
    assert.deepEqual(Object.keys(read()).sort(), ['errors','message','status']); assert(!read().errors[0].field && !read().errors[0].code);
    assert(e.message.includes('fields=sha codes=invalid')); assert(e.message.length < 180);
  });
  await check('長さ上限/制御文字/本文フィールドだけを保存', async () => {
    const msg = 'x '.repeat(2000) + '\n\r\u0000';
    await a.ghSaveError(response(422, { message: msg, errors: Array.from({length:12}, () => ({message:'y '.repeat(600),field:'content',code:'invalid'})) }), '', '');
    const d = read(); assert(d.message.length <= 1000); assert.equal(d.errors.length,8); assert(d.errors.every(e=>e.message.length<=500)); assert(!/[\u0000-\u001f]/.test(d.message));
  });
  await check('過大応答を32KBで打ち切り生データを保存しない', async () => {
    await a.ghSaveError(response(422, { message: 'SYNTHETIC_PRIVATE'.repeat(3000) }), '', '');
    assert.equal(read().message, '[response too large]'); assert(!fs.readFileSync(diagnostic,'utf8').includes('SYNTHETIC_PRIVATE'));
  });
  await check('不正JSONでも元のHTTP失敗を保持', async () => {
    const e=await a.ghSaveError(new Response('invalid private text', {status:502}), '', '');assert(e.message.includes('HTTP 502'));assert.equal(read().message,'');
  });
  await check('診断保存不能でもローカル保存を壊さず原因を返す', async () => {
    const old=sandbox.process.env.DEMO_DATA;sandbox.process.env.DEMO_DATA=path.join(dir,'missing','state.json');
    const e=await a.ghSaveError(response(422,{message:'content too large'}),'','');assert(e.message.includes('category=size_limit'));assert(e.message.includes('diagnostic=unavailable'));sandbox.process.env.DEMO_DATA=old;
  });
  await check('既存診断ファイルの権限も0600へ制限', async () => {
    fs.chmodSync(diagnostic,0o644);await a.ghSaveError(response(422,{message:'unknown'}),'','');assert.equal(fs.statSync(diagnostic).mode&0o777,0o600);
  });
  await check('最終422だけを診断し従来のPUT→SHA→PUT再試行を維持', async () => {
    const calls=[];fetchImpl=async (_url,opt)=>{calls.push(opt.method||'GET');return calls.length===2?response(200,{sha:'test-new-sha'}):response(422,{message:'content is too large'});};
    await assert.rejects(()=>a.ghPut('{"test":true}','test-old-sha'),e=>e.message.includes('category=size_limit'));assert.deepEqual(calls,['PUT','GET','PUT']);
  });
  await check('成功と再試行成功には診断を書かず保存結果を返す', async () => {
    const before=fs.readFileSync(diagnostic,'utf8'),calls=[];fetchImpl=async (_url,opt)=>{calls.push(opt.method||'GET');return calls.length===1?response(409,{message:'test conflict'}):calls.length===2?response(200,{sha:'test-new-sha'}):response(200,{content:{sha:'test-saved-sha'}});};
    assert.equal(await a.ghPut('{"test":true}','test-old-sha'),'test-saved-sha');assert.deepEqual(calls,['PUT','GET','PUT']);assert.equal(fs.readFileSync(diagnostic,'utf8'),before);
  });
  await check('422以外は従来どおり再試行せず分類', async () => {
    let n=0;fetchImpl=async()=>{n++;return response(429,{message:'rate limit exceeded'});};await assert.rejects(()=>a.ghPut('{"test":true}',null),e=>e.message.includes('category=rate_limit'));assert.equal(n,1);
  });
  if (process.argv[2]) await check('送信無効の本番コピーを隔離保存しmock422でも元記録を維持', async () => {
    const crypto=require('node:crypto'), hash=x=>crypto.createHash('sha256').update(x).digest('hex');
    const source=fs.readFileSync(path.resolve(process.argv[2])), sourceHash=hash(source), original=JSON.parse(source);
    assert(original.state && !original.state.mailRelay?.url && !original.state.mailRelay?.secret && original.state.mails.length===0,'送信無効のコピーのみ使用可能');
    const target=path.join(dir,'safe-copy.json');fs.writeFileSync(target,source,{mode:0o600});
    sandbox.process.env.DEMO_DATA=target;sandbox.process.env.DEMO_EPHEMERAL='0';sandbox.process.env.DEMO_PERSIST='1';
    const p=sandbox.module.exports,loaded=p.loadSnapshot();assert(loaded.enabled&&loaded.data,'コピー読込');
    const before=hash(JSON.stringify(original.state)), save=p.startSaver(()=>loaded.data);save();
    const calls=[];fetchImpl=async (_url,opt)=>{calls.push(opt.method||'GET');return opt.method==='PUT'?response(422,{message:'content too large'}):response(200,{sha:'test-copy-sha'});};
    await timers.find(t=>t.ms===30000).fn();
    assert.deepEqual(calls,['GET','PUT','GET','PUT']);assert(hash(JSON.stringify(JSON.parse(fs.readFileSync(target)).state))===before,'コピー保存後も全state保持');
    assert(hash(fs.readFileSync(path.resolve(process.argv[2])))===sourceHash,'元コピーは変更なし');
    assert(logs.at(-1).includes('category=size_limit'));assert(!logs.join('\n').includes(fixtureSecret));assert(!logs.join('\n').includes(fixtureMail));
    assert.equal(fs.statSync(target+'.github-error.json').mode&0o777,0o600);
  });
  console.log(JSON.stringify({ok:true,checks:results.length,externalNetwork:false,productionData:false,realMail:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
