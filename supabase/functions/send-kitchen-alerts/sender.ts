export type AlertMessage = {id:string;claim_id:string;title:string;body:string;rule_code:string};
export type SendResult = {status:'sent'|'failed'|'uncertain';providerId?:string;error?:string};
export async function sendTelegram(alert:AlertMessage,token:string,chatId:string,siteUrl:string,fetcher:typeof fetch=fetch):Promise<SendResult>{
  const route=alert.rule_code==='kitchen.request_submitted'?'/kitchen/purchases':alert.rule_code==='kitchen.count_confirmed'?'/kitchen/stock?view=history&type=count':'/kitchen/stock?view=history';
  const text=alert.body.slice(0,3000)+(alert.body.length>3000?'\n[More items in the app]':'')+'\n'+siteUrl.replace(/\/$/,'')+'/#'+route;
  try{
    const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(response.ok&&result.ok===true&&Number.isInteger(result.result?.message_id))return {status:'sent',providerId:String(result.result.message_id)};
    if(result.ok===false)return {status:'failed',error:'Provider rejected the message ('+String(result.error_code??response.status)+')'};
    return {status:'uncertain',error:'Provider response could not be verified'};
  }catch{return {status:'uncertain',error:'Delivery could not be verified; check the group before retrying'};}
}
