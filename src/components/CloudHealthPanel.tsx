import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { secondaryButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { useAccess } from '../lib/access';
import { isSupabaseConfigured, shouldUseLocalData, supabase } from '../lib/supabase';
import { checkCloudConnection, type ConnectionArea, type ConnectionCheck, type ConnectionState } from '../lib/cloudConnection';

export function CloudHealthPanel({onProducts}: {onProducts: () => void}) {
  const {profile} = useAccess();
  return <CloudHealthWorkspace key={profile?.id ?? 'no-account'} onProducts={onProducts}/>;
}

function CloudHealthWorkspace({onProducts}: {onProducts: () => void}) {
  const {text} = useLanguage(), {profile, can} = useAccess();
  const [result, setResult] = useState<ConnectionCheck | null>(null), [busy, setBusy] = useState(false);
  const generation = useRef(0), busyRef = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, [profile?.id]);
  async function check() {
    if (busyRef.current || !isSupabaseConfigured || !profile?.id) return;
    const ticket = ++generation.current, current = () => mounted.current && ticket === generation.current;
    busyRef.current = true; setBusy(true); setResult(null);
    try {
      const next = await checkCloudConnection({
        user: () => supabase.auth.getUser(),
        profile: id => supabase.from('profiles').select('id,status,is_anonymous,app_access_granted').eq('id', id).maybeSingle(),
        schema: () => supabase.rpc('read_platform_schema_version'),
        products: () => supabase.from('products').select('id', {count: 'exact', head: true}).eq('active', true),
      }, profile.id, current);
      if (current()) setResult(next);
    } finally { if (current()) { busyRef.current = false; setBusy(false); } }
  }
  const stateLabel = (state: ConnectionState) => ({
    unchecked: text('Not Checked', 'Belum Disemak'), passed: text('Passed', 'Lulus'), failed: text('Needs Attention', 'Perlu Perhatian'),
    empty: text('No Products', 'Tiada Produk'), found: text('Found', 'Ditemui'), configured: text('Configured Only', 'Konfigurasi Sahaja'),
  })[state];
  const labels: Record<ConnectionArea, string> = {account: text('Staff Account', 'Akaun Staf'), database: text('Database Setup', 'Persediaan Pangkalan Data'), products: text('Bar Products', 'Produk Bar'), photos: text('Private Photo Storage', 'Storan Foto Peribadi')};
  function detail(area: ConnectionArea, state: ConnectionState) {
    if (state === 'unchecked') return text('No verified result.', 'Belum ada keputusan disahkan.');
    if (area === 'account') return state === 'passed' ? text('Active named account verified.', 'Akaun bernama aktif disahkan.') : text('Account could not be verified. Sign in with your staff login.', 'Akaun tidak dapat disahkan. Log masuk dengan akaun staf anda.');
    if (area === 'database') return state === 'passed' ? text('Required database features found.', 'Fungsi pangkalan data yang diperlukan ditemui.') : text('Setup could not be verified. Ask the owner to check the deployment.', 'Persediaan tidak dapat disahkan. Minta pemilik menyemak pelaksanaan.');
    if (area === 'products') return state === 'failed' ? text('Product list unavailable; the count is unknown.', 'Senarai produk tidak tersedia; jumlah tidak diketahui.') : state === 'empty' ? text('Add products with actual prices and carton sizes.', 'Tambah produk dengan harga sebenar dan saiz karton.') : text(`${result?.activeProducts} active products. Prices and opening stock are not verified by this check.`, `${result?.activeProducts} produk aktif. Harga dan stok awal tidak disahkan oleh semakan ini.`);
    return state === 'configured' ? text('Photo upload and reopening on another device still need a real-photo test.', 'Muat naik dan buka semula pada peranti lain masih memerlukan ujian foto sebenar.') : text('Private photo storage could not be verified.', 'Storan foto peribadi tidak dapat disahkan.');
  }
  const tasks = [
    {label: text('Prices & Carton Sizes', 'Harga & Saiz Karton'), action: <button type="button" className={secondaryButtonClass} onClick={onProducts}>{text('Products', 'Produk')}<ArrowRight size={16}/></button>},
    {label: text('Counted Opening Stock', 'Stok Awal Dikira'), action: can('bar.stock.manage') ? <Link className={secondaryButtonClass} to="/stock-in">{text('Stock In', 'Stok Masuk')}<ArrowRight size={16}/></Link> : null},
    {label: text('Receipt Upload & Reopening', 'Muat Naik & Buka Semula Resit'), action: can('purchasing.cost.view') && (can('purchasing.view') || can('purchasing.fulfil')) ? <Link className={secondaryButtonClass} to="/kitchen/purchases?view=receipts">{text('Receipts', 'Resit')}<ArrowRight size={16}/></Link> : null},
    {label: text('Same Record on Another Device', 'Rekod Sama pada Peranti Lain'), action: null},
  ];
  return <section className="bar-health min-w-0 space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-base font-semibold">{text('System Health', 'Status Sistem')}</h2><p className="mt-1 text-sm text-muted">{shouldUseLocalData ? text('Device preview · no shared cloud records', 'Pratonton peranti · tiada rekod cloud bersama') : isSupabaseConfigured ? text('Cloud mode · connection checks only', 'Mod cloud · semakan sambungan sahaja') : text('Cloud is not configured.', 'Cloud belum dikonfigurasi.')}</p></div>
      <button type="button" className={`${secondaryButtonClass} w-full sm:w-52`} disabled={busy || !isSupabaseConfigured || !profile?.id} onClick={() => void check()}><RefreshCw size={16}/>{busy ? text('Checking...', 'Menyemak...') : text('Check Connection', 'Semak Sambungan')}</button>
    </div>
    <p role="status" className="min-h-5 text-xs text-muted">{busy ? text('Previous results cleared. Checking current access...', 'Keputusan terdahulu dikosongkan. Menyemak akses semasa...') : result ? text('Checked', 'Disemak') + ' · ' + new Date(result.checkedAt).toLocaleString(text('en-MY','ms-MY'), {timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) + ' MYT' : text('Connection not checked.', 'Sambungan belum disemak.')}</p>
    <dl className="divide-y divide-line border-y border-line">
      {(Object.keys(labels) as ConnectionArea[]).map(area => { const state = result?.states[area] ?? 'unchecked'; return <div key={area} data-health-area={area} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3">
        <dt className="text-sm font-semibold">{labels[area]}</dt>
        <dd className={`max-w-36 break-words rounded-md px-2 py-1 text-center text-xs font-semibold ${state === 'failed' || state === 'empty' ? 'bg-amber-50 text-warning' : state === 'passed' ? 'bg-shell text-accent' : 'bg-paper text-muted'}`}>{stateLabel(state)}</dd>
        <dd className="col-span-2 break-words text-sm text-muted">{detail(area, state)}</dd>
      </div>; })}
    </dl>
    <div><h3 className="text-sm font-semibold">{text('Before First Use', 'Sebelum Penggunaan Pertama')}</h3><p className="mb-2 mt-1 text-xs text-muted">{text('Manual verification required', 'Pengesahan manual diperlukan')}</p><ul className="divide-y divide-line border-y border-line">{tasks.map(task => <li key={task.label} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center"><p className="break-words text-sm font-semibold">{task.label}</p>{task.action}</li>)}</ul></div>
  </section>;
}
