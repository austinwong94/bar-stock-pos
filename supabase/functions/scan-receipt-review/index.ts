import { createReviewScanHandler } from './handler.ts';
Deno.serve(createReviewScanHandler(name => Deno.env.get(name)));
