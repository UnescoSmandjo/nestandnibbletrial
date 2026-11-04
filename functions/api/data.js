const NO_CACHE={"cache-control":"no-store"};
const blankCart=()=>({items:[],dType:'rp',dVal:0,otype:'Dine in',who:''});
function deepMerge(a,b){const out={...(a&&typeof a==='object'&&!Array.isArray(a)?a:{})};for(const [k,v] of Object.entries(b&&typeof b==='object'?b:{})){if(v&&typeof v==='object'&&!Array.isArray(v))out[k]=deepMerge(out[k],v);else out[k]=v}return out}
function mergeState(oldState,newState){
 const merged={...oldState,...newState};
 const byId=new Map();for(const o of [...(oldState.orders||[]),...(newState.orders||[])])if(o&&o.id)byId.set(o.id,o);
 merged.orders=[...byId.values()];
 merged.seq={...(oldState.seq||{}),...(newState.seq||{})};for(const k of Object.keys(merged.seq))merged.seq[k]=Math.max(Number(oldState.seq?.[k]||0),Number(newState.seq?.[k]||0));
 for(const k of ['att','so','cashOpen','cashCount'])merged[k]=deepMerge(oldState[k],newState[k]);
 // Keranjang bersifat lokal per perangkat, bukan data bersama.
 merged.cart=blankCart();
 return merged;
}
export async function onRequestGet({env}){
 if(!env.DB)return Response.json({error:'Database D1 belum terhubung.'},{status:503,headers:NO_CACHE});
 try{const row=await env.DB.prepare('SELECT state_json, updated_at FROM app_state WHERE id=1').first();if(!row)return Response.json({state:null,updatedAt:null},{headers:NO_CACHE});return Response.json({state:JSON.parse(row.state_json),updatedAt:row.updated_at},{headers:NO_CACHE})}
 catch(e){return Response.json({error:'Gagal membaca database.'},{status:500,headers:NO_CACHE})}
}
export async function onRequestPut({request,env}){
 if(!env.DB)return Response.json({error:'Database D1 belum terhubung.'},{status:503,headers:NO_CACHE});
 try{
  const raw=await request.text();if(raw.length>1800000)return Response.json({error:'Ukuran data melebihi batas 1.8 MB.'},{status:413,headers:NO_CACHE});
  const body=JSON.parse(raw),s=body.state;
  if(!s||typeof s!=='object'||!Array.isArray(s.orders)||!Array.isArray(s.menu))return Response.json({error:'Format data tidak valid.'},{status:400,headers:NO_CACHE});
  const row=await env.DB.prepare('SELECT state_json FROM app_state WHERE id=1').first();
  const old=row?JSON.parse(row.state_json):{};
  const merged=mergeState(old,s);const json=JSON.stringify(merged);const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).bind(json,now).run();
  return Response.json({ok:true,state:merged,updatedAt:now},{headers:NO_CACHE});
 }catch(e){return Response.json({error:'Gagal menyimpan data ke database.'},{status:500,headers:NO_CACHE})}
}
