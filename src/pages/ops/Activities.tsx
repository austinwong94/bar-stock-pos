import { useEffect, useMemo, useState } from 'react';
import { Check, MoreHorizontal, Ship, Undo2, Users } from 'lucide-react';
import { PageHeader } from '../../components/Page';
import { buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { StaffConfirmation, StaffFeedback, StaffFilters, StaffSummary, StaffTabs } from '../../components/StaffWorkspace';
import { useBusinessDate } from '../../lib/useBusinessDate';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { loadActivityTypes, readErrorMessage } from '../../lib/opsData';
import { groupByBooking, guestMatches, useStaffManifest, type AttendanceAction } from '../../lib/useStaffManifest';
import type { ActivityType, ManifestRow } from '../../lib/platformTypes';

export default function Activities() {
  const {can}=useAccess(); const {text:t}=useLanguage();
  const [date,setDate]=useBusinessDate('guests');
  const {rows,loading,busy,error,notice,refresh,update}=useStaffManifest(date,true);
  const [types,setTypes]=useState<ActivityType[]>([]); const [typeError,setTypeError]=useState('');
  const [search,setSearch]=useState(''); const [boat,setBoat]=useState('');
  const [mode,setMode]=useState('activity');
  const [details,setDetails]=useState<ManifestRow|null>(null);
  const [confirmation,setConfirmation]=useState<{guests:ManifestRow[];action:AttendanceAction;value:string|boolean|null;title:string}|null>(null);
  const canSelect=can('activities.select'); const canMark=can('activities.mark');
  useEffect(()=>{let active=true;loadActivityTypes().then(result=>{if(active)setTypes(result);}).catch(e=>{if(active)setTypeError(readErrorMessage(e,'Could not load activity choices.'));});return()=>{active=false;};},[]);
  const boats=useMemo(()=>[...new Map(rows.map(r=>[r.assignment_id,{id:r.assignment_id,label:r.boat_code}])).values()],[rows]);
  const selected=rows.filter(r=>!boat || r.assignment_id===boat);
  const shown=selected.filter(r=>guestMatches(r,search));
  const back=selected.filter(r=>r.returned).length;
  const activityName=(row:ManifestRow)=>types.find(type=>type.code===row.activity_code)?.name ?? row.activity_code ?? t('No Activity','Tiada Aktiviti');
  function changeDate(value:string){setBoat('');setSearch('');setDate(value);}
  async function save(guests:ManifestRow[],action:AttendanceAction,value:string|boolean|null){
    return update(guests,action,value,t('Attendance saved.','Kehadiran disimpan.'));
  }
  return <div className="staff-workspace">
    <PageHeader title={t('Island Activities','Aktiviti Pulau')} />
    <StaffFilters date={date} onDate={changeDate} search={search} onSearch={setSearch} boat={boat} onBoat={setBoat} boats={boats} onRefresh={()=>void refresh()} disabled={busy} />
    <StaffSummary items={[{label:t('Checked In','Daftar Masuk'),value:selected.length},{label:t('Returned','Sudah Kembali'),value:back,tone:'accent'},{label:t('Still Out','Belum Kembali'),value:selected.length-back,tone:'warning'}]} />
    <StaffTabs value={mode} onChange={setMode} items={[{value:'activity',label:t('Activity','Aktiviti')},{value:'joined',label:t('Roll Call','Kehadiran')},{value:'returned',label:t('Return','Kembali')}]} />
    <StaffFeedback loading={loading} error={error || typeError} notice={notice} onRetry={()=>{void refresh();void loadActivityTypes().then(result=>{setTypes(result);setTypeError('');}).catch(e=>setTypeError(readErrorMessage(e,'Could not load activity choices.')));}} />
    {!loading && !shown.length?<p className="border-y border-line py-8 text-center text-sm text-muted">{rows.length?t('No guests match this view.','Tiada tetamu dalam paparan ini.'):t('Check guests in at Boarding first.','Daftar masuk tetamu di Kehadiran Bot dahulu.')}</p>:null}
    <div className="grid items-start gap-5 lg:grid-cols-2">{boats.filter(b=>shown.some(r=>r.assignment_id===b.id)).map(b=><section key={b.id} className="min-w-0">
      <h2 className="flex items-center gap-2 border-b border-line pb-2 text-sm font-bold"><Ship className="h-4 w-4 text-accent" />{b.label}<span className="ml-auto text-xs font-medium text-muted">{shown.filter(r=>r.assignment_id===b.id).length} pax</span></h2>
      {groupByBooking(shown.filter(r=>r.assignment_id===b.id)).map(group=>{
        const unchosen=group.rows.filter(r=>!r.activity_code && !r.returned && r.activity_status!=='joined');
        const out=group.rows.filter(r=>!r.returned);
        return <div key={group.bookingRef} className="mt-3 min-w-0">
          <header className="flex items-center justify-between gap-2 bg-shell px-2 py-1"><div className="min-w-0"><p className="text-xs font-semibold">{group.leadName}</p><p className="text-[11px] text-muted">{group.bookingRef}</p></div>
            {mode==='returned' && canMark && out.length>1?<button type="button" disabled={busy} className="flex shrink-0 items-center gap-1 px-2 text-xs font-semibold text-accent" onClick={()=>setConfirmation({guests:out,action:'returned',value:true,title:t('Confirm Group Return','Sahkan Kumpulan Kembali')})}><Users className="h-4 w-4" />{t('Group Back','Kumpulan Kembali')}</button>:null}
          </header>
          {mode==='activity' && canSelect && unchosen.length>1?<div className="border-b border-line py-2"><p className="mb-1 text-xs text-muted">{t('Set Unchosen Guests','Tetapkan Tetamu Belum Pilih')} · {unchosen.length} pax</p><div className="grid grid-cols-3 gap-1">{types.map(type=><button type="button" key={type.code} aria-label={`Group ${type.name} ${group.bookingRef}`} disabled={busy || !!typeError} className={secondaryButtonClass+' !px-1 !text-xs'} onClick={()=>setConfirmation({guests:unchosen,action:'activity',value:type.code,title:t('Set Group Activity','Tetapkan Aktiviti Kumpulan')+': '+type.name})}>{type.name}</button>)}</div></div>:null}
          <ul>{group.rows.map(row=><li key={row.passenger_id} className={'staff-row '+(mode==='activity'?'activity-choice-row':'')} data-passenger={row.passenger_id}>
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{row.full_name}</p><p className="mt-0.5 text-xs text-muted">{activityName(row)}{row.needs_assistance?' · '+t('Needs Help','Perlu Bantuan'):''}</p></div>
            <div className="flex items-center gap-1">
              {mode==='activity'?null:mode==='joined'?<button type="button" aria-label={'Mark Joined '+row.full_name} disabled={!canMark || busy || !row.activity_code || row.activity_status==='joined'} className={(row.activity_status==='joined'?secondaryButtonClass:buttonClass)+' !px-2 !text-xs'} onClick={()=>void save([row],'joined','joined')}>{row.activity_status==='joined'?<Check className="h-4 w-4" />:null}{t('Joined','Sertai')}</button>:<button type="button" aria-label={'Mark Returned '+row.full_name} disabled={!canMark || busy || row.returned} className={(row.returned?secondaryButtonClass:buttonClass)+' !px-2 !text-xs'} onClick={()=>void save([row],'returned',true)}>{row.returned?<Check className="h-4 w-4" />:null}{row.returned?t('Back','Kembali'):t('Mark Back','Tanda Kembali')}</button>}
              <button type="button" className={iconButtonClass} title={t('Guest Details','Butiran Tetamu')} aria-label={'Guest Details '+row.full_name} disabled={busy} onClick={()=>setDetails(row)}><MoreHorizontal className="h-4 w-4" /></button>
            </div>
            {mode==='activity'?<div role="group" aria-label={'Activity for '+row.full_name} className="col-span-2 grid grid-cols-3 gap-1">{types.map(type=><button type="button" key={type.code} aria-label={`${type.name} for ${row.full_name}`} aria-pressed={row.activity_code===type.code} disabled={!canSelect || busy || !!typeError || row.activity_status==='joined' || row.returned} className={(row.activity_code===type.code?buttonClass:secondaryButtonClass)+' min-w-0 !px-1 !text-xs'} onClick={()=>void save([row],'activity',type.code)}>{row.activity_code===type.code?<Check className="h-3 w-3 shrink-0" />:null}{type.name}</button>)}</div>:null}
          </li>)}</ul>
        </div>;
      })}
    </section>)}</div>
    {details?<Modal title={t('Guest Details','Butiran Tetamu')} onClose={()=>setDetails(null)}>
      <h3 className="break-words text-base font-bold">{details.full_name}</h3><p className="mt-1 text-sm text-muted">{details.boat_code} · {details.booking_ref}</p><p className="mt-3 text-sm">{activityName(details)} · {details.activity_status==='joined'?t('Joined','Sertai'):t('Not Joined','Belum Sertai')}</p><p className="mt-1 text-sm">{details.returned?t('Back on Boat','Sudah Kembali ke Bot'):t('Not Back on Boat','Belum Kembali ke Bot')}</p>
      {details.phone?<a className={secondaryButtonClass+' my-3'} href={'tel:'+details.phone}>{details.phone}</a>:null}
      {details.assistance_note?<p className="my-3 text-sm">{details.assistance_note}</p>:null}
      {canMark?<div className="mt-4 grid gap-2">
        {details.returned?<button type="button" className={secondaryButtonClass} onClick={()=>{setDetails(null);setConfirmation({guests:[details],action:'returned',value:false,title:t('Reset Return Attendance','Tetapkan Semula Kehadiran Kembali')});}}><Undo2 className="h-4 w-4" />{t('Reset Return','Tetapkan Semula Kembali')}</button>:null}
        {details.activity_status!=='pending'?<button type="button" className={secondaryButtonClass} onClick={()=>{setDetails(null);setConfirmation({guests:[details],action:'joined',value:'pending',title:t('Reset Activity Attendance','Tetapkan Semula Kehadiran Aktiviti')});}}><Undo2 className="h-4 w-4" />{t('Reset Roll Call','Tetapkan Semula Kehadiran')}</button>:null}
      </div>:null}
      {canSelect && details.activity_code && details.activity_status!=='joined' && !details.returned?<button type="button" className={secondaryButtonClass+' mt-3'} onClick={()=>{setDetails(null);setConfirmation({guests:[details],action:'activity',value:null,title:t('Clear Activity Choice','Padam Pilihan Aktiviti')});}}><Undo2 className="h-4 w-4" />{t('Clear Choice','Padam Pilihan')}</button>:null}
    </Modal>:null}
    {confirmation?<StaffConfirmation title={confirmation.title} guests={confirmation.guests} action={t('Confirm','Sahkan')} busy={busy} error={error} onClose={()=>setConfirmation(null)} onConfirm={()=>void save(confirmation.guests,confirmation.action,confirmation.value).then(ok=>{if(ok)setConfirmation(null);})} />:null}
  </div>;
}
