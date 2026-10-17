import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { PackagePlus, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../components/Form';
import { AccountReportArchivePanel } from '../components/AccountReportArchivePanel';
import { CocktailRecipePanel } from '../components/CocktailRecipePanel';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/Page';
import { ViewChoices } from '../components/ViewChoices';
import { useToast } from '../components/Toast';
import { categoryRank, groupByCategory, normalizeCategoryName } from '../lib/data';
import { hasSupabaseCredentials, isSupabaseConfigured, shouldUseLocalData, supabase } from '../lib/supabase';
import { clearLocalTransactionHistory, loadLocalCategories, loadLocalProductPriceHistory, loadLocalProducts, resetLocalStarterData, saveLocalProduct, saveLocalSettings } from '../lib/localStore';
import { money } from '../lib/format';
import type { AppSettingKey, Category, ProductPriceHistory, ProductWithStock, SettingsMap } from '../lib/types';
import { assetPath } from '../lib/assets';
import { useLanguage } from '../lib/language';
import { hasAdminAccess, unlockAdminAccess } from '../lib/adminAccess';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { readAllRows } from '../lib/readAllRows';

type ProductForm = {
  id?: string;
  name: string;
  category_id: string;
  price_per_unit: string;
  cost_per_unit: string;
  carton_size: string;
  low_stock_threshold: string;
  image_url: string;
  active: boolean;
  source_updated_at?: string;
};

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const blank = (defaultCartonSize: number): ProductForm => ({
  name: '',
  category_id: '',
  price_per_unit: '0',
  cost_per_unit: '',
  carton_size: String(defaultCartonSize),
  low_stock_threshold: '0',
  image_url: '',
  active: true,
});

const defaultCategories = [
  { name: 'Beer', sort_order: 10 },
  { name: 'Soft Drink', sort_order: 20 },
  { name: 'Food', sort_order: 30 },
  { name: 'Cocktail', sort_order: 40 },
  { name: 'Others', sort_order: 50 },
];

type BundleForm = {
  beer_bundle_enabled: boolean;
  beer_bundle_name: string;
  beer_bundle_units_per_set: string;
  beer_bundle_price: string;
};

const bundleKeys: AppSettingKey[] = ['beer_bundle_enabled', 'beer_bundle_name', 'beer_bundle_units_per_set', 'beer_bundle_price'];
type BundleSettingRow = { key: AppSettingKey; value: SettingsMap[AppSettingKey]; updated_at: string };
type BundleVersionMap = Partial<Record<AppSettingKey, string>>;
type Localize = (english: string, malay: string) => string;
type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
};
type CloudCheckStatus = 'pass' | 'fail' | 'info';
type CloudCheckRow = {
  label: string;
  status: CloudCheckStatus;
  detail: string;
};
const productImageBucket = 'product-images';
const maxProductImageBytes = 4 * 1024 * 1024;

function cleanFileName(name: string) {
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : 'jpg';
  const safeExt = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : 'jpg';
  return `${crypto.randomUUID()}.${safeExt}`;
}

function friendlyAdminError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('verify_admin_access') || lower.includes('function') || lower.includes('column')) {
    return 'Cloud database needs the latest SQL update. Run supabase/live_cloud_fix.sql in Supabase, then try again.';
  }
  if (lower.includes('bucket') || lower.includes('storage')) {
    return 'Cloud storage needs the latest SQL update. Run supabase/live_cloud_fix.sql in Supabase, then try again.';
  }
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('policy')) {
    return 'Admin permission is not active. Unlock Admin again, then check the Supabase SQL/RLS update if it still fails.';
  }
  return message;
}

function cloudCheckTone(status: CloudCheckStatus) {
  if (status === 'pass') return 'bg-shell text-accent';
  if (status === 'fail') return 'bg-amber-50 text-warning';
  return 'bg-white text-neutral-600';
}

function cloudCheckLabel(status: CloudCheckStatus, text: Localize) {
  if (status === 'pass') return text('Ready', 'Sedia');
  if (status === 'fail') return text('Needs fix', 'Perlu betul');
  return text('Info', 'Info');
}

function cloudCheckError(error: unknown, fallback: string) {
  const message =
    error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : fallback;
  return friendlyAdminError(message);
}

function asAuditRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asAuditRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(asAuditRecord(item))) : [];
}

