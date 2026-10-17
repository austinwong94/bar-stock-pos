const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_ANON_KEY;
try{
 if(!url||!key)throw new Error('Configure the existing project public Supabase URL and key before cloud deployment.');
 if(key.startsWith('sb_secret_')||key.startsWith('sk-'))throw new Error('Cloud frontend requires a public Supabase key.');
 if(key.split('.').length===3&&JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role!=='anon')throw new Error('A privileged key cannot enter a frontend build.');
 const response=await fetch(new URL('/rest/v1/rpc/read_platform_schema_version',url),{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Cloud schema probe failed (HTTP '+response.status+'). Apply the reviewed forward migrations before deploying this frontend.');
 const status=await response.json();
 if(status.schema_version!=='202610140073'||!status.measured_piece_receiving||!status.private_payment_receipts||!status.private_purchase_evidence||!status.retired_writes_private)throw new Error('The cloud database does not meet this frontend release contract.');
 console.log('Cloud schema and private-bucket configuration match. This probe does not certify Auth, physical uploads or production acceptance.');
}catch(error){console.error(error.message);process.exitCode=1;}
