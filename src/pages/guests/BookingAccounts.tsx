import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Plus, Check, Pencil, Ban } from 'lucide-react';
import { Badge } from '../../components/Page';
import { Modal } from '../../components/Modal';
import { Field, inputClass, buttonClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { todayIso, readErrorMessage } from '../../lib/opsData';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { accountTotals, bookingPaymentDone, type BookingAccount, type BookingPayment, type DailyBooking, type ReferralParty } from '../../lib/bookingOperations';
import { csvEscape } from '../../lib/format';
import { prepareSaveAttempt, definitiveSaveFailure, type SaveAttempt } from '../../lib/saveAttempt';

type AccountsData={accounts:BookingAccount[];payments:BookingPayment[];referrers:ReferralParty[]};
type Save=(rpc:string,args:Record<string,unknown>)=>Promise<boolean>;
const rm=(n:number|null)=>n===null?'Not Set':`RM ${n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const terms=(r:ReferralParty)=>r.method==='percent'?`${r.rate}%`:r.method==='fixed'?`${rm(r.rate)} / Booking`:r.method==='per_pax'?`${rm(r.rate)} / Eligible Pax`:r.is_default?'Not Set':'Use General Commission';
function exportCsv(filename:string,rows:unknown[][]){
  const lines=rows.map(row=>row.map(value=>csvEscape(typeof value==='string' && /^[\s]*[=+@\-]/.test(value)?`'${value}`:value)).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function BookingAccounts({date,bookings}:{date:string;bookings:DailyBooking[]}) {
  const toast=useToast();const [data,setData]=useState<AccountsData>({accounts:[],payments:[],referrers:[]});const [error,setError]=useState('');
  const [tab,setTab]=useState('accounts');const [selected,setSelected]=useState<DailyBooking|null>(null);const [party,setParty]=useState<ReferralParty|'new'|null>(null);const [busy,setBusy]=useState(false);
  const saving=useRef(false);const tokens=useRef(new Map<string,SaveAttempt>());const sequence=useRef(0);
  const load=useCallback(async()=>{const seq=++sequence.current;const {data,error}=await supabase.rpc('read_booking_accounts',{p_date:date});if(seq!==sequence.current)return;if(error)setError(error.message);else{setData(data as AccountsData);setError('');}},[date]);
  useEffect(()=>{void load();},[load]);useSharedRefresh(()=>!saving.current?load():undefined,{tables:['booking_accounts','booking_payments','referral_parties'],intervalMs:15000});
  const save:Save=async(rpc,args)=>{if(saving.current)return false;saving.current=true;setBusy(true);const {key,payload}=prepareSaveAttempt(tokens.current,rpc,args);try{const {error}=await supabase.rpc(rpc,payload);if(error)throw error;tokens.current.delete(key);await load();toast.success('Saved');return true;}catch(e){if(definitiveSaveFailure(e))tokens.current.delete(key);toast.error(readErrorMessage(e));await load();return false;}finally{saving.current=false;setBusy(false);}};
  const account=(id:string)=>data.accounts.find(a=>a.booking_id===id)??null;
  const payments=(id:string)=>data.payments.filter(p=>p.booking_id===id);
  const totals=(id:string)=>accountTotals(account(id),payments(id));
  const active=bookings.filter(b=>!['cancelled','no_show'].includes(b.status));
  function download(kind:'accounts'|'payments'){
    const rows:unknown[][]=kind==='accounts'?[['Service Date','Booking Reference','Booking Name','Booking Status','Invoice Number','Currency','Agreed Total','Net Received','Balance','Payment Status','Done','Referrer','Commission Method (Snapshot)','Commission Rate (Snapshot)','Commission Base','Commissionable Pax','Commission Due','Commission Paid','Commission Balance','Accounting Remarks','Last Updated By','Last Updated At']]:[['Service Date','Booking Reference','Booking Name','Invoice Number','Payment Date','Kind','Currency','Amount','Reference','Notes','Recorded By','Recorded At','Voided At','Void Reason']];
    for(const b of bookings){const a=account(b.id);const t=totals(b.id);
      if(kind==='accounts')rows.push([date,b.booking_ref,b.lead_name,b.status,a?.invoice_number??'','MYR',a?.amount_due??'',t.paid,t.balance??'',t.status,bookingPaymentDone(a,payments(b.id))?'Yes':'No',data.referrers.find(r=>r.id===a?.referrer_id)?.name??'',a?.commission_method??'',a?.commission_rate??'',a?.commission_base??'',a?.commission_pax??'',t.commission??'',a?.commission_paid??'',t.commissionBalance??'',a?.remarks??'',a?.updated_by_name??'',a?.updated_at??'']);
      else payments(b.id).forEach(p=>rows.push([date,b.booking_ref,b.lead_name,a?.invoice_number??'',p.payment_date,p.kind,'MYR',p.amount,p.reference,p.note,p.recorded_by_name,p.created_at,p.voided_at??'',p.void_reason??'']));
    }
    exportCsv(`Lovely-Paradise_${kind==='accounts'?'Booking-Accounts':'Payment-Ledger'}_${date}.csv`,rows);
  }
  return <>
    <div className="sheet-list-toolbar"><div className="sheet-tabs" role="tablist" aria-label="Accounting Views"><button role="tab" aria-selected={tab==='accounts'} onClick={()=>setTab('accounts')}>Booking Accounts</button><button role="tab" aria-selected={tab==='referrers'} onClick={()=>setTab('referrers')}>Commission Terms</button></div>
      <div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} onClick={()=>download('accounts')} disabled={!!error}><Download size={16}/> Accounts CSV</button><button className={secondaryButtonClass} onClick={()=>download('payments')} disabled={!!error}><Download size={16}/> Payments CSV</button></div>
    </div>
    {error?<p role="alert" className="sheet-alert">{error}</p>:tab==='accounts'?<>
      <div className="sheet-totals"><span><strong>{rm(data.payments.filter(p=>!p.voided_at).reduce((n,p)=>n+Math.round(p.amount*100)*(p.kind==='refund'?-1:1),0)/100)}</strong> Net Received</span><span><strong>{active.filter(b=>totals(b.id).status==='Partial').length}</strong> Partly Paid</span><span><strong>{active.filter(b=>totals(b.id).status==='Total Not Entered').length}</strong> Missing Booking Totals</span></div>
      <div className="sheet-account-head" aria-hidden="true"><span>Booking / Invoice</span><span>Agreed Total</span><span>Received</span><span>Balance</span><span>Status</span><span/></div>
      {bookings.map(b=>{const a=account(b.id),t=totals(b.id);return <div key={b.id} className="sheet-account-row">
        <div className="sheet-account-name"><strong>{b.lead_name}</strong><span>{a?.invoice_number||'Invoice Not Set'}</span><span>{b.booking_ref}{!['draft','confirmed','arrived'].includes(b.status)?` · ${b.status}`:''}</span></div>
        <div className="sheet-money"><span>Agreed Total</span><strong>{rm(a?.amount_due??null)}</strong></div><div className="sheet-money"><span>Received</span><strong>{rm(t.paid)}</strong></div><div className="sheet-money"><span>Balance</span><strong>{rm(t.balance)}</strong></div>
        <Badge tone={t.status==='Paid'?'good':t.status==='Partial'?'warn':t.status==='Overpaid'?'bad':'neutral'}>{t.status}</Badge><button className={secondaryButtonClass} onClick={()=>setSelected(b)}>Open Account</button>
      </div>;})}
      {!bookings.length?<p className="sheet-empty">No bookings for this date.</p>:null}
    </>:<>
      <div className="sheet-section-heading"><h2>Referral Commission</h2><button className={buttonClass} onClick={()=>setParty('new')}><Plus size={16}/> Add Referrer</button></div>
      {data.referrers.slice().sort((a,b)=>Number(b.is_default)-Number(a.is_default)||a.name.localeCompare(b.name)).map(r=><div className="sheet-referrer" key={r.id}><div><strong>{r.name}</strong>{r.is_default?<Badge>Default Terms</Badge>:null}</div><span>{terms(r)}</span><button className="sheet-icon" title="Edit Commission Terms" aria-label={`Edit ${r.name}`} onClick={()=>setParty(r)}><Pencil size={16}/></button></div>)}
    </>}
    {selected?<AccountDialog key={selected.id} booking={selected} initial={account(selected.id)} account={account(selected.id)} payments={payments(selected.id)} referrers={data.referrers} busy={busy} save={save} onClose={()=>!busy&&setSelected(null)}/>:null}
    {party?<ReferrerDialog party={party==='new'?null:party} busy={busy} save={save} onClose={()=>!busy&&setParty(null)}/>:null}
  </>;
}

