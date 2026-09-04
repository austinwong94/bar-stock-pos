import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Plus, Trash2, Upload } from 'lucide-react';
import { PageHeader, Panel, Badge } from '../../components/Page';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { loadAgencies, loadPickupLocations, readErrorMessage, sourceLabels, todayIso } from '../../lib/opsData';
import type { AgeBand, Agency, PickupLocation } from '../../lib/platformTypes';

/**
 * The sheet the team already keeps in Excel, but it writes straight into the
 * database. One row is one guest; rows that share a group name become one
 * booking, which is what keeps a family together downstream.
 */
type SheetRow = {
  group: string;
  name: string;
  phone: string;
  nationality: string;
  type: string;
  passport: string;
  hotel: string;
};

const emptyRow = (): SheetRow => ({ group: '', name: '', phone: '', nationality: '', type: '', passport: '', hotel: '' });

const columns: Array<{ key: keyof SheetRow; label: string; width: string; placeholder: string }> = [
  { key: 'group', label: 'Group / booking name', width: 'minmax(9rem,1.2fr)', placeholder: 'Tan Family' },
  { key: 'name', label: 'Guest full name', width: 'minmax(10rem,1.4fr)', placeholder: 'Tan Wei Ming' },
  { key: 'phone', label: 'Phone', width: 'minmax(7rem,1fr)', placeholder: '+60…' },
  { key: 'nationality', label: 'Nationality', width: 'minmax(6rem,0.8fr)', placeholder: 'Malaysian' },
  { key: 'type', label: 'Adult / child / elderly', width: 'minmax(6rem,0.8fr)', placeholder: 'adult' },
  { key: 'passport', label: 'Passport', width: 'minmax(7rem,0.9fr)', placeholder: 'A1234567' },
  { key: 'hotel', label: 'Hotel / pickup', width: 'minmax(8rem,1fr)', placeholder: 'Hotel Marina Bay' },
];

function normalizeType(value: string): AgeBand {
  const text = value.trim().toLowerCase();
  if (!text) return 'adult';
  if (text.startsWith('c') || text.startsWith('k')) return 'child';
  if (text.startsWith('i') || text.startsWith('b')) return 'infant';
  if (text.startsWith('e') || text.startsWith('s') || text.startsWith('o')) return 'elderly';
  return 'adult';
}

