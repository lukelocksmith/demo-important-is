const SESSION_KEY='niedernsill_session_v1';

export function getSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
}

export function clearSession(){localStorage.removeItem(SESSION_KEY)}

export async function login(name,pin){
  const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,pin})});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||'Nie udało się zalogować');
  const session={token:data.token,user:data.user,expiresAt:data.expiresAt};
  localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  return {...session,firstLogin:data.firstLogin};
}

async function authed(path,options={}){
  const s=getSession();
  if(!s?.token) throw new Error('Najpierw wybierz swoje imię i wpisz PIN');
  const r=await fetch(path,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'}});
  const data=await r.json();
  if(r.status===401){clearSession();throw new Error(data.error||'Sesja wygasła')}
  if(!r.ok) throw new Error(data.error||'Wystąpił błąd');
  return data;
}

export function loadVotes(){return authed('/api/votes')}
export function saveVote(itemType,itemId,vote){return authed('/api/votes',{method:'POST',body:JSON.stringify({itemType,itemId,vote})})}
export function removeVote(itemType,itemId){return authed('/api/votes',{method:'DELETE',body:JSON.stringify({itemType,itemId})})}
