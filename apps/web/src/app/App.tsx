import { FormEvent, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router-dom";
import { getRuntimeConfig } from "../lib/config";
import { apiFetch } from "../lib/api";

type Me = { id: string; email: string; name?: string | null; memberships?: any[]; isPlatformAdmin?: boolean };

const Icon = {
  edit: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>),
  trash: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>),
  plus: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M12 5v14M5 12h14"/></svg>),
  key: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2"/></svg>),
};

function IconBtn({ onClick, title, color, children, type="button" as any, disabled=false }: any) {
  const colors: any = { blue: "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40", red: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40", green: "text-green-700 hover:bg-green-50 dark:hover:bg-green-950/40" };
  return <button type={type} disabled={disabled} onClick={onClick} title={title} className={`inline-flex items-center justify-center p-1.5 rounded ${colors[color]||"text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"} disabled:opacity-40`}>{children}</button>;
}

function useTheme() {
  const [theme, setTheme] = useState<"light"|"dark">(() => { const s=localStorage.getItem("theme"); if(s==="light"||s==="dark") return s; return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"; });
  useEffect(()=>{ document.documentElement.classList.toggle("dark", theme==="dark"); localStorage.setItem("theme", theme); }, [theme]);
  return { theme, toggle: ()=>setTheme(t=>t==="dark"?"light":"dark") };
}

function Layout({ children, me, onLogout }: { children: React.ReactNode; me: Me|null; onLogout: ()=>void }) {
  const [menuOpen,setMenuOpen]=useState(false); const [userMenuOpen,setUserMenuOpen]=useState(false);
  const {theme,toggle}=useTheme(); const cfg=getRuntimeConfig();
  const sntLogo = theme==="dark"?"/brand/snt-blanco.png":"/brand/snt-azul.png";
  const nav=[{to:"/",label:"Inicio"},{to:"/c/central",label:"Complejo demo"},...(me?[{to:"/admin",label:"Panel"}]:[])];
  return (<div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="sticky top-0 z-40 border-b border-slate-200/70 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
        <button className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Menú" onClick={()=>setMenuOpen(v=>!v)}><span className="block w-5 h-0.5 bg-current mb-1"/><span className="block w-5 h-0.5 bg-current mb-1"/><span className="block w-5 h-0.5 bg-current"/></button>
        <Link to="/" aria-label="Inicio"><img src="/brand/logo.png" alt={cfg.appName} className="h-9 w-9 object-contain"/></Link>
        <div className="relative">
          <button className="h-9 w-9 rounded-full bg-brand text-white font-semibold flex items-center justify-center" onClick={()=>setUserMenuOpen(v=>!v)}>{(me?.name||me?.email||"I").slice(0,1).toUpperCase()}</button>
          {userMenuOpen && <div className="absolute right-0 mt-2 w-64 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-1 text-sm">
            <div className="px-3 py-2 text-xs text-slate-500 truncate">{me?me.email:"Invitado (sin sesión)"}</div>
            <button onClick={()=>{toggle();setUserMenuOpen(false);}} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Tema ({theme==="dark"?"oscuro":"claro"})</button>
            {me && <button onClick={()=>{setUserMenuOpen(false);onLogout();}} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-red-600">Cerrar sesión</button>}
            {!me && <div className="px-3 py-2 text-xs text-slate-500">Acceso de invitado: puedes ver complejos y reservar.</div>}
          </div>}
        </div>
      </div>
      {menuOpen && <nav className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950"><div className="mx-auto max-w-6xl px-4 py-2 flex flex-col">{nav.map(i=> <NavLink key={i.to} to={i.to} onClick={()=>setMenuOpen(false)} className={({isActive})=>`px-2 py-2 rounded ${isActive?"bg-slate-100 dark:bg-slate-800 font-medium":"hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{i.label}</NavLink>)}</div></nav>}
    </header>
    <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-4"><div className="mx-auto max-w-6xl flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span>POWERED by</span><img src={sntLogo} alt="Supernovatel" className="h-5 object-contain"/></div></footer>
  </div>);
}

function HomePage({me,refreshMe}:{me:Me|null;refreshMe:()=>Promise<void>}){
  const [authCfg,setAuthCfg]=useState<any>(null); const [health,setHealth]=useState<any>(null);
  const [mode,setMode]=useState<"login"|"set">("login"); const [email,setEmail]=useState("admin@supernovatel.com");
  const [password,setPassword]=useState(""); const [newPw,setNewPw]=useState(""); const [msg,setMsg]=useState(""); const [err,setErr]=useState("");
  useEffect(()=>{ apiFetch<any>("/auth/config").then(setAuthCfg).catch(()=>null); apiFetch<any>("/health").then(setHealth).catch(()=>null); },[]);
  async function onLogin(e:FormEvent){ e.preventDefault(); setErr(""); setMsg(""); try{ await apiFetch("/auth/login",{method:"POST",body:JSON.stringify({email,password})}); await refreshMe(); setMsg("Sesión iniciada."); setPassword(""); }catch(e:any){ const m=e.message||"Error"; if(m.toLowerCase().includes("establecer")||m.toLowerCase().includes("password not set")||m.toLowerCase().includes("contraseña")){setMode("set");setErr("Cuenta sin contraseña: establécela para continuar.");} else setErr(m);} }
  async function onSet(e:FormEvent){ e.preventDefault(); setErr(""); setMsg(""); try{ await apiFetch("/auth/set-password",{method:"POST",body:JSON.stringify({email,password:newPw})}); await refreshMe(); setMsg("Contraseña establecida. Sesión iniciada."); setMode("login"); setNewPw(""); }catch(e:any){ setErr(e.message||"Error"); } }
  return (<div className="space-y-6">
    <section className="rounded-xl border bg-white dark:bg-slate-900 p-6">
      <h1 className="text-2xl font-semibold mb-2">AdCoDe v1.0 (pruebas)</h1>
      <p className="text-slate-600 dark:text-slate-300">Administración de complejos deportivos: reservas, escenarios, ventas, inventario y reportes.</p>
      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <a href={authCfg?.googleAuthEnabled?"/api/v1/auth/google/start":undefined} onClick={e=>{if(!authCfg?.googleAuthEnabled)e.preventDefault();}} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 ${authCfg?.googleAuthEnabled?"":"opacity-50 cursor-not-allowed"}`} title={authCfg?.googleAuthEnabled?"Continuar con Google":"Google OAuth pendiente"}><img src="/brand/google-g.png" alt="Google" className="h-5 w-5"/> Continuar con Google</a>
        <Link to="/c/central" className="inline-flex items-center rounded-md bg-brand text-white px-4 py-2">Ver complejo demo</Link>
        {me && <Link to="/admin" className="inline-flex items-center rounded-md border px-4 py-2">Ir al panel</Link>}
      </div>
      {!me ? (<div className="mt-5 max-w-md">
        <h2 className="font-medium mb-2 inline-flex items-center gap-2"><Icon.key className="w-4 h-4 text-blue-600"/> {mode==="login"?"Iniciar sesión (email y contraseña)":"Establecer contraseña"}</h2>
        {mode==="login" ? (<form onSubmit={onLogin} className="space-y-2">
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Email"/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Contraseña"/>
          <div className="flex gap-2"><button className="rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-4 py-2">Entrar</button><button type="button" onClick={()=>{setMode("set");setErr("");}} className="text-sm underline text-blue-600">Primera vez / establecer contraseña</button></div>
        </form>) : (<form onSubmit={onSet} className="space-y-2">
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Email"/>
          <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nueva contraseña (mín. 6)"/>
          <div className="flex gap-2"><button className="rounded-md bg-brand text-white px-4 py-2">Guardar y entrar</button><button type="button" onClick={()=>setMode("login")} className="text-sm underline">Volver</button></div>
        </form>)}
        {err && <p className="text-sm mt-2 text-red-600">{err}</p>}{msg && <p className="text-sm mt-2 text-green-700 dark:text-green-400">{msg}</p>}
        <p className="text-xs mt-2 text-slate-500">Invitado puede navegar sin sesión. Pruebas: admin@supernovatel.com / Admin123! · admin.demo@adcode.test / User123!</p>
      </div>) : (<div className="mt-4 text-sm">Sesión: <b>{me.email}</b>{me.isPlatformAdmin?" (platform admin)":""}</div>)}
      <p className="mt-3 text-xs text-slate-500">API: {health?.ok?`OK (${health.version||"dev"})`:"sin conexión"} · Google: {authCfg?.googleAuthEnabled?"configurado":"pendiente"} · Auth email+contraseña</p>
    </section>
  </div>);
}

function ComplexPage(){
  const {slug}=useParams(); const cs=slug||"central";
  const [complex,setComplex]=useState<any>(null); const [scenarios,setScenarios]=useState<any[]>([]); const [menu,setMenu]=useState<any[]>([]);
  const [form,setForm]=useState({scenarioId:"",date:new Date().toISOString().slice(0,10),start:"10:00",end:"11:00",clientName:""});
  const [result,setResult]=useState<any>(null); const [err,setErr]=useState("");
  useEffect(()=>{ apiFetch<any>(`/complexes/${cs}`).then(r=>setComplex(r.data)).catch(()=>{}); apiFetch<any>(`/scenarios?slug=${cs}`).then(r=>setScenarios(r.data||[])).catch(()=>{}); apiFetch<any>(`/sales/menu/${cs}`).then(r=>setMenu(r.data?.items||[])).catch(()=>{}); },[cs]);
  useEffect(()=>{ if(scenarios[0]&&!form.scenarioId) setForm(f=>({...f,scenarioId:scenarios[0].id})); },[scenarios, form.scenarioId]);
  async function create(e:FormEvent){ e.preventDefault(); setErr(""); setResult(null); try{ const r=await apiFetch<any>("/reservations",{method:"POST",body:JSON.stringify({scenarioId:form.scenarioId,startAt:new Date(`${form.date}T${form.start}:00`).toISOString(),endAt:new Date(`${form.date}T${form.end}:00`).toISOString(),clientName:form.clientName||undefined})}); setResult(r);}catch(e:any){setErr(e.message||"Error");}}
  return (<div className="space-y-4">
    <h1 className="text-xl font-semibold">{complex?.name||`Complejo: ${cs}`}</h1><p className="text-sm text-slate-500">Vista pública/invitado.</p>
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-3"><h2 className="font-medium">Reserva</h2>
        {scenarios.length===0?<p className="text-sm text-slate-500">Sin escenarios.</p>:<form onSubmit={create} className="space-y-2 text-sm">
          <select value={form.scenarioId} onChange={e=>setForm({...form,scenarioId:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent">{scenarios.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent"/>
          <div className="grid grid-cols-2 gap-2"><input type="time" value={form.start} onChange={e=>setForm({...form,start:e.target.value})} className="border rounded px-2 py-2 bg-transparent"/><input type="time" value={form.end} onChange={e=>setForm({...form,end:e.target.value})} className="border rounded px-2 py-2 bg-transparent"/></div>
          <input placeholder="Nombre cliente" value={form.clientName} onChange={e=>setForm({...form,clientName:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent"/>
          <button className="rounded-md bg-brand text-white px-4 py-2">Confirmar reserva</button>
        </form>}
        {err&&<p className="text-sm text-red-600">{err}</p>}{result?.data&&<div className="text-sm rounded border p-3"><div><b>Código:</b> {result.data.code}</div><div><b>Estado:</b> {result.data.status}</div><div><b>Total:</b> {result.data.totalAmount}</div></div>}
      </div>
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Menú/stock</h2>{menu.length===0?<p className="text-sm text-slate-500">Sin productos.</p>:<ul className="space-y-1 text-sm">{menu.map((m:any)=> <li key={m.id} className="flex justify-between border-b pb-1"><span>{m.name}</span><span>{m.price} · stock {m.stock}</span></li>)}</ul>}</div>
    </div>
  </div>);
}

function AdminPage({me}:{me:Me|null}){
  const [tab,setTab]=useState("resumen"); const [tenants,setTenants]=useState<any[]>([]); const [complexes,setComplexes]=useState<any[]>([]);
  const [scenarios,setScenarios]=useState<any[]>([]); const [members,setMembers]=useState<any[]>([]); const [summary,setSummary]=useState<any>(null);
  const [selTenant,setSelTenant]=useState(""); const [selComplex,setSelComplex]=useState(""); const [msg,setMsg]=useState(""); const [err,setErr]=useState("");
  const [tForm,setTForm]=useState({name:"",slug:"",contactName:"",contactEmail:"",maxComplexes:1});
  const [cForm,setCForm]=useState({name:"",slug:"",timezone:"America/La_Paz",currency:"BOB"}); const [cEdit,setCEdit]=useState<any>(null);
  const [sForm,setSForm]=useState({name:"",rentalFormat:"PER_HOUR",priceDay:80,priceNight:100}); const [sEdit,setSEdit]=useState<any>(null);
  const [uForm,setUForm]=useState({email:"",name:"",role:"SELLER",clientTier:"NORMAL"}); const [uEdit,setUEdit]=useState<any>(null);

  async function loadAll(){ apiFetch<any>("/reports/summary").then(setSummary).catch(()=>{}); try{const r=await apiFetch<any>("/platform/my-tenants"); setTenants(r.data||[]); if(!selTenant&&r.data?.[0]) setSelTenant(r.data[0].id);}catch{setTenants([]);} try{const r=await apiFetch<any>("/complexes/mine"); setComplexes(r.data||[]); if(!selComplex&&r.data?.[0]) setSelComplex(r.data[0].id);}catch{setComplexes([]);} }
  async function loadScenarios(id:string){ if(!id){setScenarios([]);return;} try{const r=await apiFetch<any>(`/scenarios?complexId=${id}`); setScenarios(r.data||[]);}catch{setScenarios([]);} }
  async function loadMembers(id:string){ if(!id){setMembers([]);return;} try{const r=await apiFetch<any>(`/users/memberships?tenantId=${id}`); setMembers(r.data||[]);}catch{setMembers([]);} }
  useEffect(()=>{ if(me) loadAll(); },[me?.id]); useEffect(()=>{loadScenarios(selComplex);},[selComplex]); useEffect(()=>{loadMembers(selTenant);},[selTenant]);
  const run=async(fn:()=>Promise<void>,ok:string)=>{setErr("");setMsg("");try{await fn();setMsg(ok);}catch(e:any){setErr(e.message||"Error");}};
  if(!me) return <div className="rounded-xl border p-6 bg-white dark:bg-slate-900">Debes iniciar sesión. <Link to="/" className="text-blue-600 underline">Inicio</Link></div>;
  const tabs=[["resumen","Resumen"],...(me.isPlatformAdmin?[["tenants","Tenants"] as [string,string]]:[]),["complejos","Complejos"],["escenarios","Escenarios"],["usuarios","Usuarios"]] as [string,string][];

  return (<div className="space-y-4">
    <div className="flex items-center justify-between flex-wrap gap-2"><h1 className="text-xl font-semibold">Panel de administración</h1><span className="text-xs text-slate-500">{me.email}{me.isPlatformAdmin?" · platform admin":""}</span></div>
    <div className="flex flex-wrap gap-2 text-sm">{tabs.map(([k,l])=> <button key={k} onClick={()=>setTab(k)} className={`px-3 py-1.5 rounded border ${tab===k?"bg-brand text-white border-brand":"hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{l}</button>)}</div>
    {(err||msg)&&<div className="text-sm">{err&&<span className="text-red-600 mr-3">{err}</span>}{msg&&<span className="text-green-700 dark:text-green-400">{msg}</span>}</div>}

    {tab==="resumen"&&<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{[["Tenants",tenants.length],["Complejos",complexes.length],["Reservas",summary?.data?.reservations??"-"],["Ingresos",summary?.data?.income??"-"],["Egresos",summary?.data?.expense??"-"],["Neto",summary?.data?.net??"-"]].map(([l,v])=> <div key={String(l)} className="rounded-xl border bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold mt-1">{String(v)}</div></div>)}</div>}

    {tab==="tenants"&&me.isPlatformAdmin&&<div className="grid md:grid-cols-2 gap-4">
      <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch("/platform/tenants",{method:"POST",body:JSON.stringify({...tForm,maxComplexes:Number(tForm.maxComplexes)})}); setTForm({name:"",slug:"",contactName:"",contactEmail:"",maxComplexes:1}); await loadAll();},"Tenant creado.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Crear tenant</h2>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={tForm.name} onChange={e=>setTForm({...tForm,name:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="slug" value={tForm.slug} onChange={e=>setTForm({...tForm,slug:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto nombre" value={tForm.contactName} onChange={e=>setTForm({...tForm,contactName:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto email" value={tForm.contactEmail} onChange={e=>setTForm({...tForm,contactEmail:e.target.value})}/>
        <input type="number" min={1} className="w-full border rounded px-2 py-2 bg-transparent" value={tForm.maxComplexes} onChange={e=>setTForm({...tForm,maxComplexes:Number(e.target.value)})}/>
        <button className="rounded-md bg-brand text-white px-4 py-2">Crear tenant</button>
      </form>
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Tenants</h2><ul className="text-sm space-y-2">{tenants.map(t=> <li key={t.id} className="border-b pb-1"><b>{t.name}</b> <span className="text-slate-500">({t.slug})</span> · {t.contactEmail} · {t.complexes?.length||0}/{t.maxComplexes}</li>)}{tenants.length===0&&<li className="text-slate-500">Sin tenants.</li>}</ul></div>
    </div>}

    {tab==="complejos"&&<div className="space-y-4">
      <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch("/complexes",{method:"POST",body:JSON.stringify({...cForm,tenantId:selTenant})}); setCForm({name:"",slug:"",timezone:"America/La_Paz",currency:"BOB"}); await loadAll();},"Complejo creado.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Crear complejo</h2>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={selTenant} onChange={e=>setSelTenant(e.target.value)}>{tenants.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={cForm.name} onChange={e=>setCForm({...cForm,name:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="slug" value={cForm.slug} onChange={e=>setCForm({...cForm,slug:e.target.value})}/>
        <div className="grid grid-cols-2 gap-2"><input className="border rounded px-2 py-2 bg-transparent" value={cForm.timezone} onChange={e=>setCForm({...cForm,timezone:e.target.value})}/><input className="border rounded px-2 py-2 bg-transparent" value={cForm.currency} onChange={e=>setCForm({...cForm,currency:e.target.value})}/></div>
        <button className="rounded-md bg-brand text-white px-4 py-2">Crear complejo</button>
      </form>
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Complejos</h2><ul className="text-sm space-y-2">{complexes.map(c=> <li key={c.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{c.name}</b> <span className="text-slate-500">/{c.slug}</span><div className="text-xs text-slate-500">{c.tenant?.name} · {c.currency}</div></div><div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setCEdit({...c})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar complejo?"))return; await apiFetch(`/complexes/${c.id}`,{method:"DELETE"}); await loadAll();},"Complejo eliminado.")}><Icon.trash className="w-4 h-4"/></IconBtn></div></li>)}{complexes.length===0&&<li className="text-slate-500">Sin complejos.</li>}</ul></div>
      {cEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/complexes/${cEdit.id}`,{method:"PATCH",body:JSON.stringify({name:cEdit.name,slug:cEdit.slug,timezone:cEdit.timezone,currency:cEdit.currency})}); setCEdit(null); await loadAll();},"Complejo actualizado.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar complejo</h2><input className="w-full border rounded px-2 py-2 bg-transparent" value={cEdit.name||""} onChange={e=>setCEdit({...cEdit,name:e.target.value})}/><input className="w-full border rounded px-2 py-2 bg-transparent" value={cEdit.slug||""} onChange={e=>setCEdit({...cEdit,slug:e.target.value})}/><div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setCEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}
    </div>}

    {tab==="escenarios"&&<div className="space-y-4">
      <div className="flex gap-2 items-center text-sm"><span>Complejo:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={selComplex} onChange={e=>setSelComplex(e.target.value)}>{complexes.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch("/scenarios",{method:"POST",body:JSON.stringify({complexId:selComplex,name:sForm.name,rentalFormat:sForm.rentalFormat,pricing:[{period:"DAY",pricePerHour:Number(sForm.priceDay)},{period:"NIGHT",pricePerHour:Number(sForm.priceNight)}]})}); setSForm({name:"",rentalFormat:"PER_HOUR",priceDay:80,priceNight:100}); await loadScenarios(selComplex);},"Escenario creado.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Crear escenario</h2>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={sForm.name} onChange={e=>setSForm({...sForm,name:e.target.value})}/>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={sForm.rentalFormat} onChange={e=>setSForm({...sForm,rentalFormat:e.target.value})}><option value="PER_HOUR">Por hora</option><option value="PER_PERSON">Por persona</option><option value="MIXED">Mixto</option><option value="FLAT_BLOCK">Bloque fijo</option></select>
        <div className="grid grid-cols-2 gap-2"><input type="number" className="border rounded px-2 py-2 bg-transparent" placeholder="Día" value={sForm.priceDay} onChange={e=>setSForm({...sForm,priceDay:Number(e.target.value)})}/><input type="number" className="border rounded px-2 py-2 bg-transparent" placeholder="Noche" value={sForm.priceNight} onChange={e=>setSForm({...sForm,priceNight:Number(e.target.value)})}/></div>
        <button className="rounded-md bg-brand text-white px-4 py-2" disabled={!selComplex}>Crear escenario</button>
      </form>
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Escenarios</h2><ul className="text-sm space-y-2">{scenarios.map(s=> <li key={s.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{s.name}</b><div className="text-xs text-slate-500">{s.rentalFormat}</div></div><div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setSEdit({...s})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar escenario?"))return; await apiFetch(`/scenarios/${s.id}`,{method:"DELETE"}); await loadScenarios(selComplex);},"Escenario eliminado.")}><Icon.trash className="w-4 h-4"/></IconBtn></div></li>)}{scenarios.length===0&&<li className="text-slate-500">Sin escenarios.</li>}</ul></div>
      {sEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/scenarios/${sEdit.id}`,{method:"PATCH",body:JSON.stringify({name:sEdit.name})}); setSEdit(null); await loadScenarios(selComplex);},"Escenario actualizado.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar escenario</h2><input className="w-full border rounded px-2 py-2 bg-transparent" value={sEdit.name||""} onChange={e=>setSEdit({...sEdit,name:e.target.value})}/><div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setSEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}
    </div>}

    {tab==="usuarios"&&<div className="space-y-4">
      <div className="flex gap-2 items-center text-sm"><span>Tenant:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={selTenant} onChange={e=>setSelTenant(e.target.value)}>{tenants.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch("/users/memberships",{method:"POST",body:JSON.stringify({...uForm,tenantId:selTenant})}); setUForm({email:"",name:"",role:"SELLER",clientTier:"NORMAL"}); await loadMembers(selTenant);},"Usuario/membresía guardada.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Agregar usuario/membresía</h2>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Email" value={uForm.email} onChange={e=>setUForm({...uForm,email:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={uForm.name} onChange={e=>setUForm({...uForm,name:e.target.value})}/>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={uForm.role} onChange={e=>setUForm({...uForm,role:e.target.value})}><option value="TENANT_ADMIN">Admin tenant</option><option value="COMPLEX_ADMIN">Admin complejo</option><option value="SELLER">Vendedor</option><option value="CLIENT">Cliente</option></select>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={uForm.clientTier} onChange={e=>setUForm({...uForm,clientTier:e.target.value})}><option value="NORMAL">Normal</option><option value="HABITUAL">Habitual</option><option value="PREFERENCIAL">Preferencial</option></select>
        <button className="rounded-md bg-brand text-white px-4 py-2" disabled={!selTenant}>Guardar</button>
        <p className="text-xs text-slate-500">El usuario establecerá su contraseña en el primer inicio de sesión.</p>
      </form>
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Usuarios del tenant</h2><ul className="text-sm space-y-2">{members.map(m=> <li key={m.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{m.user?.name||m.user?.email}</b> <span className="text-slate-500">({m.user?.email})</span><div className="text-xs text-slate-500">{m.role} · {m.clientTier} · contraseña: {m.user?.hasPassword?"sí":"pendiente"}</div></div><div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setUEdit({...m})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar membresía?"))return; await apiFetch(`/users/memberships/${m.id}`,{method:"DELETE"}); await loadMembers(selTenant);},"Membresía eliminada.")}><Icon.trash className="w-4 h-4"/></IconBtn></div></li>)}{members.length===0&&<li className="text-slate-500">Sin usuarios o sin permisos.</li>}</ul></div>
      {uEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/users/memberships/${uEdit.id}`,{method:"PATCH",body:JSON.stringify({role:uEdit.role,clientTier:uEdit.clientTier})}); setUEdit(null); await loadMembers(selTenant);},"Membresía actualizada.")} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar membresía</h2><div className="text-sm">{uEdit.user?.email}</div><select className="w-full border rounded px-2 py-2 bg-transparent" value={uEdit.role} onChange={e=>setUEdit({...uEdit,role:e.target.value})}><option value="TENANT_ADMIN">Admin tenant</option><option value="COMPLEX_ADMIN">Admin complejo</option><option value="SELLER">Vendedor</option><option value="CLIENT">Cliente</option></select><select className="w-full border rounded px-2 py-2 bg-transparent" value={uEdit.clientTier} onChange={e=>setUEdit({...uEdit,clientTier:e.target.value})}><option value="NORMAL">Normal</option><option value="HABITUAL">Habitual</option><option value="PREFERENCIAL">Preferencial</option></select><div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setUEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}
    </div>}
  </div>);
}

export default function App(){
  const [me,setMe]=useState<Me|null>(null);
  async function refreshMe(){ try{const r=await apiFetch<any>("/auth/me"); setMe(r.user||null);}catch{setMe(null);} }
  async function logout(){ try{await apiFetch("/auth/logout",{method:"POST"});}catch{} setMe(null); }
  useEffect(()=>{refreshMe();},[]);
  return (<Layout me={me} onLogout={logout}><Routes>
    <Route path="/" element={<HomePage me={me} refreshMe={refreshMe}/>}/>
    <Route path="/c/:slug" element={<ComplexPage/>}/>
    <Route path="/admin/*" element={<AdminPage me={me}/>}/>
    <Route path="*" element={<div className="text-sm text-slate-500">Página no encontrada</div>}/>
  </Routes></Layout>);
}
