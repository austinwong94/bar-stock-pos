import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Field, iconButtonClass, inputClass } from './Form';
import { useLanguage } from '../lib/language';
import { supabase } from '../lib/supabase';
import { readErrorMessage } from '../lib/opsData';

export function PurchaseSupplier({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { text } = useLanguage();
  const [names, setNames] = useState<string[]>(['99 Speedmart', 'AEON', 'Jusco']);
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void (async () => {
    const result = await supabase.rpc('read_purchase_suppliers');
    if (result.error) setError(readErrorMessage(result.error, text('Could not load suppliers.', 'Pembekal tidak dapat dimuatkan.')));
    else setNames([...new Set(['99 Speedmart', 'AEON', 'Jusco', ...result.data])].sort());
  })(); }, [text]);
  async function add() {
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await supabase.rpc('save_purchase_supplier', { p_name: name.trim() });
      if (result.error) throw result.error;
      setNames(previous => [...new Set([...previous, result.data])].sort()); onChange(result.data); setAdding(false); setName('');
    } catch (e) { setError(readErrorMessage(e, text('Supplier not saved.', 'Pembekal belum disimpan.'))); }
    finally { setBusy(false); }
  }
  return <Field label={text('Supplier', 'Pembekal')}>
    <div className="flex min-w-0 gap-1.5">
      {adding ? <input autoFocus className={inputClass} value={name} maxLength={160} aria-label={text('New Supplier Name', 'Nama Pembekal Baru')} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}/>:<select aria-label={text('Supplier', 'Pembekal')} className={inputClass} value={value} onChange={e => onChange(e.target.value)}><option value="">{text('Select Supplier', 'Pilih Pembekal')}</option>{[...new Set([...names, ...(value ? [value] : [])])].map(name => <option key={name}>{name}</option>)}</select>}
      <button type="button" className={iconButtonClass + ' shrink-0'} disabled={busy || (adding && !name.trim())} aria-label={text(adding ? 'Save Supplier' : 'Add Supplier', adding ? 'Simpan Pembekal' : 'Tambah Pembekal')} title={text(adding ? 'Save Supplier' : 'Add Supplier', adding ? 'Simpan Pembekal' : 'Tambah Pembekal')} onClick={() => adding ? void add() : setAdding(true)}><Plus size={16}/></button>
      {adding ? <button type="button" className={iconButtonClass + ' shrink-0'} disabled={busy} aria-label={text('Cancel', 'Batal')} onClick={() => setAdding(false)}><X size={16}/></button> : null}
    </div>
    {error ? <span role="alert" className="mt-1 block text-xs text-danger">{error}</span> : null}
  </Field>;
}
