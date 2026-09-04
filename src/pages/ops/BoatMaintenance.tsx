import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Droplets, Fuel, Repeat, Wrench } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadBoats, loadEmployees, readErrorMessage, todayIso } from '../../lib/opsData';
import { money } from '../../lib/format';
import type { Boat, Employee, FuelLog, FuelSummaryRow, Repair } from '../../lib/platformTypes';
import type { SettingsMap } from '../../lib/types';

const categories: Array<[Repair['issue_category'], string]> = [
  ['engine', 'Engine'],
  ['propeller', 'Propeller'],
  ['hull', 'Hull / body'],
  ['electrical', 'Electrical'],
  ['fuel_system', 'Fuel system'],
  ['steering', 'Steering'],
  ['safety_gear', 'Safety gear'],
  ['interior', 'Interior'],
  ['other', 'Other'],
];

function firstOfMonth() {
  const today = todayIso();
  return `${today.slice(0, 8)}01`;
}

export default function BoatMaintenance({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { can } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');

  const [tab, setTab] = useState<'fuel' | 'repairs'>('fuel');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [summary, setSummary] = useState<FuelSummaryRow[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [loading, setLoading] = useState(true);

  const showCost = can('maintenance.cost.view');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [boatRows, employeeRows, fuelRows, summaryRows, repairRows] = await Promise.all([
        loadBoats(true),
        loadEmployees(),
        supabase
          .from('boat_fuel_logs')
          .select('*, boats(code,name)')
          .gte('log_date', from)
          .lte('log_date', to)
          .order('log_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.rpc('boat_fuel_summary', { p_from: from, p_to: to }),
        supabase
          .from('boat_repairs')
          .select('*, boats(code,name)')
          .order('reported_date', { ascending: false })
          .limit(300),
      ]);
      setBoats(boatRows);
      setEmployees(employeeRows);
      setFuelLogs((fuelRows.data ?? []) as FuelLog[]);
      setSummary((summaryRows.data ?? []) as FuelSummaryRow[]);
      setRepairs((repairRows.data ?? []) as Repair[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load maintenance records.'));
    }
    setLoading(false);
  }, [from, to, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = useMemo(() => {
    const used = summary.reduce((sum, row) => sum + Number(row.litres_used ?? 0), 0);
    const loaded = summary.reduce((sum, row) => sum + Number(row.litres_loaded ?? 0), 0);
    const spend = summary.reduce((sum, row) => sum + Number(row.cost_loaded ?? 0) + Number(row.cost_used ?? 0), 0);
    const openRepairs = repairs.filter((repair) => repair.status === 'reported' || repair.status === 'in_progress');
    const repeatRepairs = repairs.filter((repair) => repair.is_recurring);
    const repairSpend = repairs
      .filter((repair) => repair.reported_date >= from && repair.reported_date <= to)
      .reduce((sum, repair) => sum + Number(repair.cost ?? 0), 0);
    return { used, loaded, spend, openRepairs, repeatRepairs, repairSpend };
  }, [from, repairs, summary, to]);

  const overspending = summary.filter((row) => (row.variance_pct ?? 0) > 15);

  return (
    <>
      <PageHeader
        title="Boat Maintenance"
        subtitle="Daily petrol usage, refuelling and every repair job with its cost and history."
        actions={
          <>
            {can('maintenance.fuel.record') ? (
              <button type="button" className={buttonClass} onClick={() => setFuelOpen(true)}>
                <Fuel className="h-4 w-4" /> Fuel entry
              </button>
            ) : null}
            {can('maintenance.repair.record') ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => { setEditingRepair(null); setRepairOpen(true); }}
              >
                <Wrench className="h-4 w-4" /> Report damage
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="From">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="ml-auto grid grid-cols-2 gap-1 rounded-2xl bg-shell p-1 text-xs font-black">
          <button type="button" onClick={() => setTab('fuel')} className={`rounded-xl px-4 py-2 ${tab === 'fuel' ? 'bg-accent text-white' : ''}`}>
            Fuel
          </button>
          <button type="button" onClick={() => setTab('repairs')} className={`rounded-xl px-4 py-2 ${tab === 'repairs' ? 'bg-accent text-white' : ''}`}>
            Repairs
          </button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Petrol used in period" value={`${totals.used.toFixed(1)} L`} />
        <Stat label="Petrol loaded in period" value={`${totals.loaded.toFixed(1)} L`} />
        {showCost ? <Stat label="Fuel spend" value={money(totals.spend, currency)} /> : null}
        <Stat
          label="Open repair jobs"
          value={String(totals.openRepairs.length)}
          tone={totals.openRepairs.length > 0 ? 'warn' : 'good'}
        />
      </div>

      {overspending.length > 0 ? (
        <div className="mb-3 rounded-2xl border border-warning bg-amber-50 p-3 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-black text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Fuel above the normal rate
          </p>
          <ul className="mt-2 grid gap-1 text-sm font-semibold text-amber-900">
            {overspending.map((row) => (
              <li key={row.boat_id}>
                {row.boat_code}: {Number(row.avg_litres_per_trip).toFixed(1)} L per trip against a{' '}
                {Number(row.expected_litres_per_trip).toFixed(1)} L baseline (+{row.variance_pct}%)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      {tab === 'fuel' ? (
        <FuelTable logs={fuelLogs} summary={summary} showCost={showCost} currency={currency} />
      ) : (
        <RepairTable
          repairs={repairs}
          currency={currency}
          showCost={showCost}
          canClose={can('maintenance.repair.close') || can('maintenance.manage')}
          onEdit={(repair) => { setEditingRepair(repair); setRepairOpen(true); }}
        />
      )}

      {fuelOpen ? (
        <FuelForm
          boats={boats}
          employees={employees}
          onClose={() => setFuelOpen(false)}
          onSaved={() => { setFuelOpen(false); void refresh(); }}
        />
      ) : null}

      {repairOpen ? (
        <RepairForm
          boats={boats}
          employees={employees}
          repairs={repairs}
          existing={editingRepair}
          onClose={() => setRepairOpen(false)}
          onSaved={() => { setRepairOpen(false); void refresh(); }}
        />
      ) : null}
    </>
  );
}

function FuelTable({
  logs,
  summary,
  showCost,
  currency,
}: {
  logs: FuelLog[];
  summary: FuelSummaryRow[];
  showCost: boolean;
  currency: string;
}) {
  return (
    <>
      <div className="mb-3 overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Boat</th>
              <th className="p-3">Island trips</th>
              <th className="p-3">Used (L)</th>
              <th className="p-3">Loaded (L)</th>
              <th className="p-3">Avg / trip</th>
              <th className="p-3">Baseline</th>
              <th className="p-3">Variance</th>
              {showCost ? <th className="p-3">Spend</th> : null}
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.boat_id} className="border-t border-line text-sm font-semibold">
                <td className="p-3 font-black">{row.boat_code}</td>
                <td className="p-3">{row.trips}</td>
                <td className="p-3">{Number(row.litres_used).toFixed(1)}</td>
                <td className="p-3">{Number(row.litres_loaded).toFixed(1)}</td>
                <td className="p-3">{Number(row.avg_litres_per_trip).toFixed(1)}</td>
                <td className="p-3">{row.expected_litres_per_trip ? Number(row.expected_litres_per_trip).toFixed(1) : '—'}</td>
                <td className={`p-3 font-black ${(row.variance_pct ?? 0) > 15 ? 'text-danger' : 'text-accent'}`}>
                  {row.variance_pct === null ? '—' : `${row.variance_pct > 0 ? '+' : ''}${row.variance_pct}%`}
                </td>
                {showCost ? (
                  <td className="p-3">{money(Number(row.cost_used) + Number(row.cost_loaded), currency)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
        <table className="w-full min-w-[760px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Boat</th>
              <th className="p-3">Type</th>
              <th className="p-3">Trip</th>
              <th className="p-3">Litres</th>
              {showCost ? <th className="p-3">Price / L</th> : null}
              {showCost ? <th className="p-3">Total</th> : null}
              <th className="p-3">Tank after</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-line text-sm font-semibold">
                <td className="p-3">{log.log_date}</td>
                <td className="p-3 font-black">{log.boats?.code ?? '—'}</td>
                <td className="p-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-black ${
                      log.entry_type === 'refuel' ? 'bg-teal-50 text-accent' : 'bg-pink-50 text-coral'
                    }`}
                  >
                    <Droplets className="h-3 w-3" />
                    {log.entry_type === 'refuel' ? 'Reloaded' : 'Island trip'}
                  </span>
                </td>
                <td className="p-3">{log.trip_label ?? '—'}</td>
                <td className="p-3">{Number(log.litres).toFixed(1)}</td>
                {showCost ? <td className="p-3">{money(log.price_per_litre, currency)}</td> : null}
                {showCost ? <td className="p-3 font-black">{money(log.total_cost, currency)}</td> : null}
                <td className="p-3">{log.tank_level_after_pct === null ? '—' : `${log.tank_level_after_pct}%`}</td>
                <td className="p-3 text-neutral-600">{log.notes ?? '—'}</td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td className="p-4 font-bold text-neutral-500" colSpan={9}>
                  No fuel entries in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RepairTable({
  repairs,
  currency,
  showCost,
  canClose,
  onEdit,
}: {
  repairs: Repair[];
  currency: string;
  showCost: boolean;
  canClose: boolean;
  onEdit: (repair: Repair) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
      <table className="w-full min-w-[860px] text-left">
        <thead className="bg-paper text-sm">
          <tr>
            <th className="p-3">Reported</th>
            <th className="p-3">Boat</th>
            <th className="p-3">Issue</th>
            <th className="p-3">Category</th>
            <th className="p-3">Damaged on</th>
            <th className="p-3">Fixed on</th>
            <th className="p-3">Days down</th>
            <th className="p-3">Status</th>
            {showCost ? <th className="p-3">Cost</th> : null}
            {canClose ? <th className="p-3"></th> : null}
          </tr>
        </thead>
        <tbody>
          {repairs.map((repair) => {
            const down =
              repair.fixed_date && repair.damaged_on
                ? Math.max(
                    0,
                    Math.round(
                      (new Date(repair.fixed_date).getTime() - new Date(repair.damaged_on).getTime()) / 86400000,
                    ),
                  )
                : null;
            return (
              <tr key={repair.id} className="border-t border-line text-sm font-semibold">
                <td className="p-3">{repair.reported_date}</td>
                <td className="p-3 font-black">{repair.boats?.code ?? '—'}</td>
                <td className="p-3">
                  <span className="font-black">{repair.issue_title}</span>
                  {repair.is_recurring ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-xl bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800">
                      <Repeat className="h-3 w-3" /> Same as before
                    </span>
                  ) : null}
                  {repair.issue_details ? (
                    <p className="mt-1 max-w-md text-xs font-medium text-neutral-600">{repair.issue_details}</p>
                  ) : null}
                </td>
                <td className="p-3 capitalize">{repair.issue_category.replace('_', ' ')}</td>
                <td className="p-3">{repair.damaged_on ?? '—'}</td>
                <td className="p-3">{repair.fixed_date ?? '—'}</td>
                <td className="p-3">{down === null ? '—' : down}</td>
                <td className="p-3">
                  <span
                    className={`rounded-xl px-2 py-1 text-xs font-black ${
                      repair.status === 'fixed'
                        ? 'bg-teal-50 text-accent'
                        : repair.status === 'cancelled'
                          ? 'bg-neutral-100 text-neutral-600'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {repair.status.replace('_', ' ')}
                  </span>
                  {repair.out_of_service && repair.status !== 'fixed' ? (
                    <span className="ml-1 rounded-xl bg-red-50 px-2 py-1 text-xs font-black text-danger">Boat parked</span>
                  ) : null}
                </td>
                {showCost ? <td className="p-3 font-black">{money(repair.cost, currency)}</td> : null}
                {canClose ? (
                  <td className="p-3">
                    <button type="button" className={secondaryButtonClass} onClick={() => onEdit(repair)}>
                      Update
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
          {repairs.length === 0 ? (
            <tr>
              <td className="p-4 font-bold text-neutral-500" colSpan={10}>
                No repair records yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FuelForm({
  boats,
  employees,
  onClose,
  onSaved,
}: {
  boats: Boat[];
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [boatId, setBoatId] = useState(boats[0]?.id ?? '');
  const [logDate, setLogDate] = useState(todayIso);
  const [entryType, setEntryType] = useState<'trip_usage' | 'refuel'>('trip_usage');
  const [tripLabel, setTripLabel] = useState('');
  const [litres, setLitres] = useState('');
  const [price, setPrice] = useState('');
  const [tank, setTank] = useState('');
  const [handledBy, setHandledBy] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const total = (Number(litres) || 0) * (Number(price) || 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!boatId) { toast.error('Choose a boat.'); return; }
    setBusy(true);
    const { error } = await supabase.from('boat_fuel_logs').insert({
      boat_id: boatId,
      log_date: logDate,
      entry_type: entryType,
      trip_label: tripLabel || null,
      entered_island: entryType === 'trip_usage',
      litres: Number(litres) || 0,
      price_per_litre: Number(price) || 0,
      total_cost: Number(total.toFixed(2)),
      tank_level_after_pct: tank === '' ? null : Number(tank),
      handled_by_employee_id: handledBy || null,
      notes: notes || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Fuel entry saved.');
    onSaved();
  }

  return (
    <Modal
      title="Fuel entry"
      onClose={onClose}
      footer={
        <button type="submit" form="fuel-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving...' : 'Save fuel entry'}
        </button>
      }
    >
      <form id="fuel-form" onSubmit={submit} className="grid gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-shell p-1 text-sm font-black">
          <button
            type="button"
            onClick={() => setEntryType('trip_usage')}
            className={`rounded-xl px-3 py-2.5 ${entryType === 'trip_usage' ? 'bg-accent text-white' : ''}`}
          >
            Used going to island
          </button>
          <button
            type="button"
            onClick={() => setEntryType('refuel')}
            className={`rounded-xl px-3 py-2.5 ${entryType === 'refuel' ? 'bg-accent text-white' : ''}`}
          >
            Reloaded / refilled
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Boat">
            <select className={inputClass} value={boatId} onChange={(e) => setBoatId(e.target.value)} required>
              <option value="">Choose boat</option>
              {boats.map((boat) => (
                <option key={boat.id} value={boat.id}>
                  {boat.code}{boat.name ? ` · ${boat.name}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
          </Field>
          <Field label="Petrol volume (litres)">
            <input type="number" step="0.1" min="0" inputMode="decimal" className={inputClass} value={litres} onChange={(e) => setLitres(e.target.value)} required />
          </Field>
          <Field label="Price per litre">
            <input type="number" step="0.01" min="0" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Field label="Trip label (optional)">
            <input className={inputClass} value={tripLabel} onChange={(e) => setTripLabel(e.target.value)} placeholder="Morning run" />
          </Field>
          <Field label="Tank level after (%)">
            <input type="number" min="0" max="100" className={inputClass} value={tank} onChange={(e) => setTank(e.target.value)} />
          </Field>
          <Field label="Handled by">
            <select className={inputClass} value={handledBy} onChange={(e) => setHandledBy(e.target.value)}>
              <option value="">Not recorded</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <p className="rounded-2xl bg-shell px-4 py-3 text-sm font-black">
          Total cost: {total.toFixed(2)}
        </p>
      </form>
    </Modal>
  );
}

function RepairForm({
  boats,
  employees,
  repairs,
  existing,
  onClose,
  onSaved,
}: {
  boats: Boat[];
  employees: Employee[];
  repairs: Repair[];
  existing: Repair | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [boatId, setBoatId] = useState(existing?.boat_id ?? boats[0]?.id ?? '');
  const [title, setTitle] = useState(existing?.issue_title ?? '');
  const [category, setCategory] = useState<Repair['issue_category']>(existing?.issue_category ?? 'engine');
  const [details, setDetails] = useState(existing?.issue_details ?? '');
  const [severity, setSeverity] = useState<Repair['severity']>(existing?.severity ?? 'medium');
  const [damagedOn, setDamagedOn] = useState(existing?.damaged_on ?? todayIso());
  const [reportedDate, setReportedDate] = useState(existing?.reported_date ?? todayIso());
  const [status, setStatus] = useState<Repair['status']>(existing?.status ?? 'reported');
  const [fixedDate, setFixedDate] = useState(existing?.fixed_date ?? '');
  const [cost, setCost] = useState(existing ? String(existing.cost) : '');
  const [vendor, setVendor] = useState(existing?.vendor ?? '');
  const [outOfService, setOutOfService] = useState(existing?.out_of_service ?? false);
  const [reportedBy, setReportedBy] = useState(existing?.reported_by_employee_id ?? '');
  const [linkedRepair, setLinkedRepair] = useState(existing?.previous_repair_id ?? '');
  const [busy, setBusy] = useState(false);

  // Prior jobs on the same boat in the same category: this is the "is it the
  // same problem as last time" answer, shown before the record is saved.
  const priorJobs = useMemo(
    () =>
      repairs.filter(
        (repair) => repair.boat_id === boatId && repair.issue_category === category && repair.id !== existing?.id,
      ),
    [boatId, category, existing?.id, repairs],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!boatId || !title.trim()) { toast.error('Boat and issue are required.'); return; }
    setBusy(true);
    const payload = {
      boat_id: boatId,
      reported_date: reportedDate,
      damaged_on: damagedOn || null,
      issue_title: title.trim(),
      issue_category: category,
      issue_details: details || null,
      severity,
      status,
      cost: Number(cost) || 0,
      vendor: vendor || null,
      fixed_date: status === 'fixed' ? (fixedDate || todayIso()) : null,
      out_of_service: outOfService,
      previous_repair_id: linkedRepair || null,
      reported_by_employee_id: reportedBy || null,
    };
    const { error } = existing
      ? await supabase.from('boat_repairs').update(payload).eq('id', existing.id)
      : await supabase.from('boat_repairs').insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(existing ? 'Repair updated.' : 'Repair recorded.');
    onSaved();
  }

  return (
    <Modal
      title={existing ? 'Update repair' : 'Report boat damage'}
      onClose={onClose}
      footer={
        <button type="submit" form="repair-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving...' : existing ? 'Save changes' : 'Save repair record'}
        </button>
      }
    >
      <form id="repair-form" onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Boat">
            <select className={inputClass} value={boatId} onChange={(e) => setBoatId(e.target.value)} required>
              <option value="">Choose boat</option>
              {boats.map((boat) => (
                <option key={boat.id} value={boat.id}>{boat.code}{boat.name ? ` · ${boat.name}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Repair['issue_category'])}>
              {categories.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="What is the problem">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Engine overheating" />
        </Field>
        <Field label="Details">
          <textarea className={inputClass} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>

        {priorJobs.length > 0 ? (
          <div className="rounded-2xl border border-warning bg-amber-50 p-3">
            <p className="flex items-center gap-2 text-sm font-black text-amber-900">
              <Repeat className="h-4 w-4" /> This boat had {priorJobs.length} earlier {category.replace('_', ' ')} job(s)
            </p>
            <select
              className={`${inputClass} mt-2`}
              value={linkedRepair}
              onChange={(e) => setLinkedRepair(e.target.value)}
            >
              <option value="">Not the same problem</option>
              {priorJobs.map((repair) => (
                <option key={repair.id} value={repair.id}>
                  {repair.reported_date} · {repair.issue_title}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Damaged on">
            <input type="date" className={inputClass} value={damagedOn} onChange={(e) => setDamagedOn(e.target.value)} />
          </Field>
          <Field label="Reported on">
            <input type="date" className={inputClass} value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} />
          </Field>
          <Field label="Severity">
            <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as Repair['severity'])}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as Repair['status'])}>
              <option value="reported">Reported</option>
              <option value="in_progress">Being repaired</option>
              <option value="fixed">Fixed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          {status === 'fixed' ? (
            <Field label="Fixed on">
              <input type="date" className={inputClass} value={fixedDate} onChange={(e) => setFixedDate(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Repair cost">
            <input type="number" step="0.01" min="0" inputMode="decimal" className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Workshop / vendor">
            <input className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label="Reported by">
            <select className={inputClass} value={reportedBy} onChange={(e) => setReportedBy(e.target.value)}>
              <option value="">Not recorded</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 rounded-2xl bg-shell px-4 py-3 text-sm font-black">
          <input type="checkbox" checked={outOfService} onChange={(e) => setOutOfService(e.target.checked)} />
          Boat cannot sail until this is fixed
        </label>
      </form>
    </Modal>
  );
}
