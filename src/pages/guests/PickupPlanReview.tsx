import { useMemo, useState } from 'react';
import { Bus, Check, ExternalLink, MapPin, Users } from 'lucide-react';
import { Modal } from '../../components/Modal';
import PassengerBreakdown from '../../components/PassengerBreakdown';
import { Field, buttonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { distanceLabel, groupSpread, hasPickupPoint, mapUrl, pickupDistance, pickupName, pickupPax, pickupStops, pickupTargets, suggestPickups, type PickupBoard } from '../../lib/pickupPlanning';
import type { Booking } from '../../lib/platformTypes';

export function PickupPlace({ booking, previous }: { booking: Booking; previous?: Booking }) {
  const url = mapUrl(booking);
  const distance = previous ? pickupDistance(previous, booking) : null;
  return <div className="min-w-0 text-xs text-muted">
    <div className="flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{pickupName(booking)}{booking.pickup_area && booking.pickup_area !== pickupName(booking) ? `, ${booking.pickup_area}` : ''}</span>{url ? <a href={url} target="_blank" rel="noreferrer" title="Open Location in Maps" aria-label={`Open ${pickupName(booking)} in Maps`} onClick={e => e.stopPropagation()} className="shrink-0 p-1 text-accent"><ExternalLink className="h-3.5 w-3.5" /></a> : null}</div>
    {!hasPickupPoint(booking) ? <p className="mt-1 text-warning">Map Point Needed</p> : previous ? <p className="mt-1">{distance == null ? 'Distance Unknown' : `${distanceLabel(distance)} from previous location (straight-line)`}</p> : null}
  </div>;
}

export default function PickupPlanReview({board, date, radius, onClose, onSaved}: {board: PickupBoard; date: string; radius: number; onClose: () => void; onSaved: () => void}) {
  const [distance, setDistance] = useState(String(radius));
  const validDistance = Number(distance)>0 && Number(distance)<=50;
  const [selected, setSelected] = useState(board.vehicles.map(v => v.id));
  const [suggestion, setSuggestion] = useState(() => suggestPickups(board, radius, board.vehicles.map(v => v.id)));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState(() => crypto.randomUUID());
  const waiting = board.bookings.filter(b => b.pickup_required && !b.pickup_group_id);
  const assigned = suggestion.groups.flatMap(g => g.bookings);
  const used = suggestion.groups.filter(g => g.bookings.length);
  const targets = pickupTargets(board, board.vehicles.map(v => v.id));
  const capacityError = suggestion.groups.some(g => pickupPax([...g.existing,...g.bookings]) > g.vehicle.capacity_pax);
  const assignment = useMemo(() => new Map(suggestion.groups.flatMap(g => g.bookings.map(b => [b.id,g.key] as const))), [suggestion]);
  function regenerate(ids: string[], km=Number(distance)) { setSelected(ids); if(km>0 && km<=50)setSuggestion(suggestPickups(board,km,ids)); setChecked(false); setToken(crypto.randomUUID()); setError(''); }
  function move(id: string, key: string) {
    const row = waiting.find(b => b.id === id)!;
    const groups = suggestion.groups.map(g => ({...g,bookings:g.bookings.filter(b => b.id !== id)}));
    groups.find(g => g.key === key)?.bookings.push(row);
    const ids = new Set(groups.flatMap(g => g.bookings.map(b => b.id)));
    setSuggestion({groups,waiting:waiting.filter(b => !ids.has(b.id))}); setChecked(false); setToken(crypto.randomUUID()); setError('');
  }
  async function confirm() {
    if (!checked || busy || !assigned.length || capacityError || !validDistance) return;
    setBusy(true); setError('');
    try {
      const {error: failure} = await supabase.rpc('confirm_pickup_plan',{p_date:date,p_version:board.version,p_request_id:token,p_groups:used.map(g => ({run_id:g.runId,vehicle_id:g.vehicle.id,booking_ids:g.bookings.map(b => b.id)}))});
      if (failure) throw failure;
      onSaved();
    } catch (e) {setError(readErrorMessage(e,'Could not confirm the pickup plan.'));} finally {setBusy(false);}
  }
  return <Modal title="Review Pickup Plan" wide onClose={() => {if (!busy) onClose();}} footer={<div className="grid gap-2">
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {capacityError ? <p role="alert" className="text-sm text-danger">A vehicle exceeds its passenger capacity.</p> : null}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} className="mt-1 h-4 w-4 accent-accent" />I checked locations, vehicle availability and passenger seats.</label>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{pickupPax(assigned)} pax to assign · {pickupPax(suggestion.waiting)} pax waiting</span><button className={`${buttonClass} w-full sm:w-auto`} disabled={busy || !checked || !assigned.length || capacityError || !validDistance} onClick={confirm}><Check className="h-4 w-4" />{busy ? 'Confirming...' : 'Confirm Plan'}</button></div>
  </div>}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">{date} · Draft, Not Assigned</span><span>{used.length} vehicle{used.length === 1 ? '' : 's'} in suggestion</span></div>
      <fieldset className="border-y border-line py-3"><legend className="text-sm font-semibold">Available Vans</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{board.vehicles.map(v => <label key={v.id} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(v.id)} disabled={!targets.some(g => g.vehicle.id === v.id)} onChange={e => regenerate(e.target.checked ? [...selected,v.id] : selected.filter(id => id !== v.id))} className="h-4 w-4 accent-accent" /><span>{v.code} · {v.capacity_pax} Seats{!targets.some(g => g.vehicle.id === v.id) ? ' · Unavailable' : ''}</span></label>)}</div></fieldset>
      <div className="max-w-xs"><Field label="Group Stops Within (km)"><input type="number" className={inputClass} min="0.1" max="50" step="0.1" value={distance} onChange={e=>{setDistance(e.target.value);regenerate(selected,Number(e.target.value));}} /></Field></div>
      {!validDistance ? <p role="alert" className="text-sm text-danger">Enter a distance between 0.1 and 50 km.</p> : null}
      <p className="text-xs text-muted">Straight-line distances, not driving routes. Check pickup times and drivers. Existing assignments stay in place.</p>
      <div className="grid items-start gap-3 md:grid-cols-2">{used.map(g => {
        const rows=[...g.existing,...g.bookings]; const spread=groupSpread(rows);
        return <section key={g.key} className="overflow-hidden rounded-lg border border-line">
          <header className="flex items-center justify-between gap-2 border-b border-line bg-shell px-3 py-2 text-sm font-semibold">
            <span className="flex items-center gap-2"><Bus className="h-4 w-4 text-accent" />{g.vehicle.code}</span>
            <span className={pickupPax(rows)>g.vehicle.capacity_pax ? 'text-danger' : 'text-accent'}>{pickupPax(rows)} / {g.vehicle.capacity_pax} pax</span>
          </header>
          <div className="px-3 py-2 text-xs text-muted">
            {spread == null ? 'Distance Unknown' : `Furthest pair: ${distanceLabel(spread)}`}
            {spread != null && spread > Number(distance) ? <strong className="ml-1 text-warning">Outside Grouping Distance</strong> : null}
          </div>
          <ul className="divide-y divide-line">{pickupStops(rows).map((stop,i,stops) => <li key={stop[0].id} className="px-3 py-2">
            <PickupPlace booking={stop[0]} previous={stops[i-1]?.[0]} />
            <ul className="mt-1 divide-y divide-line">{stop.map(b => <li key={b.id} data-pickup-plan-booking={b.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-2 gap-y-1 py-2">
              <div className="min-w-0 text-sm"><strong className="block break-words [overflow-wrap:anywhere]">{b.lead_name}</strong><span className="text-xs font-semibold tabular text-accent">{b.pax_total} pax</span></div>
              {g.existing.some(x => x.id === b.id) ? <span className="text-xs text-muted">Already Assigned</span> :
                <select aria-label={`Vehicle for ${b.lead_name}`} className={inputClass} value={assignment.get(b.id) ?? ''} onChange={e => move(b.id,e.target.value)}>
                  <option value="">Waiting</option>
                  {suggestion.groups.map(target => <option key={target.key} value={target.key}>{target.vehicle.code}</option>)}
                </select>}
              <div className="col-span-2"><PassengerBreakdown counts={b} /></div>
            </li>)}</ul>
          </li>)}</ul>
        </section>;
      })}</div>
      {suggestion.waiting.length ? <section className="border-t border-line pt-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-warning"><Users className="h-4 w-4" />Needs Attention · {pickupPax(suggestion.waiting)} pax</h3>
        <ul className="mt-1 divide-y divide-line">{suggestion.waiting.map(b => <li key={b.id} data-pickup-plan-booking={b.id} className="grid min-w-0 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="min-w-0">
            <p className="flex items-start justify-between gap-2 text-sm font-semibold"><span className="min-w-0 [overflow-wrap:anywhere]">{b.lead_name}</span><span className="shrink-0 tabular text-accent">{b.pax_total} pax</span></p>
            <PassengerBreakdown counts={b} />
            <PickupPlace booking={b} />
            <p className="text-xs text-warning">{hasPickupPoint(b) ? 'No nearby vehicle with enough seats' : 'Location needs checking before grouping'}</p>
          </div>
          <select aria-label={`Vehicle for ${b.lead_name}`} className={inputClass} value="" onChange={e => move(b.id,e.target.value)}><option value="">Keep Waiting</option>{suggestion.groups.map(g => <option key={g.key} value={g.key}>{g.vehicle.code} · {g.vehicle.capacity_pax} seats</option>)}</select>
        </li>)}</ul>
      </section> : null}
      {!waiting.length ? <p className="text-sm text-muted">No bookings are waiting for a vehicle.</p> : null}
    </fieldset>
  </Modal>;
}