function AccountDialog({booking,initial,account,payments,referrers,busy,save,onClose}:{booking:DailyBooking;initial:BookingAccount|null;account:BookingAccount|null;payments:BookingPayment[];referrers:ReferralParty[];busy:boolean;save:Save;onClose:()=>void}) {
  const [view,setView]=useState('payments');const [due,setDue]=useState(initial?.amount_due?.toString()??'');const [invoice,setInvoice]=useState(initial?.invoice_number??'');const [remarks,setRemarks]=useState(initial?.remarks??'');
  const [editVersion,setEditVersion]=useState(initial?.updated_at??null);
  const [commissionVersion,setCommissionVersion]=useState(initial?.updated_at??null);
  const [date,setDate]=useState(todayIso);const [amount,setAmount]=useState('');const [reference,setReference]=useState('');const [kind,setKind]=useState('receipt');const [voiding,setVoiding]=useState<BookingPayment|null>(null);const [reason,setReason]=useState('');
  const totals=accountTotals(account,payments);
  const mutate=async(action:string,values:Record<string,unknown>,expected=account?.updated_at??null)=>save('save_booking_finance',{p_action:action,p_booking_id:booking.id,p_expected_updated_at:expected,p_values:values});
  const stale=editVersion!==(account?.updated_at??null);
  function reloadForm(){setDue(account?.amount_due?.toString()??'');setInvoice(account?.invoice_number??'');setRemarks(account?.remarks??'');setEditVersion(account?.updated_at??null);}
  return <Modal title={booking.lead_name} onClose={onClose} wide><div className="daily-sheet">
    <div className="sheet-account-summary"><span>Agreed Total<strong>{rm(account?.amount_due??null)}</strong></span><span>Received<strong>{rm(totals.paid)}</strong></span><span>Balance<strong>{rm(totals.balance)}</strong></span><Badge tone={totals.status==='Paid'?'good':'warn'}>{totals.status}</Badge></div>
    <div className="sheet-tabs mb-4" role="tablist" aria-label="Booking Account Sections">{['payments','details','commission'].map(v=><button role="tab" aria-selected={view===v} key={v} onClick={()=>{setView(v);if(v==='details')reloadForm();if(v==='commission')setCommissionVersion(account?.updated_at??null);}}>{v==='payments'?'Payments':v==='details'?'Total & Invoice':'Commission'}</button>)}</div>
    {view==='details'?<form className="sheet-form" onSubmit={async e=>{e.preventDefault();if(await mutate('account',{amount_due:due,invoice_number:invoice,remarks},editVersion))setView('payments');}}><fieldset disabled={busy||stale}>
      <div className="sheet-form-grid"><Field label="Agreed Booking Total (RM)"><input required type="number" min="0" step="0.01" className={inputClass} value={due} onChange={e=>setDue(e.target.value)}/></Field><Field label="Invoice Number"><input className={inputClass} value={invoice} onChange={e=>setInvoice(e.target.value)}/></Field></div><Field label="Accounting Remarks"><textarea rows={3} className={inputClass} value={remarks} onChange={e=>setRemarks(e.target.value)}/></Field><button className={buttonClass}><Check size={16}/> Save Total & Invoice</button>
    </fieldset>{stale?<p role="alert" className="sheet-alert">Account changed. Your edits have not been saved. <button type="button" onClick={reloadForm}>Reload Latest</button></p>:null}</form>:view==='commission'?<CommissionForm key={commissionVersion??'none'} booking={booking} account={account} referrers={referrers} busy={busy} mutate={async(action,values)=>{const saved=await mutate(action,values,commissionVersion);if(saved)setView('payments');return saved;}}/>:<>
      <form className="sheet-payment-form" onSubmit={async e=>{e.preventDefault();if(await mutate('payment',{amount,payment_date:date,kind,reference})){setAmount('');setReference('');}}}>
        <fieldset disabled={busy}><div className="sheet-form-grid"><Field label="Payment Date"><input required type="date" max={todayIso()} className={inputClass} value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Amount (RM)"><input required type="number" min="0.01" step="0.01" className={inputClass} value={amount} onChange={e=>setAmount(e.target.value)}/></Field><Field label="Type"><select className={inputClass} value={kind} onChange={e=>setKind(e.target.value)}><option value="receipt">Payment Received</option><option value="refund">Refund to Guest</option></select></Field><Field label="Payment Reference"><input className={inputClass} value={reference} onChange={e=>setReference(e.target.value)}/></Field></div><button className={buttonClass}><Plus size={16}/> Record {kind==='receipt'?'Payment':'Refund'}</button></fieldset>
      </form>
      <h3 className="sheet-subheading">Payment History</h3>{payments.length?payments.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(p=><div className={`sheet-payment-row ${p.voided_at?'opacity-60':''}`} key={p.id}><div><strong>{p.payment_date}</strong><span>{p.kind==='refund'?'Refund':'Received'}{p.voided_at?' · Voided':''}</span></div><div><strong>{rm(p.amount)}</strong><span>{p.reference||'No Reference'}</span></div><div><span>{p.recorded_by_name}</span><time>{new Date(p.created_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})} MYT</time>{p.void_reason?<span>{p.void_reason}</span>:null}</div>{!p.voided_at?<button className="sheet-icon" title="Void Incorrect Entry" aria-label={`Void ${p.payment_date} ${p.amount}`} disabled={busy} onClick={()=>{setVoiding(p);setReason('');}}><Ban size={16}/></button>:null}</div>):<p className="sheet-empty">No payments recorded.</p>}
    </>}
    {voiding?<Modal title="Void Incorrect Payment" onClose={()=>!busy&&setVoiding(null)}><form className="sheet-form" onSubmit={async e=>{e.preventDefault();if(await mutate('void_payment',{id:voiding.id,reason}))setVoiding(null);}}><p>{voiding.payment_date} · {rm(voiding.amount)}</p><Field label="Reason"><textarea required minLength={3} className={inputClass} value={reason} onChange={e=>setReason(e.target.value)}/></Field><button className={buttonClass} disabled={busy}>Confirm Void</button></form></Modal>:null}
  </div></Modal>;
}

