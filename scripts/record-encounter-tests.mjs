#!/usr/bin/env node
/**
 * 只在 npm script 的所有 node --test 成功之后调用。
 * 记录当前 Git HEAD 的本地回归回执；不修改账号、数据、部署或 PR。
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const kind=process.argv[2];
if(kind!=='account'&&kind!=='encounter'){
  console.error('只接受 account / encounter 已通过的测试类型');
  process.exitCode=2;
}else{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',
    stdio:['ignore','pipe','ignore']}).trim();
  const dirty=git(['status','--porcelain','--untracked-files=no']);
  if(dirty){
    console.error('工作区仍有未提交的代码变动，不能把测试回执绑定到旧 Git HEAD');
    process.exitCode=1;
  }else{
    const receipt={schemaVersion:1,kind,gitHead:git(['rev-parse','HEAD']),
      finishedAt:Date.now(),source:'native-node-test'};
    const dir=resolve(root,'test-results');
    mkdirSync(dir,{recursive:true});
    writeFileSync(resolve(dir,'encounter-'+kind+'-test-receipt.json'),
      JSON.stringify(receipt,null,2)+'\n','utf8');
    console.log('TEST RECEIPT '+kind+' '+receipt.gitHead);
  }
}
