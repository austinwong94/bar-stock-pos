import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, GripHorizontal, History, Maximize2, Minimize2, Minus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import Papa from 'papaparse';
import { buttonClass, iconButtonClass, secondaryButtonClass } from '../../components/Form';
import { ViewChoices } from '../../components/ViewChoices';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import { supabase } from '../../lib/supabase';
import { definitiveSaveFailure } from '../../lib/saveAttempt';
import { blankGridRow, changedGridRow, gridDoneChecked, gridColumns, gridCountKeys, gridPayload, gridRows, parseGridPaste, patchGridCell, type GridAccounts, type GridColumn, type GridRow } from '../../lib/bookingGrid';
import { defaultSheetView, readSheetView, sheetDateLabel, sheetViewKey } from '../../lib/bookingSheetView';
import type { DailyBooking, DailySheet } from '../../lib/bookingOperations';
import '../../booking-grid.css';

export type SheetDay={date:string;sheet:DailySheet|null;error?:string};
type Panel={sheet:DailySheet;accounts:GridAccounts;rows:GridRow[];loaded:boolean;error?:string};
type PendingSave={rpc:string;payload:Record<string,unknown>;dates:string[]};
type Props={date:string;sheet?:DailySheet;days?:SheetDay[];reload:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy?:(v:boolean)=>void;onDraftSafe?:(v:boolean)=>void;onHistory:(b:DailyBooking)=>void;onAccounts:(date:string)=>void};
const emptyAccounts:GridAccounts={accounts:[],payments:[],referrers:[]};