export function PickupPointForm({booking, board, onClose, onSaved}: {booking: Booking; board: PickupBoard; onClose: () => void; onSaved: () => void}) {
  const [name,setName]=useState(booking.pickup_hotel_name ?? ''); const [area,setArea]=useState(booking.pickup_area ?? '');
  const [lat,setLat]=useState(booking.pickup_latitude?.toString() ?? ''); const [lng,setLng]=useState(booking.pickup_longitude?.toString() ?? '');
  const [location,setLocation]=useState(booking.pickup_location_id ?? ''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const paired=!!lat.trim() === !!lng.trim();
  const valid=!!name.trim() && paired && (!lat.trim() || (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat))<=90 && Math.abs(Number(lng))<=180));
  async function save() {
    if(!valid || busy)return;
    setBusy(true);setError('');
    try {const {error:failure}=await supabase.rpc('save_pickup_point_checked',{p_booking_id:booking.id,p_expected_updated_at:booking.updated_at,p_name:name,p_area:area,p_latitude:lat.trim()?Number(lat):null,p_longitude:lng.trim()?Number(lng):null,p_location_id:location || null});if(failure)throw failure;onSaved();} catch(e){setError(readErrorMessage(e,'Could not save the pickup location.'));}finally{setBusy(false);}
  }
  return <Modal title="Pickup Location" onClose={() => {if(!busy)onClose();}} footer={<div className="grid gap-2">{error ? <p role="alert" className="text-sm text-danger">{error}</p>:null}<button className={buttonClass} onClick={save} disabled={busy || !valid}>{busy?'Saving...':'Save Location'}</button></div>}><fieldset disabled={busy} className="grid gap-3"><p className="text-sm font-semibold">{booking.lead_name} · {booking.pax_total} pax</p><Field label="Saved Place"><select className={inputClass} value={location} onChange={e => {setLocation(e.target.value);const l=board.locations.find(l=>l.id===e.target.value);if(l){setName(l.name);setArea(l.area ?? '');setLat(l.latitude?.toString() ?? '');setLng(l.longitude?.toString() ?? '');}}}><option value="">Other Location</option>{board.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Hotel, Street or Building"><input className={inputClass} value={name} onChange={e=>{setName(e.target.value);setLocation('');setLat('');setLng('');}} /></Field><Field label="Area"><input className={inputClass} value={area} onChange={e=>{setArea(e.target.value);setLocation('');setLat('');setLng('');}} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Latitude"><input inputMode="decimal" className={inputClass} value={lat} onChange={e=>{setLat(e.target.value);setLocation('');}} /></Field><Field label="Longitude"><input inputMode="decimal" className={inputClass} value={lng} onChange={e=>{setLng(e.target.value);setLocation('');}} /></Field></div><p className="text-xs text-muted">Coordinates are optional. Without a map point, distance stays unknown and this booking needs manual review.</p><a className={secondaryButtonClass} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name,area].join(' '))}`}><ExternalLink className="h-4 w-4" />Find Location in Maps</a></fieldset></Modal>;
}
