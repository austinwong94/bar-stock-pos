import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, History, Plus, Search, Trash2, Users } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass, dangerButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { isDemoMode, supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import {
  bookingStatusLabels,
  loadAgencies,
  loadPickupLocations,
  readErrorMessage,
  sourceLabels,
  todayIso,
} from '../../lib/opsData';
import { csvEscape } from '../../lib/format';
import type { AgeBand, Agency, Booking, BookingHistoryRow, PickupLocation, Tourist } from '../../lib/platformTypes';

type PersonRow = {
  id?: string;
  full_name: string;
  phone: string;
  nationality: string;
  age_band: AgeBand;
  passport_no: string;
};

const emptyPerson = (): PersonRow => ({
  full_name: '',
  phone: '',
  nationality: '',
  age_band: 'adult',
  passport_no: '',
});

export default function Bookings() {
  const toast = useToast();
  const { can } = useAccess();

  const [date, setDate] = useState(todayIso);
  const [useDateFilter, setUseDateFilter] = useState(true);
  const [search, setSearch] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Booking | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Booking | null>(null);
  const [history, setHistory] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);

  const canSeeAll = can('guests.booking.view_all');
  const canCreate = can('guests.booking.create');
  const canDelete = can('guests.booking.delete');
  const canExport = can('guests.export');
  const canSeePrivate = can('guests.contact.view');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const touristSelect = canSeePrivate ? 'tourists(*, tourist_private(*))' : 'tourists(*)';
      let query = supabase
        .from('bookings')
        .select(`*, agencies(id,name,source_type), ${touristSelect}`)
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (useDateFilter) query = query.eq('service_date', date);
      const [bookingResult, agencyRows, locationRows] = await Promise.all([
        query,
        canSeeAll ? loadAgencies() : Promise.resolve([]),
        loadPickupLocations().catch(() => []),
      ]);
      if (bookingResult.error) throw bookingResult.error;
      setBookings((bookingResult.data ?? []) as Booking[]);
      setAgencies(agencyRows);
      setLocations(locationRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load bookings.'));
    }
    setLoading(false);
  }, [canSeeAll, canSeePrivate, date, toast, useDateFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bookings;
    return bookings.filter((booking) =>
      [
        booking.booking_ref,
        booking.lead_name,
        booking.lead_phone,
        booking.pickup_hotel_name,
        booking.external_ref,
        booking.agencies?.name,
        ...(booking.tourists ?? []).map((tourist) => tourist.full_name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [bookings, search]);

  const totals = useMemo(() => {
    const pax = filtered.reduce((sum, booking) => sum + booking.pax_total, 0);
    const bySource = filtered.reduce<Record<string, number>>((map, booking) => {
      map[booking.source_type] = (map[booking.source_type] ?? 0) + booking.pax_total;
      return map;
    }, {});
    return { pax, bySource };
  }, [filtered]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Deleting a customer record always asks why, and the reason is stored on
  // the audit row. This is the control against an outside agent quietly
  // clearing out company data.
  async function remove(booking: Booking, reason: string) {
    const { error } = await supabase.rpc('delete_booking', {
      p_booking_id: booking.id,
      p_reason: reason,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Booking deleted. The reason has been recorded.');
    setDeleting(null);
    void refresh();
  }

  function exportCsv() {
    if (isDemoMode) {
      toast.error('Downloads are blocked inside the demo preview. Export works in the real deployment.');
      return;
    }
    const header = ['Booking', 'Arrival', 'Source', 'Agency', 'Lead', 'Lead phone', 'Pickup', 'Pax', 'Guest', 'Guest phone', 'Type'];
    const lines = [header.map(csvEscape).join(',')];
    filtered.forEach((booking) => {
      (booking.tourists ?? []).forEach((tourist) => {
        lines.push(
          [
            booking.booking_ref,
            booking.service_date,
            sourceLabels[booking.source_type] ?? booking.source_type,
            booking.agencies?.name ?? '',
            booking.lead_name,
            booking.lead_phone ?? '',
            booking.pickup_hotel_name ?? '',
            booking.pax_total,
            tourist.full_name,
            tourist.phone ?? '',
            tourist.age_band,
          ]
            .map(csvEscape)
            .join(','),
        );
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lovely-paradise-guests-${useDateFilter ? date : 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Tourist Bookings"
        subtitle={
          canSeeAll
            ? 'Every booking from agents, OTAs, in-house and walk-ins. People who book together stay together.'
            : 'Bookings entered by your agency. Other sources are not visible to you.'
        }
        actions={
          <>
            {canCreate ? (
              <button type="button" className={buttonClass} onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" /> New booking
              </button>
            ) : null}
            {canExport ? (
              <button type="button" className={secondaryButtonClass} onClick={exportCsv}>
                <Download className="h-4 w-4" /> Export
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
        <Field label="Arrival date">
          <input type="date" className={inputClass} value={date} onChange={(e) => { setDate(e.target.value); setUseDateFilter(true); }} />
        </Field>
        <label className="flex h-11 items-center gap-2 rounded-2xl bg-shell px-3 text-sm font-black">
          <input type="checkbox" checked={!useDateFilter} onChange={(e) => setUseDateFilter(!e.target.checked)} />
          All dates
        </label>
        <div className="min-w-[12rem] flex-1">
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, phone, hotel, booking ref"
              />
            </div>
          </Field>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Bookings" value={String(filtered.length)} />
        <Stat label="Total pax" value={String(totals.pax)} tone="good" />
        {Object.entries(totals.bySource).slice(0, 2).map(([source, pax]) => (
          <Stat key={source} label={`${sourceLabels[source] ?? source} pax`} value={String(pax)} />
        ))}
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
        <table className="w-full min-w-[880px] text-left">
          <thead className="bg-paper text-sm">
            <tr>
              <th className="p-3 w-10"></th>
              <th className="p-3">Booking</th>
              <th className="p-3">Arrival</th>
              <th className="p-3">Lead guest</th>
              <th className="p-3">Source</th>
              <th className="p-3">Pickup</th>
              <th className="p-3">Pax</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                open={expanded.has(booking.id)}
                onToggle={() => toggle(booking.id)}
                onEdit={() => { setEditing(booking); setFormOpen(true); }}
                onDelete={canDelete ? () => setDeleting(booking) : undefined}
                onHistory={() => setHistory(booking)}
                showPassport={canSeePrivate}
              />
            ))}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td className="p-4 font-bold text-neutral-500" colSpan={9}>
                  No bookings for this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {deleting ? (
        <DeleteBookingDialog
          booking={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={(reason) => remove(deleting, reason)}
        />
      ) : null}

      {history ? <HistoryDialog booking={history} onClose={() => setHistory(null)} /> : null}

      {formOpen ? (
        <BookingForm
          booking={editing}
          agencies={agencies}
          locations={locations}
          canSetSource={canSeeAll}
          canSeePrivate={canSeePrivate}
          defaultDate={date}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void refresh(); }}
        />
      ) : null}
    </>
  );
}

function BookingRow({
  booking,
  open,
  onToggle,
  onEdit,
  onDelete,
  onHistory,
  showPassport,
}: {
  booking: Booking;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onHistory: () => void;
  showPassport: boolean;
}) {
  const people = [...(booking.tourists ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <>
      <tr className="border-t border-line text-sm font-semibold">
        <td className="p-3">
          <button type="button" onClick={onToggle} aria-label="Show guests" className="grid h-8 w-8 place-items-center rounded-xl bg-shell">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="p-3 font-black">{booking.booking_ref}</td>
        <td className="p-3">{booking.service_date}</td>
        <td className="p-3">
          <span className="font-black">{booking.lead_name}</span>
          {booking.lead_phone ? <p className="text-xs font-medium text-neutral-600">{booking.lead_phone}</p> : null}
        </td>
        <td className="p-3">
          <span className="rounded-xl bg-shell px-2 py-1 text-xs font-black">
            {sourceLabels[booking.source_type] ?? booking.source_type}
          </span>
          {booking.agencies?.name ? <p className="mt-1 text-xs font-medium text-neutral-600">{booking.agencies.name}</p> : null}
        </td>
        <td className="p-3">
          {booking.pickup_hotel_name ?? '—'}
          {booking.pickup_time ? <p className="text-xs font-medium text-neutral-600">{booking.pickup_time.slice(0, 5)}</p> : null}
        </td>
        <td className="p-3">
          <span className="inline-flex items-center gap-1 font-black">
            <Users className="h-4 w-4 text-accent" /> {booking.pax_total}
          </span>
        </td>
        <td className="p-3">
          <span className="rounded-xl bg-shell px-2 py-1 text-xs font-black text-accent">
            {bookingStatusLabels[booking.status] ?? booking.status}
          </span>
        </td>
        <td className="p-3">
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={onEdit}>Open</button>
            <button type="button" className={secondaryButtonClass} onClick={onHistory} aria-label="Change history">
              <History className="h-4 w-4" />
            </button>
            {onDelete ? (
              <button type="button" className={dangerButtonClass} onClick={onDelete} aria-label="Delete booking">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-line bg-shell/50">
          <td colSpan={9} className="px-3 py-2">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-accent">
              Travelling together · {people.length} guest(s)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-black text-neutral-600">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Name</th>
                    <th className="py-1 pr-3">Phone</th>
                    <th className="py-1 pr-3">Nationality</th>
                    <th className="py-1 pr-3">Type</th>
                    {showPassport ? <th className="py-1 pr-3">Passport</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {people.map((person, index) => (
                    <tr key={person.id} className="font-semibold">
                      <td className="py-1 pr-3 text-neutral-500">{index + 1}</td>
                      <td className="py-1 pr-3 font-black">
                        {person.full_name}
                        {person.is_lead ? <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">LEAD</span> : null}
                      </td>
                      <td className="py-1 pr-3">{person.phone ?? '—'}</td>
                      <td className="py-1 pr-3">{person.nationality ?? '—'}</td>
                      <td className="py-1 pr-3 capitalize">{person.age_band}</td>
                      {showPassport ? <td className="py-1 pr-3">{person.tourist_private?.passport_no ?? '—'}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BookingForm({
  booking,
  agencies,
  locations,
  canSetSource,
  canSeePrivate,
  defaultDate,
  onClose,
  onSaved,
}: {
  booking: Booking | null;
  agencies: Agency[];
  locations: PickupLocation[];
  canSetSource: boolean;
  canSeePrivate: boolean;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [serviceDate, setServiceDate] = useState(booking?.service_date ?? defaultDate);
  const [leadName, setLeadName] = useState(booking?.lead_name ?? '');
  const [leadPhone, setLeadPhone] = useState(booking?.lead_phone ?? '');
  const [sourceType, setSourceType] = useState(booking?.source_type ?? 'in_house');
  const [agencyId, setAgencyId] = useState(booking?.agency_id ?? '');
  const [externalRef, setExternalRef] = useState(booking?.external_ref ?? '');
  const [locationId, setLocationId] = useState(booking?.pickup_location_id ?? '');
  const [hotel, setHotel] = useState(booking?.pickup_hotel_name ?? '');
  const [area, setArea] = useState(booking?.pickup_area ?? '');
  const [pickupTime, setPickupTime] = useState(booking?.pickup_time?.slice(0, 5) ?? '');
  const [status, setStatus] = useState(booking?.status ?? 'confirmed');
  const [requests, setRequests] = useState(booking?.special_requests ?? '');
  const [people, setPeople] = useState<PersonRow[]>(() => initialPeople(booking));
  const [busy, setBusy] = useState(false);

  function updatePerson(index: number, patch: Partial<PersonRow>) {
    setPeople((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRows(count = 1) {
    setPeople((rows) => [...rows, ...Array.from({ length: count }, emptyPerson)]);
  }

  function removeRow(index: number) {
    setPeople((rows) => (rows.length === 1 ? [emptyPerson()] : rows.filter((_, i) => i !== index)));
  }

  // Paste a block straight out of Excel: tab separated columns, one guest a
  // line. This is how the team already keeps the list today.
  function handlePaste(event: React.ClipboardEvent, startIndex: number) {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim().length > 0);
    setPeople((rows) => {
      const next = [...rows];
      lines.forEach((line, offset) => {
        const cells = line.split('\t');
        const target = startIndex + offset;
        const base = next[target] ?? emptyPerson();
        next[target] = {
          ...base,
          full_name: (cells[0] ?? base.full_name).trim(),
          phone: (cells[1] ?? base.phone).trim(),
          nationality: (cells[2] ?? base.nationality).trim(),
          age_band: normalizeAgeBand(cells[3]) ?? base.age_band,
          passport_no: (cells[4] ?? base.passport_no).trim(),
        };
      });
      return next;
    });
  }

  function chooseLocation(id: string) {
    setLocationId(id);
    const match = locations.find((location) => location.id === id);
    if (match) {
      setHotel(match.name);
      setArea(match.area ?? '');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const filled = people.filter((person) => person.full_name.trim().length > 0);
    if (filled.length === 0) { toast.error('Add at least one guest name.'); return; }
    setBusy(true);

    const chosen = locations.find((location) => location.id === locationId);
    const payload: Record<string, unknown> = {
      id: booking?.id ?? '',
      service_date: serviceDate,
      lead_name: leadName.trim() || filled[0].full_name.trim(),
      lead_phone: leadPhone,
      source_type: sourceType,
      agency_id: agencyId,
      external_ref: externalRef,
      pickup_location_id: locationId,
      pickup_hotel_name: hotel,
      pickup_area: area,
      pickup_latitude: chosen?.latitude ?? booking?.pickup_latitude ?? '',
      pickup_longitude: chosen?.longitude ?? booking?.pickup_longitude ?? '',
      pickup_time: pickupTime,
      status,
      special_requests: requests,
    };

    const tourists = filled.map((person, index) => ({
      id: person.id ?? '',
      full_name: person.full_name.trim(),
      phone: person.phone,
      nationality: person.nationality,
      age_band: person.age_band,
      is_lead: index === 0,
      ...(canSeePrivate ? { private: { passport_no: person.passport_no } } : {}),
    }));

    const { error } = await supabase.rpc('save_booking', { p_booking: payload, p_tourists: tourists });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(booking ? 'Booking updated.' : `Booking saved with ${filled.length} guest(s).`);
    onSaved();
  }

  const paxSummary = people.filter((person) => person.full_name.trim()).length;

  return (
    <Modal
      title={booking ? `Booking ${booking.booking_ref}` : 'New booking'}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <p className="text-sm font-black">{paxSummary} guest(s) in this group</p>
          <button type="submit" form="booking-form" className={`${buttonClass} ml-auto`} disabled={busy}>
            {busy ? 'Saving...' : 'Save booking'}
          </button>
        </div>
      }
    >
      <form id="booking-form" onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrival date">
            <input type="date" className={inputClass} value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required />
          </Field>
          <Field label="Lead guest name">
            <input className={inputClass} value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Family / group name" />
          </Field>
          <Field label="Lead contact number">
            <input className={inputClass} value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} />
          </Field>
          <Field label="Your booking reference">
            <input className={inputClass} value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
          </Field>
          {canSetSource ? (
            <>
              <Field label="Source">
                <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value as Booking['source_type'])}>
                  {Object.entries(sourceLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Agency / OTA">
                <select className={inputClass} value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                  <option value="">None (in-house)</option>
                  {agencies.map((agency) => (
                    <option key={agency.id} value={agency.id}>{agency.name}</option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}
          <Field label="Hotel / pickup point">
            <select className={inputClass} value={locationId} onChange={(e) => chooseLocation(e.target.value)}>
              <option value="">Type it below instead</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.area ? ` · ${location.area}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hotel name (free text)">
            <input className={inputClass} value={hotel} onChange={(e) => setHotel(e.target.value)} />
          </Field>
          <Field label="Area">
            <input className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
          <Field label="Pickup time">
            <input type="time" className={inputClass} value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as Booking['status'])}>
              {Object.entries(bookingStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Special requests">
          <input className={inputClass} value={requests} onChange={(e) => setRequests(e.target.value)} />
        </Field>

        <div className="rounded-2xl border border-line bg-shell/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black">Everyone in this booking</p>
              <p className="text-xs font-semibold text-neutral-600">
                Paste straight from Excel: Name, Phone, Nationality, Adult/Child{canSeePrivate ? ', Passport' : ''}.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => addRows(1)}>
                <Plus className="h-4 w-4" /> Row
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => addRows(4)}>+4</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs font-black text-neutral-600">
                  <th className="pb-1 pr-2 w-8">#</th>
                  <th className="pb-1 pr-2">Full name</th>
                  <th className="pb-1 pr-2">Phone</th>
                  <th className="pb-1 pr-2">Nationality</th>
                  <th className="pb-1 pr-2">Type</th>
                  {canSeePrivate ? <th className="pb-1 pr-2">Passport</th> : null}
                  <th className="pb-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {people.map((person, index) => (
                  <tr key={person.id ?? index}>
                    <td className="pr-2 text-xs font-black text-neutral-500">{index + 1}</td>
                    <td className="pr-2 py-0.5">
                      <input
                        className={inputClass}
                        value={person.full_name}
                        onChange={(e) => updatePerson(index, { full_name: e.target.value })}
                        onPaste={(e) => handlePaste(e, index)}
                        placeholder={index === 0 ? 'Lead guest' : 'Guest name'}
                      />
                    </td>
                    <td className="pr-2 py-0.5">
                      <input className={inputClass} value={person.phone} onChange={(e) => updatePerson(index, { phone: e.target.value })} />
                    </td>
                    <td className="pr-2 py-0.5">
                      <input className={inputClass} value={person.nationality} onChange={(e) => updatePerson(index, { nationality: e.target.value })} />
                    </td>
                    <td className="pr-2 py-0.5">
                      <select
                        className={inputClass}
                        value={person.age_band}
                        onChange={(e) => updatePerson(index, { age_band: e.target.value as AgeBand })}
                      >
                        <option value="adult">Adult</option>
                        <option value="child">Child</option>
                        <option value="elderly">Elderly</option>
                        <option value="infant">Infant</option>
                      </select>
                    </td>
                    {canSeePrivate ? (
                      <td className="pr-2 py-0.5">
                        <input className={inputClass} value={person.passport_no} onChange={(e) => updatePerson(index, { passport_no: e.target.value })} />
                      </td>
                    ) : null}
                    <td className="py-0.5">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white text-danger"
                        aria-label="Remove guest"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function initialPeople(booking: Booking | null): PersonRow[] {
  const rows = [...(booking?.tourists ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (rows.length === 0) return [emptyPerson()];
  return rows.map((tourist: Tourist) => ({
    id: tourist.id,
    full_name: tourist.full_name,
    phone: tourist.phone ?? '',
    nationality: tourist.nationality ?? '',
    age_band: tourist.age_band,
    passport_no: tourist.tourist_private?.passport_no ?? '',
  }));
}

function normalizeAgeBand(value: string | undefined): AgeBand | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text.startsWith('c') || text.startsWith('k')) return 'child';
  if (text.startsWith('i') || text.startsWith('b')) return 'infant';
  if (text.startsWith('e') || text.startsWith('s') || text.startsWith('o')) return 'elderly';
  if (text.startsWith('a')) return 'adult';
  return null;
}

function DeleteBookingDialog({
  booking,
  onClose,
  onConfirm,
}: {
  booking: Booking;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < 5;

  return (
    <Modal
      title={`Delete ${booking.booking_ref}?`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button type="button" className={`${secondaryButtonClass} flex-1`} onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className={`${dangerButtonClass} flex-1`}
            disabled={tooShort}
            onClick={() => onConfirm(reason.trim())}
          >
            Delete booking
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm font-medium text-ink">
        This removes {booking.lead_name} and {booking.pax_total} guest record(s). It cannot be undone.
      </p>
      <Field
        label="Why is this being deleted?"
        hint="Recorded against your name in the change log, so every deletion can be traced."
      >
        <textarea
          className={inputClass}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Guest cancelled the trip by phone"
          autoFocus
        />
      </Field>
      {tooShort && reason.length > 0 ? (
        <p className="mt-2 text-xs font-medium text-danger">Give a real reason, not a single character.</p>
      ) : null}
    </Modal>
  );
}

function HistoryDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [rows, setRows] = useState<BookingHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('booking_history', { p_booking_id: booking.id });
      setRows((data ?? []) as BookingHistoryRow[]);
      setLoading(false);
    })();
  }, [booking.id]);

  const labels: Record<string, string> = {
    insert: 'Entered',
    update: 'Edited',
    delete: 'Deleted',
    delete_booking: 'Booking deleted',
  };

  return (
    <Modal title={`Change history — ${booking.booking_ref}`} onClose={onClose}>
      {loading ? <p className="py-4 text-sm font-medium text-muted">Loading…</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="py-4 text-sm font-medium text-muted">Nothing recorded for this booking yet.</p>
      ) : null}
      <ol className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2.5 text-sm">
            <span className="w-32 shrink-0 tabular text-xs text-muted">
              {new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}
            </span>
            <span className="font-semibold text-ink">{labels[row.action] ?? row.action}</span>
            <span className="text-muted">{row.summary ?? ''}</span>
            <span className="ml-auto font-medium">{row.actor_name}</span>
            {row.reason ? (
              <span className="w-full rounded bg-shell px-2 py-1 text-xs text-muted">Reason: {row.reason}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </Modal>
  );
}