function CommissionForm({booking,account,referrers,busy,mutate}:{booking:DailyBooking;account:BookingAccount|null;referrers:ReferralParty[];busy:boolean;mutate:(action:string,values:Record<string,unknown>)=>Promise<boolean>}) {
  const [party,setParty]=useState(account?.referrer_id??'');const [inherit,setInherit]=useState(!account?.commission_method);const [method,setMethod]=useState(account?.commission_method??'percent');const [rate,setRate]=useState(account?.commission_rate?.toString()??'');const [base,setBase]=useState((account?.commission_base??account?.amount_due)?.toString()??'');const [pax,setPax]=useState(account?.commission_pax?.toString()??'');const [payout,setPayout]=useState('');
  const t=accountTotals(account,[]);const selected=referrers.find(r=>r.id===party);const applied=selected?.method?selected:referrers.find(r=>r.is_default);const resolved=inherit?applied?.method:method;
  return <div className="sheet-form"><form onSubmit={async e=>{e.preventDefault();await mutate('commission',{referrer_id:party||null,use_party_terms:inherit,method,rate,base,pax:pax||0});}}><fieldset disabled={busy||account?.amount_due==null}>
    <Field label="Referrer"><select className={inputClass} value={party} onChange={e=>{setParty(e.target.value);setInherit(true);}}><option value="">No Referral</option>{referrers.filter(r=>!r.is_default&&r.active).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    {party?<><label className="sheet-toggle"><input type="checkbox" checked={inherit} onChange={e=>setInherit(e.target.checked)}/> Use Referrer's Current Terms <span>{applied?terms(applied):'Not Set'}</span></label>{!inherit?<div className="sheet-form-grid"><Field label="Commission Method"><select className={inputClass} value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="percent">Percentage</option><option value="fixed">Fixed per Booking</option><option value="per_pax">Fixed per Eligible Pax</option></select></Field><Field label={method==='percent'?'Rate (%)':'Rate (RM)'}><input required type="number" min="0" max={method==='percent'?100:undefined} step="0.01" className={inputClass} value={rate} onChange={e=>setRate(e.target.value)}/></Field></div>:null}
      {resolved==='percent'?<Field label="Commissionable Amount (RM)"><input required type="number" min="0" step="0.01" className={inputClass} value={base} onChange={e=>setBase(e.target.value)}/></Field>:resolved==='per_pax'?<Field label="Commissionable Passengers"><input required type="number" min="1" step="1" className={inputClass} value={pax} onChange={e=>setPax(e.target.value)}/></Field>:null}
    </>:null}<button className={buttonClass}><Check size={16}/> Save Booking Commission</button>
    </fieldset></form>{account?.amount_due==null?<p className="sheet-alert">Save the agreed total under Total & Invoice first.</p>:null}
    <div className="sheet-account-summary"><span>Commission<strong>{rm(t.commission)}</strong></span><span>Paid to Referrer<strong>{rm(account?.commission_paid??0)}</strong></span><span>Outstanding<strong>{rm(t.commissionBalance)}</strong></span></div>
    {(t.commissionBalance??0)>0?<form className="sheet-inline-form" onSubmit={async e=>{e.preventDefault();if(await mutate('commission_paid',{amount:payout}))setPayout('');}}><Field label="Commission Paid (RM)"><input required type="number" min="0.01" max={t.commissionBalance!} step="0.01" className={inputClass} value={payout} onChange={e=>setPayout(e.target.value)}/></Field><button className={secondaryButtonClass} disabled={busy}>Record Payout</button></form>:null}
  </div>;
}

function ReferrerDialog({party,busy,save,onClose}:{party:ReferralParty|null;busy:boolean;save:Save;onClose:()=>void}) {
  const [name,setName]=useState(party?.name??'');const [method,setMethod]=useState(party?.method??'');const [rate,setRate]=useState(party?.rate?.toString()??'');
  return <Modal title={party?'Edit Commission Terms':'Add Referrer'} onClose={onClose}><form className="daily-sheet sheet-form" onSubmit={async e=>{e.preventDefault();if(await save('save_referral_party',{p_id:party?.id??null,p_expected_updated_at:party?.updated_at??null,p_name:name,p_method:method||null,p_rate:method?Number(rate):null}))onClose();}}><fieldset disabled={busy}>
    <Field label="Name"><input required className={inputClass} readOnly={party?.is_default} value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Commission Method"><select className={inputClass} value={method} onChange={e=>setMethod(e.target.value)}><option value="">{party?.is_default?'Not Set':'Use General Commission'}</option><option value="percent">Percentage</option><option value="fixed">Fixed per Booking</option><option value="per_pax">Fixed per Eligible Pax</option></select></Field>{method?<Field label={method==='percent'?'Rate (%)':'Rate (RM)'}><input required type="number" min="0" max={method==='percent'?100:undefined} step="0.01" className={inputClass} value={rate} onChange={e=>setRate(e.target.value)}/></Field>:null}<p className="sheet-note">Applies when terms are selected for a booking. Saved booking commissions stay unchanged.</p><button className={buttonClass}><Check size={16}/> Save Terms</button>
  </fieldset></form></Modal>;
}
