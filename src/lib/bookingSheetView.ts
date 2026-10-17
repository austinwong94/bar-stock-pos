import { addDays, format, startOfWeek } from 'date-fns';
import { gridColumns } from './bookingGrid';

export const sheetViewKey='lovely-paradise:booking-sheet-view:v1';
export type SheetView={zoom:number;height:number;widths:Record<string,number>};
export const defaultSheetView:SheetView={zoom:85,height:560,widths:{}};
export const shiftSheetDate=(date:string,days:number)=>format(addDays(new Date(date+'T12:00:00'),days),'yyyy-MM-dd');
export const sheetWeekStart=(date:string)=>format(startOfWeek(new Date(date+'T12:00:00'),{weekStartsOn:1}),'yyyy-MM-dd');
export const sheetDateLabel=(date:string,pattern='EEE, d MMM')=>format(new Date(date+'T12:00:00'),pattern);
export function cleanSheetView(value:unknown):SheetView {
  const v=(value&&typeof value==='object'?value:{}) as Partial<SheetView>;
  const widths:Record<string,number>={};
  for(const c of gridColumns){const n=v.widths?.[c.key];if(typeof n==='number'&&Number.isFinite(n))widths[c.key]=Math.max(48,Math.min(700,n));}
  return {zoom:typeof v.zoom==='number'&&Number.isFinite(v.zoom)?Math.max(60,Math.min(125,v.zoom)):85,height:typeof v.height==='number'&&Number.isFinite(v.height)?Math.max(240,Math.min(1000,v.height)):560,widths};
}
export function readSheetView(){try{return cleanSheetView(JSON.parse(localStorage.getItem(sheetViewKey)||'null'));}catch{return {...defaultSheetView,widths:{}};}}