function auditString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function auditNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function titleCaseAuditAction(action: string) {
  return action
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function auditPaymentLabel(method: string | null, text: Localize) {
  if (method === 'cash') return text('Cash Payment', 'Bayaran Tunai');
  if (method === 'qr') return text('QR Payment', 'Bayaran QR');
  if (method === 'complimentary') return text('FOC', 'FOC');
  return method ? titleCaseAuditAction(method) : null;
}

function auditActionLabel(action: string, text: Localize) {
  const labels: Record<string, string> = {
    verify_app_access: text('Access code entered', 'Kod akses dimasukkan'),
    verify_admin_access: text('Admin unlocked', 'Admin dibuka'),
    save_app_settings_checked: text('Settings saved', 'Tetapan disimpan'),
    save_product_checked_insert: text('Product added', 'Produk ditambah'),
    save_product_checked_update: text('Product updated', 'Produk dikemas kini'),
    stock_in_product: text('Stock In saved', 'Stok Masuk disimpan'),
    stock_in_products: text('Stock In batch saved', 'Stok Masuk pukal disimpan'),
    complete_sale: text('Sale recorded', 'Jualan direkod'),
    void_sale: text('Sale voided', 'Jualan dibatalkan'),
    verify_qr_payment: text('QR checked', 'QR disemak'),
    close_daily_report: text('Daily closing saved', 'Tutupan harian disimpan'),
    reopen_daily_report: text('Daily closing reopened', 'Tutupan harian dibuka semula'),
    save_account_report_archive: text('Report archived', 'Laporan diarkib'),
  };
  return labels[action] ?? titleCaseAuditAction(action);
}

function auditEntityLabel(entityType: string | null, text: Localize) {
  if (entityType === 'product') return text('Product', 'Produk');
  if (entityType === 'sale') return text('Sale', 'Jualan');
  if (entityType === 'daily_report') return text('Closing', 'Tutupan');
  if (entityType === 'app_settings') return text('Settings', 'Tetapan');
  if (entityType === 'profile') return text('Access', 'Akses');
  return entityType ? titleCaseAuditAction(entityType) : text('System', 'Sistem');
}

function compactAuditId(id: string | null) {
  return id ? id.slice(0, 8) + '...' : '-';
}

function auditActorLabel(log: AuditLogRow, text: Localize) {
  const after = asAuditRecord(log.after_json);
  const worker = auditString(after?.entered_by) ?? auditString(after?.order_taken_by) ?? auditString(after?.changed_by);
  if (worker) return worker;
  if (log.action === 'verify_admin_access') return text('Admin', 'Admin');
  if (log.action === 'verify_app_access') return text('Staff device', 'Peranti staf');
  return compactAuditId(log.actor_id);
}

function auditDetail(log: AuditLogRow, currencySymbol: string, text: Localize) {
  const after = asAuditRecord(log.after_json);
  const before = asAuditRecord(log.before_json);
  const rows = asAuditRows(log.after_json);
  const productName = auditString(after?.name) ?? auditString(before?.name) ?? auditString(after?.product_name) ?? auditString(before?.product_name);
  if (productName) return productName;

  if (rows.length > 0) {
    const names = rows.map((row) => auditString(row.key)).filter(Boolean).slice(0, 3).join(', ');
    return names ? names + (rows.length > 3 ? ' +' + String(rows.length - 3) : '') : countLabel(rows.length, text('Record', 'Rekod'), text('Records', 'Rekod'));
  }

  const quantityAdded = auditNumber(after?.quantity_added);
  if (quantityAdded != null) {
    const onHand = auditNumber(after?.quantity_on_hand);
    return '+' + countLabel(quantityAdded, text('Unit', 'Unit'), text('Units', 'Unit')) + (onHand == null ? '' : ' · ' + String(onHand) + ' ' + text('balance', 'baki'));
  }

  const totalAmount = auditNumber(after?.total_amount) ?? auditNumber(before?.total_amount);
  if (totalAmount != null) {
    const payment = auditPaymentLabel(auditString(after?.payment_method) ?? auditString(before?.payment_method), text);
    return money(totalAmount, currencySymbol) + (payment ? ' · ' + payment : '');
  }

  const businessDate = auditString(after?.business_date) ?? auditString(before?.business_date);
  if (businessDate) return businessDate;

  const status = auditString(after?.status) ?? auditString(after?.qr_status) ?? auditString(before?.status) ?? auditString(before?.qr_status);
  if (status) return titleCaseAuditAction(status);

  return compactAuditId(log.entity_id);
}

function parseProductForm(form: ProductForm) {
  const name = form.name.trim();
  const price = Number(form.price_per_unit);
  const cost = form.cost_per_unit.trim() ? Number(form.cost_per_unit) : null;
  const cartonSize = Math.floor(Number(form.carton_size));
  const lowStockThreshold = Math.floor(Number(form.low_stock_threshold));

  if (!name) return { error: 'Enter a product name.' } as const;
  if (!Number.isFinite(price) || price < 0) return { error: 'Enter a valid price per unit.' } as const;
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) return { error: 'Enter a valid cost per unit.' } as const;
  if (!Number.isFinite(cartonSize) || cartonSize < 1) return { error: 'Units per carton must be at least 1.' } as const;
  if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) return { error: 'Low stock alert unit balance must be 0 or more.' } as const;

  return {
    payload: {
      name,
      category_id: form.category_id,
      price_per_unit: Number(price.toFixed(2)),
      cost_per_unit: cost == null ? null : Number(cost.toFixed(2)),
      carton_size: cartonSize,
      low_stock_threshold: lowStockThreshold,
      image_url: form.image_url.trim() || null,
      active: form.active,
    },
  } as const;
}

function bundleFormFromSettings(settings: SettingsMap): BundleForm {
  return {
    beer_bundle_enabled: settings.beer_bundle_enabled === true || settings.beer_bundle_enabled === 'true',
    beer_bundle_name: String(settings.beer_bundle_name || 'Beer Bundle'),
    beer_bundle_units_per_set: String(settings.beer_bundle_units_per_set || 4),
    beer_bundle_price: String(settings.beer_bundle_price || 40),
  };
}

function settingsWithBundleRows(settings: SettingsMap, rows: BundleSettingRow[]) {
  return rows.reduce(
    (next, row) => ({ ...next, [row.key]: row.value }),
    { ...settings },
  );
}

function bundleVersionsFromRows(rows: BundleSettingRow[]) {
  return rows.reduce<BundleVersionMap>((next, row) => ({ ...next, [row.key]: row.updated_at }), {});
}

