'use strict';
// 外部fetchを使わず、GitHubの状態遷移をメモリ内で再現。実サーバー・実送信設定は読み込まない。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cnsalon-git-backup-'));
const source=fs.readFileSync(path.join(__dirname,'..','persist.js'),'utf8');
const HEAD='1'.repeat(40),OLD_TREE='2'.repeat(40),NEW_TREE='3'.repeat(40),COMMIT='4'.repeat(40),OTHER='5'.repeat(40),TARGET='salon-data/state.json.gz';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),blobHash=x=>crypto.createHash('sha1').update('blob '+x.length+'\0').update(x).digest('hex');
const reply=(status,data)=>new Response(JSON.stringify(data),{status});
function fixture(options={}){
  const state={head:HEAD,calls:[],blob:null,tree:null,commit:null,patches:0,privacy:options.privacy??true,otherFile:'test-preserved-file'};
  const sandbox={require,Buffer,__dirname:temp,module:{exports:{}},console:{log(){}},process:{env:{DEMO_EPHEMERAL:'1',HP_MAIL:'0',DEMO_DATA:path.join(temp,'state.json'),GH_TOKEN:'test-fake-token',GH_REPO:'test/private',GH_BRANCH:'main'}},fetch:async(url,opt={})=>{
    const route=new URL(url).pathname.replace('/repos/test/private',''),method=opt.method||'GET',body=opt.body?JSON.parse(opt.body):null;state.calls.push({route,method});
    if(options.onRequest)await options.onRequest({route,method,body,state,sandbox});
    if(options.fail===route&&method!=='GET')return reply(422,{message:'test stage refusal'});
    if(route===''&&method==='GET')return reply(200,{private:state.privacy});
    if(route==='/git/ref/heads/main')return reply(200,{ref:'refs/heads/main',object:{type:'commit',sha:state.head}});
    if(route==='/git/commits/'+HEAD)return reply(200,{sha:HEAD,tree:{sha:OLD_TREE}});
    if(route==='/git/blobs'){
      assert.equal(body.encoding,'base64');state.blob=Buffer.from(body.content,'base64');return reply(201,{sha:options.badBlob?OTHER:blobHash(state.blob)});
    }
    if(route==='/git/trees'){
      assert.equal(body.base_tree,OLD_TREE);assert.equal(body.tree.length,1);assert.equal(body.tree[0].path,TARGET);assert.equal(body.tree[0].mode,'100644');assert.equal(body.tree[0].type,'blob');assert.equal(body.tree[0].sha,blobHash(state.blob));state.tree=body;
      return reply(201,{sha:NEW_TREE});
    }
    if(route==='/git/commits'){
      assert.deepEqual(body.parents,[HEAD]);assert.equal(body.tree,NEW_TREE);state.commit=body;return reply(201,{sha:COMMIT,tree:{sha:NEW_TREE},parents:[{sha:HEAD}]});
    }
    if(route==='/git/refs/heads/main'){
      state.patches++;assert.equal(body.force,false);assert.equal(body.sha,COMMIT);
      if(options.conflict){state.head=OTHER;return reply(409,{message:'test conflict'});}
      if(options.lostResponse){state.head=COMMIT;throw Error('test connection lost');}
      if(options.transient&&state.patches===1)throw Error('test transient connection failure');
      if(options.unknownRef)throw Error('test connection lost');
      if(options.abortOnRef)throw Error('test abort');
      state.head=COMMIT;return reply(200,{ref:'refs/heads/main',object:{type:'commit',sha:COMMIT}});
    }
    if(route==='/contents/'+TARGET&&method==='PUT'){
      state.blob=Buffer.from(body.content,'base64');return reply(200,{content:{sha:blobHash(state.blob)}});
    }
    if(route==='/contents/'+TARGET&&method==='GET')return new Response(state.blob,{status:200});
    if(route==='/contents/salon-data/state.json')return reply(404,{});
    throw Error('unexpected synthetic endpoint');
  }};
  vm.runInNewContext(source+'\nmodule.exports.audit={ghPut,ghPutGit,ghFetch};',sandbox);
  return {a:sandbox.module.exports.audit,p:sandbox.module.exports,state,sandbox};
}
const sample=JSON.stringify({savedAt:1,state:{test:'テストコピー',photos:{__pm_map__:[['test','test-photo-data']]},mailRelay:{url:'',secret:''},mails:[]}}),compressed=zlib.gzipSync(sample);
const results=[];async function check(name,fn){await fn();results.push(name);}
(async()=>{
  await check('小さい保存は非公開確認後Contents経路を維持',async()=>{
    const f=fixture(),result=await f.a.ghPut(sample,null);assert.equal(result,blobHash(f.state.blob));assert.deepEqual(f.state.calls.map(x=>x.method),['GET','PUT']);assert(zlib.gunzipSync(f.state.blob).equals(Buffer.from(sample)));
  });
  for(const privacy of [false,null])await check('非公開を確認できない保存先へは送らない '+privacy,async()=>{
    const f=fixture();f.state.privacy=privacy;await assert.rejects(()=>f.a.ghPut(sample,null),/repository_not_private/);assert.equal(f.state.calls.length,1);assert(!f.state.blob);
  });
  await check('既存treeと他ファイルを保持してblob→tree→commit→ref順に保存',async()=>{
    const f=fixture(),out=await f.a.ghPutGit(sample,compressed);assert.equal(out,blobHash(compressed));assert.equal(f.state.head,COMMIT);assert.equal(f.state.otherFile,'test-preserved-file');assert.deepEqual(f.state.calls.map(x=>x.method),['GET','GET','POST','POST','POST','PATCH']);
    assert.equal(await f.a.ghFetch(true),sample);
  });
  for(const fail of ['/git/blobs','/git/trees','/git/commits'])await check('途中失敗は旧backupのrefを変更しない '+fail,async()=>{
    const f=fixture({fail});await assert.rejects(()=>f.a.ghPutGit(sample,compressed));assert.equal(f.state.head,HEAD);assert.equal(f.state.patches,0);
  });
  await check('返却blob SHA不一致ではtreeやrefを作らない',async()=>{
    const f=fixture({badBlob:true});await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/git_blob/);assert.equal(f.state.head,HEAD);assert(!f.state.tree);
  });
  await check('ref競合は新しい親へ付け替えず同プロセスの再送も止める',async()=>{
    const f=fixture({conflict:true});await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_conflict/);const n=f.state.calls.length;
    await assert.rejects(()=>f.a.ghPut(sample,null),/ref_update_unconfirmed/);assert.equal(f.state.calls.length,n);assert.equal(f.state.head,OTHER);assert.equal(f.state.patches,1);
  });
  await check('ref応答が失われてもGETで同じcommitを確認して成功',async()=>{
    const f=fixture({lostResponse:true});assert.equal(await f.a.ghPutGit(sample,compressed),blobHash(compressed));assert.equal(f.state.head,COMMIT);assert.equal(f.state.patches,1);
  });
  await check('旧headのままの一時通信断は同じcommitだけ1回再試行',async()=>{
    const f=fixture({transient:true});assert.equal(await f.a.ghPutGit(sample,compressed),blobHash(compressed));assert.equal(f.state.patches,2);assert.equal(f.state.calls.filter(x=>x.route==='/git/commits').length,1);
  });
  await check('refの結果確認もできないときは成功扱いせず停止',async()=>{
    const f=fixture({unknownRef:true,onRequest:({route,state})=>{if(state.patches&&route==='/git/ref/heads/main')throw Error('test GET failure');}});
    await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_update_unconfirmed/);assert.equal(f.state.head,HEAD);const n=f.state.calls.length;await assert.rejects(()=>f.a.ghPut(sample,null));assert.equal(f.state.calls.length,n);
  });
  await check('所有者でなくなった場合はrefを更新しない',async()=>{
    let f;f=fixture({onRequest:({route,method})=>{if(route==='/git/commits'&&method==='POST')f.p.abortSaves();}});
    await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/save_aborted/);assert.equal(f.state.head,HEAD);assert.equal(f.state.patches,0);
  });
  await check('20MiBを超える圧縮データはContents PUTを使わない',async()=>{
    const json=JSON.stringify({test:crypto.randomBytes(21*1024*1024).toString('base64')}),f=fixture();await f.a.ghPut(json,null);
    assert(f.state.blob.length>20*1024*1024);assert(!f.state.calls.some(x=>x.method==='PUT'));assert.equal(f.state.calls[0].route,'');assert(hash(zlib.gunzipSync(f.state.blob))===hash(json),'復元内容一致');
  });
  if(process.argv[2])await check('送信無効本番コピーを無加工gzipで保存復元し原本保持',async()=>{
    const file=path.resolve(process.argv[2]),raw=fs.readFileSync(file),before=hash(raw),s=JSON.parse(raw);
    assert(s.state&&!s.state.mailRelay?.url&&!s.state.mailRelay?.secret&&s.state.mails.length===0,'送信無効コピーのみ');
    const f=fixture(),json=raw.toString('utf8');await f.a.ghPut(json,null);assert(hash(zlib.gunzipSync(f.state.blob))===before,'写真含む全内容復元一致');assert(hash(fs.readFileSync(file))===before,'元コピーは変更なし');
    const restored=await f.a.ghFetch(true);assert(hash(restored)===before,'既存raw GETの復元形式を維持');
  });
  console.log(JSON.stringify({ok:true,checks:results.length,externalNetwork:false,productionWrites:false,realMail:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
