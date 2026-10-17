import { createReceiptHandler } from './handler.ts';

Deno.serve(createReceiptHandler(name => Deno.env.get(name)));
