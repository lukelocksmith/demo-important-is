import crypto from 'node:crypto';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' };

async function getUser(req){
  const raw=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  if(!raw) return null;
  const tokenHash=crypto.createHash('sha256').update(raw).digest('hex');
  const q=`${url}/rest/v1/trip_sessions?token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id`;
  const r=await fetch(q,{headers});
  const rows=await r.json();
  return rows?.[0]?.user_id||null;
}

export default async function handler(req,res){
  if(!url||!key) return res.status(503).json({error:'Backend nie jest jeszcze skonfigurowany'});
  const userId=await getUser(req);
  if(!userId) return res.status(401).json({error:'Sesja wygasła. Zaloguj się ponownie.'});

  if(req.method==='GET'){
    const own=await fetch(`${url}/rest/v1/trip_votes?user_id=eq.${userId}&select=item_type,item_id,vote,updated_at`,{headers});
    const ownVotes=await own.json();
    const all=await fetch(`${url}/rest/v1/trip_votes?select=item_type,item_id,vote,user_id,trip_users(name)`,{headers});
    const allVotes=await all.json();
    return res.status(200).json({own:ownVotes,all:allVotes.map(v=>({itemType:v.item_type,itemId:v.item_id,vote:v.vote,userId:v.user_id,userName:v.trip_users?.name||''}))});
  }

  if(req.method==='POST'){
    const {itemType,itemId,vote}=req.body||{};
    if(!['route','food','day'].includes(itemType)||!itemId||!['want','maybe','no'].includes(vote)) return res.status(400).json({error:'Nieprawidłowy głos'});
    const r=await fetch(`${url}/rest/v1/trip_votes?on_conflict=user_id,item_type,item_id`,{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:userId,item_type:itemType,item_id:itemId,vote})});
    const data=await r.json();
    if(!r.ok) return res.status(500).json({error:'Nie udało się zapisać głosu'});
    return res.status(200).json({ok:true,vote:data?.[0]||null});
  }

  if(req.method==='DELETE'){
    const {itemType,itemId}=req.body||{};
    const r=await fetch(`${url}/rest/v1/trip_votes?user_id=eq.${userId}&item_type=eq.${encodeURIComponent(itemType)}&item_id=eq.${encodeURIComponent(itemId)}`,{method:'DELETE',headers});
    if(!r.ok) return res.status(500).json({error:'Nie udało się usunąć głosu'});
    return res.status(200).json({ok:true});
  }

  return res.status(405).json({error:'Method not allowed'});
}
