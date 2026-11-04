function decodeB64url(value){const s=value.replace(/-/g,'+').replace(/_/g,'/');const padded=s+'='.repeat((4-s.length%4)%4);return Uint8Array.from(atob(padded),c=>c.charCodeAt(0))}
async function valid(token,secret){try{const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length)return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);const ok=await crypto.subtle.verify('HMAC',key,decodeB64url(signature),new TextEncoder().encode(payload));if(!ok)return false;const data=JSON.parse(new TextDecoder().decode(decodeB64url(payload)));return !!data.id&&data.exp>Date.now()}catch{return false}}
export async function onRequest({request,env,next}){
 const path=new URL(request.url).pathname;
 if(path==='/login.html'||path==='/login.css'||path==='/api/login'||path==='/api/logout')return next();
 if(path==='/app.css')return next();
 const cookie=request.headers.get('Cookie')||'';const match=cookie.match(/(?:^|;\s*)nn_session=([^;]+)/);
 if(env.SESSION_SECRET&&match&&await valid(match[1],env.SESSION_SECRET))return next();
 if(path.startsWith('/api/'))return Response.json({error:'Sesi login berakhir. Silakan masuk kembali.'},{status:401,headers:{'cache-control':'no-store'}});
 return Response.redirect(new URL('/login.html',request.url),302);
}
