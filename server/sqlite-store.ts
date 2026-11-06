import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateState, type Ledger } from '../shared/domain.js';
import { nextState, type LedgerStore, type Owner } from './store.js';
export class SqliteStore implements LedgerStore {
  kind='sqlite' as const;
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
  }
  async getOwner() { return this.db.prepare('SELECT name,salt,hash FROM owner WHERE id=1').get() as Owner|undefined; }
  async setup(owner: Owner, initial: Ledger) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.db.prepare('SELECT id FROM owner WHERE id=1').get()) throw new Error('初期設定は完了しています');
      this.db.prepare('INSERT INTO owner VALUES(1,?,?,?)').run(owner.name,owner.salt,owner.hash);
      this.db.prepare('INSERT INTO ledger VALUES(1,?)').run(JSON.stringify(validateState(initial)));
      this.db.exec('COMMIT');
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  async getState() {
    const row=this.db.prepare('SELECT json FROM ledger WHERE id=1').get() as {json:string}|undefined;
    if(!row) throw new Error('初期設定が必要です');
    return validateState(JSON.parse(row.json));
  }
  async command(revision: number, command: unknown) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare('SELECT json FROM ledger WHERE id=1').get() as {json:string}|undefined;
      if(!row) throw new Error('初期設定が必要です');
      const next=nextState(validateState(JSON.parse(row.json)),revision,command);
      this.db.prepare('UPDATE ledger SET json=? WHERE id=1').run(JSON.stringify(next));
      this.db.exec('COMMIT');return next;
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  async hasSession(hash: string) {return !!this.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now());}
  async putSession(hash: string, expires: number) {
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash,expires);
  }
  async deleteSession(hash: string) {this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash);}
}
