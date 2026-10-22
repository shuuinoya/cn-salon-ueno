'use strict';
// 通信先はローカルbare Gitへ差し替え。private確認も架空応答のみ。送信・本番書込なし。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),zlib=require('node:zlib'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cnsalon-git-check-'));fs.chmodSync(root,0o700);
const source=fs.readFileSync(path.join(__dirname,'..','persist.js'),'utf8'),target='salon-data/state.json.gz';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),blobHash=x=>crypto.createHash('sha1').update('blob '+x.length+'\0').update(x).digest('hex');
const env={PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_AUTHOR_NAME:'テスト保存',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'テスト保存',GIT_COMMITTER_EMAIL:'test@example.test'};
const git=(dir,args,input)=>cp.execFileSync('/usr/bin/git',args,{cwd:dir,env,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const sample=JSON.stringify({savedAt:1,state:{test:'テスト',mailRelay:{url:'',secret:''},mails:[]}}),compressed=zlib.gzipSync(sample),secret='ghp_SYNTHETIC_SECRET';
let serial=0;
function fixture(options={}){
 const base=path.join(root,'case-'+(++serial));fs.mkdirSync(base,{mode:0o700});const bare=path.join(base,'remote.git');git(base,['init','--bare','--template=',bare]);
 const originalBlob=git(bare,['hash-object','-w','--stdin'],'テスト保持ファイル'),tree=git(bare,['mktree'],'100644 blob '+originalBlob+'\tkeep.txt\n');
 const initial=git(bare,['commit-tree',tree], 'テスト初期\n');git(bare,['update-ref','refs/heads/main',initial]);
 const state={bare,initial,spawn:[],dirs:new Set(),patches:0,privateReads:0,privacy:true},handlers={};
 state.hangReady=new Promise(resolve=>{state.resolveHang=resolve;});
 const advance=()=>{const parent=git(bare,['rev-parse','refs/heads/main']),next=git(bare,['commit-tree',tree,'-p',parent],'テスト別更新 '+Date.now()+'\n');git(bare,['update-ref','refs/heads/main',next]);return next;};
 const wrapped={...cp,spawn(bin,args,opts){
   state.spawn.push({args:[...args],opts});state.dirs.add(opts.cwd);
   assert.equal(opts.shell,false);assert.equal(opts.detached,true);assert(!args.join(' ').includes(secret));assert(!Object.keys(opts.env).some(k=>/^GIT_TRACE/.test(k)));
   assert.equal(opts.env.GIT_CONFIG_GLOBAL,'/dev/null');const config=Object.fromEntries(Array.from({length:Number(opts.env.GIT_CONFIG_COUNT)},(_,i)=>[opts.env['GIT_CONFIG_KEY_'+i],opts.env['GIT_CONFIG_VALUE_'+i]]));
   assert.equal(config['credential.helper'],'');assert.equal(config['http.followRedirects'],'false');assert.equal(config['http.https://github.com/test/private.git.extraheader'],'Authorization: Basic '+Buffer.from('x-access-token:'+secret).toString('base64'));
   assert.equal(fs.statSync(opts.cwd).mode&0o777,0o700);
   let actual=args.map(x=>x==='https://github.com/test/private.git'?'file://'+bare:x),lost=false;
   if(args[0]==='push'){
     state.patches++;assert(!args.some(x=>/^--force|^\+/.test(x)));if(options.conflict)advance();
     if(options.failPush&&state.patches<=options.failPush)actual=['rev-parse','--verify','test-nonexistent'];
     if(options.lostResponse)lost=true;
     for(const rel of ['config','backup-index'])assert.equal(fs.statSync(path.join(opts.cwd,rel)).mode&0o777,0o600);
     const configFile=fs.readFileSync(path.join(opts.cwd,'config'),'utf8');assert(!configFile.includes(secret)&&!configFile.includes('Authorization'));
   }
   if(options.unknown&&args[0]==='ls-remote')actual=['rev-parse','--verify','test-nonexistent'];
   if(options.hangFetch&&args[0]==='fetch'){
     const child=cp.spawn(process.execPath,['-e','require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});setInterval(()=>{},1000)'],opts);
     state.resolveHang();return child;
   }
   const child=cp.spawn(bin,actual,opts);if(lost){const emit=child.emit;child.emit=function(event,...a){if(event==='close'&&a[0]===0)a[0]=1;return emit.call(this,event,...a);};}
   return child;
 }};
 const sandbox={require:n=>n==='child_process'?wrapped:require(n),Buffer,__dirname:base,module:{exports:{}},console:{log(){}},setTimeout,clearTimeout,
  process:{env:{DEMO_EPHEMERAL:'1',HP_MAIL:'0',DEMO_DATA:path.join(base,'state.json'),GH_TOKEN:secret,GH_REPO:'test/private',GH_BRANCH:'main',GIT_TRACE:'1',GIT_DIR:'test-wrong'},umask:process.umask.bind(process),kill:process.kill.bind(process),on:(name,fn)=>{handlers[name]=fn;}},
  fetch:async(_url,opt={})=>{state.privateReads++;assert.equal(_url,'https://api.github.com/repos/test/private');assert(!opt.body);return new Response(JSON.stringify({private:state.privacy}),{status:200});}};
 vm.runInNewContext(source+'\nmodule.exports.audit={ghPut,ghPutGit};',sandbox);
 return {a:sandbox.module.exports.audit,p:sandbox.module.exports,state,advance,handlers};
}
const results=[];async function check(name,fn){if(process.argv[3]&&process.argv[3]!==name)return;await fn();results.push(name);}
function cleaned(f){for(const d of f.state.dirs)assert(!fs.existsSync(d),'一時作業場削除');}
(async()=>{
 await check('通常Gitは既存treeを保ち同じgzipとblob識別番号を保存',async()=>{const f=fixture(),out=await f.a.ghPutGit(sample,compressed);assert.equal(out,blobHash(compressed));assert.equal(git(f.state.bare,['show','main:keep.txt']),'テスト保持ファイル');const bytes=cp.execFileSync('/usr/bin/git',['show','main:'+target],{cwd:f.state.bare,env});assert(zlib.gunzipSync(bytes).equals(Buffer.from(sample)));assert.equal(git(f.state.bare,['rev-parse','main^']),f.state.initial);cleaned(f);});
 await check('非公開を確認できない保存先にはデータを渡さない',async()=>{const f=fixture();f.state.privacy=false;await assert.rejects(()=>f.a.ghPut(sample,null),/repository_not_private/);assert.equal(f.state.spawn.length,0);});
 await check('100MiB超はGit開始前に明示拒否',async()=>{const f=fixture();await assert.rejects(()=>f.a.ghPutGit('',{length:100*1024*1024+1}),/size_limit/);assert.equal(f.state.spawn.length,0);});
 await check('push未更新を確認した失敗は次周期に再試行できる',async()=>{const f=fixture({failPush:1});await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/category=git_command/);assert.equal(git(f.state.bare,['rev-parse','main']),f.state.initial);cleaned(f);await f.a.ghPutGit(sample,compressed);assert.equal(f.state.patches,2);cleaned(f);});
 await check('未更新確認後でも次周期までに別headが入れば送らず停止',async()=>{const f=fixture({failPush:1});await assert.rejects(()=>f.a.ghPutGit(sample,compressed));const next=f.advance();await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_conflict/);assert.equal(f.state.patches,1);assert.equal(git(f.state.bare,['rev-parse','main']),next);cleaned(f);});
 await check('通常push競合は別更新を保持して以後停止',async()=>{const f=fixture({conflict:true});await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_conflict/);const n=f.state.spawn.length;await assert.rejects(()=>f.a.ghPut(sample,null),/ref_update_unconfirmed/);assert.equal(f.state.spawn.length,n);cleaned(f);});
 await check('push応答が失われてもremotehead一致を確認して成功',async()=>{const f=fixture({lostResponse:true});assert.equal(await f.a.ghPutGit(sample,compressed),blobHash(compressed));assert.equal(f.state.patches,1);cleaned(f);});
 await check('push結果を照合できない場合は自動再送せず停止',async()=>{const f=fixture({unknown:true});await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_update_unconfirmed/);await assert.rejects(()=>f.a.ghPutGit(sample,compressed),/ref_update_unconfirmed/);assert.equal(f.state.patches,1);cleaned(f);});
 await check('親の終了処理は子プロセス群を停止し一時Gitを削除',async()=>{
   const f=fixture({hangFetch:true}),pending=f.a.ghPutGit(sample,compressed).then(()=>({ok:true}),error=>({error}));await f.state.hangReady;await new Promise(resolve=>setTimeout(resolve,80));f.handlers.exit();const result=await pending;assert(result.error);assert.equal(f.state.patches,0);assert.equal(git(f.state.bare,['rev-parse','main']),f.state.initial);cleaned(f);
 });
 await check('20MiB超の入口は非公開確認して通常Gitを使用',async()=>{const f=fixture(),json=JSON.stringify({test:crypto.randomBytes(21*1024*1024).toString('base64')});await f.a.ghPut(json,null);assert.equal(f.state.privateReads,1);assert.equal(f.state.patches,1);const bytes=cp.execFileSync('/usr/bin/git',['show','main:'+target],{cwd:f.state.bare,env,maxBuffer:40*1024*1024});assert(bytes.length>20*1024*1024);assert(hash(zlib.gunzipSync(bytes))===hash(json));cleaned(f);});
 if(process.argv[2])await check('送信無効本番コピーの写真を含む全内容を実Gitから完全復元',async()=>{const file=path.resolve(process.argv[2]),raw=fs.readFileSync(file),original=hash(raw),s=JSON.parse(raw);assert(s.state&&!s.state.mailRelay?.url&&!s.state.mailRelay?.secret&&s.state.mails.length===0,'送信無効コピーのみ');const f=fixture(),gz=await new Promise((resolve,reject)=>zlib.gzip(raw,{level:9},(e,b)=>e?reject(e):resolve(b)));await f.a.ghPutGit(raw.toString(),gz);const restored=cp.execFileSync('/usr/bin/git',['show','main:'+target],{cwd:f.state.bare,env,maxBuffer:120*1024*1024});assert(hash(zlib.gunzipSync(restored))===original,'全内容一致');assert(hash(fs.readFileSync(file))===original,'元コピー不変');cleaned(f);});
 console.log(JSON.stringify({ok:true,checks:results.length,externalNetwork:false,productionWrites:false,realMail:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
