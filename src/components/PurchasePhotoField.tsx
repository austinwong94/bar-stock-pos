import { useEffect, useId, useState } from 'react';
import { Camera, Check, ImagePlus } from 'lucide-react';
import { useLanguage } from '../lib/language';
import { readErrorMessage } from '../lib/opsData';
import { purchasePhotoUrl, savePurchasePhoto, type PurchasePhoto } from '../lib/purchaseEvidence';

export function PurchasePhotoField({ label, kind, actor, folder, value, otherHash, onChange, disabled = false }: {
  label: string; kind: 'receipt' | 'items'; actor: string; folder: string;
  value: PurchasePhoto | null; otherHash?: string; onChange: (photo: PurchasePhoto) => void; disabled?: boolean;
}) {
  const { text } = useLanguage();
  const id = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [url, setUrl] = useState('');
  useEffect(() => {
    let active = true, blob = '';
    if (value) void purchasePhotoUrl(value.path).then(next => { blob = next; if (active) setUrl(next); else if (next.startsWith('blob:')) URL.revokeObjectURL(next); }).catch(() => setUrl(''));
    else setUrl('');
    return () => { active = false; if (blob.startsWith('blob:')) URL.revokeObjectURL(blob); };
  }, [value?.path]);
  async function upload(file?: File) {
    if (!file || busy || disabled) return;
    setBusy(true); setError('');
    try {
      const photo = await savePurchasePhoto(file, actor, folder, kind);
      if (photo.hash === otherHash) throw new Error(text('Use a different photo for the receipt and the items.', 'Gunakan foto berbeza untuk resit dan barang.'));
      onChange(photo);
    } catch (e) { setError(readErrorMessage(e, text('Photo not saved. Try again.', 'Foto belum disimpan. Cuba lagi.'))); }
    finally { setBusy(false); }
  }
  return <div data-photo-kind={kind} className="min-w-0 rounded-md border border-line p-2.5">
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">{value ? <Check size={14} className="shrink-0 text-palm"/> : null}{label} <span className="text-danger">*</span></p>
    {url ? <img src={url} alt={label} className="mb-2 h-24 w-full rounded object-contain bg-shell"/> : null}
    <div className="grid grid-cols-2 gap-1.5">
      {(['camera','file'] as const).map(source => <label key={source} title={source === 'camera' ? text('Take Photo', 'Ambil Foto') : text('Upload Photo', 'Muat Naik Foto')} className={`flex min-h-11 cursor-pointer items-center justify-center rounded border border-line focus-within:ring-2 focus-within:ring-accent ${busy || disabled ? 'pointer-events-none opacity-50' : 'hover:bg-shell'}`} htmlFor={id + source}>{source === 'camera' ? <Camera size={18} className="shrink-0"/> : <ImagePlus size={18} className="shrink-0"/>}
        <input id={id + source} aria-label={label + ': ' + (source === 'camera' ? text('Take Photo', 'Ambil Foto') : text('Upload Photo', 'Muat Naik Foto'))} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" capture={source === 'camera' ? 'environment' : undefined} disabled={busy || disabled} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/>
      </label>)}
    </div>
    {busy ? <p role="status" className="mt-1 text-xs text-muted">{text('Saving Photo...', 'Menyimpan Foto...')}</p> : null}
    {error ? <p role="alert" className="mt-1 break-words text-xs text-danger">{error}</p> : null}
  </div>;
}

export function PurchaseEvidenceViewer({ receipt, items }: { receipt: string; items: string }) {
  const { text } = useLanguage();
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => { if (photo?.url.startsWith('blob:')) URL.revokeObjectURL(photo.url); }, [photo]);
  async function open(path: string, label: string) {
    setError('');
    try { setPhoto({ url: await purchasePhotoUrl(path), label }); }
    catch (e) { setError(readErrorMessage(e, 'Could not open photo.')); }
  }
  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">{[[receipt, text('Receipt Photo', 'Foto Resit')], [items, text('Items Photo', 'Foto Barang')]].map(([path, label]) => <button key={path} type="button" className="inline-flex min-h-11 items-center gap-2 rounded border border-line px-3 text-xs font-semibold" onClick={() => void open(path, label)}><ImagePlus size={16}/>{label}</button>)}</div>
    {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
    {photo ? <div className="mt-3"><div className="mb-2 flex justify-between text-sm"><strong>{photo.label}</strong><button className="min-h-11 px-3 text-accent" onClick={() => setPhoto(null)}>{text('Close Photo', 'Tutup Foto')}</button></div><img className="max-h-96 w-full object-contain" src={photo.url} alt={photo.label}/></div> : null}
  </div>;
}