export default function BookingSheet() {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAccess();

  const [serviceDate, setServiceDate] = useState(todayIso);
  const [sourceType, setSourceType] = useState('in_house');
  const [agencyId, setAgencyId] = useState('');
  const [rows, setRows] = useState<SheetRow[]>(() => Array.from({ length: 8 }, emptyRow));
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canSetSource = can('guests.booking.edit_all');
  const canSeePrivate = can('guests.contact.view');

  useEffect(() => {
    void (async () => {
      setAgencies(canSetSource ? await loadAgencies().catch(() => []) : []);
      setLocations(await loadPickupLocations().catch(() => []));
    })();
  }, [canSetSource]);

  const update = useCallback((rowIndex: number, key: keyof SheetRow, value: string) => {
    setRows((current) => {
      const next = [...current];
      next[rowIndex] = { ...next[rowIndex], [key]: value };
      // Typing in the last row always leaves a fresh one below, so the sheet
      // never runs out the way a fixed table would.
      if (rowIndex === next.length - 1 && value.trim()) next.push(emptyRow());
      return next;
    });
  }, []);

  // Pasting a block from Excel fills down and across from the focused cell.
  const handlePaste = useCallback(
    (event: React.ClipboardEvent, rowIndex: number, columnIndex: number) => {
      const text = event.clipboardData.getData('text/plain');
      if (!text.includes('\t') && !text.includes('\n')) return;
      event.preventDefault();

      const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim().length > 0);
      setRows((current) => {
        const next = [...current];
        lines.forEach((line, lineOffset) => {
          const cells = line.split('\t');
          const target = rowIndex + lineOffset;
          while (next.length <= target) next.push(emptyRow());
          const row = { ...next[target] };
          cells.forEach((cell, cellOffset) => {
            const column = columns[columnIndex + cellOffset];
            if (column) row[column.key] = cell.trim();
          });
          next[target] = row;
        });
        if (next[next.length - 1] && Object.values(next[next.length - 1]).some((value) => value.trim())) {
          next.push(emptyRow());
        }
        return next;
      });
      toast.success(`${lines.length} row(s) pasted in.`);
    },
    [toast],
  );

  function onKeyDown(event: React.KeyboardEvent, rowIndex: number, columnIndex: number) {
    const move = (nextRow: number, nextColumn: number) => {
      const key = `${nextRow}:${nextColumn}`;
      const element = cellRefs.current[key];
      if (element) {
        event.preventDefault();
        element.focus();
        element.select();
      }
    };
    if (event.key === 'Enter' || event.key === 'ArrowDown') move(rowIndex + 1, columnIndex);
    if (event.key === 'ArrowUp') move(rowIndex - 1, columnIndex);
  }

  // Rows that share a group name are one booking. A row with a name but no
  // group is its own booking, named after the guest.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; hotel: string; rows: SheetRow[] }>();
    rows.forEach((row) => {
      if (!row.name.trim()) return;
      const label = row.group.trim() || row.name.trim();
      const key = label.toLowerCase();
      const entry = map.get(key) ?? { label, hotel: row.hotel.trim(), rows: [] };
      if (!entry.hotel && row.hotel.trim()) entry.hotel = row.hotel.trim();
      entry.rows.push(row);
      map.set(key, entry);
    });
    return [...map.values()];
  }, [rows]);

  const guestCount = groups.reduce((sum, group) => sum + group.rows.length, 0);

  async function importAll() {
    if (groups.length === 0) { toast.error('Nothing to import yet.'); return; }
    setImporting(true);
    let created = 0;
    let failed = 0;

    for (const [index, group] of groups.entries()) {
      setProgress(`Saving ${index + 1} of ${groups.length}…`);
      const location = locations.find(
        (item) => item.name.toLowerCase() === group.hotel.toLowerCase(),
      );
      const lead = group.rows[0];

      const { error } = await supabase.rpc('save_booking', {
        p_booking: {
          id: '',
          service_date: serviceDate,
          lead_name: group.label,
          lead_phone: lead.phone,
          source_type: sourceType,
          agency_id: agencyId,
          pickup_location_id: location?.id ?? '',
          pickup_hotel_name: group.hotel,
          pickup_area: location?.area ?? '',
          pickup_latitude: location?.latitude ?? '',
          pickup_longitude: location?.longitude ?? '',
          status: 'confirmed',
        },
        p_tourists: group.rows.map((row, rowIndex) => ({
          id: '',
          full_name: row.name.trim(),
          phone: row.phone,
          nationality: row.nationality,
          age_band: normalizeType(row.type),
          is_lead: rowIndex === 0,
          ...(canSeePrivate && row.passport ? { private: { passport_no: row.passport } } : {}),
        })),
      });

      if (error) { failed += 1; toast.error(`${group.label}: ${error.message}`); }
      else created += 1;
    }

    setImporting(false);
    setProgress('');
    if (created > 0) {
      toast.success(`${created} booking(s) with ${guestCount} guest(s) saved.`);
      if (failed === 0) navigate('/guests');
    }
  }

  const gridTemplate = `2.25rem ${columns.map((column) => column.width).join(' ')} 2.25rem`;

  return (
    <>
      <PageHeader
        title="Sheet entry"
        subtitle="Type it like a spreadsheet, or paste a block straight out of Excel. Rows sharing a group name become one booking."
        actions={
          <>
            <button type="button" className={secondaryButtonClass} onClick={() => navigate('/guests')}>
              <ArrowLeft className="h-4 w-4" /> Back to bookings
            </button>
            <button type="button" className={buttonClass} onClick={importAll} disabled={importing || guestCount === 0}>
              <Upload className="h-4 w-4" />
              {importing ? progress || 'Saving…' : `Save ${groups.length} booking${groups.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Arrival date for every row">
          <input type="date" className={inputClass} value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        </Field>
        {canSetSource ? (
          <>
            <Field label="Source">
              <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Agency / OTA">
              <select className={inputClass} value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">None (in-house)</option>
                {agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
              </select>
            </Field>
          </>
        ) : null}
        <div className="flex items-end">
          <div className="w-full rounded-lg border border-line bg-surface px-3 py-2.5">
            <p className="eyebrow">Will create</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {groups.length} booking{groups.length === 1 ? '' : 's'} · {guestCount} guest{guestCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </div>

      <p className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs font-medium text-muted">
        <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          Click the first cell and paste. Columns are read in the order shown below, so an Excel sheet with the same
          column order drops straight in. Enter or the down arrow moves to the next row. Leave the group blank and the
          guest becomes their own booking.
        </span>
      </p>

      <Panel>
        <div className="table-scroll">
          <div className="min-w-[64rem]">
            <div
              className="grid gap-px border-b border-line bg-paper px-2 py-2"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span className="eyebrow" />
              {columns.map((column) => (
                <span key={column.key} className="eyebrow px-1">{column.label}</span>
              ))}
              <span className="eyebrow" />
            </div>

            <div className="divide-y divide-line">
              {rows.map((row, rowIndex) => {
                const filled = Boolean(row.name.trim());
                return (
                  <div
                    key={rowIndex}
                    className={`grid items-center gap-px px-2 py-1 ${filled ? '' : 'opacity-70 focus-within:opacity-100'}`}
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <span className="px-1 text-xs tabular text-muted">{rowIndex + 1}</span>
                    {columns.map((column, columnIndex) => (
                      <input
                        key={column.key}
                        ref={(element) => { cellRefs.current[`${rowIndex}:${columnIndex}`] = element; }}
                        className="min-h-9 w-full rounded border border-transparent bg-transparent px-1.5 py-1.5 text-sm outline-none transition hover:border-line focus:border-accent focus:bg-surface focus:ring-1 focus:ring-accent/20"
                        value={row[column.key]}
                        placeholder={rowIndex === 0 ? column.placeholder : ''}
                        onChange={(event) => update(rowIndex, column.key, event.target.value)}
                        onPaste={(event) => handlePaste(event, rowIndex, columnIndex)}
                        onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
                        aria-label={`${column.label} row ${rowIndex + 1}`}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setRows((current) => (current.length === 1 ? [emptyRow()] : current.filter((_, i) => i !== rowIndex)))}
                      className="grid h-8 w-8 place-items-center rounded text-muted transition hover:bg-shell hover:text-danger"
                      aria-label={`Remove row ${rowIndex + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setRows((current) => [...current, ...Array.from({ length: 5 }, emptyRow)])}
          >
            <Plus className="h-4 w-4" /> 5 more rows
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setRows(Array.from({ length: 8 }, emptyRow))}
          >
            Clear sheet
          </button>
        </div>
      </Panel>

      {groups.length > 0 ? (
        <Panel title="Groups the system found" className="mt-4">
          <ul className="divide-y divide-line">
            {groups.map((group) => (
              <li key={group.label} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                <span className="font-semibold text-ink">{group.label}</span>
                <span className="flex items-center gap-2">
                  {group.hotel ? <Badge>{group.hotel}</Badge> : null}
                  <span className="tabular text-muted">{group.rows.length} guest{group.rows.length === 1 ? '' : 's'}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
