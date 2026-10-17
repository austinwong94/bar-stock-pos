const unavailable=():never=>{throw new Error('Practice data is unavailable in a cloud build.');};
export const db=new Proxy({}, {get:unavailable});
export const demoPersonas:unknown[]=[];
export const demoCurrentUserId=unavailable;
export const demoSwitchPersona=unavailable;
export const resetDemoDb=unavailable;
