import './measure-choices.css';

export function MeasureChoices({label,options,value,disabled=false,onChange}:{label:string;options:string[];value:string;disabled?:boolean;onChange:(unit:string)=>void}){
 if(!options.length)return null;
 return <div className="measure-choices" role="group" aria-label={label}>{options.map(unit=><button type="button" key={unit} aria-pressed={value===unit} disabled={disabled} onClick={()=>onChange(unit)}>{unit}</button>)}</div>;
}
