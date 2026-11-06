import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteStore } from '../server/sqlite-store.js';
import { validBootstrap } from '../server/bootstrap.js';
import { encodeState } from '../server/firestore-store.js';
import { emptyState } from '../shared/domain.js';

test('初回設定コードは正しい値だけを受理する',()=>{
  const token=randomBytes(48).toString('base64url');
  assert.equal(validBootstrap(token,token),true);
  assert.equal(validBootstrap(undefined,token),false);
  assert.equal(validBootstrap(token,undefined),false);
  assert.equal(validBootstrap(token+'a',token),false);
  assert.equal(validBootstrap(token.slice(1),token),false);
});
test('独立した保存クライアント間でも初期設定・revision・セッションの整合性を保つ',async()=>{
  mkdirSync('output/tmp',{recursive:true});
  const dir=mkdtempSync(resolve('output/tmp/'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_store-'));
  const a=new SqliteStore(resolve(dir,'ledger.sqlite')), b=new SqliteStore(resolve(dir,'ledger.sqlite'));
  await a.setup({name:'検証',salt:'fixture-salt',hash:'fixture-hash'},emptyState());
  await assert.rejects(b.setup({name:'別人',salt:'fixture',hash:'fixture'},emptyState()),/完了/);
  const command=(id:string)=>({type:'account',account:{id,name:'銀行',type:'bank',openingBalance:100}});
  const results=await Promise.allSettled([a.command(0,command('a')),b.command(0,command('b'))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await b.getState()).accounts.length,1);
  await a.putSession('fixture-session',Date.now()+10000);
  assert.equal(await b.hasSession('fixture-session'),true);
  await b.deleteSession('fixture-session');assert.equal(await a.hasSession('fixture-session'),false);
});
test('Firestoreの保存サイズを検査し、JSONへ未検証データを保存しない',()=>{
  const state=emptyState();assert.equal(JSON.parse(encodeState(state)).version,1);
  assert.throws(()=>encodeState({...state,version:2} as never));
});
