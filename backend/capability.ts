export async function capability(id:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('ISP-REMOTE-RESULT-V1:'+id)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
