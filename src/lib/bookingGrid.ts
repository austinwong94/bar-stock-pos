import Papa from 'papaparse';
import { format, isValid, parse } from 'date-fns';
import { accountTotals, bookingPaymentDone, bookingCounts, type BookingAccount, type BookingPayment, type DailyBooking, type DailySheet, type ReferralParty } from './bookingOperations';

export type GridValues = Record<string, string>;
export type GridRow = { key:string; booking:DailyBooking|null; account:BookingAccount|null; payments:BookingPayment[]; values:GridValues; original:GridValues };
export type GridAccounts = {accounts:BookingAccount[];payments:BookingPayment[];referrers:ReferralParty[]};
export type GridColumn = {key:string;label:string;width:number;section:'booking'|'planning'|'accounts';title?:string;readOnly?:boolean;lookup?:string};
export const gridColumns:GridColumn[] = [
  {key:'time',label:'Time',width:95,section:'booking'},
  {key:'name',label:'Guest Name',width:220,section:'booking'},
  {key:'phone',label:'Contact No.',width:160,section:'booking'},
  ...['A','C','I','T/L','TG'].map((label,i)=>({key:['adults','children','infants','tour_leaders','tour_guides'][i],label,width:54,section:'booking' as const,title:['Adults','Children','Infants','Tour Leader (Local)','Tour Guide (China)'][i]})),
  {key:'pickup',label:'Pick Up',width:210,section:'booking'},
  {key:'tour',label:'Tour',width:235,section:'booking'},
  {key:'dropoff',label:'Drop Off',width:185,section:'booking'},
  {key:'guide',label:'Guide',width:150,section:'planning',lookup:'guide'},
  {key:'guide_phone',label:'Contact No.',width:145,section:'planning',readOnly:true,title:'Guide Contact No. (Directory)'},
  {key:'driver',label:'Driver',width:145,section:'planning',lookup:'driver'},
  {key:'driver_phone',label:'Contact No.',width:145,section:'planning',readOnly:true,title:'Driver Contact No. (Directory)'},
  {key:'vehicle',label:'Vehicle No.',width:150,section:'planning',lookup:'vehicle'},
  {key:'boat',label:'Boat No.',width:150,section:'planning',lookup:'boat'},
  {key:'captain',label:'Boat Captain',width:150,section:'planning',lookup:'captain'},
  {key:'crew',label:'Boat Crew',width:170,section:'planning',lookup:'crew'},
  {key:'remarks',label:'Remark',width:250,section:'booking'},
  {key:'refer',label:'Refer',width:180,section:'accounts',lookup:'refer'},
  {key:'date1',label:'Payment Date 1',width:145,section:'accounts'},
  {key:'amount1',label:'Amount 1 (RM)',width:140,section:'accounts'},
  {key:'date2',label:'Payment Date 2',width:145,section:'accounts'},
  {key:'amount2',label:'Amount 2 (RM)',width:140,section:'accounts'},
  {key:'paid',label:'Done',width:72,section:'accounts',title:'Payment Confirmed'},
  {key:'invoice',label:'Invoice No.',width:200,section:'accounts'},
  {key:'account_notes',label:'Accounting Remark',width:240,section:'accounts'},
  {key:'total',label:'Booking Total (RM)',width:155,section:'accounts'},
  {key:'agency',label:'Agency',width:180,section:'booking',lookup:'agency'},
  {key:'net_paid',label:'Net Paid (RM)',width:145,section:'accounts',readOnly:true,title:'Saved receipts less refunds, including payments beyond the first two columns'},
  {key:'balance',label:'Balance (RM)',width:145,section:'accounts',readOnly:true,title:'Saved booking total less net payments; negative means overpaid'},
  {key:'payment_count',label:'Payment Records',width:145,section:'accounts',readOnly:true,title:'All saved receipts and refunds, excluding voided records'},
];
export const gridCountKeys=['adults','children','infants','tour_leaders','tour_guides'] as const;
export const blankGridRow=():GridRow=>({key:crypto.randomUUID(),booking:null,account:null,payments:[],values:{},original:{}});
export const changedGridRow=(row:GridRow)=>Object.keys(row.values).some(k=>(row.values[k]??'')!==(row.original[k]??''));
const normalizeLabel=(value:string)=>value.trim().toLocaleLowerCase();
export const gridDoneChecked=(value:string='')=>['true','done','paid','overpaid','yes','1'].includes(normalizeLabel(value));
function doneValue(value:string='') {
  if(gridDoneChecked(value))return true;
  if(['','false','no','0','unpaid','partial','amount not set','total not entered'].includes(normalizeLabel(value)))return false;
  throw new Error('Done must be ticked or unticked. Pasted cells can use Done, Yes, No, TRUE or FALSE.');
}