export default function BookingSpreadsheet({date,sheet,days,reload,onDirty,onBusy,onDraftSafe,onHistory,onAccounts}:Props){
  const {can,profile}=useAccess();
  const {text:t}=useLanguage();
  const canWrite=can('guests.sheet.write'),canPlan=can('fleet.assign')||can('guests.plan.manage'),canFinance=can('guests.finance.manage');
  const entries=useMemo<SheetDay[]>(()=>days??(sheet?[{date,sheet}]:[]),[date,sheet,days]);
  const weekly=!!days,scope=entries.map(d=>d.date).join(','),pendingKey=`booking-grid-pending:${profile?.id}`,lastDay=entries[entries.length-1];
  const draftKey=(d:string)=>`booking-grid-draft:${profile?.id}:${d}`;
  const [panels,setPanels]=useState<Record<string,Panel>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [wide,setWide]=useState(false),[section,setSection]=useState('all'),[retry,setRetry]=useState(0),[view,setView]=useState(readSheetView),[viewError,setViewError]=useState('');
  const [position,setPosition]=useState(0),[maxScroll,setMaxScroll]=useState(0);
  const [viewportWidth,setViewportWidth]=useState(()=>window.innerWidth);
  const [pending,setPending]=useState<PendingSave|null>(()=>{try{const p=JSON.parse(sessionStorage.getItem(pendingKey)||'null');return p&&['save_booking_spreadsheet','save_booking_sheet_range'].includes(p.rpc)&&p.payload&&Array.isArray(p.dates)?p:null;}catch{return null;}});
  const writing=useRef(false),scrollRef=useRef<HTMLDivElement>(null),tableRef=useRef<HTMLTableElement>(null);
  const previousDate=useRef(date);
  const drag=useRef<{key:string;start:number;size:number}|null>(null);
  const dirtyCount=Object.values(panels).reduce((n,p)=>n+p.rows.filter(changedGridRow).length,0),locked=busy||!!pending;
  const restricted=entries.some(d=>d.sheet?.restricted);
  const columns=gridColumns.filter(c=>(!restricted||!['phone','agency'].includes(c.key))&&(c.section!=='accounts'||canFinance)&&(section==='all'||c.key==='name'||c.section===section));
  // Keep a readable name column without letting it cover the entire phone sheet.
  const width=(c:GridColumn)=>c.key==='name'&&viewportWidth<640?Math.min(view.widths[c.key]??c.width,Math.floor(viewportWidth*.44/(view.zoom/100))):view.widths[c.key]??c.width;
  useEffect(()=>{const resize=()=>setViewportWidth(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);

  useEffect(()=>{
    let active=true;
    void (async()=>{
      for(const day of entries){
        if(!day.sheet)continue;
        let accounts=emptyAccounts,loadError='';
        try{if(canFinance){const r=await supabase.rpc('read_booking_accounts',{p_date:day.date});if(r.error)throw r.error;accounts=r.data as GridAccounts;}}catch(e){loadError=(e as Error).message||'Could not load payment records.';}
        if(!active)return;
        let recovered:{rows:GridRow[];sheet:DailySheet}|null=null;
        try{const s=JSON.parse(sessionStorage.getItem(`booking-grid-draft:${profile?.id}:${day.date}`)||'null');if(s?.version===1&&Array.isArray(s.rows)&&s.sheet?.bookings)recovered=s;}catch{/* A missing draft does not prevent reading saved records. */}
        setPanels(current=>{
          const previous=current[day.date];
          const privateDay=day.sheet?.contacts_hidden;
          const retain=privateDay?null:previous?.rows.some(changedGridRow)?previous:recovered;
          if(privateDay)sessionStorage.removeItem(`booking-grid-draft:${profile?.id}:${day.date}`);
          return {...current,[day.date]:{sheet:retain?.sheet??day.sheet!,accounts,loaded:!loadError,error:loadError,rows:retain?.rows??[...gridRows(day.sheet!,accounts),...Array.from({length:canWrite?(weekly?1:5):0},blankGridRow)]}};
        });
      }
    })();return()=>{active=false;};
  },[entries,canFinance,canWrite,profile?.id,retry,weekly]);

  useEffect(()=>{
    let safe=true;
    for(const [d,p] of Object.entries(panels))try{
      if(p.rows.some(changedGridRow))sessionStorage.setItem(`booking-grid-draft:${profile?.id}:${d}`,JSON.stringify({version:1,rows:p.rows,sheet:p.sheet}));
      else sessionStorage.removeItem(`booking-grid-draft:${profile?.id}:${d}`);
    }catch{safe=false;}
    onDirty(dirtyCount>0||!!pending);onBusy?.(locked);onDraftSafe?.(safe);
    if(!safe)setError('This browser cannot retain drafts. Keep this sheet open until it is saved.');
  },[panels,dirtyCount,pending,locked,onDirty,onBusy,onDraftSafe,profile?.id]);
  useEffect(()=>()=>{onDirty(false);onBusy?.(false);onDraftSafe?.(true);},[onDirty,onBusy,onDraftSafe]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirtyCount||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirtyCount,pending]);
  useEffect(()=>{try{localStorage.setItem(sheetViewKey,JSON.stringify(view));setViewError('');}catch{setViewError('View settings apply now, but this browser could not remember them.');}},[view]);
  useEffect(()=>{
    const el=scrollRef.current,table=tableRef.current;if(!el||!table)return;
    const update=()=>{setPosition(el.scrollLeft);setMaxScroll(Math.max(0,el.scrollWidth-el.clientWidth));};
    const observer=new ResizeObserver(update);observer.observe(el);observer.observe(table);el.addEventListener('scroll',update);update();
    return()=>{observer.disconnect();el.removeEventListener('scroll',update);};
  },[scope,section,view.zoom,view.widths,wide]);
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setWide(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  useEffect(()=>{
    if(previousDate.current===date)return;previousDate.current=date;
    const el=scrollRef.current,heading=el?.querySelector<HTMLElement>(`tbody[data-sheet-date="${date}"] .grid-day-heading`);
    if(weekly&&el&&heading)el.scrollTop+=heading.getBoundingClientRect().top-el.getBoundingClientRect().top-(tableRef.current?.tHead?.getBoundingClientRect().height??0);
  },[date,weekly]);

  const editable=(p:Panel,row:GridRow,c:GridColumn)=>!p.sheet.contacts_hidden&&!c.readOnly&&(c.section==='accounts'?canFinance:c.section==='planning'?canPlan:(p.sheet.restricted?c.key==='time':canWrite))&&!(/^date[12]$|^amount[12]$/.test(c.key)&&row.payments[Number(c.key.slice(-1))-1]);
  function patchCell(p:Panel,list:GridRow[],index:number,key:string,value:string){
    patchGridCell(p.sheet,list,index,key,value);
  }
  function mutate(d:string,action:(p:Panel,rows:GridRow[])=>void){
    if(locked)return;setNotice('');setPanels(current=>{const p=current[d];if(!p?.loaded)return current;const rows=p.rows.map(r=>({...r,values:{...r.values}}));action(p,rows);return {...current,[d]:{...p,rows}};});
  }
  function change(d:string,index:number,key:string,value:string){mutate(d,(p,rows)=>{patchCell(p,rows,index,key,value);if(index===rows.length-1&&rows.length<200)rows.push(blankGridRow());});}
  function addRows(d:string){mutate(d,(_,rows)=>{rows.push(...Array.from({length:Math.min(5,200-rows.length)},blankGridRow));});}
  function paste(event:React.ClipboardEvent,d:string,index:number,columnIndex:number){
    const text=event.clipboardData.getData('text/plain');if(!/[\t\r\n]/.test(text)&&columns[columnIndex]?.key!=='paid')return;event.preventDefault();
    try{const block=parseGridPaste(text);if(index+block.length>200)throw new Error('Each date supports up to 200 rows at a time.');
      if(block.some(line=>line.length>columns.length-columnIndex))throw new Error('The copied block has more columns than this view. Choose Full Template before pasting it.');
      mutate(d,(p,rows)=>{block.forEach((cells,offset)=>{
        while(rows.length<=index+offset)rows.push(blankGridRow());
        // Apply resource defaults first; explicit staff pasted from the sheet win.
        const entries=cells.map((cell,col)=>({cell,column:columns[columnIndex+col]}));
        entries.sort((a,b)=>Number(['boat','vehicle'].includes(b.column.key))-Number(['boat','vehicle'].includes(a.column.key)));
        entries.forEach(({cell,column:c})=>{
          const row=rows[index+offset];
          if(!row.booking&&!cell.trim()&&['captain','crew','driver'].includes(c.key))return;
          if(editable(p,row,c))patchCell(p,rows,index+offset,c.key,cell.trim());
        });
      });if(rows.length<200)rows.push(blankGridRow());});setError('');
    }catch(e){setError((e as Error).message);}
  }
  function keyDown(e:React.KeyboardEvent<HTMLInputElement>,d:string,row:number,column:number){
    const offset=e.key==='Enter'||e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0;if(!offset)return;
    const next=scrollRef.current?.querySelector<HTMLInputElement>(`[data-date="${d}"][data-row="${row+offset}"][data-column="${column}"]`);if(next){e.preventDefault();next.focus();next.select();}
  }
  async function save(){
    if(writing.current)return;let attempt=pending;
    try{
      if(!attempt){const changed=entries.filter(d=>panels[d.date]?.rows.some(changedGridRow));if(!changed.length)return;
        const payloads=changed.map(d=>{const p=panels[d.date];if(!p.loaded)throw Error('Load payment records before saving.');return gridPayload(p.rows,p.sheet,p.accounts,d.date);});
        const request=crypto.randomUUID();attempt={rpc:payloads.length===1?'save_booking_spreadsheet':'save_booking_sheet_range',dates:changed.map(d=>d.date),payload:payloads.length===1?{...payloads[0],p_request_id:request}:{p_days:payloads,p_request_id:request}};
        // Persist the original request before sending, so an uncertain retry cannot duplicate receipts.
        sessionStorage.setItem(pendingKey,JSON.stringify(attempt));setPending(attempt);
      }
    }catch(e){setError((e as Error).message);return;}
    writing.current=true;setBusy(true);setError('');setNotice('');
    try{const result=await supabase.rpc(attempt.rpc,attempt.payload);if(result.error)throw result.error;}
    catch(e){if(definitiveSaveFailure(e)){try{sessionStorage.removeItem(pendingKey);}catch{/* Same request remains safe to retry after refresh. */}setPending(null);}setError(((e as Error).message||'Could not confirm this save.')+' Your typed rows are retained.');writing.current=false;setBusy(false);return;}
    // The server acknowledged the transaction. Refresh failures must never resubmit it.
    try{for(const d of attempt.dates)sessionStorage.removeItem(draftKey(d));sessionStorage.removeItem(pendingKey);}catch{setError('Saved successfully. Browser draft cleanup failed; reload and check the saved records before further editing.');}
    setPending(null);setPanels({});onDirty(false);setNotice('Changes Saved');
    try{await reload();setRetry(n=>n+1);}catch{setError('Changes saved. Refresh the sheet to load the latest records.');}
    finally{writing.current=false;setBusy(false);}
  }
  function discard(){if(!window.confirm('Discard the unsaved changes on this sheet?'))return;try{for(const day of entries)sessionStorage.removeItem(draftKey(day.date));setPanels({});setRetry(n=>n+1);setError('');setNotice('');}catch{setError('The browser could not clear this draft.');}}
  function download(){const csv=Papa.unparse({fields:[...(weekly?['Service Date']:[]),...columns.map(c=>c.label)],data:entries.flatMap(d=>(panels[d.date]?.rows??[]).filter(r=>r.values.name).map(r=>[...(weekly?[d.date]:[]),...columns.map(c=>r.values[c.key]||'')]))},{escapeFormulae:true});const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`Booking-Sheet_${weekly?'Weekly_':''}${entries[0]?.date}${weekly?'_to_'+lastDay?.date:''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function resizeWidth(key:string,value:number){setView(v=>({...v,widths:{...v.widths,[key]:Math.max(48,Math.min(700,Math.round(value)))}}));}
  const zoom=(n:number)=>setView(v=>({...v,zoom:Math.max(60,Math.min(125,n))}));
  const scroll=(n:number)=>{if(scrollRef.current)scrollRef.current.scrollLeft=n;};
  function revealCell(event:React.FocusEvent<HTMLDivElement>){
    const frame=scrollRef.current,cell=event.target.closest<HTMLTableCellElement>('td');
    if(!frame||!cell||cell.classList.contains('grid-name-cell'))return;
    const row=cell.parentElement as HTMLTableRowElement;
    const name=row.querySelector<HTMLTableCellElement>('.grid-name-cell');
    if(!name)return;
    if(cell.cellIndex<name.cellIndex){frame.scrollLeft=0;return;}
    // Browser focus scrolling does not account for the frozen name column.
    const bounds=frame.getBoundingClientRect(),box=cell.getBoundingClientRect();
    const left=bounds.left+row.cells[0].getBoundingClientRect().width+name.getBoundingClientRect().width+2;
    const right=bounds.right-2;
    if(box.left<left)frame.scrollLeft-=left-box.left;
    else if(box.right>right)frame.scrollLeft+=Math.min(box.right-right,box.left-left);
  }
  const lookups=useMemo(()=>{
    const values:Record<string,string[]>={guide:[],driver:[],captain:[],crew:[],boat:[],vehicle:[],agency:[],refer:[]};
    for(const p of Object.values(panels)){for(const role of ['guide','driver','captain','crew'])values[role].push(...p.sheet.employees.filter(e=>e.job_type===role).map(e=>e.full_name));values.boat.push(...p.sheet.available_boats.map(b=>b.code));values.vehicle.push(...p.sheet.vehicles.map(v=>v.code));values.agency.push(...p.sheet.agencies.map(a=>a.name));values.refer.push(...p.accounts.referrers.filter(r=>!r.is_default&&r.active).map(r=>r.name));}
    return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,[...new Set(v)]]));
  },[panels]);
  const labelDate=(d:string)=>weekly?` ${d}`:'';
  const columnChoices = <ViewChoices label="Visible Columns" value={section} onChange={setSection} className="booking-grid-views" items={[
    {value:'all',ariaLabel:t('Full Template','Templat Penuh'),label:<><span className="hidden sm:inline">{t('Full Template','Templat Penuh')}</span><span className="sm:hidden">{t('All','Semua')}</span></>},
    {value:'booking',label:t('Bookings','Tempahan')},
    {value:'planning',ariaLabel:t('Assignments','Penugasan'),label:<><span className="hidden sm:inline">{t('Assignments','Penugasan')}</span><span className="sm:hidden">{t('Assign','Tugasan')}</span></>},
    ...(canFinance?[{value:'accounts',label:t('Payments','Bayaran')}]:[]),
  ]}/>;
  return <section className={`booking-spreadsheet ${wide?'booking-spreadsheet-wide':''}`} aria-label="Excel-Style Booking Sheet">
    <div className="booking-mobile-columns">{columnChoices}</div>
    <div className="booking-grid-controls">
      <div className="booking-grid-toolbar">
        {columnChoices}
        <div className="booking-grid-sizing"><div className="booking-grid-zoom" role="group" aria-label="Sheet Zoom Controls"><button title="Zoom Out" aria-label="Zoom Out" disabled={view.zoom<=60} onClick={()=>zoom(view.zoom-5)}><Minus size={15}/></button><input type="range" aria-label="Sheet Zoom" min="60" max="125" step="5" value={view.zoom} onChange={e=>zoom(Number(e.target.value))}/><output aria-live="polite">{view.zoom}%</output><button title="Zoom In" aria-label="Zoom In" disabled={view.zoom>=125} onClick={()=>zoom(view.zoom+5)}><Plus size={15}/></button></div><button title="Reset Sheet Sizing" aria-label="Reset Sheet Sizing" onClick={()=>setView({...defaultSheetView,widths:{}})}><RotateCcw size={16}/></button><button title="Download Sheet CSV" aria-label="Download Sheet CSV" onClick={download}><Download size={16}/></button></div>
        <div className="booking-grid-actions">{canWrite?<button type="button" aria-label="Add Rows" title="Add Rows" className={secondaryButtonClass} disabled={locked||!panels[date]?.loaded||panels[date]?.rows.length>=200} onClick={()=>addRows(date)}><Plus size={16}/><span>Add Rows</span></button>:null}
          <button type="button" className={buttonClass} title={busy?'Saving...':pending?'Check Last Save':`Save${dirtyCount?` ${dirtyCount} ${dirtyCount===1?'Row':'Rows'}`:''}`} aria-label={busy?'Saving...':pending?'Check Last Save':`Save${dirtyCount?` ${dirtyCount} ${dirtyCount===1?'Row':'Rows'}`:''}`} disabled={busy||(!dirtyCount&&!pending)} onClick={()=>void save()}><Save size={16}/>{busy?'Saving...':pending?'Check Last Save':<><span className="hidden sm:inline">Save{dirtyCount?` ${dirtyCount} ${dirtyCount===1?'Row':'Rows'}`:''}</span><span aria-hidden="true" className="sm:hidden">{dirtyCount||'Save'}</span></>}</button>
          <button type="button" className={iconButtonClass} title={wide?'Exit Wide View':'Expand Sheet'} aria-label={wide?'Exit Wide View':'Expand Sheet'} onClick={()=>setWide(!wide)}>{wide?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
        </div>
      </div>
      <div className="booking-grid-pan"><button aria-label="Scroll Columns Left" title="Scroll Columns Left" disabled={position<1} onClick={()=>scroll(position-(scrollRef.current?.clientWidth??400)*.7)}><ChevronLeft size={16}/></button><input aria-label="Horizontal Position" type="range" min="0" max={maxScroll||1} disabled={!maxScroll} value={Math.min(position,maxScroll)} onChange={e=>scroll(Number(e.target.value))}/><button aria-label="Scroll Columns Right" title="Scroll Columns Right" disabled={position>=maxScroll-1} onClick={()=>scroll(position+(scrollRef.current?.clientWidth??400)*.7)}><ChevronRight size={16}/></button></div>
    </div>
    <div className={busy||pending||dirtyCount||notice?'booking-grid-status':'sr-only'}><span role="status">{busy?'Saving to Records...':pending?'Save Not Confirmed':dirtyCount?`${dirtyCount} Unsaved Rows · This Device`:notice||'All Changes Saved'}</span>{dirtyCount?<button className="underline" disabled={locked} onClick={discard}>Discard Changes</button>:null}</div>
    {error?<div role="alert" className="sheet-alert">{error}</div>:null}{viewError?<p role="status">{viewError}</p>:null}
    <div ref={scrollRef} className="booking-grid-scroll" style={{height:view.height}} tabIndex={0} aria-label="Booking Spreadsheet" onFocusCapture={revealCell}>
      <table ref={tableRef} className="booking-grid-table" style={{width:222+columns.reduce((n,c)=>n+width(c),0),zoom:view.zoom/100}}><colgroup><col style={{width:42}}/>{columns.map(c=><col key={c.key} style={{width:width(c)}}/>)}<col style={{width:180}}/></colgroup>
        <thead><tr><th scope="col">#</th>{columns.map(c=><th scope="col" className={c.key==='name'?'grid-name-head':''} key={c.key} title={c.title||c.label}><span className="grid-column-label">{c.label}</span><span className="grid-column-resize" role="separator" tabIndex={0} aria-label={`Resize ${c.title||c.label}`} aria-orientation="vertical" aria-valuenow={width(c)} aria-valuemin={48} aria-valuemax={700} onDoubleClick={()=>resizeWidth(c.key,c.width)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();resizeWidth(c.key,e.key==='Home'?c.width:width(c)+(e.key==='ArrowRight'?10:-10));}}} onPointerDown={e=>{e.preventDefault();drag.current={key:c.key,start:e.clientX,size:width(c)};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(d?.key===c.key)resizeWidth(c.key,d.size+(e.clientX-d.start)/(view.zoom/100));}} onPointerUp={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}/></th>)}<th scope="col">Record</th></tr></thead>
        {entries.map(day=>{const p=panels[day.date];return <tbody key={day.date} data-sheet-date={day.date}>
          {weekly?<tr className="grid-day-heading"><th colSpan={columns.length+2}><div><strong>{sheetDateLabel(day.date,'EEE, d MMM yyyy')}</strong><span>{p?.rows.filter(r=>r.values.name).length??0} Bookings</span>{canWrite&&p?.loaded?<button disabled={locked||p.rows.length>=200} aria-label={`Add Rows ${day.date}`} onClick={()=>addRows(day.date)}><Plus size={14}/><span>Add Rows</span></button>:null}</div></th></tr>:null}
          {!p?.loaded||!day.sheet?<tr><td colSpan={columns.length+2}><div className="grid-day-message">{day.error||p?.error||'Loading Sheet...'}{day.error||p?.error?<button onClick={()=>void reload().then(()=>setRetry(n=>n+1))}>Retry</button>:null}</div></td></tr>:p.rows.map((row,index)=><tr key={row.key} className={`${changedGridRow(row)?'grid-row-draft':''} ${row.booking&&['cancelled','no_show'].includes(row.booking.status)?'grid-row-inactive':''}`} data-grid-key={row.key}>
            <th scope="row">{index+1}</th>{columns.map((c,ci)=><td key={c.key} className={c.key==='name'?'grid-name-cell':''}>
              {c.key==='paid'?<label className="grid-done-cell" title={t('Payment confirmed. Amounts stay unchanged.','Bayaran disahkan. Amaun tidak berubah.')}><input type="checkbox" aria-label={`Done Row ${index+1}${labelDate(day.date)}`} data-date={day.date} data-row={index} data-column={ci} checked={gridDoneChecked(row.values.paid)} disabled={locked||!editable(p,row,c)} onChange={e=>change(day.date,index,c.key,String(e.target.checked))} onPaste={e=>paste(e,day.date,index,ci)} onKeyDown={e=>keyDown(e,day.date,index,ci)}/></label>:!editable(p,row,c)?<span title={row.values[c.key]||''} className="grid-readonly">{row.values[c.key]||'—'}</span>:<input aria-label={`${c.title||c.label} Row ${index+1}${labelDate(day.date)}`} data-date={day.date} data-row={index} data-column={ci} value={row.values[c.key]||''} disabled={locked} list={c.lookup?`grid-${c.lookup}`:undefined} inputMode={gridCountKeys.includes(c.key as typeof gridCountKeys[number])?'numeric':/^amount|^total/.test(c.key)?'decimal':'text'} placeholder={gridCountKeys.includes(c.key as typeof gridCountKeys[number])?'0':''} onChange={e=>change(day.date,index,c.key,e.target.value)} onPaste={e=>paste(e,day.date,index,ci)} onKeyDown={e=>keyDown(e,day.date,index,ci)} title={row.values[c.key]||c.title||c.label}/>}</td>)}
            <td><div className="grid-record"><span>{changedGridRow(row)?'Unsaved':row.booking?.status==='cancelled'?'Cancelled':row.booking?.status==='no_show'?'No-Show':row.booking?'Saved':''}</span>{row.booking?<><small title={row.booking.updated_by_name||row.booking.creator_name||undefined}>{row.booking.updated_by_name||row.booking.creator_name}</small><button type="button" disabled={locked} title="Change History" aria-label={`History Row ${index+1}${labelDate(day.date)}`} onClick={()=>{setWide(false);onHistory(row.booking!);}}><History size={16}/></button></>:<button type="button" disabled={locked} title="Remove Empty or Unsaved Row" aria-label={`Remove Row ${index+1}${labelDate(day.date)}`} onClick={()=>mutate(day.date,(_,rows)=>{rows.splice(index,1);})}><Trash2 size={15}/></button>}</div></td>
          </tr>)}
        </tbody>;})}
        <tfoot><tr><th>Total</th>{columns.map(c=><td key={c.key}>{gridCountKeys.includes(c.key as typeof gridCountKeys[number])?Object.values(panels).flatMap(p=>p.rows).reduce((n,r)=>n+(r.values.name&&!['cancelled','no_show'].includes(r.booking?.status||'')&&/^\d+$/.test(r.values[c.key]||'')?Number(r.values[c.key]):0),0):''}</td>)}<td/></tr></tfoot>
      </table>
    </div>
    <div className="booking-grid-height" role="separator" tabIndex={0} aria-label="Resize Sheet Height" aria-orientation="horizontal" aria-valuenow={view.height} aria-valuemin={240} aria-valuemax={1000} onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();setView(v=>({...v,height:e.key==='Home'?560:Math.max(240,Math.min(1000,v.height+(e.key==='ArrowDown'?40:-40)))}));}}} onPointerDown={e=>{drag.current={key:'height',start:e.clientY,size:view.height};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(d?.key==='height')setView(v=>({...v,height:Math.max(240,Math.min(1000,d.size+e.clientY-d.start))}));}} onPointerUp={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}><GripHorizontal size={18}/></div>
    {Object.entries(lookups).map(([key,values])=><datalist key={key} id={`grid-${key}`}>{values.map(value=><option key={value} value={value}/>)}</datalist>)}
    <div className="booking-grid-footer"><span>A · Adults &nbsp; C · Children &nbsp; I · Infants &nbsp; T/L · Local &nbsp; TG · China</span>{canFinance?<button disabled={locked} className={secondaryButtonClass} onClick={()=>{setWide(false);onAccounts(date);}}>Payment History & Corrections</button>:null}</div>
  </section>;
}
