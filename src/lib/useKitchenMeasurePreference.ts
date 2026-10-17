import { useEffect, useState } from 'react';
import { useAccess } from './access';
import { kitchenChoicesKey, readKitchenChoices, rememberKitchenChoice, type KitchenChoices, type KitchenEntryScope } from './kitchenQuickEntry';
import type { KitchenItem } from './kitchenCatalogue';

export function useKitchenMeasurePreference(scope:KitchenEntryScope){
 const {profile}=useAccess();
 const key=kitchenChoicesKey(import.meta.env.VITE_SUPABASE_URL,profile?.id??'',scope);
 const read=()=>{try{return {key,choices:readKitchenChoices(localStorage.getItem(key)),failed:false};}catch{return {key,choices:{} as KitchenChoices,failed:true};}};
 const [state,setState]=useState(read);
 useEffect(()=>{setState(read());},[key]);
 function remember(item:KitchenItem,unit:string){
  try{setState({key,choices:rememberKitchenChoice(localStorage,key,item,unit),failed:false});}
  catch{setState(previous=>({...previous,key,choices:previous.key===key?previous.choices:{},failed:true}));}
 }
 return {choices:state.key===key?state.choices:{},failed:state.key===key&&state.failed,remember};
}
