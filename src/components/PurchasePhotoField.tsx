import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { iconButtonClass, secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { readErrorMessage } from '../lib/opsData';
import { DuplicatePurchasePhotoError, purchasePhotoUrl, savePurchasePhoto, type PurchasePhoto } from '../lib/purchaseEvidence';

type PhotoPreview = { path: string | null; ticket: number; url: string; phase: 'empty' | 'url' | 'image' | 'ready' | 'error' };
function usePhotoPreview(path: string | null) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<PhotoPreview>({ path: null, ticket: 0, url: '', phase: 'empty' });
  const generation = useRef(0);
  useEffect(() => {
    let active = true, leasedUrl = '';
    const ticket = ++generation.current;
    setState({ path, ticket, url: '', phase: path === null ? 'empty' : 'url' });
    if (path !== null && !path.trim()) setState({ path, ticket, url: '', phase: 'error' });
    else if (path !== null) void purchasePhotoUrl(path).then(url => {
      if (!url || typeof url !== 'string') throw new Error('Photo URL unavailable.');
      if (!active) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
      leasedUrl = url;
      setState({ path, ticket, url, phase: 'image' });
    }).catch(() => { if (active) setState({ path, ticket, url: '', phase: 'error' }); });
    return () => { active = false; if (leasedUrl.startsWith('blob:')) URL.revokeObjectURL(leasedUrl); };
  }, [path, retry]);
  const current: PhotoPreview = state.path === path ? state : { path, ticket: 0, url: '', phase: path === null ? 'empty' : 'url' };
  function imageResult(phase: 'ready' | 'error') {
    setState(previous => previous.path === path && previous.ticket === current.ticket && previous.url === current.url ? { ...previous, phase } : previous);
  }
  return { ...current, loading: current.phase === 'url' || current.phase === 'image', retry: () => setRetry(value => value + 1), loaded: () => imageResult('ready'), failed: () => imageResult('error') };
}

function PhotoPreviewFrame({ preview, label, height, busy = false }: { preview: ReturnType<typeof usePhotoPreview>; label: string; height: string; busy?: boolean }) {
  const { text } = useLanguage();
  return <div data-photo-preview className={`relative min-w-0 overflow-hidden rounded bg-shell ${height}`} aria-busy={preview.loading}>
    {preview.url && preview.phase !== 'error' ? <img key={preview.ticket + ':' + preview.url} src={preview.url} alt={label} aria-hidden={preview.phase !== 'ready'} onLoad={preview.loaded} onError={preview.failed} className={`h-full w-full object-contain ${preview.phase === 'ready' ? '' : 'invisible'}`} /> : null}
    {preview.loading ? <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted"><LoaderCircle size={18} className="animate-spin" />{text('Opening Photo...', 'Membuka Foto...')}</div> : null}
    {preview.phase === 'error' ? <div role="alert" className="absolute inset-0 grid content-center justify-items-center gap-1 p-2 text-center text-xs text-danger"><p>{text('Photo could not load.', 'Foto tidak dapat dimuatkan.')}</p><button type="button" className={`${secondaryButtonClass} min-h-11 px-2 text-xs`} disabled={busy} onClick={preview.retry}><RefreshCw size={14} />{text('Retry Photo', 'Cuba Lagi')}</button></div> : null}
  </div>;
}

export function PurchasePhotoField({ label, kind, actor, folder, value, otherHash, onChange, onBusyChange, disabled = false }: {
  label: string; kind: 'receipt' | 'items'; actor: string; folder: string;
  value: PurchasePhoto | null; otherHash?: string; onChange: (photo: PurchasePhoto) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}) {
  const { text } = useLanguage();
  const id = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const preview = usePhotoPreview(value?.path ?? null);
  const uploading = useRef(false);
  async function upload(file?: File) {
    if (!file || uploading.current || disabled) return;
    uploading.current = true; setBusy(true); setError(''); onBusyChange?.(true);
    let photo: PurchasePhoto | undefined;
    try {
      photo = await savePurchasePhoto(file, actor, folder, kind, otherHash);
    } catch (e) { setError(e instanceof DuplicatePurchasePhotoError ? text('Use a different photo for the receipt and the items.', 'Gunakan foto berbeza untuk resit dan barang.') : readErrorMessage(e, text('Photo not saved. Try again.', 'Foto belum disimpan. Cuba lagi.'))); }
    finally { uploading.current = false; setBusy(false); onBusyChange?.(false); }
    if (photo) onChange(photo);
  }
  return <div data-photo-kind={kind} className="min-w-0 rounded-md border border-line p-2.5">
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">{value ? <Check size={14} className="shrink-0 text-palm"/> : null}{label} <span className="text-danger">*</span></p>
    {value ? <div className="mb-2"><PhotoPreviewFrame preview={preview} label={label} height="h-28" busy={busy} /></div> : null}
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
  return <EvidencePhotos key={JSON.stringify([receipt, items])} receipt={receipt} items={items} />;
}

function EvidencePhotos({ receipt, items }: { receipt: string; items: string }) {
  const { text } = useLanguage();
  const [kind, setKind] = useState<'receipt' | 'items' | null>(null);
  const preview = usePhotoPreview(kind === 'receipt' ? receipt : kind === 'items' ? items : null);
  const label = kind === 'receipt' ? text('Receipt Photo', 'Foto Resit') : text('Items Photo', 'Foto Barang');
  return <div className="mt-3">
    <div className="grid grid-cols-2 gap-2">{(['receipt', 'items'] as const).map(choice => <button key={choice} type="button" aria-pressed={kind === choice} className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded border border-line px-2 text-xs font-semibold aria-pressed:border-accent aria-pressed:text-accent" onClick={() => setKind(choice)}><ImagePlus size={16} className="shrink-0"/>{choice === 'receipt' ? text('Receipt Photo', 'Foto Resit') : text('Items Photo', 'Foto Barang')}</button>)}</div>
    {kind ? <div className="mt-3"><div className="mb-2 flex items-center justify-between gap-2 text-sm"><strong className="min-w-0 break-words">{label}</strong><button type="button" className={iconButtonClass} title={text('Close Photo', 'Tutup Foto')} aria-label={text('Close Photo', 'Tutup Foto')} onClick={() => setKind(null)}><X size={18}/></button></div><PhotoPreviewFrame preview={preview} label={label} height="h-72 sm:h-96" /></div> : null}
  </div>;
}
