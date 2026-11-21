'use strict';
// 許可した実行ファイルだけを梱包する。作業用フォルダ全体は送らない。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {build}=require('./build-runtime.cjs');
build();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'reservation-release-'));
try {
  const target=path.join(temp,'reservation-service');fs.mkdirSync(target);
  for(const name of ['server.cjs','worker.cjs','lib','public','runtime','package-lock.json','.env.example','README.md','事業計画.md','検証結果.md','販売開始の進捗.md','Dockerfile']){
    fs.cpSync(path.join(__dirname,name),path.join(target,name),{recursive:true,dereference:false});
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
  pkg.scripts={start:'node server.cjs'};
  fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const hashes=[];
  function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name),relative=path.relative(target,file);
    if(entry.isSymbolicLink())throw Error('リンクを梱包できません: '+relative);
    if(/(^|\/)(data|node_modules|tls|\.git|test-results)(\/|$)|(^|\/)\.env$|mail-config\.json|mac-production\.env/.test(relative))throw Error('禁止ファイル: '+relative);
    if(entry.isDirectory())scan(file);else hashes.push(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')+'  '+relative);
  }}
  scan(target);fs.writeFileSync(path.join(target,'SHA256SUMS'),hashes.sort().join('\n')+'\n');
  const out=path.join(__dirname,'releases');fs.mkdirSync(out,{recursive:true});
  const css=fs.readFileSync(path.join(__dirname,'public/style.css'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'public/profit.js'),'utf8');
  const calculator=fs.readFileSync(path.join(__dirname,'public/profit.html'),'utf8')
    .replace('<link rel="stylesheet" href="/style.css">',()=>'<style>'+css+'</style>')
    .replace('<script src="/profit.js" defer></script>','')
    .replace('<a class="wordmark" href="/">店舗向け予約サービス</a><a href="/">サービス紹介へ</a>','<span class="wordmark">店舗向け予約サービス / 収支試算</span>')
    .replace('</body>',()=>'<script>'+js+'</script></body>');
  fs.writeFileSync(path.join(out,'収支試算.html'),calculator);
  const filename=path.join(out,'reservation-service.tar.gz');
  execFileSync('tar',['-czf',filename,'-C',temp,'reservation-service']);
  console.log('公開用一式を作成: '+filename+' ('+hashes.length+' files)');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
