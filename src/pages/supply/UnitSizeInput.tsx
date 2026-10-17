import { inputClass } from '../../components/Form';
import type { InputHTMLAttributes } from 'react';
import { editSize, sizeInput, switchSizeUnit, unitSizeCopy, type UnitLine, type SizeUnit } from '../../lib/kitchenUnitBatch';

export function UnitSizeInput({line,language,disabled,label,helpId,shared=false,inputProps,onChange}:{line:UnitLine;language:'en'|'ms';disabled:boolean;label:string;helpId:string;shared?:boolean;inputProps?:InputHTMLAttributes<HTMLInputElement>&{'data-delivery-field'?:string};onChange:(patch:Partial<UnitLine>)=>void}){
 const copy=unitSizeCopy(line.base,line.unit,language,line.water),measured=line.base!=='unit'&&copy.fixed===null,ms=language==='ms';
 const size=measured?sizeInput(line):null,units:SizeUnit[]=line.base==='g'?['kg','g']:['L','ml'];
 const conversion=measured&&line.factor&&Number(line.factor)>0?`${size!.value} ${size!.unit} = ${Number(line.factor).toLocaleString(ms?'ms-MY':'en-MY',{maximumFractionDigits:6})} ${copy.measure}`:null;
 return <div className="unit-size-field">
  <div className="grid min-w-0 gap-1.5 text-sm font-semibold text-ink"><span className="text-[0.8125rem] text-muted">{copy.label}</span><div className="unit-measure-input">
   <input {...inputProps} className={inputClass} aria-label={label} disabled={disabled} inputMode="decimal" maxLength={40} readOnly={copy.fixed!==null} aria-describedby={helpId} value={size?size.value:line.factor} placeholder={copy.fixed!==null?String(copy.fixed):copy.placeholder} onChange={e=>onChange(size?editSize(line,e.target.value,size.unit):{factor:e.target.value})}/>
   {size?<div className="unit-measure-choices" role="group" aria-label={label+' Unit'}>{units.map(unit=><button key={unit} type="button" disabled={disabled} aria-pressed={size.unit===unit} onClick={()=>onChange(switchSizeUnit(line,unit))}>{unit}</button>)}</div>:null}
  </div></div>
  <small id={helpId} className="unit-size-hint">{conversion??(shared?copy.hint:copy.rowHint)}</small>
 </div>;
}
