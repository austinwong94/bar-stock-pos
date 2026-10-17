import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Building2, MapPin, Plus, UserCog } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { loadAgencies, loadEmployees, loadPickupLocations, readErrorMessage, sourceLabels } from '../../lib/opsData';
import type { Agency, Employee, PickupLocation } from '../../lib/platformTypes';

type Tab = 'employees' | 'agencies' | 'locations';

export default function Directory() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [editing, setEditing] = useState<{ kind: Tab; row: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [employeeRows, agencyRows, locationRows] = await Promise.all([
        supabase.from('employees').select('*').order('job_type').order('full_name'),
        loadAgencies(),
        loadPickupLocations(),
      ]);
      setEmployees((employeeRows.data ?? []) as Employee[]);
      setAgencies(agencyRows);
      setLocations(locationRows);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the directory.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tabs: Array<[Tab, string, typeof UserCog]> = [
    ['employees', 'Employees', UserCog],
    ['agencies', 'Agencies & OTAs', Building2],
    ['locations', 'Pickup points', MapPin],
  ];

  return (
    <>
      <PageHeader
        title="Directory"
        subtitle="Captains, guides and drivers for the dropdowns; agencies for booking sources; hotels with coordinates so pickup runs group themselves."
        actions={
          <button type="button" className={buttonClass} onClick={() => setEditing({ kind: tab, row: {} })}>
            <Plus className="h-4 w-4" /> Add
          </button>
        }
      />

      <div className="mb-3 grid max-w-2xl grid-cols-3 gap-1 rounded-2xl bg-shell p-1 text-sm font-black">
        {tabs.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 ${tab === value ? 'bg-accent text-white' : ''}`}
          >
            <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/85 shadow-soft">
        {tab === 'employees' ? (
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-paper text-sm">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Job</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Active</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id} className="border-t border-line text-sm font-semibold">
                  <td className="p-3 font-black">{employee.full_name}</td>
                  <td className="p-3 capitalize">{employee.job_type}</td>
                  <td className="p-3">{employee.phone ?? '—'}</td>
                  <td className="p-3">{employee.active ? 'Yes' : 'No'}</td>
                  <td className="p-3">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ kind: 'employees', row: employee as unknown as Record<string, unknown> })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'agencies' ? (
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-paper text-sm">
              <tr>
                <th className="p-3">Agency</th>
                <th className="p-3">Type</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Active</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((agency) => (
                <tr key={agency.id} className="border-t border-line text-sm font-semibold">
                  <td className="p-3 font-black">{agency.name}</td>
                  <td className="p-3">{sourceLabels[agency.source_type] ?? agency.source_type}</td>
                  <td className="p-3">
                    {agency.contact_person ?? '—'}
                    {agency.contact_phone ? <p className="text-xs font-medium text-neutral-600">{agency.contact_phone}</p> : null}
                  </td>
                  <td className="p-3">{agency.active ? 'Yes' : 'No'}</td>
                  <td className="p-3">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ kind: 'agencies', row: agency as unknown as Record<string, unknown> })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'locations' ? (
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-paper text-sm">
              <tr>
                <th className="p-3">Hotel / pickup point</th>
                <th className="p-3">Area</th>
                <th className="p-3">Coordinates</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id} className="border-t border-line text-sm font-semibold">
                  <td className="p-3 font-black">{location.name}</td>
                  <td className="p-3">{location.area ?? '—'}</td>
                  <td className="p-3">
                    {location.latitude !== null && location.longitude !== null
                      ? `${location.latitude}, ${location.longitude}`
                      : 'Not set — auto grouping will fall back to the hotel name'}
                  </td>
                  <td className="p-3">
                    <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ kind: 'locations', row: location as unknown as Record<string, unknown> })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {editing ? (
        <DirectoryForm
          kind={editing.kind}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      ) : null}
    </>
  );
}

const tableFor: Record<Tab, string> = {
  employees: 'employees',
  agencies: 'agencies',
  locations: 'pickup_locations',
};

function DirectoryForm({
  kind,
  row,
  onClose,
  onSaved,
}: {
  kind: Tab;
  row: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Record<string, unknown>>(row);
  const [busy, setBusy] = useState(false);

  function set(key: string, value: unknown) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function text(key: string) {
    const value = form[key];
    return value === null || value === undefined ? '' : String(value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    let payload: Record<string, unknown>;
    if (kind === 'employees') {
      payload = {
        full_name: text('full_name').trim(),
        job_type: text('job_type') || 'crew',
        employee_code: text('employee_code') || null,
        phone: text('phone') || null,
        active: form.active !== false,
        notes: text('notes') || null,
      };
    } else if (kind === 'agencies') {
      payload = {
        name: text('name').trim(),
        source_type: text('source_type') || 'agent',
        contact_person: text('contact_person') || null,
        contact_phone: text('contact_phone') || null,
        contact_email: text('contact_email') || null,
        active: form.active !== false,
      };
    } else {
      payload = {
        name: text('name').trim(),
        area: text('area') || null,
        address: text('address') || null,
        latitude: text('latitude') === '' ? null : Number(text('latitude')),
        longitude: text('longitude') === '' ? null : Number(text('longitude')),
        active: form.active !== false,
      };
    }

    const table = tableFor[kind];
    const { error } = form.id
      ? await supabase.from(table).update(payload).eq('id', form.id as string)
      : await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Saved.');
    onSaved();
  }

  return (
    <Modal
      title={form.id ? 'Edit entry' : 'New entry'}
      onClose={onClose}
      footer={
        <button type="submit" form="directory-form" className={`${buttonClass} w-full`} disabled={busy}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      }
    >
      <form id="directory-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {kind === 'employees' ? (
          <>
            <Field label="Full name">
              <input className={inputClass} value={text('full_name')} onChange={(e) => set('full_name', e.target.value)} required />
            </Field>
            <Field label="Job">
              <select className={inputClass} value={text('job_type') || 'crew'} onChange={(e) => set('job_type', e.target.value)}>
                <option value="captain">Captain</option>
                <option value="guide">Tour guide</option>
                <option value="driver">Driver</option>
                <option value="crew">Crew</option>
                <option value="bar">Bar</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Staff number">
              <input className={inputClass} value={text('employee_code')} onChange={(e) => set('employee_code', e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} value={text('phone')} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </>
        ) : null}

        {kind === 'agencies' ? (
          <>
            <Field label="Agency / OTA name">
              <input className={inputClass} value={text('name')} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Source type">
              <select className={inputClass} value={text('source_type') || 'agent'} onChange={(e) => set('source_type', e.target.value)}>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Contact person">
              <input className={inputClass} value={text('contact_person')} onChange={(e) => set('contact_person', e.target.value)} />
            </Field>
            <Field label="Contact phone">
              <input className={inputClass} value={text('contact_phone')} onChange={(e) => set('contact_phone', e.target.value)} />
            </Field>
            <Field label="Contact email">
              <input className={inputClass} value={text('contact_email')} onChange={(e) => set('contact_email', e.target.value)} />
            </Field>
          </>
        ) : null}

        {kind === 'locations' ? (
          <>
            <Field label="Hotel / pickup point">
              <input className={inputClass} value={text('name')} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Area">
              <input className={inputClass} value={text('area')} onChange={(e) => set('area', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <input className={inputClass} value={text('address')} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </div>
            <Field label="Latitude">
              <input className={inputClass} inputMode="decimal" value={text('latitude')} onChange={(e) => set('latitude', e.target.value)} placeholder="5.4100" />
            </Field>
            <Field label="Longitude">
              <input className={inputClass} inputMode="decimal" value={text('longitude')} onChange={(e) => set('longitude', e.target.value)} placeholder="100.3300" />
            </Field>
            <p className="text-xs font-semibold text-neutral-600 sm:col-span-2">
              Coordinates let the system group nearby hotels automatically. Copy them from Google Maps.
            </p>
          </>
        ) : null}

        <label className="flex items-center gap-2 rounded-2xl bg-shell px-4 py-3 text-sm font-black sm:col-span-2">
          <input type="checkbox" checked={form.active !== false} onChange={(e) => set('active', e.target.checked)} />
          Active
        </label>
      </form>
    </Modal>
  );
}
