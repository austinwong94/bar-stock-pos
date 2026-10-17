import {runActivePlatformTests} from '../supabase/tests/active-platform.mjs';
try{console.log(JSON.stringify(await runActivePlatformTests({journey:process.argv.includes('--kitchen')?'kitchen':'all'})));}
catch(error){console.error(error.stack??error.message,error.code??'',error.cause?.message??'');process.exitCode=1;}