// Resource staff belong to the day's boat/van, not to an individual booking.
export function patchGridCell(sheet:DailySheet,list:GridRow[],index:number,key:string,value:string) {
  const row=list[index];
  const previousResource=row.values[key]||'';
  row.values={...row.values,[key]:value};
  const contact=(name:string,role:string)=>{
    const matches=sheet.employees.filter(e=>normalizeLabel(e.full_name)===normalizeLabel(name)&&e.job_type===role);
    return matches.length===1?matches[0].phone||'':'';
  };
  const employee=(id:string|null|undefined)=>sheet.employees.find(e=>e.id===id)?.full_name||'';
  if(key==='boat'||key==='vehicle') {
    const resources=key==='boat'?sheet.available_boats:sheet.vehicles;
    if(resources.some(r=>normalizeLabel(r.code)===normalizeLabel(previousResource))&&normalizeLabel(previousResource)!==normalizeLabel(value)) {
      for(const field of key==='boat'?['captain','crew']:['driver','driver_phone'])row.values[field]='';
    }
    const matches=resources.filter(r=>normalizeLabel(r.code)===normalizeLabel(value));
    if(matches.length===1||!value.trim()) {
      const peers=list.filter(other=>other.key!==row.key&&normalizeLabel(other.values[key]||'')===normalizeLabel(value));
      const assignedBoat=sheet.boats.filter(b=>b.boat_id===matches[0]?.id);
      const assignedVans=sheet.runs.filter(v=>v.vehicle_id===matches[0]?.id);
      for(const field of key==='boat'?['captain','crew']:['driver']) {
        const saved=field==='captain'?assignedBoat.map(b=>employee(b.captain_employee_id))
          :field==='crew'?assignedBoat.map(b=>b.crew_employee_ids.map(employee).filter(Boolean).join('; '))
          :assignedVans.map(v=>employee(v.driver_employee_id));
        const choices=[...new Set((peers.length?peers.map(r=>r.values[field]||''):saved))];
        const changedResource=resources.some(r=>normalizeLabel(r.code)===normalizeLabel(previousResource))&&normalizeLabel(previousResource)!==normalizeLabel(value);
        row.values[field]=!value.trim()?'':choices.length===1?choices[0]:choices.length>1||changedResource?'':row.values[field]||'';
      }
      if(key==='vehicle')row.values.driver_phone=contact(row.values.driver,'driver');
    }
  }
  if(key==='guide'||key==='driver')row.values[key+'_phone']=contact(value,key);
  if(['captain','crew','driver'].includes(key)) {
    const resource=key==='driver'?'vehicle':'boat',label=normalizeLabel(row.values[resource]||'');
    if(label)for(const other of list)if(other.key!==row.key&&normalizeLabel(other.values[resource]||'')===label) {
      other.values={...other.values,[key]:value};
      if(key==='driver')other.values.driver_phone=row.values.driver_phone;
    }
  }
}
export function gridRows(sheet:DailySheet,accounts:GridAccounts):GridRow[]{
  const employee=(id:string|null|undefined)=>sheet.employees.find(e=>e.id===id);
  return sheet.bookings.map(b=>{
    const a=sheet.boats.find(a=>a.id===b.assignment_id),van=sheet.runs.find(g=>g.id===b.pickup_group_id),account=accounts.accounts.find(a=>a.booking_id===b.id)??null;
    const payments=accounts.payments.filter(p=>p.booking_id===b.id&&!p.voided_at&&p.kind==='receipt').sort((a,b)=>a.payment_date.localeCompare(b.payment_date)||a.created_at.localeCompare(b.created_at));
    const values:GridValues={time:b.pickup_time?.slice(0,5)||'',name:b.lead_name,phone:b.lead_phone||'',...Object.fromEntries(Object.entries(bookingCounts(b)).map(([k,v])=>[k,v?String(v):''])),pickup:b.pickup_required?b.pickup_hotel_name||'':'Own Transport',tour:b.tour_name||'',dropoff:b.dropoff_location||'',guide:employee(b.guide_employee_id)?.full_name||'',guide_phone:employee(b.guide_employee_id)?.phone||'',driver:employee(van?.driver_employee_id)?.full_name||'',driver_phone:employee(van?.driver_employee_id)?.phone||'',vehicle:sheet.vehicles.find(v=>v.id===van?.vehicle_id)?.code||'',boat:a?.code||'',captain:employee(a?.captain_employee_id)?.full_name||'',crew:a?.crew_employee_ids.map(id=>employee(id)?.full_name).filter(Boolean).join('; ')||'',remarks:b.ops_notes||'',refer:accounts.referrers.find(r=>r.id===account?.referrer_id)?.name||'',date1:payments[0]?.payment_date||'',amount1:payments[0]?String(payments[0].amount):'',date2:payments[1]?.payment_date||'',amount2:payments[1]?String(payments[1].amount):'',paid:String(bookingPaymentDone(account,accounts.payments.filter(p=>p.booking_id===b.id))),invoice:account?.invoice_number||'',account_notes:account?.remarks||'',total:account?.amount_due==null?'':String(account.amount_due),agency:sheet.agencies.find(a=>a.id===b.agency_id)?.name||''};
    const allPayments=accounts.payments.filter(p=>p.booking_id===b.id&&!p.voided_at);
    const totals=accountTotals(account,allPayments);
    values.net_paid=totals.paid.toFixed(2);
    values.balance=totals.balance==null?'':totals.balance.toFixed(2);
    values.payment_count=String(allPayments.length);
    return {key:b.id,booking:b,account,payments,values,original:{...values}};
  });
}
export function parseGridPaste(text:string):string[][] {
  const result=Papa.parse<string[]>(text,{delimiter:'\t',skipEmptyLines:'greedy'});
  if(result.errors.length)throw new Error('The pasted cells have unmatched quotes. Copy the cells from Excel again.');
  if(result.data.length>200)throw new Error('Paste up to 200 booking rows at a time.');
  return result.data;
}
export function gridDate(value:string,serviceDate:string):string {
  const text=value.trim();if(!text)return '';
  for(const pattern of ['yyyy-MM-dd','dd/MM/yyyy','d/M/yyyy','d.M.yyyy','d-MMM-yyyy','d-MMM-yy','d-MMM','d MMM yyyy']) {
    const result=parse(text,pattern,new Date(serviceDate+'T12:00:00'));
    if(isValid(result))return format(result,'yyyy-MM-dd');
  }
  throw new Error('Use a real payment date, for example 04/08/2026.');
}
export function gridTime(value:string):string|null {
  const period=value.trim().match(/(am|pm)$/i)?.[1].toLowerCase();
  const text=value.trim().replace(/\s*(hrs?|am|pm)$/i,'');if(!text||/^tba$/i.test(text))return null;
  const match=text.match(/^(\d{1,2}):?(\d{2})$/);if(!match||Number(match[1])>23||Number(match[2])>59)throw new Error('Time must be HH:MM or HHMM, for example 06:45 or 0645HRS.');
  let hour=Number(match[1]);if(period){if(hour<1||hour>12)throw new Error('AM/PM hours must be between 1 and 12.');hour=hour%12+(period==='pm'?12:0);}
  return String(hour).padStart(2,'0')+':'+match[2];
}
function amount(text:string){if(!/^\d+(\.\d{1,2})?$/.test(text.trim()))throw new Error('Enter an RM amount with at most two decimals.');return Number(text);}
export function gridPayload(rows:GridRow[],sheet:DailySheet,accounts:GridAccounts,date:string){
  const boats=new Map<string,Record<string,unknown>>(),vans=new Map<string,Record<string,unknown>>();
  const resolve=(label:string,options:{id:string;name:string}[],kind:string)=>{if(!label.trim())return null;const matches=options.filter(x=>x.name.trim().toLowerCase()===label.trim().toLowerCase());if(matches.length!==1)throw new Error(`Choose a registered ${kind}: "${label}" was not uniquely matched.`);return matches[0].id;};
  const person=(text:string,role:string)=>resolve(text,sheet.employees.filter(e=>e.job_type===role).map(e=>({id:e.id,name:e.full_name})),role);
  const merge=(map:Map<string,Record<string,unknown>>,id:string,value:Record<string,unknown>)=>{const current=map.get(id)||{};for(const key of Object.keys(value)){if(key in current&&JSON.stringify(current[key])!==JSON.stringify(value[key]))throw new Error('Rows for the same boat or van have conflicting staff.');}map.set(id,{...current,...value});};
  const changed=rows.flatMap((row,index)=>{
    if(!changedGridRow(row))return [];
    try{
      const v=row.values,dirty=(k:string)=>!row.booking||(v[k]||'')!==(row.original[k]||'');
      const booking:Record<string,unknown>={},assignment:Record<string,unknown>={},finance:Record<string,unknown>={};
      if(!v.name?.trim())throw new Error('Enter the Guest Name for this booking row.');
      const mapping={name:'lead_name',phone:'lead_phone',pickup:'pickup_hotel_name',tour:'tour_name',dropoff:'dropoff_location',remarks:'ops_notes'};
      for(const [key,field]of Object.entries(mapping))if(dirty(key))booking[field]=(v[key]||'').trim();
      if(!row.booking&&!v.tour?.trim())booking.tour_name='Lovely Paradise Day Trip';
      if(dirty('pickup')){booking.pickup_required=!/^(own transport|ex jetty)$/i.test(v.pickup?.trim()||'');if(!booking.pickup_required)booking.pickup_hotel_name='';}
      if(dirty('time')){const time=gridTime(v.time||'');if(sheet.restricted)assignment.pickup_time=time;else booking.pickup_time=time;}
      if(gridCountKeys.some(dirty)){const counts=Object.fromEntries(gridCountKeys.map(k=>{if(!/^\d*$/.test(v[k]||''))throw new Error(`${k}: enter a whole passenger count.`);return[k,Number(v[k]||0)];}));if(Object.values(counts).reduce((a,b)=>a+b,0)<1)throw new Error('Enter at least one passenger in A, C, I, T/L or TG.');booking.counts=counts;}
      if(dirty('agency')){booking.agency_id=resolve(v.agency||'',sheet.agencies,'agency');booking.source_type=booking.agency_id?'agent':'in_house';}
      const boat=resolve(v.boat||'',sheet.available_boats.map(b=>({id:b.id,name:b.code})),'boat');
      if(dirty('boat')&&(v.boat||row.original.boat))assignment.boat_id=boat;
      if(boat&&(dirty('boat')||dirty('captain')||dirty('crew'))){const a=sheet.boats.find(a=>a.boat_id===boat);const res:Record<string,unknown>={boat_id:boat,expected:a?.updated_at??null};
        if(dirty('captain')&&(v.captain||row.original.captain))res.captain=person(v.captain||'','captain');
        if(dirty('crew')&&(v.crew||row.original.crew))res.crew=(v.crew||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>person(x,'crew'));
        merge(boats,boat,res);
      }else if(!boat&&(v.captain||v.crew))throw new Error('Enter Boat No. before assigning its captain or crew.');
      const vehicle=resolve(v.vehicle||'',sheet.vehicles.map(b=>({id:b.id,name:b.code})),'van');
      if(dirty('vehicle')&&(v.vehicle||row.original.vehicle))assignment.vehicle_id=vehicle;
      if(vehicle&&(dirty('vehicle')||dirty('driver'))){const g=sheet.runs.find(g=>g.vehicle_id===vehicle);const res:Record<string,unknown>={vehicle_id:vehicle,expected:g?.updated_at??null};if(dirty('driver')&&(v.driver||row.original.driver))res.driver=person(v.driver||'','driver');merge(vans,vehicle,res);}
      else if(!vehicle&&v.driver)throw new Error('Enter Vehicle No. before assigning its driver.');
      if(dirty('guide')&&(v.guide||row.original.guide))assignment.guide_employee_id=person(v.guide||'','guide');
      for(const [key,field]of Object.entries({invoice:'invoice_number',account_notes:'remarks'}))if(dirty(key)&&(v[key]||row.original[key]))finance[field]=v[key]||'';
      if(dirty('total')&&(v.total||row.original.total))finance.amount_due=v.total?amount(v.total):null;
      if(dirty('paid')&&(v.paid||row.original.paid))finance.payment_done=doneValue(v.paid);
      if(dirty('refer')&&(v.refer||row.original.refer)){const found=accounts.referrers.find(r=>!r.is_default&&r.name.toLowerCase()===v.refer?.trim().toLowerCase());if(found||!v.refer)finance.referrer_id=found?.id??null;else finance.referrer_name=v.refer.trim();}
      const payments=[];for(const slot of [1,2]){if(!row.payments[slot-1]&&(v['date'+slot]||v['amount'+slot])){if(!v['date'+slot]||!v['amount'+slot])throw new Error(`Payment ${slot} needs both its actual date and amount.`);payments.push({payment_date:gridDate(v['date'+slot],date),amount:amount(v['amount'+slot]),reference:`Sheet Payment ${slot}`});}}
      if(payments.length)finance.payments=payments;
      return [{key:row.key,number:index+1,id:row.booking?.id??null,expected:row.booking?.updated_at??null,account_expected:row.account?.updated_at??null,booking,assignment,finance}];
    }catch(e){throw new Error(`Row ${index+1}: ${(e as Error).message}`);}
  });
  return {p_date:date,p_rows:changed,p_resources:{boats:[...boats.values()],vans:[...vans.values()]}};
}