function AuditActivityPanel({ logs, settings }: { logs: AuditLogRow[]; settings: SettingsMap }) {
  const { text } = useLanguage();
  const currencySymbol = String(settings.currency_symbol || 'MYR');

  return (
    <section className="island-panel rounded-lg p-3 sm:rounded-xl sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold sm:text-xl">{text('Activity Log', 'Log Aktiviti')}</h2>
        <span className="w-fit rounded-full border border-line bg-white/85 px-3 py-1 text-xs font-semibold text-neutral-600">
          {shouldUseLocalData ? text('Cloud only', 'Cloud sahaja') : String(logs.length) + ' ' + text('latest', 'terkini')}
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/75 sm:hidden">
        <table className="dense-table w-full table-fixed text-left text-[11px]">
          <thead className="bg-paper">
            <tr>
              <th className="w-[31%] p-2">{text('Time', 'Masa')}</th>
              <th className="w-[27%] p-2">{text('Action', 'Tindakan')}</th>
              <th className="w-[18%] p-2">{text('By', 'Oleh')}</th>
              <th className="w-[24%] p-2">{text('Detail', 'Butiran')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={`mobile-log-${log.id}`} className="border-t border-line align-top">
                <td className="p-2 font-bold leading-tight">
                  <span className="block">{format(new Date(log.created_at), 'dd MMM')}</span>
                  <span className="block text-[10px] text-neutral-600">{format(new Date(log.created_at), 'h:mm a')}</span>
                </td>
                <td className="p-2 leading-tight">
                  <span className="line-clamp-2 font-semibold">{auditActionLabel(log.action, text)}</span>
                  <span className="mt-1 block truncate text-[10px] font-bold text-accent">{auditEntityLabel(log.entity_type, text)}</span>
                </td>
                <td className="p-2">
                  <span className="line-clamp-2 font-bold text-neutral-700">{auditActorLabel(log, text)}</span>
                </td>
                <td className="p-2">
                  <span className="line-clamp-3 font-bold text-neutral-700">{auditDetail(log, currencySymbol, text)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 ? (
          <div className="p-4 text-center text-sm font-bold text-neutral-600">
            {shouldUseLocalData
              ? text('Cloud activity appears here after Cloud Live is connected.', 'Aktiviti cloud akan muncul di sini selepas Cloud Live disambungkan.')
              : text('No activity recorded yet.', 'Belum ada aktiviti direkod.')}
          </div>
        ) : null}
      </div>
      <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
        <table className="dense-table w-full min-w-[820px] text-left text-xs sm:text-sm">
          <thead className="bg-paper">
            <tr>
              <th className="p-3">{text('Time', 'Masa')}</th>
              <th className="p-3">{text('Action', 'Tindakan')}</th>
              <th className="p-3">{text('Record', 'Rekod')}</th>
              <th className="p-3">{text('By', 'Oleh')}</th>
              <th className="p-3">{text('Detail', 'Butiran')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-3 font-bold">{format(new Date(log.created_at), 'dd MMM yyyy, h:mm a')}</td>
                <td className="p-3 font-semibold">{auditActionLabel(log.action, text)}</td>
                <td className="p-3">{auditEntityLabel(log.entity_type, text)}</td>
                <td className="p-3 font-bold text-neutral-600">{auditActorLabel(log, text)}</td>
                <td className="p-3 font-bold text-neutral-700">{auditDetail(log, currencySymbol, text)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 ? (
          <div className="p-5 text-center text-sm font-bold text-neutral-600">
            {shouldUseLocalData
              ? text('Cloud activity appears here after Cloud Live is connected.', 'Aktiviti cloud akan muncul di sini selepas Cloud Live disambungkan.')
              : text('No activity recorded yet.', 'Belum ada aktiviti direkod.')}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CloudHealthPanel() {
  const { text } = useLanguage();
  const [cloudCheckRows, setCloudCheckRows] = useState<CloudCheckRow[]>([]);
  const [checkingCloud, setCheckingCloud] = useState(false);
  const currentSaveLocation = shouldUseLocalData
    ? text('This browser/device only', 'Browser/peranti ini sahaja')
    : text('Supabase cloud', 'Cloud Supabase');
  const realUseStatus = shouldUseLocalData
    ? text('Switch to Cloud Live before real operation', 'Tukar ke Cloud Live sebelum operasi sebenar')
    : text('Ready for shared use across devices', 'Sedia untuk guna bersama merentas peranti');
  async function runCloudCheck() {
    setCheckingCloud(true);
    try {
      if (!hasSupabaseCredentials) {
        setCloudCheckRows([
          {
            label: text('Supabase keys', 'Kunci Supabase'),
            status: 'fail',
            detail: text('Add the public project URL and publishable key before Cloud Live can save data.', 'Tambah Project URL dan publishable key sebelum Cloud Live boleh simpan data.'),
          },
        ]);
        return;
      }

      if (shouldUseLocalData || !isSupabaseConfigured) {
        setCloudCheckRows([
          {
            label: text('Cloud Live mode', 'Mod Cloud Live'),
            status: 'info',
            detail: text('Switch to Cloud Live, unlock the app, then run this check again.', 'Tukar ke Cloud Live, buka aplikasi, kemudian jalankan semakan ini sekali lagi.'),
          },
          {
            label: text('Supabase keys', 'Kunci Supabase'),
            status: 'pass',
            detail: text('Public Supabase URL/key are present. Secret keys are not used in the browser.', 'URL/key awam Supabase ada. Secret key tidak digunakan dalam browser.'),
          },
        ]);
        return;
      }

      const nextRows: CloudCheckRow[] = [];
      const session = await supabase.auth.getSession();
      nextRows.push({
        label: text('Cloud session', 'Sesi cloud'),
        status: session.data.session ? 'pass' : 'fail',
        detail: session.data.session
          ? text('Access-code login is connected to Supabase Auth.', 'Login kod akses disambungkan ke Supabase Auth.')
          : text('Enable Anonymous sign-ins in Supabase Auth, then unlock the app again.', 'Aktifkan Anonymous sign-ins di Supabase Auth, kemudian buka aplikasi semula.'),
      });

      const probes: Array<{ label: string; ok: string; run: () => Promise<{ error: unknown }> }> = [
        {
          label: text('Settings/RLS', 'Tetapan/RLS'),
          ok: text('Settings table can be read with current access.', 'Jadual settings boleh dibaca dengan akses semasa.'),
          run: () => supabase.from('app_settings').select('key').limit(1),
        },
        {
          label: text('Products/RLS', 'Produk/RLS'),
          ok: text('Products can be read for POS/Admin.', 'Produk boleh dibaca untuk POS/Admin.'),
          run: () => supabase.from('products').select('id').limit(1),
        },
        {
          label: text('Report SQL', 'SQL laporan'),
          ok: text('Account report functions are installed.', 'Fungsi laporan akaun sudah dipasang.'),
          run: () =>
            supabase.rpc('account_report_archive_file_name', {
              p_report_kind: 'daily',
              p_period_start: '2026-01-01',
              p_period_end: '2026-01-01',
            }),
        },
        {
          label: text('Audit log', 'Log audit'),
          ok: text('Admin can review saved system activity.', 'Admin boleh semak aktiviti sistem yang disimpan.'),
          run: () => supabase.from('audit_logs').select('id').limit(1),
        },
      ];

      for (const probe of probes) {
        const result = await probe.run();
        nextRows.push({
          label: probe.label,
          status: result.error ? 'fail' : 'pass',
          detail: result.error ? cloudCheckError(result.error, text('Cloud check failed.', 'Semakan cloud gagal.')) : probe.ok,
        });
      }
      setCloudCheckRows(nextRows);
    } finally {
      setCheckingCloud(false);
    }
  }

  const rows = [
    {
      label: text('Current mode', 'Mod semasa'),
      status: shouldUseLocalData ? text('This Device Only', 'Peranti Ini Sahaja') : text('Cloud Live', 'Cloud Live'),
      detail: shouldUseLocalData
        ? text('Data stays in this browser/device. Use Cloud Live before real operation.', 'Data kekal dalam browser/peranti ini. Guna Cloud Live sebelum operasi sebenar.')
        : text('Data saves to Supabase and is shared across devices.', 'Data disimpan ke Supabase dan dikongsi merentas peranti.'),
      ok: !shouldUseLocalData,
    },
    {
      label: text('Supabase keys', 'Kunci Supabase'),
      status: hasSupabaseCredentials ? text('Present', 'Ada') : text('Missing', 'Tiada'),
      detail: hasSupabaseCredentials
        ? text('Public project URL/key detected. No secret key is used in the browser.', 'Project URL/public key dikesan. Secret key tidak digunakan dalam browser.')
        : text('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for cloud use.', 'Tambah VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY untuk guna cloud.'),
      ok: hasSupabaseCredentials,
    },
    {
      label: text('Anonymous Auth', 'Auth Tanpa Nama'),
      status: shouldUseLocalData ? text('Not used in device mode', 'Tidak digunakan dalam mod peranti') : text('Needed for access-code login', 'Diperlukan untuk login kod akses'),
      detail: text('In Supabase, enable Auth > Sign In / Providers > Anonymous sign-ins.', 'Di Supabase, aktifkan Auth > Sign In / Providers > Anonymous sign-ins.'),
      ok: shouldUseLocalData || isSupabaseConfigured,
    },
    {
      label: text('Storage bucket', 'Bucket storage'),
      status: shouldUseLocalData ? text('Not used in device mode', 'Tidak digunakan dalam mod peranti') : text('Needed for images', 'Diperlukan untuk gambar'),
      detail: text('QR receipts use payment-receipts. Product photos use product-images.', 'Resit QR guna payment-receipts. Gambar produk guna product-images.'),
      ok: shouldUseLocalData || isSupabaseConfigured,
    },
  ];

  return (
    <section className="island-panel rounded-lg p-3 sm:rounded-xl sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold sm:text-xl">{text('System Health', 'Status Sistem')}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={secondaryButtonClass} onClick={() => void runCloudCheck()} disabled={checkingCloud}>
            <RotateCcw className="h-4 w-4" />
            {checkingCloud ? text('Checking cloud', 'Semak cloud') : text('Run cloud check', 'Semak cloud')}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-white/80 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{text('Current save location', 'Lokasi simpan semasa')}</p>
          <p className="mt-1 text-sm font-semibold sm:text-base">{currentSaveLocation}</p>
        </div>
        <div className={'rounded-lg border p-3 ' + (shouldUseLocalData ? 'border-amber-200 bg-amber-50' : 'border-teal-200 bg-shell')}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{text('Use for real operation', 'Untuk operasi sebenar')}</p>
          <p className={'mt-1 text-sm font-semibold sm:text-base ' + (shouldUseLocalData ? 'text-warning' : 'text-accent')}>{realUseStatus}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:hidden">
        {rows.map((row) => (
          <article key={`mobile-health-${row.label}`} className="rounded-lg border border-line bg-white/85 p-3 shadow-none">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold">{row.label}</p>
              <span className={'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ' + (row.ok ? 'bg-shell text-accent' : 'bg-amber-50 text-warning')}>
                {row.status}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold leading-relaxed text-neutral-600">{row.detail}</p>
          </article>
        ))}
      </div>
      <div className="clean-scroll mt-4 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
        <table className="dense-table w-full min-w-[680px] text-left text-xs sm:text-sm">
          <thead className="bg-paper">
            <tr>
              <th className="p-3">{text('Check', 'Semakan')}</th>
              <th className="p-3">{text('Status', 'Status')}</th>
              <th className="p-3">{text('Detail', 'Butiran')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <td className="p-3 font-semibold">{row.label}</td>
                <td className="p-3">
                  <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + (row.ok ? 'bg-shell text-accent' : 'bg-amber-50 text-warning')}>
                    {row.status}
                  </span>
                </td>
                <td className="p-3 font-bold text-neutral-600">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-lg border border-line bg-white/75 p-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold">{text('Cloud Readiness', 'Kesediaan Cloud')}</h3>
          <span className="text-xs font-semibold text-neutral-500">
            {cloudCheckRows.length > 0
              ? text('Latest check results', 'Keputusan semakan terkini')
              : text('Run before real multi-device use', 'Jalankan sebelum guna banyak peranti')}
          </span>
        </div>
        {cloudCheckRows.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-neutral-600">
            {text('This confirms whether the site can save and read shared cloud data safely.', 'Ini mengesahkan sama ada laman boleh simpan dan baca data cloud bersama dengan selamat.')}
          </p>
        ) : (
          <>
          <div className="mt-3 grid gap-2 sm:hidden">
            {cloudCheckRows.map((row) => (
              <article key={`mobile-cloud-${row.label}`} className="rounded-lg border border-line bg-white/85 p-3 shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold">{row.label}</p>
                  <span className={'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ' + cloudCheckTone(row.status)}>
                    {cloudCheckLabel(row.status, text)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-bold leading-relaxed text-neutral-600">{row.detail}</p>
              </article>
            ))}
          </div>
          <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-xl border border-line bg-white sm:block">
            <table className="dense-table w-full min-w-[620px] text-left text-xs sm:text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3">{text('Area', 'Bahagian')}</th>
                  <th className="p-3">{text('Result', 'Keputusan')}</th>
                  <th className="p-3">{text('What it means', 'Maksud')}</th>
                </tr>
              </thead>
              <tbody>
                {cloudCheckRows.map((row) => (
                  <tr key={row.label} className="border-t border-line align-top">
                    <td className="p-3 font-semibold">{row.label}</td>
                    <td className="p-3">
                      <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + cloudCheckTone(row.status)}>
                        {cloudCheckLabel(row.status, text)}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-neutral-600">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      {shouldUseLocalData ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:p-4">
          <h3 className="text-base font-semibold">{text('Device Data', 'Data Peranti')}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={secondaryButtonClass + ' dense-action justify-center bg-white/90'}
              onClick={() => {
                if (!window.confirm('Clear sales, stock activity, and daily closing records on this device only? Products and settings will stay.')) return;
                clearLocalTransactionHistory();
                window.location.reload();
              }}
            >
              <Trash2 className="h-4 w-4" />
              {text('Clear this-device sales/stock history', 'Padam sejarah jualan/stok peranti ini')}
            </button>
            <button
              type="button"
              className={secondaryButtonClass + ' dense-action justify-center bg-white/90'}
              onClick={() => {
                if (!window.confirm('Restore starter products, settings, sales, stock activity, and reports on this device only? Cloud data is not affected.')) return;
                resetLocalStarterData();
                window.location.reload();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {text('Restore starter data on this device', 'Pulihkan data permulaan pada peranti ini')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
export default function Products({ settings, onSettingsSaved }: { settings: SettingsMap; onSettingsSaved: (settings: SettingsMap) => void }) {
  const toast = useToast();
  const { text } = useLanguage();
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceHistory, setPriceHistory] = useState<ProductPriceHistory[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [bundleForm, setBundleForm] = useState<BundleForm>(() => bundleFormFromSettings(settings));
  const [bundleVersions, setBundleVersions] = useState<BundleVersionMap>({});
  const [bundleDirty, setBundleDirty] = useState(false);
  const [bundleSaving, setBundleSaving] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [adminPin, setAdminPin] = useState('');
  const [demoAdminUnlocked, setDemoAdminUnlocked] = useState(hasAdminAccess);
  const [adminSection, setAdminSection] = useState<'products' | 'recipes' | 'priceHistory' | 'reports' | 'activity' | 'health'>('products');
  const defaultCartonSize = Number(settings.default_carton_size || 24);
  const [readError, setReadError] = useState('');
  const readGeneration = useRef(0);

  async function refresh(_canRepairDefaults = demoAdminUnlocked) {
    if (!isSupabaseConfigured) {
      setProducts(loadLocalProducts(true));
      setCategories(loadLocalCategories());
      setPriceHistory(loadLocalProductPriceHistory());
      setAuditLogs([]);
      setBundleVersions({});
      return;
    }
    const ticket=++readGeneration.current;
    try {
    const [productData, categoryData, priceHistoryData, bundleSettingData, auditLogData] = await Promise.all([
      readAllRows<ProductWithStock>((from,to)=>supabase.from('products').select('*, categories(id,name,sort_order), inventory_balances(quantity_on_hand)').order('name').order('id').range(from,to)),
      readAllRows<Category>((from,to)=>supabase.from('categories').select('*').order('sort_order').order('id').range(from,to)),
      readAllRows<ProductPriceHistory>((from,to)=>supabase.from('product_price_history').select('*, products(name), profiles(full_name)').order('changed_at', { ascending: false }).order('id').range(from,to)),
      readAllRows<BundleSettingRow>((from,to)=>supabase.from('app_settings').select('key,value,updated_at').in('key', bundleKeys).order('key').range(from,to)),
      readAllRows<AuditLogRow>((from,to)=>supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).order('id').range(from,to)),
    ]);
    if(ticket!==readGeneration.current)return;
    setReadError('');
    setProducts((productData ?? []) as ProductWithStock[]);
    setPriceHistory(priceHistoryData);
    setAuditLogs(auditLogData);
    const bundleRows = (bundleSettingData ?? []) as BundleSettingRow[];
    setBundleVersions(bundleVersionsFromRows(bundleRows));
    if (!bundleDirty && bundleRows.length > 0) {
      setBundleForm(bundleFormFromSettings(settingsWithBundleRows(settings, bundleRows)));
    }
    const currentCategories = (categoryData ?? []) as Category[];
    setCategories(currentCategories);
    } catch (failure) {
      if(ticket===readGeneration.current)setReadError((failure as Error).message || text('Admin records could not be loaded. Retry before editing.', 'Rekod pentadbir tidak dapat dimuatkan. Cuba lagi sebelum mengedit.'));
    }
  }

  async function unlockAdmin() {
    const result = await unlockAdminAccess(adminPin);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDemoAdminUnlocked(true);
    setAdminPin('');
    await refresh(true);
  }

  useEffect(() => {
    void refresh(demoAdminUnlocked);
  }, [demoAdminUnlocked]);

  useSharedRefresh(() => refresh(false), {
    tables: ['products', 'categories', 'inventory_balances', 'product_price_history', 'app_settings', 'daily_reports', 'account_report_archives', 'audit_logs'],
    intervalMs: 20000,
  });

  useEffect(() => {
    if (!bundleDirty) setBundleForm(bundleFormFromSettings(settings));
  }, [bundleDirty, settings]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name)),
    [categories],
  );
  const sortedProducts = useMemo(() => Object.values(groupByCategory(products)).flat(), [products]);
  const effectiveForm = useMemo(() => {
    if (!form) return null;
    return { ...form, category_id: form.category_id || sortedCategories[0]?.id || '' };
  }, [form, sortedCategories]);

  async function repairDefaultCategories() {
    if (!isSupabaseConfigured) {
      setCategories(loadLocalCategories());
      toast.success(text('Product categories are ready.', 'Kategori produk sudah sedia.'));
      return;
    }
    const { error } = await supabase.from('categories').upsert(defaultCategories, { onConflict: 'name' });
    if (error) {
      toast.error(friendlyAdminError(error.message));
      return;
    }
    await refresh(true);
    toast.success(text('Product categories are ready.', 'Kategori produk sudah sedia.'));
  }

  async function uploadProductImage(file: File) {
    if (file.size > maxProductImageBytes) {
      throw new Error(text('Product image must be 4MB or smaller.', 'Gambar produk mesti 4MB atau lebih kecil.'));
    }
    if (!file.type.startsWith('image/')) {
      throw new Error(text('Choose an image file.', 'Pilih fail gambar.'));
    }
    const path = `products/${cleanFileName(file.name)}`;
    const { error } = await supabase.storage.from(productImageBucket).upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });
    if (error) {
      throw new Error(friendlyAdminError(error.message));
    }
    const { data } = supabase.storage.from(productImageBucket).getPublicUrl(path);
    return data.publicUrl;
  }

  function openProductForm(next: ProductForm | null) {
    setImageFile(null);
    setForm(next);
  }

  function updateBundleForm(patch: Partial<BundleForm>) {
    setBundleDirty(true);
    setBundleForm((current) => ({ ...current, ...patch }));
  }

  async function reloadBundleSettingsFromCloud() {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase.from('app_settings').select('key,value,updated_at').in('key', bundleKeys);
    if (error) {
      toast.error(friendlyAdminError(error.message));
      return;
    }
    const rows = (data ?? []) as BundleSettingRow[];
    const nextSettings = settingsWithBundleRows(settings, rows);
    setBundleVersions(bundleVersionsFromRows(rows));
    setBundleForm(bundleFormFromSettings(nextSettings));
    setBundleDirty(false);
    onSettingsSaved(nextSettings);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!effectiveForm || productSaving) return;
    if (!effectiveForm.category_id) {
      toast.error(text('Choose a category before saving.', 'Pilih kategori sebelum simpan.'));
      return;
    }
    const parsed = parseProductForm(effectiveForm);
    if ('error' in parsed) {
      const errorMalay: Record<string, string> = {
        'Enter a product name.': 'Masukkan nama produk.',
        'Enter a valid price per unit.': 'Masukkan harga seunit yang betul.',
        'Enter a valid cost per unit.': 'Masukkan kos seunit yang betul.',
        'Units per carton must be at least 1.': 'Unit setiap karton mesti sekurang-kurangnya 1.',
        'Low stock alert unit balance must be 0 or more.': 'Baki unit amaran stok rendah mesti 0 atau lebih.',
      };
      const errorText = parsed.error || 'Check the product fields.';
      toast.error(text(errorText, errorMalay[errorText] ?? errorText));
      return;
    }
    setProductSaving(true);
    try {
      const payload = { ...parsed.payload };
      if (isSupabaseConfigured && imageFile) {
        payload.image_url = await uploadProductImage(imageFile);
      }
      if (!isSupabaseConfigured) {
        saveLocalProduct({
          id: effectiveForm.id,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          inventory_balances: { quantity_on_hand: products.find((item) => item.id === effectiveForm.id)?.inventory_balances?.quantity_on_hand ?? 0 },
        });
        openProductForm(null);
        await refresh();
        toast.success(text('Product saved.', 'Produk disimpan.'));
        return;
      }
      const result = await supabase.rpc('save_product_checked', {
        p_product_id: effectiveForm.id ?? null,
        p_payload: payload,
        p_source_updated_at: effectiveForm.id ? effectiveForm.source_updated_at ?? null : null,
      });
      if (result.error) {
        if (result.error.message.toLowerCase().includes('another device')) {
          await refresh(false);
        }
        toast.error(friendlyAdminError(result.error.message));
        return;
      }
      openProductForm(null);
      await refresh();
      toast.success(text('Product saved.', 'Produk disimpan.'));
    } finally {
      setProductSaving(false);
    }
  }

  async function saveBundle(event: FormEvent) {
    event.preventDefault();
    const units = Math.max(1, Math.floor(Number(bundleForm.beer_bundle_units_per_set || 4)));
    const price = Number(bundleForm.beer_bundle_price);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error(text('Enter a valid bundle price.', 'Masukkan harga set yang betul.'))
      return;
    }
    const nextSettings: SettingsMap = {
      ...settings,
      beer_bundle_enabled: bundleForm.beer_bundle_enabled,
      beer_bundle_name: bundleForm.beer_bundle_name.trim() || 'Beer Bundle',
      beer_bundle_units_per_set: units,
      beer_bundle_price: Number(price.toFixed(2)),
    };
    setBundleSaving(true);
    if (!isSupabaseConfigured) {
      saveLocalSettings(nextSettings);
      onSettingsSaved(nextSettings);
      setBundleDirty(false);
      setBundleSaving(false);
      toast.success(text('Beer bundle saved.', 'Set bir disimpan.'));
      return;
    }
    const rows = bundleKeys.map((key) => ({ key, value: nextSettings[key] }));
    const { data, error } = await supabase.rpc('save_app_settings_checked', {
      p_rows: rows,
      p_versions: bundleVersions,
    });
    setBundleSaving(false);
    if (error) {
      if (error.message.toLowerCase().includes('another device')) {
        await reloadBundleSettingsFromCloud();
      }
      toast.error(friendlyAdminError(error.message));
      return;
    }
    const savedRows = (data?.settings ?? []) as BundleSettingRow[];
    if (savedRows.length > 0) setBundleVersions(bundleVersionsFromRows(savedRows));
    setBundleDirty(false);
    onSettingsSaved(nextSettings);
    toast.success(text('Beer bundle saved.', 'Set bir disimpan.'));
  }

  function openCocktailProductForm() {
    const cocktailCategory = sortedCategories.find((category) => normalizeCategoryName(category.name) === 'Cocktail');
    openProductForm({
      ...blank(defaultCartonSize),
      name: 'Cocktail A',
      category_id: cocktailCategory?.id ?? '',
      carton_size: '1',
      low_stock_threshold: '0',
    });
  }

  function attachImage(file: File | undefined) {
    if (!file || !effectiveForm) return;
    if (file.size > maxProductImageBytes) {
      toast.error(text('Product image must be 4MB or smaller.', 'Gambar produk mesti 4MB atau lebih kecil.'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(text('Choose an image file.', 'Pilih fail gambar.'));
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setForm({ ...effectiveForm, image_url: String(reader.result ?? '') });
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageHeader title={text('Admin', 'Pentadbir')} actions={demoAdminUnlocked && !readError ? <>
        <button className={buttonClass} onClick={() => openProductForm(blank(defaultCartonSize))}><Plus size={16} />{text('Add Product', 'Tambah Produk')}</button>
        <Link className={secondaryButtonClass} to="/settings">{text('Settings', 'Tetapan')}</Link>
      </> : undefined} />
      {readError ? <p role="alert" className="mb-3 text-sm text-danger">{readError} <button className={secondaryButtonClass} onClick={()=>void refresh()}>{text('Retry', 'Cuba Lagi')}</button></p> : null}
      {!demoAdminUnlocked ? (
        <div className="island-panel mb-4 max-w-xl rounded-lg p-3 sm:mb-5 sm:rounded-xl sm:p-5">
          <h2 className="text-xl font-semibold sm:text-2xl">{text('Admin Access', 'Akses Pentadbir')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} type="password" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} placeholder={text('Admin password', 'Kata laluan admin')} />
            <button className={buttonClass} onClick={() => void unlockAdmin()}>{text('Unlock', 'Buka')}</button>
          </div>
        </div>
      ) : null}
      {!demoAdminUnlocked || readError ? null : (
      <>
      <ViewChoices className="bar-admin-tabs mb-4" label={text('Admin Section', 'Bahagian Pentadbir')} value={adminSection} onChange={value => setAdminSection(value as typeof adminSection)} items={[
        {value: 'products', label: text('Products', 'Produk')},
        {value: 'recipes', label: text('Recipes', 'Resipi')},
        {value: 'priceHistory', label: text('Prices', 'Harga')},
        {value: 'reports', label: text('Reports', 'Laporan')},
        {value: 'activity', label: text('Activity', 'Aktiviti')},
        {value: 'health', label: text('System', 'Sistem')},
      ]} />
      {adminSection === 'products' ? (
      <>
      <section className="island-panel mb-4 rounded-lg p-3 sm:mb-5 sm:rounded-xl sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold sm:text-xl">{text('Product Categories', 'Kategori Produk')}</h2>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-4">
          {sortedCategories.map((category) => (
            <span key={category.id} className="border-r border-line pr-3 text-sm text-muted last:border-r-0">
              {normalizeCategoryName(category.name)}
            </span>
          ))}
        </div>
        {sortedCategories.length === 0 ? (
          <div className="mt-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <p className="text-sm font-bold text-warning">{text('No categories found. Create the default bar categories first.', 'Tiada kategori. Cipta kategori bar asas dahulu.')}</p>
            <button type="button" className={secondaryButtonClass + ' bg-white'} onClick={() => void repairDefaultCategories()}>
              {text('Create categories', 'Cipta kategori')}
            </button>
          </div>
        ) : null}
      </section>
      <form onSubmit={saveBundle} className="island-panel mb-4 rounded-lg p-3 sm:mb-5 sm:rounded-xl sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-accent">
              <PackagePlus className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold sm:text-xl">{text('Beer Bundle', 'Set Bir')}</h2>
                {bundleDirty ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[0.68rem] font-semibold leading-none text-warning">
                    {text('Unsaved', 'Belum simpan')}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-bold text-neutral-600">
                {countLabel(Number(bundleForm.beer_bundle_units_per_set || 4), text('Beer Unit', 'Unit Bir'), text('Beer Units', 'Unit Bir'))} · {money(Number(bundleForm.beer_bundle_price || 0), String(settings.currency_symbol))}
              </p>
            </div>
          </div>
          <button className={buttonClass} disabled={bundleSaving}>
            {bundleSaving ? text('Saving...', 'Menyimpan...') : text('Save', 'Simpan')}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-[1fr_1.4fr_1fr_1fr]">
          <Field label={text('Status', 'Status')}>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-paper px-3 text-sm font-bold">
              <input
                type="checkbox"
                checked={bundleForm.beer_bundle_enabled}
                onChange={(event) => updateBundleForm({ beer_bundle_enabled: event.target.checked })}
              />
              {bundleForm.beer_bundle_enabled ? text('Enabled', 'Aktif') : text('Disabled', 'Tidak aktif')}
            </label>
          </Field>
          <Field label={text('Bundle name', 'Nama set')}>
            <input
              className={inputClass}
              value={bundleForm.beer_bundle_name}
              onChange={(event) => updateBundleForm({ beer_bundle_name: event.target.value })}
            />
          </Field>
          <Field label={text('Units per set', 'Unit setiap set')}>
            <input
              className={inputClass}
              type="number"
              min={1}
              value={bundleForm.beer_bundle_units_per_set}
              onChange={(event) => updateBundleForm({ beer_bundle_units_per_set: event.target.value })}
            />
          </Field>
          <Field label={text('Price per set', 'Harga setiap set')}>
            <input
              className={inputClass}
              type="number"
              min={0}
              step="0.01"
              value={bundleForm.beer_bundle_price}
              onChange={(event) => updateBundleForm({ beer_bundle_price: event.target.value })}
            />
          </Field>
        </div>
      </form>
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/80 shadow-none sm:hidden">
        <table className="dense-table w-full table-fixed text-left text-[11px]">
          <thead className="bg-paper">
            <tr>
              <th className="w-[44%] p-2">{text('Product', 'Produk')}</th>
              <th className="w-[26%] p-2">{text('Price', 'Harga')}</th>
              <th className="w-[18%] p-2">{text('Stock', 'Stok')}</th>
              <th className="w-[12%] p-2">{text('Edit', 'Edit')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((product) => (
              <tr key={`mobile-product-${product.id}`} className="border-t border-line align-top">
                <td className="p-2">
                  <div className="min-w-0">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{product.name}</p>
                      <p className="text-xs text-muted">{normalizeCategoryName(product.categories?.name)}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${product.active ? 'bg-shell text-accent' : 'bg-neutral-100 text-neutral-600'}`}>
                        {product.active ? text('Active', 'Aktif') : text('Inactive', 'Tidak aktif')}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="p-2 font-bold leading-tight">
                  <span className="block whitespace-nowrap text-[11px] font-semibold">{money(product.price_per_unit, String(settings.currency_symbol))}</span>
                  <span className="mt-1 block whitespace-nowrap text-[10px] text-neutral-600">{text('Cost', 'Kos')} {product.cost_per_unit == null ? '-' : money(product.cost_per_unit, String(settings.currency_symbol))}</span>
                </td>
                <td className="p-2 font-bold leading-tight">
                  <span className="block font-semibold">{product.inventory_balances?.quantity_on_hand ?? 0} {text('Units', 'Unit')}</span>
                  <span className="block text-[10px] text-neutral-600">{text('Alert', 'Amaran')} {product.low_stock_threshold} {text('Units', 'Unit')}</span>
                </td>
                <td className="p-2">
                  <button
                    className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-ink shadow-none"
                    aria-label={`${text('Edit', 'Edit')} ${product.name}`}
                    onClick={() =>
                      openProductForm({
                        id: product.id,
                        name: product.name,
                        category_id: product.category_id ?? '',
                        price_per_unit: String(product.price_per_unit),
                        cost_per_unit: product.cost_per_unit == null ? '' : String(product.cost_per_unit),
                        carton_size: String(product.carton_size),
                        low_stock_threshold: String(product.low_stock_threshold),
                        image_url: product.image_url ?? '',
                        active: product.active,
                        source_updated_at: product.updated_at,
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="clean-scroll hidden overflow-x-auto rounded-lg border border-line bg-white/80 shadow-none sm:block sm:rounded-xl">
        <table className="dense-table w-full min-w-[760px] text-left text-xs sm:text-sm">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">{text('Name', 'Nama')}</th>
              <th className="p-3">{text('Image', 'Gambar')}</th>
              <th className="p-3">{text('Category', 'Kategori')}</th>
              <th className="p-3">{text('Price', 'Harga')}</th>
              <th className="p-3">{text('Cost', 'Kos')}</th>
              <th className="p-3">{text('Units / carton', 'Unit / karton')}</th>
              <th className="p-3">{text('Low Alert (Units)', 'Amaran Rendah (Unit)')}</th>
              <th className="p-3">{text('Status', 'Status')}</th>
              <th className="p-3">{text('Action', 'Tindakan')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((product) => (
              <tr key={product.id} className="border-t border-line">
                <td className="p-3 font-bold">{product.name}</td>
                <td className="p-3">
                  <img
                    src={product.image_url ?? assetPath('assets/custom-order.svg')}
                    data-fallback={assetPath('assets/custom-order.svg')}
                    alt=""
                    className="h-14 w-20 rounded-xl object-cover"
                    onError={(event) => {
                      const fallback = event.currentTarget.dataset.fallback;
                      if (fallback && !event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
                    }}
                  />
                </td>
                <td className="p-3">{normalizeCategoryName(product.categories?.name)}</td>
                <td className="p-3 whitespace-nowrap font-bold">{money(product.price_per_unit, String(settings.currency_symbol))}</td>
                <td className="p-3 whitespace-nowrap">{product.cost_per_unit == null ? '-' : money(product.cost_per_unit, String(settings.currency_symbol))}</td>
                <td className="p-3">{product.carton_size}</td>
                <td className="p-3 whitespace-nowrap">{product.low_stock_threshold} {text('Units', 'Unit')}</td>
                <td className="p-3">{product.active ? text('Active', 'Aktif') : text('Inactive', 'Tidak aktif')}</td>
                <td className="p-3">
                  <button
                    className={secondaryButtonClass}
                    onClick={() =>
                      openProductForm({
                        id: product.id,
                        name: product.name,
                        category_id: product.category_id ?? '',
                        price_per_unit: String(product.price_per_unit),
                        cost_per_unit: product.cost_per_unit == null ? '' : String(product.cost_per_unit),
                        carton_size: String(product.carton_size),
                        low_stock_threshold: String(product.low_stock_threshold),
                        image_url: product.image_url ?? '',
                        active: product.active,
                        source_updated_at: product.updated_at,
                      })
                    }
                  >
                    {text('Edit', 'Edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      ) : adminSection === 'recipes' ? (
        <CocktailRecipePanel products={sortedProducts} settings={settings} onAddCocktailProduct={openCocktailProductForm} />
      ) : adminSection === 'priceHistory' ? (
        <section className="island-panel rounded-lg p-3 sm:rounded-xl sm:p-5">
          <h2 className="text-lg font-semibold sm:text-xl">{text('Price History', 'Sejarah Harga')}</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white/75 sm:hidden">
            <table className="dense-table w-full table-fixed text-left text-[11px]">
              <thead className="bg-paper">
                <tr>
                  <th className="w-[40%] p-2">{text('Product', 'Produk')}</th>
                  <th className="w-[30%] p-2">{text('Price', 'Harga')}</th>
                  <th className="w-[30%] p-2">{text('Cost', 'Kos')}</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.map((item) => (
                  <tr key={`mobile-price-${item.id}`} className="border-t border-line">
                    <td className="p-2 align-top">
                      <p className="truncate font-semibold">{item.products?.name ?? item.product_name}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-neutral-600">{format(new Date(item.changed_at), 'dd MMM yyyy')}</p>
                      <p className="text-[10px] font-bold text-neutral-600">{format(new Date(item.changed_at), 'h:mm a')}</p>
                      <p className="mt-1 truncate text-[10px] font-semibold text-accent">{text('By', 'Oleh')} {item.profiles?.full_name ?? 'Admin'}</p>
                    </td>
                    <td className="p-2 align-top font-bold leading-tight">
                      <span className="block text-[10px] text-neutral-500">{text('Old', 'Lama')}</span>
                      <span className="block truncate">{item.old_price_per_unit == null ? '-' : money(item.old_price_per_unit, String(settings.currency_symbol))}</span>
                      <span className="mt-1 block text-[10px] text-accent">{text('New', 'Baru')}</span>
                      <span className="block truncate font-semibold text-accent">{item.new_price_per_unit == null ? '-' : money(item.new_price_per_unit, String(settings.currency_symbol))}</span>
                    </td>
                    <td className="p-2 align-top font-bold leading-tight">
                      <span className="block text-[10px] text-neutral-500">{text('Old', 'Lama')}</span>
                      <span className="block truncate">{item.old_cost_per_unit == null ? '-' : money(item.old_cost_per_unit, String(settings.currency_symbol))}</span>
                      <span className="mt-1 block text-[10px] text-neutral-500">{text('New', 'Baru')}</span>
                      <span className="block truncate">{item.new_cost_per_unit == null ? '-' : money(item.new_cost_per_unit, String(settings.currency_symbol))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {priceHistory.length === 0 ? (
              <div className="p-4 text-center text-sm font-bold text-neutral-600">
                {text('No price changes recorded yet.', 'Belum ada perubahan harga.')}
              </div>
            ) : null}
          </div>
          <div className="clean-scroll mt-3 hidden overflow-x-auto rounded-lg border border-line bg-white/75 sm:block">
            <table className="dense-table w-full min-w-[820px] text-left text-xs sm:text-sm">
              <thead className="bg-paper">
                <tr>
                  <th className="p-3">{text('Time', 'Masa')}</th>
                  <th className="p-3">{text('Product', 'Produk')}</th>
                  <th className="p-3">{text('Old price', 'Harga lama')}</th>
                  <th className="p-3">{text('New price', 'Harga baru')}</th>
                  <th className="p-3">{text('Old cost', 'Kos lama')}</th>
                  <th className="p-3">{text('New cost', 'Kos baru')}</th>
                  <th className="p-3">{text('Changed by', 'Diubah oleh')}</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="p-3 whitespace-nowrap">{format(new Date(item.changed_at), 'dd MMM yyyy, h:mm a')}</td>
                    <td className="p-3 font-semibold">{item.products?.name ?? item.product_name}</td>
                    <td className="p-3 whitespace-nowrap">{item.old_price_per_unit == null ? '-' : money(item.old_price_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap font-semibold">{item.new_price_per_unit == null ? '-' : money(item.new_price_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.old_cost_per_unit == null ? '-' : money(item.old_cost_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.new_cost_per_unit == null ? '-' : money(item.new_cost_per_unit, String(settings.currency_symbol))}</td>
                    <td className="p-3 whitespace-nowrap">{item.profiles?.full_name ?? 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {priceHistory.length === 0 ? (
              <div className="p-5 text-center text-sm font-bold text-neutral-600">{text('No price changes recorded yet.', 'Belum ada perubahan harga.')}</div>
            ) : null}
          </div>
        </section>
      ) : adminSection === 'activity' ? (
        <AuditActivityPanel logs={auditLogs} settings={settings} />
      ) : adminSection === 'reports' ? (
        <AccountReportArchivePanel settings={settings} />
      ) : (
        <CloudHealthPanel />
      )}
      </>
      )}
      {effectiveForm ? (
        <Modal title={effectiveForm.id ? text('Edit product', 'Edit produk') : text('Add product', 'Tambah produk')} onClose={() => openProductForm(null)}>
          <form onSubmit={save} className="grid gap-4">
            {effectiveForm.id ? (
              <p className="rounded-xl border border-teal-200 bg-shell px-3 py-2 text-xs font-semibold leading-tight text-accent">
                {text('Protected save: stops if this product changed on another device.', 'Simpan terlindung: berhenti jika produk ini diubah pada peranti lain.')}
              </p>
            ) : null}
            <Field label={text('Product name', 'Nama produk')}>
              <input className={inputClass} value={effectiveForm.name} onChange={(e) => setForm({ ...effectiveForm, name: e.target.value })} required />
            </Field>
            <Field label={text('Category', 'Kategori')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sortedCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setForm({ ...effectiveForm, category_id: category.id })}
                    className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-semibold shadow-none ${
                      effectiveForm.category_id === category.id
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-white text-ink'
                    }`}
                  >
                    {normalizeCategoryName(category.name)}
                  </button>
                ))}
              </div>
              {sortedCategories.length === 0 ? (
                <div className="rounded-xl border border-warning bg-amber-50 p-3 text-sm font-semibold text-warning">
                  <p>{text('Categories are missing. Create them before saving a product.', 'Kategori tiada. Cipta kategori sebelum simpan produk.')}</p>
                  <button type="button" className={secondaryButtonClass + ' mt-2 bg-white'} onClick={() => void repairDefaultCategories()}>
                    {text('Create categories', 'Cipta kategori')}
                  </button>
                </div>
              ) : null}
            </Field>
            <Field label={text('Product image URL', 'URL gambar produk')}>
              <input className={inputClass} value={effectiveForm.image_url} onChange={(e) => { setImageFile(null); setForm({ ...effectiveForm, image_url: e.target.value }); }} placeholder="https://..." />
            </Field>
            <Field label={text('Attach product image', 'Lampir gambar produk')}>
              <div className="grid gap-3 rounded-xl border border-line bg-shell p-3 sm:grid-cols-[140px_1fr] sm:items-center sm:rounded-lg">
                <img src={effectiveForm.image_url || assetPath('assets/custom-order.svg')} alt="" className="h-20 w-full rounded-xl object-cover sm:h-24" />
                <div className="grid gap-2">
                  <input className={inputClass} type="file" accept="image/*" onChange={(event) => attachImage(event.target.files?.[0])} />
                  <p className="text-xs font-bold text-neutral-600">{isSupabaseConfigured ? text('Attached images upload to Supabase when you save.', 'Gambar dilampir akan dimuat naik ke Supabase apabila simpan.') : text('Attached images are saved on this device only in local mode.', 'Gambar dilampir disimpan pada peranti ini sahaja dalam mod local.')}</p>
                </div>
              </div>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={text('Price per unit', 'Harga seunit')}><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.price_per_unit} onChange={(e) => setForm({ ...effectiveForm, price_per_unit: e.target.value })} /></Field>
              <Field label={text('Cost Per Unit', 'Kos Seunit')}><input className={inputClass} type="number" min={0} step="0.01" value={effectiveForm.cost_per_unit} onChange={(e) => setForm({ ...effectiveForm, cost_per_unit: e.target.value })} /></Field>
              <Field label={text('Units per carton', 'Unit setiap karton')}><input className={inputClass} type="number" min={1} value={effectiveForm.carton_size} onChange={(e) => setForm({ ...effectiveForm, carton_size: e.target.value })} /></Field>
              <Field label={text('Low stock alert at (unit balance)', 'Amaran stok rendah pada baki unit')}><input className={inputClass} type="number" min={0} value={effectiveForm.low_stock_threshold} onChange={(e) => setForm({ ...effectiveForm, low_stock_threshold: e.target.value })} /><p className="mt-1 text-xs font-bold text-neutral-600">{text('Counted in individual units, not cartons.', 'Dikira dalam unit individu, bukan karton.')}</p></Field>
            </div>
            <label className="flex items-center gap-3 font-bold">
              <input type="checkbox" checked={effectiveForm.active} onChange={(e) => setForm({ ...effectiveForm, active: e.target.checked })} />
              {text('Active', 'Aktif')}
            </label>
            <button className={`${buttonClass} w-full sm:w-auto`} disabled={productSaving}>{productSaving ? text('Saving...', 'Menyimpan...') : text('Save product', 'Simpan produk')}</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
