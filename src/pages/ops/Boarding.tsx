import { useMemo, useState } from 'react';
import { Check, MoreHorizontal, Ship, Undo2, UserX, Users } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { buttonClass, iconButtonClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { StaffConfirmation, StaffFeedback, StaffFilters, StaffSummary, StaffTabs } from '../../components/StaffWorkspace';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { groupByBooking, guestMatches, useStaffManifest } from '../../lib/useStaffManifest';
import type { BoardingStatus, ManifestRow } from '../../lib/platformTypes';
import { passengerLabel } from '../../lib/passengerLabel';
export { groupByBooking } from '../../lib/useStaffManifest';

export default function Boarding() {
  const {can}=useAccess(); const {text:t}=useLanguage();
  const [date,setDate]=useBusinessDate('guests');
  const {rows,loading,busy,error,notice,refresh,update}=useStaffManifest(date);
  const [search,setSearch]=useState(''); const [boat,setBoat]=useState('');
  const [view,setView]=useState('all');
  const [details,setDetails]=useState<ManifestRow|null>(null);
  const [confirmation,setConfirmation]=useState<{guests:ManifestRow[];status:BoardingStatus;title:string}|null>(null);
  const [checkAll,setCheckAll]=useState<ManifestRow[]|null>(null);
  const canMark=can('boarding.mark');
  const boats=useMemo(()=>[...new Map(rows.map(r=>[r.assignment_id,{id:r.assignment_id,label:r.boat_code}])).values()],[rows]);
  const selected=rows.filter(r=>!boat || r.assignment_id===boat);
  const shown=selected.filter(r=>(view==='all' || r.boarding_status===view) && guestMatches(r,search));
  const waiting=selected.filter(r=>r.boarding_status==='pending');
  const checked=selected.filter(r=>r.boarding_status==='arrived').length;
  const noShow=selected.filter(r=>r.boarding_status==='no_show').length;
  const labels={pending:t('Waiting','Menunggu'),arrived:t('Checked In','Daftar Masuk'),no_show:t('No-Show','Tidak Hadir')};
  function changeDate(value:string){setBoat('');setSearch('');setDate(value);}
  async function mark(guests:ManifestRow[],status:BoardingStatus){
    return update(guests,'boarding',status,guests.length+' '+t(guests.length===1?'Guest':'Guests','Tetamu')+' · '+labels[status]);
  }
  return <div className="staff-workspace">
    <PageHeader title={t('Boarding Attendance','Kehadiran Menaiki Bot')} />
    <StaffFilters date={date} onDate={changeDate} search={search} onSearch={setSearch} boat={boat} onBoat={setBoat} boats={boats} onRefresh={()=>void refresh()} disabled={busy} />
    <StaffTabs value={view} onChange={setView} items={[{value:'all',label:t('All Guests','Semua Tetamu'),count:selected.length},{value:'pending',label:labels.pending,count:selected.length-checked-noShow},{value:'arrived',label:labels.arrived,count:checked},{value:'no_show',label:labels.no_show,count:noShow}]} />
    {canMark?<div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3"><span className="text-xs font-medium text-muted">{boat?boats.find(b=>b.id===boat)?.label:t('All Boats','Semua Bot')} · {waiting.length} {t('Waiting','Menunggu')}</span><button type="button" className={buttonClass} disabled={busy||loading||!waiting.length} onClick={()=>setCheckAll(waiting)}><Users className="h-4 w-4"/>{t('Check In All Waiting','Daftar Masuk Semua Menunggu')} ({waiting.length})</button></div>:null}
    <StaffFeedback loading={loading} error={error} notice={notice} onRetry={()=>void refresh()} />
    {search?<p className="mb-2 text-xs text-muted">{shown.length} {t('guests found','tetamu ditemui')}</p>:null}
    {!loading && !shown.length ? <p className="border-y border-line py-8 text-center text-sm text-muted">{rows.length?t('No guests match this view.','Tiada tetamu dalam paparan ini.'):t('No assigned guests for this date.','Tiada tetamu ditugaskan pada tarikh ini.')}</p>:null}
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">{boats.filter(b=>shown.some(r=>r.assignment_id===b.id)).map(b=><section key={b.id} className="min-w-0">
      <h2 className="flex items-center gap-2 border-b border-line pb-2 text-sm font-bold"><Ship className="h-4 w-4 text-accent" />{b.label}<span className="ml-auto text-xs font-medium text-muted">{rows.filter(r=>r.assignment_id===b.id && r.boarding_status==='arrived').length} / {rows.filter(r=>r.assignment_id===b.id).length}</span></h2>
      {groupByBooking(selected.filter(r=>r.assignment_id===b.id)).filter(group=>group.rows.some(r=>shown.includes(r))).map(group=>{
        const pending=group.rows.filter(r=>r.boarding_status==='pending');
        return <div key={group.bookingRef} className="mt-3 min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-2 border-y border-line bg-shell px-2 py-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{group.leadName}</p><p className="text-xs text-muted">{group.rows.length} pax · {group.rows.filter(r=>r.boarding_status==='arrived').length} {t('Checked In','Daftar Masuk')}</p><p className="mt-0.5 text-[11px] text-muted">{group.bookingRef}</p></div>{canMark ? <button type="button" className={(pending.length?buttonClass:secondaryButtonClass)+' !px-2 !text-xs'} aria-label={t('Check In Group','Daftar Masuk Kumpulan')+' '+group.leadName} disabled={busy||!pending.length} onClick={()=>void mark(pending,'arrived').then(ok=>{if(ok)setView('all');})}><Users className="h-4 w-4" />{pending.length?`${t('Check In Group','Daftar Masuk Kumpulan')} (${pending.length})`:t('Group Checked In','Kumpulan Didaftar')}</button>:null}</header>
          <ul>{group.rows.map(row=><li key={row.passenger_id} className="staff-row" data-passenger={row.passenger_id}>
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{row.full_name}</p><p className="mt-0.5 text-xs text-muted">{passengerLabel(row.age_band,t)} · {labels[row.boarding_status]}{row.needs_assistance?' · '+t('Assistance Needed','Perlu Bantuan'):''}</p></div>
            <div className="flex items-center gap-1">{canMark?<button type="button" disabled={busy || row.boarding_status==='arrived'} aria-label={t('Check In','Daftar Masuk')+' '+row.full_name} className={(row.boarding_status==='arrived'?secondaryButtonClass:buttonClass)+' !px-2 !text-xs'} onClick={()=>void mark([row],'arrived')}>{row.boarding_status==='arrived'?<Check className="h-4 w-4" />:null}{row.boarding_status==='arrived'?t('In','Masuk'):t('Check In','Daftar Masuk')}</button>:<span className="text-xs font-semibold">{labels[row.boarding_status]}</span>}
              <button type="button" className={iconButtonClass} title={t('Guest Details','Butiran Tetamu')} aria-label={'Guest Details '+row.full_name} disabled={busy} onClick={()=>setDetails(row)}><MoreHorizontal className="h-4 w-4" /></button></div>
          </li>)}</ul>
        </div>;
      })}
    </section>)}</div>
    {details?<Modal title={t('Guest Details','Butiran Tetamu')} onClose={()=>setDetails(null)}>
      <h3 className="break-words text-base font-bold">{details.full_name}</h3><p className="mt-1 text-sm text-muted">{details.boat_code} · {details.booking_ref}</p><p className="mt-3 text-sm font-semibold">{labels[details.boarding_status]}</p>
      {details.phone?<a className={secondaryButtonClass+' my-3'} href={'tel:'+details.phone}>{details.phone}</a>:null}
      {details.assistance_note?<p className="my-3 text-sm">{details.assistance_note}</p>:null}
      {canMark?<div className="mt-4 grid gap-2">{details.activity_status==='joined' || details.returned?<p className="text-sm text-muted">{t('Activity attendance is already recorded. Correct that record before changing check-in.','Kehadiran aktiviti telah direkodkan. Betulkan rekod itu sebelum mengubah daftar masuk.')}</p>:<>
        {details.boarding_status!=='no_show'?<button type="button" className={secondaryButtonClass} onClick={()=>{setDetails(null);setConfirmation({guests:[details],status:'no_show',title:t('Mark No-Show','Tanda Tidak Hadir')});}}><UserX className="h-4 w-4" />{t('Mark No-Show','Tanda Tidak Hadir')}</button>:null}
        {details.boarding_status!=='pending'?<button type="button" className={secondaryButtonClass} onClick={()=>{setDetails(null);setConfirmation({guests:[details],status:'pending',title:t('Reset Check-In','Tetapkan Semula Daftar Masuk')});}}><Undo2 className="h-4 w-4" />{t('Reset to Waiting','Tetapkan kepada Menunggu')}</button>:null}
      </>}</div>:null}
    </Modal>:null}
    {confirmation?<StaffConfirmation title={confirmation.title} guests={confirmation.guests} action={t('Confirm','Sahkan')} busy={busy} error={error} onClose={()=>setConfirmation(null)} onConfirm={()=>void mark(confirmation.guests,confirmation.status).then(ok=>{if(ok)setConfirmation(null);})} />:null}
    {checkAll?<Modal title={t('Check In All Waiting','Daftar Masuk Semua Menunggu')} onClose={()=>{if(!busy)setCheckAll(null);}} footer={<button type="button" className={buttonClass} disabled={busy} onClick={()=>void mark(checkAll,'arrived').then(ok=>{if(ok){setCheckAll(null);setView('all');setSearch('');}})}><Check className="h-4 w-4"/>{t('Check In','Daftar Masuk')} {checkAll.length} {t('Guests','Tetamu')}</button>}>
      <p className="mb-3 text-sm font-semibold">{checkAll.length} {t('waiting guests','tetamu menunggu')} · {date}</p>
      {error?<p role="alert" className="mb-2 text-sm text-danger">{error}</p>:null}
      <ul className="divide-y divide-line">{groupByBooking(checkAll).map(group=><li key={group.rows[0].booking_id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words">{group.leadName}<span className="block text-xs text-muted">{group.rows[0].boat_code}</span></span><strong className="shrink-0">{group.rows.length} pax</strong></li>)}</ul>
    </Modal>:null}
  </div>;
}
