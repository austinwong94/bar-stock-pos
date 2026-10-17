import { db, can, require as requirePermission, currentUserIdRef, userHasPermission, canViewBooking, manifestRows, demoPrivacy } from './demoBackend';
import { redactGuest } from './guestPrivacy';
type Row=Record<string,any>;
const actor=()=>currentUserIdRef.value;
const profile=(id:string|null)=>db.profiles.find(p=>p.id===id);
const demand=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};

export const demoPrivacyHandlers:Record<string,(p:Row)=>any>={
  admin_guest_privacy(){
    requirePermission('platform.roles.manage');
    return db.profiles.map(p=>{
      const rule=(db.guest_privacy_rules??[]).find(r=>r.user_id===p.id),role=db.access_roles.find(r=>r.code===p.access_role_code);
      const restricted=!!p.agency_id||p.access_role_code==='external_planner'||!!p.is_anonymous;
      return {user_id:p.id,name:p.full_name,role:role?.name??p.access_role_code,agency:db.agencies.find(a=>a.id===p.agency_id)?.name??null,restricted,master:!!role?.is_master,
        mode:role?.is_master&&!restricted?'history':rule?.mode==='history'&&restricted?'names_contacts':rule?.mode??'names_contacts',hide_after_days:rule?.hide_after_days??1,
        version:rule?.version??0,updated_by:profile(rule?.updated_by)?.full_name??null,updated_at:rule?.updated_at??null,finance_allowed:userHasPermission(p.id,'guests.finance.manage')};
    }).sort((a,b)=>Number(b.master)-Number(a.master)||a.name.localeCompare(b.name));
  },
  admin_save_guest_privacy(p){
    requirePermission('platform.roles.manage');
    const person=profile(p.p_user_id);demand(person,'Account not found.');
    demand(!db.access_roles.some(r=>r.code===person!.access_role_code&&r.is_master),'Boss accounts retain history.');
    demand(['contacts','names_contacts','history'].includes(p.p_mode)&&Number.isInteger(p.p_days)&&p.p_days>=1&&p.p_days<=365,'Choose a privacy rule and 1-365 days.');
    const restricted=person!.agency_id||person!.access_role_code==='external_planner'||person!.is_anonymous;
    demand(!(restricted&&p.p_mode==='history'),'External, agency and shared accounts cannot retain guest history.');
    demand(!(restricted&&p.p_finance),'External, agency and shared accounts cannot access accounts or commission.');
    db.guest_privacy_rules??=[];
    const old=db.guest_privacy_rules.find(r=>r.user_id===p.p_user_id);
    demand((old?.version??0)===p.p_expected_version,'Changed on another device. Reload before saving.');
    if(p.p_finance!=null)demand(userHasPermission(p.p_user_id,'guests.finance.manage')===p.p_expected_finance,'Financial access changed on another device. Reload before saving.');
    if(p.p_finance!=null&&p.p_finance!==p.p_expected_finance){
      requirePermission('platform.users.manage');
      db.user_permission_overrides=db.user_permission_overrides.filter(r=>!(r.user_id===p.p_user_id&&r.permission_code==='guests.finance.manage'));
      db.user_permission_overrides.push({user_id:p.p_user_id,permission_code:'guests.finance.manage',effect:p.p_finance?'grant':'revoke'});
    }
    const next={user_id:p.p_user_id,mode:p.p_mode,hide_after_days:p.p_days,version:(old?.version??0)+1,updated_by:actor(),updated_at:new Date().toISOString()};
    db.guest_privacy_rules=db.guest_privacy_rules.filter(r=>r.user_id!==p.p_user_id).concat(next);
    db.audit_logs.push({id:crypto.randomUUID(),actor_id:actor(),action:'guest_privacy_changed',entity_type:'guest_privacy_rules',entity_id:p.p_user_id,before_json:old??null,after_json:next,created_at:next.updated_at});
  },
  read_guest_bookings(p){
    if(profile(actor())?.access_role_code==='external_planner')return [];
    return db.bookings.filter(b=>(!p.p_date||b.service_date===p.p_date)&&canViewBooking(b.id)).sort((a,b)=>b.service_date.localeCompare(a.service_date)).slice(0,500).map(b=>redactGuest({...b,agencies:db.agencies.find(a=>a.id===b.agency_id)??null,
      tourists:db.tourists.filter(t=>t.booking_id===b.id).map(t=>({...t,tourist_private:can('guests.contact.view')?db.tourist_private.find(v=>v.tourist_id===t.id)??null:null}))},demoPrivacy(b.service_date)));
  },
  read_staff_manifest(p){return manifestRows().filter(r=>r.service_date===p.p_date&&canViewBooking(r.booking_id)&&(!p.p_arrived_only||r.boarding_status==='arrived')).map(r=>redactGuest(r,demoPrivacy(p.p_date)));},
};

export function filterDemoGuestResult(name:string,p:Row,data:any){
  if(['read_daily_booking_sheet','read_pickup_board'].includes(name))return {...data,bookings:redactGuest(data.bookings,demoPrivacy(p.p_date)),...(name==='read_daily_booking_sheet'?demoPrivacy(p.p_date):{})};
  if(['read_guest_meal_needs','read_booking_accounts'].includes(name))return redactGuest(data,demoPrivacy(p.p_date));
  const date=db.bookings.find(b=>b.id===p.p_booking_id)?.service_date;
  if(['booking_history','read_booking_change_log'].includes(name)&&demoPrivacy(date).contacts_hidden)return data.map((r:Row)=>({...r,details:null,reason:null,summary:'Private details hidden'}));
  return data;
}
export function guardDemoGuestWrite(name:string,p:Row){
  if(name==='boat_assignment_message'&&demoPrivacy(p.p_service_date).contacts_hidden)throw new Error('Guest details for this date are private.');
  if(name==='save_booking_finance'&&p.p_action==='account'){
    const b=db.bookings.find(b=>b.id===p.p_booking_id),a=db.booking_accounts.find(a=>a.booking_id===p.p_booking_id);
    if(b&&demoPrivacy(b.service_date).contacts_hidden&&a&&(p.p_values?.remarks??'')!==a.remarks)throw new Error('Accounting remarks are private for this date. Ask an authorised PIC to edit the total and invoice.');
  }
  if(!['save_booking','save_daily_booking','save_departure_assignment'].includes(name))return;
  const id=p.p_booking_id??p.p_booking?.id;
  const b=db.bookings.find(b=>b.id===id);
  if(b&&demoPrivacy(b.service_date).contacts_hidden)throw new Error('Guest details for this date are private. Ask an authorised PIC to edit this record.');
}
