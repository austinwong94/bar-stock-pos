import { countBalance, countQuantity, type CountItem } from './stockCount';
import { definitiveInitialSaveFailure } from './saveAttempt';

export const stockOutReasons = [['Spoilage','Rosak'],['Wastage','Pembaziran'],['Missing','Hilang'],['Other Use','Kegunaan Lain']] as const;
export type StockOutLine = { display_unit?: string; display_factor?: number; expected_item_version?: string; ingredient_id: string; name: string; expected_base_unit: string; expected_balance: number; expected_version: string | null; quantity: number };
export type StockOutAttempt = { id: string; lines: StockOutLine[]; reason: string; notes: string; attempted: boolean; createdAt: string };
type StorageReader = Pick<Storage,'length'|'key'|'getItem'>;
type StorageWriter = Pick<Storage,'getItem'|'setItem'>;

export function stockOutQuantity(input: string, unit: string) {
  const value = countQuantity(input,unit);
  return value !== null && value > 0 ? value : null;
}
export const stockOutChanged = (line: StockOutLine, item?: CountItem) => !item || !item.active || item.base_unit !== line.expected_base_unit || countBalance(item) !== line.expected_balance || item.balance_version !== line.expected_version || (!!line.expected_item_version && item.updated_at !== line.expected_item_version);
export const stockOutArgs = (attempt: StockOutAttempt) => ({p_items:attempt.lines.map(({name,...line})=>line),p_reason:attempt.reason,p_notes:attempt.notes,p_request_id:attempt.id});

export async function submitStockOut(client: {rpc: (name: string,args: ReturnType<typeof stockOutArgs>) => PromiseLike<{data:unknown;error:unknown}>}, attempt: StockOutAttempt) {
  const result=await client.rpc('record_kitchen_stock_out_checked',stockOutArgs(attempt));
  if(result.error)throw result.error;
  if(result.data!==attempt.id)throw new Error('The stock-out confirmation was incomplete.');
  return result.data;
}

export function readStockOutAttempt(storage: StorageReader, prefix: string): StockOutAttempt | null {
  const attempts: StockOutAttempt[]=[];
  for(let i=0;i<storage.length;i++) {
    const key=storage.key(i);
    if(!key?.startsWith(prefix+'/'))continue;
    const attempt=JSON.parse(storage.getItem(key)||'null');
    if(typeof attempt?.id!=='string'||key!==prefix+'/'+attempt.id||typeof attempt.attempted!=='boolean'||typeof attempt.createdAt!=='string'||typeof attempt.notes!=='string'||!stockOutReasons.some(([reason])=>reason===attempt.reason)||!Array.isArray(attempt.lines)||!attempt.lines.length||attempt.lines.length>200
      ||!attempt.lines.every((line:StockOutLine)=>line&&typeof line.ingredient_id==='string'&&typeof line.name==='string'&&['g','ml','unit'].includes(line.expected_base_unit)&&Number.isFinite(line.expected_balance)&&Number.isFinite(line.quantity)&&line.quantity>0&&(line.expected_version===null||typeof line.expected_version==='string')))
      throw new Error('A pending stock-out could not be read. Ask a manager to check stock history before entering it again.');
    attempts.push(attempt);
  }
  return attempts.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]??null;
}

export function storeStockOutAttempt(storage: StorageWriter, prefix: string, attempt: StockOutAttempt) {
  const key=prefix+'/'+attempt.id, previous=storage.getItem(key);
  if(previous&&JSON.stringify(stockOutArgs(JSON.parse(previous)))!==JSON.stringify(stockOutArgs(attempt)))throw new Error('The pending stock-out has different details. Check the original confirmation.');
  const value=JSON.stringify(attempt);
  storage.setItem(key,value);
  if(storage.getItem(key)!==value)throw new Error('Browser storage is unavailable. Nothing has been submitted.');
}

export const stockFailureIsDefinite = definitiveInitialSaveFailure;
