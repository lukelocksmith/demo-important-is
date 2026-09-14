import crypto from 'node:crypto';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' };

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!url||!key) return res.status(503).json({error:'Backend nie jest jeszcze skonfigurowany'});
  const {name,pin}=req.body||{};
  if(!name||!/^[0-9]{4}$/.test(String(pin||''))) return res.status(400).json({error:'Wybierz imię i wpisz 4-cyfrowy PIN'});
  try{
    const login=await fetch(`${url}/rest/v1/rpc/claim_or_login_trip_user`,{method:'POST',headers,body:JSON.stringify({p_name:name,p_pin:String(pin)})});
    const data=await login.json();
    if(!login.ok) return res.status(401).json({error:data?.message?.includes('Invalid PIN')?'Nieprawidłowy PIN':'Nie udało się zalogować'});
    const user=Array.isArray(data)?data[0]:data;
    const token=crypto.randomBytes(32).toString('hex');
    const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
    const expires=new Date(Date.now()+30*24*60*60*1000).toISOString();
    const save=await fetch(`${url}/rest/v1/trip_sessions`,{method:'POST',headers:{...headers,Prefer:'return=minimal'},body:JSON.stringify({user_id:user.user_id,token_hash:tokenHash,expires_at:expires})});
    if(!save.ok) throw new Error('session');
    return res.status(200).json({token,user:{id:user.user_id,name:user.user_name},firstLogin:!!user.first_login,expiresAt:expires});
  }catch(e){
    return res.status(500).json({error:'Błąd logowania. Spróbuj ponownie.'});
  }
}
