'use strict';
// 本番を起動せず、設定確認が無応答でも起動準備を終えられることを検査する。
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'mac-production.js'),'utf8');
const code=source.slice(source.indexOf('function tailscaleLocalApi()'),source.indexOf('// 固定URL（Tailscale）の持ち主か'));
function environment(discovery, network=[]) {
  const calls=[],kills=[];
  const spawn=()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=signal=>kills.push(signal);
    if(discovery!==null) process.nextTick(()=>{child.stdout.emit('data',discovery);child.emit('close',0);});
    return child;
  };
  const http={request(options,callback){
    calls.push(options.method);const q=new EventEmitter();let timer;
    q.setTimeout=(ms,fn)=>{assert.equal(ms,5000);if(network[0]==='hang')timer=setTimeout(fn,10);};
    q.destroy=()=>{clearTimeout(timer);q.emit('error',Error('timeout'));};q.write=()=>{};
    q.end=()=>process.nextTick(()=>{
      const item=network.shift();if(item==='hang')return;
      const r=new EventEmitter();r.statusCode=item?.status||0;r.headers={};callback(r);
      r.emit('data',JSON.stringify(item?.body||{}));r.emit('end');
    });return q;
  }};
  const context={spawn,process:{execPath:process.execPath},PORT:'5600',console:{log(){}},require:name=>{assert.equal(name,'http');return http;},
    setTimeout:(fn,ms)=>{assert.equal(ms,5000);return setTimeout(fn,10);},clearTimeout};
  vm.createContext(context);vm.runInContext(code,context);return {context,calls,kills};
}
async function main(){
  const valid=JSON.stringify({port:'12345',token:'test-fixture-only'});
  let e=environment(null);assert.equal(await e.context.tailscaleLocalApi(),null);assert.deepEqual(e.kills,['SIGKILL']);
  console.log('OK: 読み取り停止は期限内に打ち切り、確認用の子処理だけを終了');
  for(const value of ['', 'broken', JSON.stringify({port:'65536',token:'test'}), JSON.stringify({port:'123',token:''}), 'x'.repeat(5000)]) {
    e=environment(value);assert.equal(await e.context.tailscaleLocalApi(),null);
  }
  console.log('OK: 権限拒否・不正な応答・過大な応答でも待ち続けない');
  e=environment(valid);assert.equal(JSON.stringify(await e.context.tailscaleLocalApi()),valid);
  console.log('OK: 通常の設定確認は従来どおり');
  e=environment(null);assert.equal(await e.context.ensureFunnel('example.test'),false);assert.equal(e.calls.length,0);
  console.log('OK: フォルダーが読めない場合も起動準備へ戻り、既存の公開設定は変更しない');
  e=environment(valid,['hang']);assert.equal(await e.context.ensureFunnel('example.test'),false);assert.deepEqual(e.calls,['GET']);
  console.log('OK: 内部窓口が無応答でも打ち切り、設定を書き込まない');
  e=environment(valid,[{status:403}]);assert.equal(await e.context.ensureFunnel('example.test'),false);assert.deepEqual(e.calls,['GET']);
  console.log('OK: 内部窓口が拒否した場合は設定を書き込まない');
  const body={AllowFunnel:{'example.test:443':true},Web:{'example.test:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:5600'}}}}};
  e=environment(valid,[{status:200,body}]);assert.equal(await e.context.ensureFunnel('example.test'),true);assert.deepEqual(e.calls,['GET']);
  e=environment(valid,[{status:200,body:{}},{status:200}]);assert.equal(await e.context.ensureFunnel('example.test'),true);assert.deepEqual(e.calls,['GET','POST']);
  console.log('OK: 確認済みの既存設定を保持し、必要な場合だけ従来どおり公開設定');
  console.log('7項目通過（本番起動・外部通信・データ変更なし）');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
