import { createStaffAccountHandler } from './handler.ts';
Deno.serve(createStaffAccountHandler(name => Deno.env.get(name)));
