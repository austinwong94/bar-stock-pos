import { sendTelegram, type AlertMessage } from './sender.ts';

Deno.serve(async(request:Request)=>{
  const secret=Deno.env.get('KITCHEN_ALERT_SECRET');
  if(request.method!=='POST'||!secret||secret.length<32||request.headers.get('x-alert-secret')!==secret)return new Response('Unauthorized',{status:401});
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN'),chatId=Deno.env.get('TELEGRAM_CHAT_ID'),siteUrl=Deno.env.get('KITCHEN_APP_URL');
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!token||!chatId||!siteUrl?.startsWith('https://')||!url||!key)return new Response('Sender not configured',{status:503});
  async function rpc(name:string,args:Record<string,unknown>){
    const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key!,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)});
    if(!response.ok)throw new Error('Alert database operation failed');
    const text=await response.text();return text?JSON.parse(text):null;
  }
  try{
    const messages=await rpc('claim_kitchen_alerts',{p_limit:5}) as AlertMessage[];
    for(const message of messages){
      const result=await sendTelegram(message,token,chatId,siteUrl);
      await rpc('finish_kitchen_alert',{p_id:message.id,p_claim_id:message.claim_id,p_status:result.status,p_provider_message_id:result.providerId??null,p_error:result.error??null});
    }
    return Response.json({processed:messages.length});
  }catch{return new Response('Alert processing stopped; check delivery status before retrying',{status:500});}
});
