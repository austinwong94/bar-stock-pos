import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Fuel, Plus, RefreshCw, Repeat, Route, Wrench } from 'lucide-react';
import { PageHeader, Stat, Panel, Badge, EmptyState } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadBoats, loadEmployees, readErrorMessage, todayIso } from '../../lib/opsData';
import { money } from '../../lib/format';
import type {
  Boat,
  BoatTrip,
  Employee,
  FuelPeriodTotals,
  FuelPurchase,
  FuelReconciliationRow,
  Repair,
  TripType,
} from '../../lib/platformTypes';
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

const tripTypes: Array<[TripType, string]> = [
  ['island_run', 'Island run'],
  ['extra_run', 'Extra run'],
  ['emergency', 'Emergency run'],
  ['maintenance_run', 'Maintenance / repositioning'],
  ['other', 'Other'],
];

const tripLabel = (type: string) => tripTypes.find(([value]) => value === type)?.[1] ?? type;

function firstOfMonth() {
  return `${todayIso().slice(0, 8)}01`;
}

export default function BoatMaintenance({ settings }: { settings: SettingsMap }) {
  const toast = useToast();
  const { can } = useAccess();
  const currency = String(settings.currency_symbol ?? 'MYR');

  const [tab, setTab] = useState<'trips' | 'fuel' | 'repairs'>('trips');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [trips, setTrips] = useState<BoatTrip[]>([]);
  const [purchases, setPurchases] = useState<FuelPurchase[]>([]);
  const [reconciliation, setReconciliation] = useState<FuelReconciliationRow[]>([]);
  const [totals, setTotals] = useState<FuelPeriodTotals | null>(null);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [tripOpen, setTripOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<BoatTrip | null>(null);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [loading, setLoading] = useState(true);

  const showCost = can('maintenance.cost.view');
  const canRecord = can('maintenance.fuel.record');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [boatRows, employeeRows, tripResult, fuelResult, reconResult, totalResult, repairResult] = await Promise.all([
        loadBoats(true),
        loadEmployees(),
        supabase
          .from('boat_trips')
          .select('*, boats(code,name)')
          .gte('service_date', from)
          .lte('service_date', to)
          .order('service_date', { ascending: false }),
        supabase
          .from('fuel_purchases')
          .select('*')
          .gte('purchase_date', from)
          .lte('purchase_date', to)
          .order('purchase_date', { ascending: false }),
        supabase.rpc('fuel_reconciliation', { p_from: from, p_to: to }),
        supabase.rpc('fuel_period_totals', { p_from: from, p_to: to }),
        supabase.from('boat_repairs').select('*, boats(code,name)').order('reported_date', { ascending: false }).limit(300),
      ]);
      setBoats(boatRows);
      setEmployees(employeeRows);
      setTrips((tripResult.data ?? []) as BoatTrip[]);
      setPurchases((fuelResult.data ?? []) as FuelPurchase[]);
      setReconciliation((reconResult.data ?? []) as FuelReconciliationRow[]);
      const totalRows = (totalResult.data ?? []) as FuelPeriodTotals[];
      setTotals(Array.isArray(totalRows) ? totalRows[0] ?? null : (totalRows as FuelPeriodTotals));
      setRepairs((repairResult.data ?? []) as Repair[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load maintenance records.'));
    }
    setLoading(false);
  }, [from, to, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function syncTrips() {
    const { data, error } = await supabase.rpc('sync_boat_trips', { p_service_date: to });
    if (error) { toast.error(error.message); return; }
    toast.success(data ? `${data} trip(s) added from the boat board.` : 'Trip log is already up to date.');
    void refresh();
  }

  const openRepairs = repairs.filter((repair) => repair.status === 'reported' || repair.status === 'in_progress');
  const emergencyTrips = trips.filter((trip) => trip.trip_type === 'emergency');
  const variance = totals?.variance_pct ?? null;
  const varianceHigh = variance !== null && Math.abs(variance) > 20;

  return (
    <>
      <PageHeader
        title="Boat Maintenance"
        subtitle="Fuel is bought for the whole fleet, so consumption is estimated from the trips each boat actually made."
        actions={
          <>
            {canRecord ? (
              <>
                <button type="button" className={buttonClass} onClick={() => { setEditingTrip(null); setTripOpen(true); }}>
                  <Route className="h-4 w-4" /> Log a trip
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => setFuelOpen(true)}>
                  <Fuel className="h-4 w-4" /> Fuel bought
                </button>
              </>
            ) : null}
            {can('maintenance.repair.record') ? (
              <button type="button" className={secondaryButtonClass} onClick={() => { setEditingRepair(null); setRepairOpen(true); }}>
                <Wrench className="h-4 w-4" /> Report damage
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="ml-auto flex gap-0.5 rounded-lg bg-shell p-0.5 text-sm font-semibold">
          {(['trips', 'fuel', 'repairs'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded px-3.5 py-1.5 capitalize transition ${tab === value ? 'bg-surface text-ink' : 'text-muted'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Stat label="Trips in period" value={String(totals?.trips ?? trips.length)} hint={`${emergencyTrips.length} emergency`} />
        <Stat label="Fuel bought" value={`${Number(totals?.litres_bought ?? 0).toFixed(0)} L`} />
        <Stat
          label="Estimated use"
          value={`${Number(totals?.litres_estimated ?? 0).toFixed(0)} L`}
          hint={variance === null ? 'no baseline set' : `${variance > 0 ? '+' : ''}${variance}% vs bought`}
          tone={varianceHigh ? 'warn' : 'default'}
        />
        {showCost ? <Stat label="Fuel spend" value={money(totals?.cost_bought ?? 0, currency)} /> : null}
      </div>

      {varianceHigh ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-2.5 text-sm font-medium text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {Number(totals?.litres_bought ?? 0).toFixed(0)} L was bought but the logged trips only account for about{' '}
            {Number(totals?.litres_estimated ?? 0).toFixed(0)} L. Either trips are missing from the log, or more fuel
            went out than the boats used.
          </span>
        </p>
      ) : null}

      {loading ? <p className="py-6 text-center text-sm font-medium text-muted">Loading…</p> : null}

      {tab === 'trips' ? (
        <>
          <Panel
            title="Trips by boat"
            actions={
              canRecord ? (
                <button type="button" className={secondaryButtonClass} onClick={syncTrips}>
                  <RefreshCw className="h-4 w-4" /> Pull from boat board
                </button>
              ) : null
            }
            className="mb-3"
          >
            <div className="table-scroll">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-paper">
                  <tr className="eyebrow">
                    <th className="px-3.5 py-2">Boat</th>
                    <th className="px-3.5 py-2">Trips</th>
                    <th className="px-3.5 py-2">Emergency</th>
                    <th className="px-3.5 py-2">Pax carried</th>
                    <th className="px-3.5 py-2">L / trip</th>
                    <th className="px-3.5 py-2">Estimated L</th>
                    <th className="px-3.5 py-2">Share</th>
                    {showCost ? <th className="px-3.5 py-2">Est. cost</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reconciliation.map((row) => (
                    <tr key={row.boat_id}>
                      <td className="px-3.5 py-2.5 font-semibold text-ink">{row.boat_code}</td>
                      <td className="px-3.5 py-2.5 tabular">{row.trips}</td>
                      <td className="px-3.5 py-2.5 tabular">
                        {row.emergency_trips > 0 ? <Badge tone="warn">{row.emergency_trips}</Badge> : '—'}
                      </td>
                      <td className="px-3.5 py-2.5 tabular">{row.pax_carried}</td>
                      <td className="px-3.5 py-2.5 tabular">
                        {row.litres_per_trip > 0 ? Number(row.litres_per_trip).toFixed(1) : <span className="text-muted">not set</span>}
                      </td>
                      <td className="px-3.5 py-2.5 tabular font-semibold">{Number(row.estimated_litres).toFixed(1)}</td>
                      <td className="px-3.5 py-2.5 tabular">{Number(row.estimated_share_pct).toFixed(0)}%</td>
                      {showCost ? <td className="px-3.5 py-2.5 tabular">{money(row.estimated_cost, currency)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={`Trip log (${trips.length})`}>
            <div className="table-scroll">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-paper">
                  <tr className="eyebrow">
                    <th className="px-3.5 py-2">Date</th>
                    <th className="px-3.5 py-2">Boat</th>
                    <th className="px-3.5 py-2">Type</th>
                    <th className="px-3.5 py-2">Out</th>
                    <th className="px-3.5 py-2">Pax</th>
                    <th className="px-3.5 py-2">Purpose</th>
                    <th className="px-3.5 py-2">Source</th>
                    {canRecord ? <th className="px-3.5 py-2"></th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {trips.map((trip) => (
                    <tr key={trip.id} className={trip.trip_type === 'emergency' ? 'bg-alert/[0.04]' : ''}>
                      <td className="px-3.5 py-2.5 tabular">{trip.service_date}</td>
                      <td className="px-3.5 py-2.5 font-semibold text-ink">{trip.boats?.code ?? '—'}</td>
                      <td className="px-3.5 py-2.5">
                        <Badge tone={trip.trip_type === 'emergency' ? 'bad' : trip.trip_type === 'island_run' ? 'accent' : 'neutral'}>
                          {tripLabel(trip.trip_type)}
                        </Badge>
                      </td>
                      <td className="px-3.5 py-2.5 tabular">{trip.departure_time?.slice(0, 5) ?? '—'}</td>
                      <td className="px-3.5 py-2.5 tabular">{trip.pax_count}</td>
                      <td className="px-3.5 py-2.5 text-muted">{trip.purpose ?? '—'}</td>
                      <td className="px-3.5 py-2.5 text-xs text-muted">{trip.auto_generated ? 'From boat board' : 'Entered by hand'}</td>
                      {canRecord ? (
                        <td className="px-3.5 py-2.5">
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => { setEditingTrip(trip); setTripOpen(true); }}
                          >
                            Edit
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trips.length === 0 && !loading ? (
              <div className="p-4">
                <EmptyState>No trips logged in this period. Use “Pull from boat board” to bring in the scheduled runs.</EmptyState>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}

      {tab === 'fuel' ? (
        <Panel title={`Fuel bought (${purchases.length})`}>
          <div className="table-scroll">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-paper">
                <tr className="eyebrow">
                  <th className="px-3.5 py-2">Date</th>
                  <th className="px-3.5 py-2">Litres</th>
                  {showCost ? <th className="px-3.5 py-2">Price / L</th> : null}
                  {showCost ? <th className="px-3.5 py-2">Total</th> : null}
                  <th className="px-3.5 py-2">Supplier</th>
                  <th className="px-3.5 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="px-3.5 py-2.5 tabular">{purchase.purchase_date}</td>
                    <td className="px-3.5 py-2.5 tabular font-semibold">{Number(purchase.litres).toFixed(1)}</td>
                    {showCost ? <td className="px-3.5 py-2.5 tabular">{money(purchase.price_per_litre, currency)}</td> : null}
                    {showCost ? <td className="px-3.5 py-2.5 tabular font-semibold">{money(purchase.total_cost, currency)}</td> : null}
                    <td className="px-3.5 py-2.5">{purchase.supplier ?? '—'}</td>
                    <td className="px-3.5 py-2.5 text-muted">{purchase.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {purchases.length === 0 && !loading ? (
            <div className="p-4"><EmptyState>No fuel purchases recorded in this period.</EmptyState></div>
          ) : null}
        </Panel>
      ) : null}

      {tab === 'repairs' ? (
        <RepairTable
          repairs={repairs}
          currency={currency}
          showCost={showCost}
          canClose={can('maintenance.repair.close') || can('maintenance.manage')}
          openCount={openRepairs.length}
          onEdit={(repair) => { setEditingRepair(repair); setRepairOpen(true); }}
        />
      ) : null}

      {tripOpen ? (
        <TripForm
          boats={boats}
          trip={editingTrip}
          defaultDate={to}
          onClose={() => setTripOpen(false)}
          onSaved={() => { setTripOpen(false); void refresh(); }}
        />
      ) : null}

      {fuelOpen ? (
        <FuelForm
          employees={employees}
          defaultDate={to}
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

function TripForm({
  boats,
  trip,
  defaultDate,
  onClose,
  onSaved,
}: {
  boats: Boat[];
  trip: BoatTrip | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [serviceDate, setServiceDate] = useState(trip?.service_date ?? defaultDate);
  const [boatId, setBoatId] = useState(trip?.boat_id ?? boats[0]?.id ?? '');
  const [type, setType] = useState<TripType>(trip?.trip_type ?? 'extra_run');
  const [departure, setDeparture] = useState(trip?.departure_time?.slice(0, 5) ?? '');
  const [returnTime, setReturnTime] = useState(trip?.return_time?.slice(0, 5) ?? '');
  const [pax, setPax] = useState(String(trip?.pax_count ?? 0));
  const [purpose, setPurpose] = useState(trip?.purpose ?? '');
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!boatId) { toast.error('Choose a boat.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('save_boat_trip', {
      p_id: trip?.id ?? null,
      p_service_date: serviceDate,
      p_boat_id: boatId,
      p_trip_type: type,
      p_departure_time: departure,
      p_return_time: returnTime,
      p_pax_count: Number(pax) || 0,
      p_purpose: purpose,
      p_notes: notes,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Trip saved.');
    onSaved();
  }

  return (
    <Modal
      title={trip ? 'Edit trip' : 'Log a boat trip'}
      onClose={onClose}
      footer={
        <button type="submit" form="trip-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save trip'}
        </button>
      }
    >
      <form id="trip-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <input type="date" className={inputClass} value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />
        </Field>
        <Field label="Boat">
          <select className={inputClass} value={boatId} onChange={(e) => setBoatId(e.target.value)} required>
            <option value="">Choose boat</option>
            {boats.map((boat) => (
              <option key={boat.id} value={boat.id}>{boat.code}{boat.name ? ` · ${boat.name}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="What kind of trip" hint="Emergency runs are counted separately in the fuel estimate.">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TripType)}>
            {tripTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="How many people on board">
          <input type="number" min="0" className={inputClass} value={pax} onChange={(e) => setPax(e.target.value)} />
        </Field>
        <Field label="Left at">
          <input type="time" className={inputClass} value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </Field>
        <Field label="Back at">
          <input type="time" className={inputClass} value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Why the boat went out">
            <input className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Took a sick guest back to the mainland" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function FuelForm({
  employees,
  defaultDate,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [purchaseDate, setPurchaseDate] = useState(defaultDate);
  const [litres, setLitres] = useState('');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [fuelType, setFuelType] = useState<'petrol' | 'diesel'>('petrol');
  const [collectedBy, setCollectedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const total = (Number(litres) || 0) * (Number(price) || 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('fuel_purchases').insert({
      purchase_date: purchaseDate,
      litres: Number(litres) || 0,
      price_per_litre: Number(price) || 0,
      total_cost: Number(total.toFixed(2)),
      supplier: supplier || null,
      fuel_type: fuelType,
      collected_by_employee_id: collectedBy || null,
      notes: notes || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Fuel purchase recorded.');
    onSaved();
  }

  return (
    <Modal
      title="Fuel bought for the fleet"
      onClose={onClose}
      footer={
        <button type="submit" form="fuel-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving…' : 'Save purchase'}
        </button>
      }
    >
      <form id="fuel-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <p className="sm:col-span-2 rounded-lg bg-shell px-3 py-2.5 text-xs font-medium text-muted">
          Fuel is bought for the whole fleet, not per boat. Record what was bought here; the system works out each
          boat&rsquo;s share from the trips it made.
        </p>
        <Field label="Date bought">
          <input type="date" className={inputClass} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
        </Field>
        <Field label="Fuel">
          <select className={inputClass} value={fuelType} onChange={(e) => setFuelType(e.target.value as 'petrol' | 'diesel')}>
            <option value="petrol">Petrol</option>
            <option value="diesel">Diesel</option>
          </select>
        </Field>
        <Field label="Litres">
          <input type="number" step="0.1" min="0" inputMode="decimal" className={inputClass} value={litres} onChange={(e) => setLitres(e.target.value)} required />
        </Field>
        <Field label="Price per litre">
          <input type="number" step="0.01" min="0" inputMode="decimal" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Field>
        <Field label="Bought from">
          <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Collected by">
          <select className={inputClass} value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)}>
            <option value="">Not recorded</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <p className="sm:col-span-2 rounded-lg border border-line px-3 py-2.5 text-sm font-semibold">
          Total: {total.toFixed(2)}
        </p>
      </form>
    </Modal>
  );
}

function RepairTable({
  repairs,
  currency,
  showCost,
  canClose,
  openCount,
  onEdit,
}: {
  repairs: Repair[];
  currency: string;
  showCost: boolean;
  canClose: boolean;
  openCount: number;
  onEdit: (repair: Repair) => void;
}) {
  return (
    <Panel title={`Repairs — ${openCount} still open`}>
      <div className="table-scroll">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-paper">
            <tr className="eyebrow">
              <th className="px-3.5 py-2">Reported</th>
              <th className="px-3.5 py-2">Boat</th>
              <th className="px-3.5 py-2">Issue</th>
              <th className="px-3.5 py-2">Category</th>
              <th className="px-3.5 py-2">Fixed</th>
              <th className="px-3.5 py-2">Status</th>
              {showCost ? <th className="px-3.5 py-2">Cost</th> : null}
              {canClose ? <th className="px-3.5 py-2"></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {repairs.map((repair) => (
              <tr key={repair.id}>
                <td className="px-3.5 py-2.5 tabular">{repair.reported_date}</td>
                <td className="px-3.5 py-2.5 font-semibold text-ink">{repair.boats?.code ?? '—'}</td>
                <td className="px-3.5 py-2.5">
                  <span className="font-semibold text-ink">{repair.issue_title}</span>
                  {repair.is_recurring ? (
                    <span className="ml-2 inline-flex"><Badge tone="warn"><Repeat className="h-3 w-3" /> repeat</Badge></span>
                  ) : null}
                  {repair.issue_details ? (
                    <p className="mt-0.5 max-w-md text-xs text-muted">{repair.issue_details}</p>
                  ) : null}
                </td>
                <td className="px-3.5 py-2.5 capitalize text-muted">{repair.issue_category.replace('_', ' ')}</td>
                <td className="px-3.5 py-2.5 tabular">{repair.fixed_date ?? '—'}</td>
                <td className="px-3.5 py-2.5">
                  <Badge tone={repair.status === 'fixed' ? 'good' : repair.status === 'cancelled' ? 'neutral' : 'warn'}>
                    {repair.status.replace('_', ' ')}
                  </Badge>
                  {repair.out_of_service && repair.status !== 'fixed' ? (
                    <span className="ml-1 inline-flex"><Badge tone="bad">boat parked</Badge></span>
                  ) : null}
                </td>
                {showCost ? <td className="px-3.5 py-2.5 tabular">{money(repair.cost, currency)}</td> : null}
                {canClose ? (
                  <td className="px-3.5 py-2.5">
                    <button type="button" className={secondaryButtonClass} onClick={() => onEdit(repair)}>Update</button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {repairs.length === 0 ? <div className="p-4"><EmptyState>No repair records yet.</EmptyState></div> : null}
    </Panel>
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

  const priorJobs = useMemo(
    () => repairs.filter((repair) => repair.boat_id === boatId && repair.issue_category === category && repair.id !== existing?.id),
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
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save repair'}
        </button>
      }
    >
      <form id="repair-form" onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Boat">
            <select className={inputClass} value={boatId} onChange={(e) => setBoatId(e.target.value)} required>
              <option value="">Choose boat</option>
              {boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.code}{boat.name ? ` · ${boat.name}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Repair['issue_category'])}>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
          <div className="rounded-lg border border-warning/40 bg-warning/[0.06] p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <Repeat className="h-4 w-4" /> This boat had {priorJobs.length} earlier {category.replace('_', ' ')} job(s)
            </p>
            <select className={`${inputClass} mt-2`} value={linkedRepair} onChange={(e) => setLinkedRepair(e.target.value)}>
              <option value="">Not the same problem</option>
              {priorJobs.map((repair) => (
                <option key={repair.id} value={repair.id}>{repair.reported_date} · {repair.issue_title}</option>
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
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 rounded-lg bg-shell px-3 py-2.5 text-sm font-semibold">
          <input type="checkbox" checked={outOfService} onChange={(e) => setOutOfService(e.target.checked)} />
          Boat cannot sail until this is fixed
        </label>
      </form>
    </Modal>
  );
}
