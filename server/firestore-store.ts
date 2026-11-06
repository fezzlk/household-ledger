import { Firestore } from '@google-cloud/firestore';
import { validateState, type Ledger } from '../shared/domain.js';
import { nextState, type LedgerStore, type Owner } from './store.js';

export const MAX_STATE_BYTES=800_000;
export function encodeState(state: Ledger) {
  const json=JSON.stringify(validateState(state));
  if(Buffer.byteLength(json,'utf8')>MAX_STATE_BYTES) throw new Error('保存容量の上限に近づきました。バックアップを書き出し、データの保管方法を見直してください');
  return json;
}
export class FirestoreStore implements LedgerStore {
  kind='firestore' as const;
  private db=new Firestore({ignoreUndefinedProperties:true});
  private owner=this.db.doc('ledgerPrivate/owner');
  private state=this.db.doc('ledgerPrivate/state');
  async getOwner() {const snap=await this.owner.get();return snap.exists?snap.data() as Owner:undefined;}
  async setup(owner: Owner, initial: Ledger) {
    const json=encodeState(initial);
    await this.db.runTransaction(async tx=>{
      const existing=await tx.get(this.owner);
      if(existing.exists) throw new Error('初期設定は完了しています');
      tx.create(this.owner,owner);tx.create(this.state,{json});
    });
  }
  async getState() {
    const snap=await this.state.get();
    if(!snap.exists) throw new Error('初期設定が必要です');
    return validateState(JSON.parse(snap.get('json')));
  }
  async command(revision: number, command: unknown) {
    return this.db.runTransaction(async tx=>{
      const snap=await tx.get(this.state);
      if(!snap.exists) throw new Error('初期設定が必要です');
      const next=nextState(validateState(JSON.parse(snap.get('json'))),revision,command);
      tx.update(this.state,{json:encodeState(next)});return next;
    });
  }
  async hasSession(hash: string) {const s=await this.db.doc('ledgerSessions/'+hash).get();return s.exists&&Number(s.get('expires'))>Date.now();}
  async putSession(hash: string, expires: number) {
    const expired=await this.db.collection('ledgerSessions').where('expires','<=',Date.now()).limit(20).get();
    const batch=this.db.batch();for(const doc of expired.docs)batch.delete(doc.ref);
    batch.set(this.db.doc('ledgerSessions/'+hash),{expires});await batch.commit();
  }
  async deleteSession(hash: string) {await this.db.doc('ledgerSessions/'+hash).delete();}
}
