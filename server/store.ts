import { applyCommand, type Ledger } from '../shared/domain.js';
export type Owner = { name: string; salt: string; hash: string };
export class RevisionConflict extends Error {
  constructor() { super('別の画面で更新されました。再読み込みして、もう一度操作してください'); }
}
export interface LedgerStore {
  kind: 'sqlite' | 'firestore';
  getOwner(): Promise<Owner | undefined>;
  setup(owner: Owner, initial: Ledger): Promise<void>;
  getState(): Promise<Ledger>;
  command(revision: number, command: unknown): Promise<Ledger>;
  hasSession(hash: string): Promise<boolean>;
  putSession(hash: string, expires: number): Promise<void>;
  deleteSession(hash: string): Promise<void>;
}
export function nextState(state: Ledger, revision: number, command: unknown) {
  if(state.revision !== revision) throw new RevisionConflict();
  return applyCommand(state, command);
}
export async function createStore(): Promise<LedgerStore> {
  if(process.env.STORE === 'firestore') {
    if(process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestoreエミュレータは使用しません');
    const { FirestoreStore } = await import('./firestore-store.js');
    return new FirestoreStore();
  }
  if(process.env.K_SERVICE) throw new Error('Cloud RunではSTORE=firestoreが必要です');
  const { SqliteStore } = await import('./sqlite-store.js');
  return new SqliteStore(process.env.DB_PATH ?? 'data/ledger.sqlite');
}
