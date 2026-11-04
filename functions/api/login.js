function b64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function sign(value,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))))}
function safeEqual(a,b){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0}
export async function onRequestPost({request,env}){
 try{
  if(!env.STAFF_USERS||!env.SESSION_SECRET)return Response.json({error:'Login belum dikonfigurasi oleh administrator.'},{status:503});
  const body=await request.json();const id=String(body.id||'').trim();const password=String(body.password||'');
  const users=JSON.parse(env.STAFF_USERS);const user=users[id];
  if(!user||typeof user.password!=='string'||!safeEqual(password,user.password))return Response.json({error:'ID atau password salah.'},{status:401,headers:{'cache-control':'no-store'}});
  const payload=b64url(new TextEncoder().encode(JSON.stringify({id,role:user.role,exp:Date.now()+12*60*60*1000})));
  const token=payload+'.'+await sign(payload,env.SESSION_SECRET);
  return Response.json({ok:true,role:user.role},{headers:{'set-cookie':`nn_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,'cache-control':'no-store'}});
 }catch{return Response.json({error:'Permintaan login tidak valid.'},{status:400})}
}
