export type SaveAttempt = { requestId: string; args: Record<string, unknown> };
export function prepareSaveAttempt(attempts: Map<string,SaveAttempt>, rpc:string, args:Record<string,unknown>) {
  // A lost response must retry the original version as well as its request ID.
  const {p_expected_updated_at: _version,...intent}=args;
  const key=JSON.stringify([rpc,intent]);
  let attempt=attempts.get(key);
  if(!attempt){attempt={requestId:crypto.randomUUID(),args:structuredClone(args)};attempts.set(key,attempt);}
  return {key,payload:{...attempt.args,p_request_id:attempt.requestId}};
}
export function definitiveSaveFailure(error:unknown) {
  const code=(error as {code?:string})?.code;
  return !!code && /^(22|23|40|42|P0)/.test(code);
}

export function definitiveInitialSaveFailure(attemptedBefore: boolean, error: unknown) {
  // A later rejection cannot disprove an earlier request whose reply was lost.
  return !attemptedBefore && (definitiveSaveFailure(error) || (error as {code?:string})?.code === 'PGRST202');
}
