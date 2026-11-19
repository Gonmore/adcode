import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useParams, useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { getRuntimeConfig } from "../lib/config";
import { apiFetch } from "../lib/api";
import { calculatePrice } from "@adcode/shared";

const DEPARTMENTS = ["La Paz","Cochabamba","Santa Cruz","Oruro","Potosí","Chuquisaca","Tarija","Beni","Pando"] as const;

type Me = { id: string; email: string; name?: string | null; phone?: string | null; avatarUrl?: string | null; lastDepartment?: string | null; memberships?: any[]; isPlatformAdmin?: boolean; hasPassword?: boolean; hasGoogle?: boolean };

const Icon = {
  edit: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>),
  trash: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>),
  plus: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M12 5v14M5 12h14"/></svg>),
  key: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2"/></svg>),
  bell: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className||"w-4 h-4"} aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>),
};

function IconBtn({ onClick, title, color, children, type="button" as any, disabled=false }: any) {
  const colors: any = { blue: "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40", red: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40", green: "text-green-700 hover:bg-green-50 dark:hover:bg-green-950/40" };
  return <button type={type} disabled={disabled} onClick={onClick} title={title} className={`inline-flex items-center justify-center p-1.5 rounded ${colors[color]||"text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"} disabled:opacity-40`}>{children}</button>;
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold">{count > 99 ? "99+" : count}</span>;
}

const SC_COLORS = ["#2563eb","#16a34a","#dc2626","#d97706","#7c3aed","#0891b2","#db2777","#65a30d","#ea580c","#0f766e"];
function scenarioColor(id: string, idx: number){ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return SC_COLORS[(h+idx)%SC_COLORS.length]; }
function dayRange(dateStr: string){ const d=new Date(dateStr+"T00:00:00"); const s=new Date(d); s.setHours(0,0,0,0); const e=new Date(d); e.setHours(23,59,59,999); return { from:s.toISOString(), to:e.toISOString() }; }
function weekRange(dateStr: string){ const d=new Date(dateStr+"T00:00:00"); const dow=d.getDay(); const mondayOffset=dow===0?-6:1-dow; const s=new Date(d); s.setDate(d.getDate()+mondayOffset); s.setHours(0,0,0,0); const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return { from:s.toISOString(), to:e.toISOString() }; }
function overlaps(aS:Date,aE:Date,bS:Date,bE:Date){ const s=aS>bS?aS:bS; const e=aE<bE?aE:bE; return e>s; }
function toLocalInput(dt:string){ const d=new Date(dt); const p=(n:number)=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function slugify(s: string){ return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""); }
const STATUS_ES: Record<string,string> = { PENDING_PAYMENT:"Pendiente de pago", PENDING_CONFIRMATION:"Pendiente de confirmación", CONFIRMED:"Confirmado", SCHEDULED:"Programado", COMPLETED:"Completado", EXPIRED:"Expirado", CANCELLED:"Cancelado", REJECTED:"Rechazado", NO_SHOW:"No asistió", PENDING:"Pendiente" };

function estimateScenarioPrice(complex:any, scenario:any, date:string, start:string, end:string, people?:number, tier?:any){
  try{
    const startAt = new Date(`${date}T${start}:00`); const endAt = new Date(`${date}T${end}:00`);
    if(!(endAt>startAt)) return null;
    const dayRule = (scenario.pricingRules||[]).find((r:any)=>r.period==="DAY");
    const nightRule = (scenario.pricingRules||[]).find((r:any)=>r.period==="NIGHT") || dayRule;
    const hm = (v:string,fb:number)=>{ const m=/^(\d{1,2}):(\d{2})$/.exec(v||""); return m?Number(m[1])+Number(m[2])/60:fb; };
    const pricing = calculatePrice({
      rentalFormat: scenario.rentalFormat as any, startAt, endAt, people,
      nightStartHour: hm(complex?.nightStart||"18:00",18), nightEndHour: hm(complex?.nightEnd||"06:00",6),
      pricePerHourDay: dayRule?.pricePerHour!=null?Number(dayRule.pricePerHour):0, pricePerHourNight: nightRule?.pricePerHour!=null?Number(nightRule.pricePerHour):(dayRule?.pricePerHour!=null?Number(dayRule.pricePerHour):0),
      pricePerPersonDay: dayRule?.pricePerPerson!=null?Number(dayRule.pricePerPerson):0, pricePerPersonNight: nightRule?.pricePerPerson!=null?Number(nightRule.pricePerPerson):(dayRule?.pricePerPerson!=null?Number(dayRule.pricePerPerson):0),
      basePriceDay: dayRule?.basePrice!=null?Number(dayRule.basePrice):0, basePriceNight: nightRule?.basePrice!=null?Number(nightRule.basePrice):(dayRule?.basePrice!=null?Number(dayRule.basePrice):0),
      discountPercent: tier?.discountPercent!=null?Number(tier.discountPercent):undefined,
      discountAmount: tier?.discountAmount!=null?Number(tier.discountAmount):undefined,
    } as any);
    return pricing;
  }catch{ return null; }
}

function money(v:any, currency?:string){ const n=Number(v||0); return `${n.toFixed(2)} ${currency||"BOB"}`; }


function AvailabilityCalendar({ date, scenarios, blocksByScenario, visibleIds, onToggle, selectableScenarioId, onPickSlot, onPickSlotScenario, onPickSlotWeek, onShowSlotReservations, allowCreate, weekView }: {
  date: string; scenarios: any[]; blocksByScenario: Record<string, any[]>;
  visibleIds?: Record<string, boolean>; onToggle?: (id: string) => void;
  selectableScenarioId?: string; onPickSlot?: (start: string, end: string) => void;
  onPickSlotScenario?: (scenarioId: string, start: string, end: string) => void;
  onPickSlotWeek?: (scenarioId: string, date: string, start: string, end: string) => void;
  onShowSlotReservations?: (blocks: any[]) => void;
  allowCreate?: boolean;
  weekView?: boolean;
}) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 7);
  const dayStart = new Date(date + "T00:00:00");
  const rows = scenarios.filter((s: any) => !visibleIds || visibleIds[s.id] !== false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!weekView) return;
    const el = scrollRef.current;
    if (!el) return;
    const todayIdx = (new Date().getDay() + 6) % 7;
    const colWidth = 68;
    const left = 48 + todayIdx * colWidth - el.clientWidth / 2 + colWidth / 2;
    el.scrollLeft = Math.max(0, left);
  }, [weekView]);

  // Single-day view (original) when not weekView
  if (!weekView) {
    return (<div className="space-y-2">
      {scenarios.length > 0 && onToggle && visibleIds && <div className="flex flex-wrap gap-2 text-xs">
        {scenarios.map((s: any, i: number) => { const c = scenarioColor(s.id, i); const on = visibleIds[s.id] !== false; return (
          <label key={s.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${on ? "" : "opacity-40"}`} title={on ? "Ocultar escenario" : "Mostrar escenario"}>
            <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} />
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{s.name}
          </label>
        ); })}
        </div>}
      <div className="border rounded overflow-auto">
        <div className="min-w-[860px]">
          <div className="grid" style={{ gridTemplateColumns: `150px repeat(${hours.length}, minmax(34px,1fr))` }}>
            <div className="text-[10px] p-1 border-b border-r bg-slate-50 dark:bg-slate-800 sticky left-0 z-10">Escenario</div>
            {hours.map(h => <div key={h} className="text-[10px] p-1 border-b text-center bg-slate-50 dark:bg-slate-800">{String(h).padStart(2, "0")}</div>)}
            {rows.length === 0 && <div className="col-span-full text-xs text-slate-500 p-3">No hay escenarios visibles. Activa al menos uno.</div>}
            {rows.map((s: any) => {
              const idx = scenarios.findIndex((x: any) => x.id === s.id);
              const c = scenarioColor(s.id, idx < 0 ? 0 : idx);
              const blocks = (blocksByScenario[s.id] || []).map((b: any) => ({ s: new Date(b.startAt), e: new Date(b.endAt), status: b.status, type: b.type, reason: b.reason }));
              return (<div key={s.id} className="contents">
                <div className="text-xs p-1 border-r border-b flex items-center gap-1 sticky left-0 bg-white dark:bg-slate-900 z-10"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{s.name}</div>
                {hours.map(h => {
                  const hs = new Date(dayStart); hs.setHours(h, 0, 0, 0); const he = new Date(dayStart); he.setHours(h + 1, 0, 0, 0);
                  const block = blocks.find((b: any) => overlaps(hs, he, b.s, b.e));
                  const allowAny = !!onPickSlotScenario && !block;
                  const isSel = selectableScenarioId === s.id;
                  const allowSel = !!(isSel && !block && onPickSlot);
                  const isClosed = block?.type === "CLOSED";
                  const slotStart = new Date(dayStart); slotStart.setHours(h,0,0,0);
                  const slotEnd = new Date(slotStart.getTime() + 60*60*1000);
                  const isPast = slotEnd <= new Date();
                  const txt = block ? (isClosed ? "Cerr" : block.type === "MAINTENANCE" ? "Mant" : block.status === "PENDING_PAYMENT" ? "Hold" : block.status === "PENDING_CONFIRMATION" ? "Pend" : block.status === "SCHEDULED" ? "Fija" : "Res") : "";
                  const canPick = (allowAny || allowSel) && !isPast;
                  const title = block ? `${s.name}: ${isClosed ? (block.reason || "Cerrado") : txt} ${new Date(block.s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}-${new Date(block.e).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : (canPick ? "Disponible (clic para seleccionar y crear reserva)" : "Disponible");
                  return <button type="button" key={s.id + "-" + h} disabled={!canPick} onClick={() => { const start = String(h).padStart(2, "0") + ":00"; const end = String(Math.min(h + 1, 23)).padStart(2, "0") + ":00"; if (allowAny) { onPickSlotScenario!(s.id, start, end); } else if (allowSel) { onPickSlot!(start, end); } }} title={title} className={`h-9 sm:h-8 border-b border-l text-[10px] font-medium ${isClosed ? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300" : block ? "text-white" : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300"} ${canPick ? "hover:bg-emerald-200 dark:hover:bg-emerald-900/40 cursor-pointer ring-inset" : "cursor-default"} ${selectableScenarioId && !isSel && !block ? "opacity-90" : ""}`} style={{ background: block && !isClosed ? c : undefined }}>{txt}</button>;
                })}
              </div>);
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border inline-block" /> Disponible</span><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 inline-block" /> Cerrado/fuera de horario</span><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400 inline-block" /> Ocupado/Hold/Mant./Fija (color por escenario)</span></div>
    </div>);
  }

  // Week view: hours vertical, days horizontal
  const weekStart = new Date(dayStart);
  const dow = weekStart.getDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  weekStart.setDate(weekStart.getDate() + mondayOffset);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
  const dayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  function blocksForDayHour(scn: any, day: Date, h: number) {
    const blocks = (blocksByScenario[scn.id] || []).map((b: any) => ({ s: new Date(b.startAt), e: new Date(b.endAt), status: b.status, type: b.type, reason: b.reason }));
    const hs = new Date(day); hs.setHours(h, 0, 0, 0); const he = new Date(day); he.setHours(h + 1, 0, 0, 0);
    return blocks.filter((b: any) => overlaps(hs, he, b.s, b.e));
  }

  return (<div className="space-y-2">
    {scenarios.length > 0 && onToggle && visibleIds && <div className="flex flex-wrap gap-2 text-xs">
      {scenarios.map((s: any, i: number) => { const c = scenarioColor(s.id, i); const on = visibleIds[s.id] !== false; return (
        <label key={s.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${on ? "" : "opacity-40"}`} title={on ? "Ocultar escenario" : "Mostrar escenario"}>
          <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} />
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{s.name}
        </label>
      ); })}
    </div>}
    <div className="border rounded overflow-auto" ref={scrollRef}>
      <div className="min-w-[640px]">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(7, minmax(68px,1fr))` }}>
          <div className="text-[10px] p-1 border-b border-r bg-slate-50 dark:bg-slate-800 sticky left-0 z-20">Hora</div>
          {days.map((d, i) => { const isToday = d.toDateString() === new Date().toDateString(); return <div key={i} className={`text-[10px] p-1 border-b text-center font-medium ${isToday ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "bg-slate-50 dark:bg-slate-800"}`}>{isToday && <span className="block text-[12px] leading-none">▼</span>}{dayLabels[i]}<br />{d.getDate()}/{d.getMonth() + 1}</div>; })}
          {hours.map(h => (
            <div key={h} className="contents">
              <div className="text-[10px] p-1 border-r border-b bg-slate-50 dark:bg-slate-800 sticky left-0 z-20 text-center">{String(h).padStart(2, "0")}:00</div>
              {days.map((day, di) => {
                const cellBlocks = rows.flatMap((s: any) => blocksForDayHour(s, day, h).map((b: any) => ({ ...b, scenario: s, color: scenarioColor(s.id, scenarios.findIndex((x: any) => x.id === s.id)) })));
                const isClosed = cellBlocks.some((b: any) => b.type === "CLOSED");
                const closedReason = cellBlocks.find((b: any) => b.type === "CLOSED")?.reason;
                const canPick = !!onPickSlotScenario || !!onPickSlot;
                return (
                  <div key={di} className={`border-b border-l p-0.5 min-h-[40px] ${day.toDateString()===new Date().toDateString() ? "bg-blue-50/60 dark:bg-blue-950/20" : ""} ${isClosed ? "bg-slate-200 dark:bg-slate-700" : "bg-emerald-50/40 dark:bg-emerald-950/10"}`} title={isClosed ? closedReason : "Disponible"}>
                    <div className="flex gap-1 h-full">
                      <div className="flex-1 flex flex-col gap-0.5 cursor-pointer" onClick={() => { if (cellBlocks.length>0 && onShowSlotReservations) { onShowSlotReservations(cellBlocks); } }}>
                        {cellBlocks.map((b: any, i: number) => {
                          const txt = b.type === "CLOSED" ? "Cerr" : b.type === "MAINTENANCE" ? "Mant" : b.status === "PENDING_PAYMENT" ? "Hold" : b.status === "PENDING_CONFIRMATION" ? "Pend" : b.status === "SCHEDULED" ? "Fija" : "Res";
                          return <div key={i} className="text-[9px] px-1 py-0.5 rounded text-white truncate" style={{ background: b.type === "CLOSED" ? "#94a3b8" : b.color }} title={`${b.scenario?.name || ""}: ${txt}`}>{b.scenario?.name ? b.scenario.name.slice(0, 8) : ""} {txt}</div>;
                        })}
                      </div>
                      {!isClosed && (allowCreate!==false) && new Date(day.getFullYear(), day.getMonth(), day.getDate(), h+1, 0, 0) > new Date() && <button type="button" className="w-6 h-6 self-center shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold flex items-center justify-center shadow" onClick={(e) => { e.stopPropagation(); const start = String(h).padStart(2, "0") + ":00"; const end = String(Math.min(h + 1, 23)).padStart(2, "0") + ":00"; const dateStr = day.toISOString().slice(0,10); if (onPickSlotWeek && rows[0]) onPickSlotWeek(rows[0].id, dateStr, start, end); else if (onPickSlotScenario && rows[0]) onPickSlotScenario(rows[0].id, start, end); else if (onPickSlot) onPickSlot(start, end); }} title="Agregar reserva">+</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border inline-block" /> Disponible</span><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 inline-block" /> Cerrado/fuera de horario</span><span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-blue-500" /> Reserva/Hold/Mant./Fija (color por escenario)</span></div>
  </div>);
}

function useTheme() {
  const [theme, setTheme] = useState<"light"|"dark">(() => { const s=localStorage.getItem("theme"); if(s==="light"||s==="dark") return s; return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"; });
  useEffect(()=>{ document.documentElement.classList.toggle("dark", theme==="dark"); localStorage.setItem("theme", theme); }, [theme]);
  return { theme, toggle: ()=>setTheme(t=>t==="dark"?"light":"dark") };
}

function Layout({ children, me, onLogout, unread, refreshMe, hideHeader, impersonate, onBackToPlatform }: { children: React.ReactNode; me: Me|null; onLogout: ()=>void; unread: number; refreshMe: ()=>Promise<void>; hideHeader?: boolean; impersonate?: any; onBackToPlatform?: ()=>void; }) {
  const [menuOpen,setMenuOpen]=useState(false); const [userMenuOpen,setUserMenuOpen]=useState(false);
  const [profileOpen,setProfileOpen]=useState(false);
  const [pName,setPName]=useState(""); const [pAvatar,setPAvatar]=useState("");
  const [pCur,setPCur]=useState(""); const [pNew,setPNew]=useState(""); const [pMsg,setPMsg]=useState(""); const [pErr,setPErr]=useState(""); const [pBusy,setPBusy]=useState(false);
  const {theme,toggle}=useTheme(); const cfg=getRuntimeConfig();
  const sntLogo = theme==="dark"?"/brand/snt-blanco.png":"/brand/snt-azul.png";
  const memberships = me?.memberships || [];
  const roles = new Set((memberships as any[]).map((m:any)=>m.role));
  const isPlatform = (!!me?.isPlatformAdmin || roles.has("PLATFORM_ADMIN")) && !impersonate;
  const effIsTenantAdmin = impersonate ? impersonate.role==="TENANT_ADMIN" : roles.has("TENANT_ADMIN");
  const effIsComplexAdmin = impersonate ? impersonate.role==="COMPLEX_ADMIN" : roles.has("COMPLEX_ADMIN");
  const effIsSeller = impersonate ? impersonate.role==="SELLER" : roles.has("SELLER");
  const isTenantAdmin = effIsTenantAdmin;
  const isComplexAdmin = effIsComplexAdmin;
  const isSeller = effIsSeller;
  const nav = [
    ...(isPlatform?[{to:"/admin?tab=tenants",label:"Tenants"}]:[]),
    {to:"/admin?tab=reservas",label:"Complejo"},
    ...((isPlatform||isTenantAdmin||isComplexAdmin||isSeller)?[{to:"/admin?tab=ventas",label:"Ventas"},{to:"/admin?tab=reportes",label:"Reportes"},{to:"/admin?tab=historial",label:"Historial"}]:[]),
    ...((isPlatform||isTenantAdmin||isComplexAdmin)?[{to:"/admin?tab=usuarios",label:"Usuarios"}]:[]),
    ...(isPlatform||isTenantAdmin?[{to:"/admin?tab=complejos",label:"Complejos"}]:[]),
  ];
  useEffect(()=>{ if(profileOpen && me){ setPName(me.name||""); setPAvatar(me.avatarUrl||""); setPCur(""); setPNew(""); setPMsg(""); setPErr(""); } },[profileOpen, me?.id]);
  const canChangePassword = !!(me?.hasPassword) || !(me?.hasGoogle);
  async function saveProfile(e:FormEvent){ e.preventDefault(); setPBusy(true); setPErr(""); setPMsg(""); try{ await apiFetch("/auth/me",{method:"PATCH",body:JSON.stringify({name:pName||null,avatarUrl:pAvatar||null})}); await refreshMe(); setPMsg("Perfil actualizado."); }catch(err:any){ setPErr(err.message||"Error"); } finally{ setPBusy(false); } }
  async function changePw(e:FormEvent){ e.preventDefault(); setPBusy(true); setPErr(""); setPMsg(""); try{ await apiFetch("/auth/change-password",{method:"POST",body:JSON.stringify({currentPassword: me?.hasPassword ? pCur : undefined, newPassword: pNew})}); setPCur(""); setPNew(""); await refreshMe(); setPMsg("Contraseña actualizada."); }catch(err:any){ setPErr(err.message||"Error"); } finally{ setPBusy(false); } }
  if (hideHeader) return (<div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">{children}<footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-4"><div className="mx-auto max-w-6xl flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span>POWERED by</span><img src={sntLogo} alt="Supernovatel" className="h-5 object-contain"/></div></footer></div>);
  return (<div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="sticky top-0 z-40 border-b border-slate-200/70 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur relative">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
        <button className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Menú" onClick={()=>setMenuOpen(v=>!v)}><span className="block w-5 h-0.5 bg-current mb-1"/><span className="block w-5 h-0.5 bg-current mb-1"/><span className="block w-5 h-0.5 bg-current"/></button>
        <Link to="/" aria-label="Inicio" className="flex items-center gap-2"><img src="/brand/logo.png" alt={cfg.appName} className="h-9 w-9 object-contain"/>{unread>0 && <span className="inline-flex items-center text-xs text-red-600"><Icon.bell className="w-4 h-4"/><Badge count={unread}/></span>}</Link>
        <div className="relative flex items-center gap-2">
          {impersonate && onBackToPlatform && <button onClick={onBackToPlatform} className="rounded-md border px-2 py-1 text-xs" title="Volver a platform admin">⬅️</button>}
          <button className="h-9 w-9 rounded-full bg-brand text-white font-semibold flex items-center justify-center overflow-hidden" onClick={()=>setUserMenuOpen(v=>!v)}>{me?.avatarUrl ? <img src={me.avatarUrl} alt="" className="h-full w-full object-cover"/> : (me?.name||me?.email||"I").slice(0,1).toUpperCase()}</button>
          {userMenuOpen && <div className="absolute right-0 mt-2 w-72 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-1 text-sm">
            <div className="px-3 py-2 text-xs text-slate-500 truncate">{me?me.email:"Invitado (sin sesión)"}</div>
            <button onClick={()=>{toggle();setUserMenuOpen(false);}} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Tema ({theme==="dark"?"oscuro":"claro"})</button>
            {me && <button onClick={()=>{setUserMenuOpen(false);setProfileOpen(true);}} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Editar perfil</button>}
            {me && <button onClick={()=>{setUserMenuOpen(false);onLogout();}} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-red-600">Cerrar sesión</button>}
            {!me && <div className="px-3 py-2 text-xs text-slate-500">Acceso de invitado: puedes ver complejos y reservar.</div>}
          </div>}
        </div>
      </div>
      {menuOpen && <><div className="fixed inset-0 z-40" onClick={()=>setMenuOpen(false)} /><div className="absolute left-2 top-14 z-50 w-64 max-w-[80vw] rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-1 text-sm"><nav className="flex flex-col">{nav.map((i,idx)=> <NavLink key={i.to+"-"+idx} to={i.to} onClick={()=>setMenuOpen(false)} className={({isActive})=>`px-3 py-2 rounded ${isActive?"bg-slate-100 dark:bg-slate-800 font-medium":"hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{i.label}</NavLink>)}</nav></div></>}
    </header>
    <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8 overflow-x-hidden">{children}</main>
    <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-4"><div className="mx-auto max-w-6xl flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span>POWERED by</span><img src={sntLogo} alt="Supernovatel" className="h-5 object-contain"/></div></footer>

    {profileOpen && me && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Editar perfil</h2><button onClick={()=>setProfileOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      {(pErr||pMsg)&&<div className="text-sm">{pErr&&<span className="text-red-600 mr-2">{pErr}</span>}{pMsg&&<span className="text-green-700 dark:text-green-400">{pMsg}</span>}</div>}
      <form onSubmit={saveProfile} className="space-y-2">
        <h3 className="font-medium text-sm">Datos</h3>
        <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre" value={pName} onChange={e=>setPName(e.target.value)}/>
        <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="URL de foto (avatar)" value={pAvatar} onChange={e=>setPAvatar(e.target.value)}/>
        <p className="text-xs text-slate-500">Puedes usar una URL de imagen para tu foto de perfil.</p>
        <button disabled={pBusy} className="rounded-md bg-brand text-white px-4 py-2 text-sm">Guardar perfil</button>
      </form>
      <div className="border-t pt-3">
        <h3 className="font-medium text-sm mb-2">Contraseña</h3>
        {me.hasGoogle && !me.hasPassword ? (
          <p className="text-sm text-slate-500">Esta cuenta usa inicio de sesión social (Google). El cambio de contraseña no es necesario.</p>
        ) : (
          <form onSubmit={changePw} className="space-y-2">
            {me.hasPassword && <input type="password" className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Contraseña actual" value={pCur} onChange={e=>setPCur(e.target.value)}/>}
            <input type="password" className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nueva contraseña (mín. 6)" value={pNew} onChange={e=>setPNew(e.target.value)}/>
            {!me.hasPassword && <p className="text-xs text-slate-500">Define una contraseña para poder iniciar sesión con email y contraseña.</p>}
            <button disabled={pBusy} className="rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-4 py-2 text-sm">Cambiar contraseña</button>
          </form>
        )}
      </div>
    </div></div>}
  </div>);
}

function DepartmentModal({ open, departments, current, onSelect, onClose }: { open: boolean; departments: readonly string[]; current?: string|null; onSelect: (d: string)=>void; onClose: ()=>void }) {
  const [val,setVal]=useState(current||"Santa Cruz");
  useEffect(()=>{ setVal(current||"Santa Cruz"); },[current, open]);
  if (!open) return null;
  return (<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
    <h2 className="font-semibold">Selecciona tu departamento</h2>
    <p className="text-sm text-slate-500">Mostraremos complejos y escenarios disponibles en el departamento seleccionado. Puedes cambiarlo cuando quieras.</p>
    <select className="w-full border rounded px-3 py-2 bg-transparent" value={val} onChange={e=>setVal(e.target.value)}>{departments.map(d=> <option key={d} value={d}>{d}</option>)}</select>
    <div className="flex gap-2 justify-end"><button className="rounded border px-3 py-2" onClick={onClose}>Cancelar</button><button className="rounded bg-brand text-white px-3 py-2" onClick={()=>onSelect(val)}>Guardar</button></div>
  </div></div>);
}

function HomePage({ me, refreshMe, unreadCount, notifications, onReadAll }: { me: Me|null; refreshMe: ()=>Promise<void>; unreadCount: number; notifications: any[]; onReadAll: ()=>Promise<void> }) {
  const [authCfg,setAuthCfg]=useState<any>(null); const [health,setHealth]=useState<any>(null);
  const [mode,setMode]=useState<"login"|"set">("login"); const [email,setEmail]=useState("admin@supernovatel.com");
  const [password,setPassword]=useState(""); const [newPw,setNewPw]=useState(""); const [msg,setMsg]=useState(""); const [err,setErr]=useState("");
  const [complexes,setComplexes]=useState<any[]>([]); const [depts,setDepts]=useState<string[]>([...DEPARTMENTS]);
  const [department,setDepartment]=useState<string>(()=>localStorage.getItem("adcode.department")||"Santa Cruz");
  const [deptModal,setDeptModal]=useState(false);
  const [askedDept,setAskedDept]=useState(false);
  const [searchForm,setSearchForm]=useState({type:"",date:new Date().toISOString().slice(0,10),start:"10:00",end:"11:00"});
  const [searching,setSearching]=useState(false);
  const [searchResults,setSearchResults]=useState<any[]|null>(null);
  const [searchErr,setSearchErr]=useState("");

  useEffect(()=>{ apiFetch<any>("/auth/config").then(setAuthCfg).catch(()=>null); apiFetch<any>("/health").then(setHealth).catch(()=>null); apiFetch<any>("/complexes").then(r=>{ setComplexes(r.data||[]); if(r.departments?.length) setDepts(r.departments); }).catch(()=>{}); },[]);
  useEffect(()=>{ 
    if(!me) return; 
    const fromUser = me.lastDepartment; 
    if(fromUser){ setDepartment(fromUser); localStorage.setItem("adcode.department", fromUser); setAskedDept(true); return; } 
    const isTenantMember = !!(me.isPlatformAdmin || (me.memberships||[]).length > 0);
    if(isTenantMember){ setAskedDept(true); return; }
    if(!askedDept){ setDeptModal(true); setAskedDept(true); } 
  },[me?.id, me?.lastDepartment, me?.isPlatformAdmin, (me?.memberships||[]).length, askedDept]);

  async function chooseDepartment(d:string){ setDepartment(d); localStorage.setItem("adcode.department", d); setDeptModal(false); if(me){ try{ await apiFetch<any>("/auth/me/preferences",{method:"PATCH",body:JSON.stringify({lastDepartment:d})}); await refreshMe(); }catch{} } }
  async function onLogin(e:FormEvent){ e.preventDefault(); setErr(""); setMsg(""); try{ await apiFetch("/auth/login",{method:"POST",body:JSON.stringify({email,password})}); await refreshMe(); setMsg("Sesión iniciada."); setPassword(""); }catch(e:any){ const m=e.message||"Error"; if(m.toLowerCase().includes("establecer")||m.toLowerCase().includes("password not set")||m.toLowerCase().includes("contraseña")){setMode("set");setErr("Cuenta sin contraseña: establécela para continuar.");} else setErr(m);} }
  async function onSet(e:FormEvent){ e.preventDefault(); setErr(""); setMsg(""); try{ await apiFetch("/auth/set-password",{method:"POST",body:JSON.stringify({email,password:newPw})}); await refreshMe(); setMsg("Contraseña establecida. Sesión iniciada."); setMode("login"); setNewPw(""); }catch(e:any){ setErr(e.message||"Error"); } }
  async function runSearch(e?:FormEvent){ if(e) e.preventDefault(); setSearchErr(""); setSearching(true); setSearchResults(null);
    try{
      const qs = new URLSearchParams({ department, date: searchForm.date, start: searchForm.start, end: searchForm.end });
      if(searchForm.type.trim()) qs.set("type", searchForm.type.trim());
      const r = await apiFetch<any>(`/scenarios/search?${qs.toString()}`);
      setSearchResults(r.data||[]);
    }catch(ex:any){ setSearchErr(ex.message||"No se pudo buscar disponibilidad"); setSearchResults([]); }
    finally{ setSearching(false); }
  }

  const filtered = useMemo(()=>complexes.filter((c:any)=>!department || c.department===department),[complexes,department]);

  if (me) {
    const memberships = me.memberships || [];
    const isPlatform = !!me.isPlatformAdmin;
    const hasTenant = (r:string) => memberships.some((m:any)=>m.role===r);
    const isTenantAdmin = hasTenant("TENANT_ADMIN");
    const isComplexAdmin = hasTenant("COMPLEX_ADMIN");
    const isSeller = hasTenant("SELLER");
    const boxes = [
      ...(isPlatform ? [{label:"Tenants",emoji:"🏢",color:"bg-indigo-500",to:"/admin?tab=tenants"}] : []),
      ...(isPlatform||isTenantAdmin ? [{label:"Complejos",emoji:"🏟️",color:"bg-emerald-500",to:"/admin?tab=complejos"},{label:"Escenarios",emoji:"⚽",color:"bg-amber-500",to:"/admin?tab=escenarios"},{label:"Usuarios",emoji:"👥",color:"bg-purple-500",to:"/admin?tab=usuarios"}] : []),
      ...(isPlatform||isTenantAdmin||isComplexAdmin||isSeller ? [{label:"Reservas",emoji:"📅",color:"bg-rose-500",to:"/admin?tab=reservas"},{label:"Ventas",emoji:"💰",color:"bg-green-500",to:"/admin?tab=ventas"},{label:"Reportes",emoji:"📈",color:"bg-cyan-500",to:"/admin?tab=reportes"},{label:"Historial",emoji:"📜",color:"bg-slate-500",to:"/admin?tab=historial"}] : []),
      ...(isPlatform||isTenantAdmin||isComplexAdmin ? [{label:"Productos",emoji:"🛒",color:"bg-orange-500",to:"/admin?tab=productos"},{label:"Inventario",emoji:"📦",color:"bg-teal-500",to:"/admin?tab=inventario"}] : []),
    ];
    return (<div className="space-y-6">
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <img src="/brand/logo.png" alt="AdCoDe" className="h-24 w-24 object-contain" />
          <h1 className="text-2xl font-bold">👋 Hola, {me.name||me.email}</h1>
          <p className="text-sm text-slate-500">{me.email}{me.isPlatformAdmin?" · Platform Admin":""}</p>
        </div>
      </section>
      <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {boxes.map((b:any)=>(
          <Link key={b.label} to={b.to} className={`${b.color} text-white rounded-xl p-4 flex flex-col items-center gap-1 shadow hover:opacity-90 transition`}>
            <span className="text-3xl">{b.emoji}</span>
            <span className="text-sm font-medium">{b.label}</span>
          </Link>
        ))}
      </section>
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-2"><h2 className="font-medium inline-flex items-center">🔔 Notificaciones <Badge count={unreadCount}/></h2>{unreadCount>0 && <button onClick={onReadAll} className="text-sm underline text-blue-600">Marcar todas leídas</button>}</div>
        {notifications.length===0 ? <p className="text-sm text-slate-500">Sin notificaciones.</p> : <ul className="space-y-2 text-sm">{notifications.slice(0,12).map((n:any)=> (
          <li key={n.id} className={`border border-slate-200 dark:border-slate-700 rounded p-2 ${n.readAt?"opacity-70":""}`}><div className="flex justify-between gap-2"><b>{n.title}</b><span className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</span></div><div>{n.body}</div><div className="text-xs text-slate-500 mt-1">{n.type}</div></li>
        ))}</ul>}
      </section>
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-2"><h2 className="font-medium">📍 Departamento</h2></div>
        <div className="flex items-center gap-2"><span className="text-sm">{department}</span><button onClick={()=>setDeptModal(true)} className="text-sm underline text-blue-600">Cambiar</button></div>
      </section>
    </div>);
  }
  return (<div className="space-y-6">
    <DepartmentModal open={deptModal} departments={depts} current={department} onSelect={chooseDepartment} onClose={()=>setDeptModal(false)} />
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 text-center">
      <div className="flex flex-col items-center gap-3 mb-4"><img src="/brand/logo.png" alt="AdCoDe" className="h-20 w-20 object-contain" /><h1 className="text-3xl font-bold">🏟️ AdCoDe</h1><p className="text-slate-600 dark:text-slate-300 max-w-md">Administración de complejos deportivos: reservas, escenarios, ventas, inventario y reportes. ⚽🏀🎾</p></div>

      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <a href={authCfg?.googleAuthEnabled?"/api/v1/auth/google/start":undefined} onClick={e=>{if(!authCfg?.googleAuthEnabled)e.preventDefault();}} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 ${authCfg?.googleAuthEnabled?"":"opacity-50 cursor-not-allowed"}`} title={authCfg?.googleAuthEnabled?"Continuar con Google":"Google OAuth pendiente"}><img src="/brand/google-g.png" alt="Google" className="h-5 w-5"/> Continuar con Google 🔐</a>
        {me && <Link to="/admin" className="inline-flex items-center rounded-md border px-4 py-2">Ir al panel 📊</Link>}
      </div>
      {!me ? (<div className="mt-5 max-w-md mx-auto text-left">
        <h2 className="font-medium mb-2 inline-flex items-center gap-2"><Icon.key className="w-4 h-4 text-blue-600"/> {mode==="login"?"🔑 Iniciar sesión (email y contraseña)":"Establecer contraseña"}</h2>
        {mode==="login" ? (<form onSubmit={onLogin} className="space-y-2">
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Email"/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Contraseña"/>
          <div className="flex gap-2"><button className="rounded-md bg-brand text-white px-4 py-2">Entrar 🚀</button><button type="button" onClick={()=>{setMode("set");setErr("");}} className="text-sm underline text-blue-600">Primera vez / establecer contraseña ✨</button></div>
        </form>) : (<form onSubmit={onSet} className="space-y-2">
          <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Email"/>
          <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nueva contraseña (mín. 6)"/>
          <div className="flex gap-2"><button className="rounded-md bg-brand text-white px-4 py-2">Guardar y entrar ✨</button><button type="button" onClick={()=>setMode("login")} className="text-sm underline">Volver</button></div>
        </form>)}
        {err && <p className="text-sm mt-2 text-red-600">{err}</p>}{msg && <p className="text-sm mt-2 text-green-700 dark:text-green-400">{msg}</p>}
        <p className="text-xs mt-2 text-slate-500">Invitado puede navegar sin sesión. Pruebas: admin@supernovatel.com / Admin123! · admin.demo@adcode.test / User123!</p>
      </div>) : (<div className="mt-4 text-sm">Sesión: <b>{(me as any)?.email}</b>{(me as any)?.isPlatformAdmin?" (platform admin)":""} · Departamento: {department} <button className="underline text-blue-600 ml-1" onClick={()=>setDeptModal(true)}>cambiar</button></div>)}
      <p className="mt-3 text-xs text-slate-500">API: {health?.ok?`OK (${health.version||"dev"})`:"sin conexión"} · Google: {authCfg?.googleAuthEnabled?"configurado":"pendiente"}</p>
    </section>

    {me && <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><div className="font-medium inline-flex items-center">Reservas <Badge count={unreadCount}/></div><div className="text-xs text-slate-500 mt-1">Notificaciones in-app</div></div>
      <button onClick={()=>setDeptModal(true)} className="text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 hover:border-brand"><div className="font-medium">Departamento</div><div className="text-xs text-slate-500 mt-1">{department} (cambiar)</div></button>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><div className="font-medium">Complejos</div><div className="text-xs text-slate-500 mt-1">{filtered.length} en {department}</div></div>
      <Link to="/admin" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 hover:border-brand"><div className="font-medium">Panel</div><div className="text-xs text-slate-500 mt-1">Gestión y administración</div></Link>
    </section>}

    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2"><h2 className="font-medium">Complejos en</h2><select className="border rounded px-2 py-1.5 bg-transparent text-sm" value={department} onChange={e=>{setDepartment(e.target.value); localStorage.setItem("adcode.department", e.target.value); if(me){ apiFetch<any>("/auth/me/preferences",{method:"PATCH",body:JSON.stringify({lastDepartment:e.target.value})}).catch(()=>{}); } }}>{depts.map(d=> <option key={d} value={d}>{d}</option>)}</select><span className="text-xs text-slate-500">{filtered.length} resultado(s)</span></div>
      {filtered.length===0 ? <p className="text-sm text-slate-500">No hay complejos en este departamento. <button className="underline text-blue-600" onClick={()=>setDeptModal(true)}>Cambiar departamento</button></p> : (
        <ul className="grid md:grid-cols-2 gap-3">{filtered.map((c:any)=> (
          <li key={c.id} className="border rounded-lg p-3">
            <div className="font-medium">{c.name}</div>
            <div className="text-xs text-slate-500">/{c.slug} · {c.department || "Santa Cruz"} · Horario: {c.openTime||"08:00"}-{c.closeTime||"22:00"} · {c.scenarios?.length||0} escenario(s) · sin prepago: {c.allowClientPayLater?"sí":"no"}</div>
            <div className="mt-2"><Link to={`/c/${c.slug}`} className="text-sm text-blue-600 underline">Ver complejo y reservar</Link></div>
          </li>
        ))}</ul>
      )}
    </section>

    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-medium">Buscar escenario disponible</h2><span className="text-xs text-slate-500">Departamento: {department}</span></div>
      <p className="text-sm text-slate-500">Busca por tipo de escenario y horario para ver complejos con disponibilidad y precios (incluye beneficio/descuento VIP si corresponde).</p>
      <form onSubmit={runSearch} className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
        <input className="border rounded px-2 py-2 bg-transparent lg:col-span-2" placeholder="Tipo o nombre (ej. cancha, fútbol, piscina)" value={searchForm.type} onChange={e=>setSearchForm({...searchForm,type:e.target.value})} />
        <input type="date" className="border rounded px-2 py-2 bg-transparent" value={searchForm.date} onChange={e=>setSearchForm({...searchForm,date:e.target.value})} />
        <input type="time" className="border rounded px-2 py-2 bg-transparent" value={searchForm.start} onChange={e=>setSearchForm({...searchForm,start:e.target.value})} />
        <div className="flex gap-2"><input type="time" className="flex-1 border rounded px-2 py-2 bg-transparent" value={searchForm.end} onChange={e=>setSearchForm({...searchForm,end:e.target.value})} /><button className="rounded-md bg-brand text-white px-3 py-2 whitespace-nowrap" disabled={searching}>{searching?"Buscando…":"Buscar"}</button></div>
      </form>
      {searchErr && <p className="text-sm text-red-600">{searchErr}</p>}
      {searchResults !== null && <div className="space-y-3">
        <div className="text-sm text-slate-600 dark:text-slate-300">{searchResults.length===0 ? "No hay escenarios disponibles para ese tipo/fecha/horario en este departamento." : `${searchResults.reduce((a:number,c:any)=>a+(c.scenarios?.length||0),0)} escenario(s) disponible(s) en ${searchResults.length} complejo(s).`}</div>
        {searchResults.map((g:any)=> (
          <div key={g.complex.id} className="border rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{g.complex.name}</div><div className="text-xs text-slate-500">/{g.complex.slug} · {g.complex.department} · Horario: {g.complex.openTime||"08:00"}-{g.complex.closeTime||"22:00"}</div></div><Link to={`/c/${g.complex.slug}`} className="text-sm text-blue-600 underline">Ver complejo</Link></div>
            <ul className="grid md:grid-cols-2 gap-2">
              {(g.scenarios||[]).map((s:any)=>{
                const base = s.priceEstimate?.base ?? 0; const currency = s.priceEstimate?.currency || g.complex.currency || "BOB";
                const myTierType = (me as any)?.memberships?.find((m:any)=> (m.tenantId===g.complex?.tenantId || true))?.clientTier; // fallback: show VIP tier if present
                const tierMatch = (s.priceEstimate?.tiers||[]).find((t:any)=>t.type===myTierType) || (s.priceEstimate?.tiers||[]).find((t:any)=>t.type==="PREFERENCIAL") || (s.priceEstimate?.tiers||[]).find((t:any)=>t.type==="HABITUAL");
                return (<li key={s.scenarioId} className="border rounded p-2 text-sm bg-slate-50/60 dark:bg-slate-800/40">
                  <div className="font-medium">{s.scenarioName}{s.group?.name?` · ${s.group.name}`:""}</div>
                  <div className="text-xs text-slate-500">Disponible {s.openTime||g.complex.openTime}-{s.closeTime||g.complex.closeTime} · {s.rentalFormat}</div>
                  <div className="mt-1">Precio: <b>{money(base, currency)}</b></div>
                  {tierMatch && tierMatch.total < base && <div className="text-xs text-emerald-700 dark:text-emerald-400">Precio {tierMatch.name || tierMatch.type}: <b>{money(tierMatch.total, currency)}</b> (ahorra {money(base-tierMatch.total,currency)}{tierMatch.discountPercent?`, ${tierMatch.discountPercent}%`:""})</div>}
                  {!tierMatch && (s.priceEstimate?.tiers||[]).some((t:any)=>t.total < base) && <div className="text-xs text-emerald-700 dark:text-emerald-400">Clientes Habitual/VIP pueden tener descuento según configuración del complejo.</div>}
                  <div className="mt-1"><Link to={`/c/${g.complex.slug}`} className="text-xs underline text-blue-600">Reservar este escenario</Link></div>
                </li>);
              })}
            </ul>
          </div>
        ))}
      </div>}
    </section>

    {me && <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2"><h2 className="font-medium inline-flex items-center"><Icon.bell className="w-4 h-4 mr-2 text-blue-600"/> Notificaciones <Badge count={unreadCount}/></h2>{unreadCount>0 && <button onClick={onReadAll} className="text-sm underline text-blue-600">Marcar todas leídas</button>}</div>
      {notifications.length===0 ? <p className="text-sm text-slate-500">Sin notificaciones.</p> : <ul className="space-y-2 text-sm">{notifications.slice(0,12).map((n:any)=> (
        <li key={n.id} className={`border rounded p-2 ${n.readAt?"opacity-70":""}`}><div className="flex justify-between gap-2"><b>{n.title}</b><span className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</span></div><div>{n.body}</div><div className="text-xs text-slate-500 mt-1">{n.type}</div></li>
      ))}</ul>}
    </section>}
  </div>);
}


function PublicMenuPage(){
  const {slug}=useParams(); const cs=slug||"";
  const [data,setData]=useState<any>(null); const [err,setErr]=useState("");
  useEffect(()=>{ apiFetch<any>(`/sales/menu/${cs}`).then(r=>setData(r.data)).catch(e=>setErr(e.message||"Error")); },[cs]);
  const url = typeof window!=="undefined" ? window.location.href : "";
  const qr = url ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}` : "";
  if(err) return <div className="rounded-xl border p-6 bg-white dark:bg-slate-900 text-red-600">{err}</div>;
  if(!data) return <div className="text-sm text-slate-500">Cargando menú...</div>;
  const c=data.complex;
  return (<div className="max-w-2xl mx-auto space-y-4">
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{c?.name||"Menú"}</h1><p className="text-sm text-slate-500">Menú digital {c?.currency?`· ${c.currency}`:""}</p></div>
      {qr && <div className="text-center text-xs text-slate-500"><img src={qr} alt="QR menú" className="w-28 h-28 border rounded bg-white"/><div className="mt-1">Escanea para abrir</div></div>}
    </div>
    {(data.items||[]).length===0 ? <div className="rounded-xl border p-6 bg-white dark:bg-slate-900 text-sm text-slate-500">Sin productos disponibles.</div> :
      <div className="space-y-3">{(data.items||[]).map((p:any)=> (
        <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="flex justify-between gap-2"><div><div className="font-medium">{p.name}</div>{p.category && <div className="text-xs text-slate-500">{p.category}</div>}{p.notes && <div className="text-xs text-slate-500 mt-1">{p.notes}</div>}</div><div className="text-xs text-slate-500">Stock total: {p.stock}</div></div>
          <div className="mt-2 space-y-1">{(p.presentations||[]).map((pr:any)=> (
            <div key={pr.id} className="flex justify-between text-sm border-t pt-1"><span>{pr.name}{pr.unitsPerPack>1?` (${pr.unitsPerPack} u.)`:""}</span><span className={pr.available?"text-green-700 dark:text-green-400":"text-slate-400"}>{money(pr.price,c?.currency)} · {pr.available?`disp. ${pr.stock}`:"agotado"}</span></div>
          ))}</div>
        </div>
      ))}</div>}
  </div>);
}

function ComplexPage({me}:{me:Me|null}){
  const {slug}=useParams(); const cs=slug||"central";
  const [complex,setComplex]=useState<any>(null); const [scenarios,setScenarios]=useState<any[]>([]); const [menu,setMenu]=useState<any[]>([]);
  const [form,setForm]=useState<any>({scenarioId:"",date:new Date().toISOString().slice(0,10),start:"10:00",end:"11:00",clientName:"",payLater:false,recurring:false,weekday:"2",weeks:8});
  const [result,setResult]=useState<any>(null); const [err,setErr]=useState(""); const [msg,setMsg]=useState("");
  const [availability,setAvailability]=useState<Record<string, any[]>>({});
  useEffect(()=>{ apiFetch<any>(`/complexes/${cs}`).then(r=>setComplex(r.data)).catch(()=>{}); apiFetch<any>(`/scenarios?slug=${cs}`).then(r=>setScenarios(r.data||[])).catch(()=>{}); apiFetch<any>(`/sales/menu/${cs}`).then(r=>setMenu(r.data?.items||[])).catch(()=>{}); },[cs]);
  useEffect(()=>{ if(scenarios[0]&&!form.scenarioId) setForm((f:any)=>({...f,scenarioId:scenarios[0].id})); },[scenarios]);
  async function loadAvailability(){
    if(!form.scenarioId || !form.date) return;
    try{ const {from,to}=dayRange(form.date); const r=await apiFetch<any>(`/scenarios/${form.scenarioId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); setAvailability({[form.scenarioId]: r.data?.blocks||[]}); }catch{ setAvailability({[form.scenarioId]:[]}); }
  }
  useEffect(()=>{ loadAvailability(); },[form.scenarioId, form.date]);
  const tenantId = complex?.tenant?.id || complex?.tenantId;
  const myMembership = me?.memberships?.find((m:any)=>m.tenantId===tenantId);
  const myTierCfg = complex?.tenant?.clientTiers?.find((t:any)=>t.type===myMembership?.clientTier);
  const tierAllows = Boolean(myMembership && (myMembership.clientTier==="HABITUAL" || myMembership.clientTier==="PREFERENCIAL"));
  const canPayLater = Boolean(tierAllows && complex?.allowClientPayLater);
  const selectedScenario = scenarios.find(s=>s.id===form.scenarioId);
  const baseEstimate = selectedScenario ? estimateScenarioPrice(complex, selectedScenario, form.date, form.start, form.end) : null;
  const vipEstimate = selectedScenario && myTierCfg ? estimateScenarioPrice(complex, selectedScenario, form.date, form.start, form.end, undefined, myTierCfg) : null;
  async function create(e:FormEvent){ e.preventDefault(); setErr(""); setMsg(""); setResult(null);
    try{
      const startAt = new Date(`${form.date}T${form.start}:00`).toISOString();
      const endAt = new Date(`${form.date}T${form.end}:00`).toISOString();
      if (form.recurring) {
        const r = await apiFetch<any>("/reservations/recurring", { method:"POST", body: JSON.stringify({ scenarioId: form.scenarioId, startAt, endAt, weekday: Number(form.weekday), weeks: Number(form.weeks), clientName: form.clientName||undefined, note: "Reserva fija recurrente" }) });
        setResult({ recurring: true, ...r });
        setMsg(`Reserva fija ${r.data?.seriesCode||""} creada. Ocurrencias: ${r.data?.created||0}, conflictos: ${r.data?.conflicts||0}. Solo la semana en curso (${r.data?.currentCode||"actual"}) queda visible para pago.`);
      } else {
        const r = await apiFetch<any>("/reservations", { method:"POST", body: JSON.stringify({ scenarioId: form.scenarioId, startAt, endAt, clientName: form.clientName || me?.name || undefined, payLater: Boolean(form.payLater && canPayLater) }) });
        setResult(r);
      }
      await loadAvailability();
    } catch(e:any){ setErr(e.message||"Error creando reserva"); await loadAvailability(); }
  }
  async function markReceiptSent(){ if(!result?.data?.code) return; try{ await apiFetch(`/reservations/${result.data.code}/receipt-sent`,{method:"POST"}); setMsg("Comprobante marcado como enviado. Pendiente de confirmación del staff."); }catch(e:any){ setErr(e.message||"No se pudo marcar comprobante"); } }

  return (<div className="space-y-4">
    <div><h1 className="text-xl font-semibold">{complex?.name||`Complejo: ${cs}`}</h1><p className="text-sm text-slate-500">{complex?.department ? `Departamento: ${complex.department} · ` : ""}Horario: {(complex?.openTime||"08:00")}-{(complex?.closeTime||"22:00")} · {me?`Sesión: ${me.email}`:"Sin sesión (invitado)"} · Sin prepago Habitual/VIP: {complex?.allowClientPayLater?"habilitado":"no habilitado"}</p></div>
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3"><h2 className="font-medium">Reserva</h2>
        <div className="text-xs text-slate-500">Horario de atención del complejo: {(complex?.openTime||"08:00")} - {(complex?.closeTime||"22:00")}{selectedScenario ? ` · Escenario: ${(selectedScenario.openTime||complex?.openTime||"08:00")}-${(selectedScenario.closeTime||complex?.closeTime||"22:00")}` : ""}</div>
        {scenarios.length===0?<p className="text-sm text-slate-500">Sin escenarios.</p>:<form onSubmit={create} className="space-y-2 text-sm">
          <select value={form.scenarioId} onChange={e=>setForm({...form,scenarioId:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent">{scenarios.map(s=> { const dr=(s.pricingRules||[]).find((r:any)=>r.period==='DAY'); const nr=(s.pricingRules||[]).find((r:any)=>r.period==='NIGHT'); const ph = dr?.pricePerHour!=null ? `${Number(dr.pricePerHour)}/h día` : (dr?.basePrice!=null?`${Number(dr.basePrice)} bloque`:''); const pn = nr?.pricePerHour!=null ? ` · ${Number(nr.pricePerHour)}/h noche` : ''; return <option key={s.id} value={s.id}>{s.name}{ph?` — ${ph}${pn}`:""}</option>; })}</select>
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent"/>
          <div className="grid grid-cols-2 gap-2"><input type="time" value={form.start} onChange={e=>setForm({...form,start:e.target.value})} className="border rounded px-2 py-2 bg-transparent"/><input type="time" value={form.end} onChange={e=>setForm({...form,end:e.target.value})} className="border rounded px-2 py-2 bg-transparent"/></div>
          <input placeholder="Nombre cliente" value={form.clientName} onChange={e=>setForm({...form,clientName:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent"/>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.recurring)} onChange={e=>setForm({...form,recurring:e.target.checked, payLater: e.target.checked ? true : form.payLater})}/> Reserva fija semanal (ej. todos los martes) — solo Habitual/VIP</label>
          {form.recurring && <div className="space-y-1"><div className="grid grid-cols-2 gap-2"><select className="border rounded px-2 py-2 bg-transparent" value={form.weekday} onChange={e=>setForm({...form,weekday:e.target.value})}><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select><input type="number" min={1} max={52} className="border rounded px-2 py-2 bg-transparent" value={form.weeks} onChange={e=>setForm({...form,weeks:Number(e.target.value)})} placeholder="Semanas"/></div><p className="text-xs text-slate-500">Solo Habitual/Preferencial y con "sin prepago" habilitado. Se reserva el horario siempre: solo la semana en curso es pagable (antes o después, hasta antes de que termine la siguiente semana). Al pagar la actual se habilita la siguiente. Si hay impago/falta o no se paga al cierre de semana se generan 2 adeudos; pagando al menos 1 antes de que termine la siguiente semana la serie continúa, si no se cancela y se libera el horario.</p></div>}
          {!form.recurring && <><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.payLater)} onChange={e=>setForm({...form,payLater:e.target.checked})} disabled={!canPayLater}/> Reserva sin pago anticipado (Habitual/VIP)</label>
          {!canPayLater && <p className="text-xs text-slate-500">Disponible para clientes Habitual/Preferencial cuando el administrador del complejo lo habilita.</p>}</>}
          {baseEstimate && <div className="rounded border p-2 bg-slate-50 dark:bg-slate-800/50 text-sm space-y-1">
            <div className="font-medium">Precio estimado</div>
            <div>Normal: <b>{money(baseEstimate.total, complex?.currency)}</b> <span className="text-xs text-slate-500">(subtotal {money(baseEstimate.subtotal, complex?.currency)})</span></div>
            {vipEstimate && (vipEstimate.discount>0 || myTierCfg) && <div className="text-emerald-700 dark:text-emerald-400">Tu precio ({myMembership?.clientTier||'VIP'}): <b>{money(vipEstimate.total, complex?.currency)}</b>{vipEstimate.discount>0 ? <span> · descuento {money(vipEstimate.discount, complex?.currency)}{myTierCfg?.discountPercent?` (${Number(myTierCfg.discountPercent)}%)`:""}</span> : <span className="text-xs"> (sin descuento configurado, pero con beneficios de tipo)</span>}</div>}
            {!me && <div className="text-xs text-slate-500">Inicia sesión para aplicar beneficios/descuentos de cliente Habitual/VIP si corresponden.</div>}
          </div>}
          <button className="rounded-md bg-brand text-white px-4 py-2">Confirmar reserva</button>{!form.recurring && <p className="text-xs text-slate-500">Consulta el calendario (incluye horarios cerrados/fuera de atención) para evitar conflictos.</p>}
        </form>}
        {err&&<div className="text-sm text-red-600 space-y-1"><p>{err}</p>{String(err).toLowerCase().includes("disponible") && <p className="text-xs">Revisa el calendario de disponibilidad y elige un horario libre.</p>}</div>}{msg&&<p className="text-sm text-green-700 dark:text-green-400">{msg}</p>}
        {result?.data && !result.recurring && <div className="text-sm rounded border p-3 space-y-1"><div><b>Código:</b> {result.data.code}</div><div><b>Estado:</b> {result.data.status}</div><div><b>Total:</b> {result.data.totalAmount} {complex?.currency||""}</div><div><b>Hold:</b> {result.holdMinutes ? `${result.holdMinutes} min` : "sin hold"}</div>{result.data.status==="PENDING_PAYMENT" && <button onClick={markReceiptSent} className="mt-2 rounded border px-3 py-1.5 text-blue-700 border-blue-300">Marcar comprobante enviado</button>}<div className="text-xs text-slate-500">Cliente y staff del complejo reciben notificación in-app al crear la reserva y al confirmar pago. WhatsApp se coordina externamente.</div></div>}
        {result?.recurring && <div className="text-sm rounded border p-3 space-y-1"><div><b>Serie:</b> {result.data?.seriesCode || result.data?.seriesId}</div><div><b>Ocurrencias creadas:</b> {result.data?.created}</div><div><b>Conflictos omitidos:</b> {result.data?.conflicts || 0}</div>{result.data?.currentCode && <div><b>Semana en curso (pagable):</b> {result.data.currentCode}</div>}<div className="text-xs text-slate-500">Solo la semana en curso aparece para pago/confirmación. Las siguientes mantienen el horario reservado y se habilitan una por una al pagar.</div></div>}
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Calendario de disponibilidad {selectedScenario?`· ${selectedScenario.name}`:""}</h2>
          {selectedScenario ? <AvailabilityCalendar date={form.date} scenarios={[selectedScenario]} blocksByScenario={availability} selectableScenarioId={form.scenarioId} onPickSlot={(start,end)=>setForm((f:any)=>({...f,start,end}))} /> : <p className="text-sm text-slate-500">Selecciona un escenario para ver disponibilidad.</p>}
          <p className="text-xs text-slate-500 mt-2">Muestra disponibilidad según horario de atención del complejo/escenario, además de reservas, holds y mantenimiento.</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="font-medium">Menú / stock</h2><div className="flex items-center gap-2 text-xs"><Link to={`/menu/${cs}`} className="text-blue-600 underline">Menú digital</Link>{typeof window!=="undefined" && <img src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(window.location.origin + `/menu/${cs}`)}`} alt="QR" className="w-10 h-10 border rounded bg-white" title="QR men· digital"/>}</div></div>{menu.length===0?<p className="text-sm text-slate-500">Sin productos.</p>:<ul className="space-y-1 text-sm">{menu.map((m:any)=> <li key={m.id} className="border-b pb-1"><div className="flex justify-between"><span>{m.name}{m.category?` · ${m.category}`:""}</span><span className={m.stock>0?"text-green-700 dark:text-green-400":"text-slate-400"}>stock {m.stock}</span></div>{(m.presentations||[]).length>0 && <div className="text-xs text-slate-500">{m.presentations.map((pr:any)=>`${pr.name}: ${money(pr.price, complex?.currency)} (${pr.stock})`).join(" · ")}</div>}</li>)}</ul>}</div>
      </div>
    </div>
  </div>);
}

function AdminPage({me, unreadCount, impersonate, onImpersonate}:{me:Me|null; unreadCount:number; impersonate?:any; onImpersonate?:(v:any)=>void}){
  const memberships = me?.memberships || [];
  const [searchParams] = useSearchParams();
  const isPlatform = !!me?.isPlatformAdmin && !impersonate;
  const tenantRoles = (tid:string)=> memberships.filter((m:any)=>m.tenantId===tid).map((m:any)=>m.role);
  const isTenantAdminFor = (tid:string)=> isPlatform || tenantRoles(tid).includes("TENANT_ADMIN");
  const isComplexAdminFor = (tid:string)=> !isTenantAdminFor(tid) && tenantRoles(tid).includes("COMPLEX_ADMIN");
  const isSellerFor = (tid:string)=> !isTenantAdminFor(tid) && !isComplexAdminFor(tid) && tenantRoles(tid).includes("SELLER");
  const myComplexIds = (tid:string)=> memberships.filter((m:any)=>m.tenantId===tid && (m.role==="COMPLEX_ADMIN"||m.role==="SELLER")).flatMap((m:any)=>m.complexIds||[]);
  const [tab,setTab]=useState(searchParams.get("tab")||"resumen");
  useEffect(()=>{ const t=searchParams.get("tab"); if(t) setTab(t); },[searchParams]); const [tenants,setTenants]=useState<any[]>([]); const [complexes,setComplexes]=useState<any[]>([]);
  const [scenarios,setScenarios]=useState<any[]>([]); const [members,setMembers]=useState<any[]>([]); const [reservations,setReservations]=useState<any[]>([]); const [summary,setSummary]=useState<any>(null);
  const [selTenant,setSelTenant]=useState(""); const [selComplex,setSelComplex]=useState(""); const [resComplex,setResComplex]=useState(""); const [resStatus,setResStatus]=useState(""); const [msg,setMsg]=useState(""); const [err,setErr]=useState("");
  const [tForm,setTForm]=useState({name:"",slug:"",contactName:"",contactEmail:"",maxComplexes:1}); const [tenantModalOpen,setTenantModalOpen]=useState(false); const [tEdit,setTEdit]=useState<any>(null);
  const [complexModalOpen,setComplexModalOpen]=useState(false); const [cForm,setCForm]=useState<any>({name:"",slug:"",department:"Santa Cruz",timezone:"America/La_Paz",currency:"BOB",openTime:"08:00",closeTime:"22:00",weekendOpenTime:"",weekendCloseTime:"",allowClientPayLater:false}); const [cEdit,setCEdit]=useState<any>(null);
  const [sForm,setSForm]=useState<any>({name:"",rentalFormat:"PER_HOUR",priceDay:80,priceNight:100,priceAdult:0,priceChild:0,childAge:10,basePrice:0,blockType:"DAY",openTime:"",closeTime:"",availableDays:[0,1,2,3,4,5,6]}); const [sEdit,setSEdit]=useState<any>(null); const [scnModalOpen,setScnModalOpen]=useState(false);
  const [uForm,setUForm]=useState<any>({email:"",name:"",phone:"",role:"SELLER",clientTier:"NORMAL",complexIds:[] as string[]}); const [uEdit,setUEdit]=useState<any>(null);
  const [calDate,setCalDate]=useState(new Date().toISOString().slice(0,10));
  const [calScenarios,setCalScenarios]=useState<any[]>([]);
  const [calBlocks,setCalBlocks]=useState<Record<string, any[]>>({});
  const [visibleScenarios,setVisibleScenarios]=useState<Record<string, boolean>>({});
  const [resEdit,setResEdit]=useState<any>(null);
  const [showResCreate,setShowResCreate]=useState(false);
  const [resModalOpen,setResModalOpen]=useState(false); const [pendingResPayment,setPendingResPayment]=useState<any>(null); const [receiptOpen,setReceiptOpen]=useState(false); const [receiptData,setReceiptData]=useState<any>(null); const [clientOptions,setClientOptions]=useState<any[]>([]); const [slotResModal,setSlotResModal]=useState(false); const [slotResData,setSlotResData]=useState<any[]>([]); const [resModalForm,setResModalForm]=useState<any>({complexId:"",scenarioId:"",date:new Date().toISOString().slice(0,10),start:"10:00",end:"11:00",clientName:"",clientEmail:"",clientPhone:"",people:1,note:"",showCalendar:false,newClient:false, hours:1, initialStatus:"PENDING_CONFIRMATION"}); const [resModalErr,setResModalErr]=useState(""); const [resModalBusy,setResModalBusy]=useState(false);
  const [cart,setCart]=useState<any[]>([]); const [saleModalOpen,setSaleModalOpen]=useState(false); const [salePaymentMethod,setSalePaymentMethod]=useState<"CASH"|"QR"|"MIXED">("CASH"); const [saleCashPaid,setSaleCashPaid]=useState(""); const [saleReceiptFile,setSaleReceiptFile]=useState<File|null>(null); const [saleBusy,setSaleBusy]=useState(false); const [saleErr,setSaleErr]=useState(""); const [saleMsg,setSaleMsg]=useState("");
  const [resClients,setResClients]=useState<any[]>([]);
  const [resCreate,setResCreate]=useState<any>({scenarioId:"",date:new Date().toISOString().slice(0,10),start:"10:00",end:"11:00",mode:"existing",membershipId:"",newEmail:"",newName:"",newPhone:"",newTier:"NORMAL",clientName:"",initialStatus:"PENDING_PAYMENT",recurring:false,weekday:"1",weeks:8,note:""});
  const [creatingRes,setCreatingRes]=useState(false);
  // Ventas/Inventario
  const [products,setProducts]=useState<any[]>([]); const [categories,setCategories]=useState<any[]>([]); const [suppliers,setSuppliers]=useState<any[]>([]);
  const [warehouses,setWarehouses]=useState<any[]>([]); const [stock,setStock]=useState<any[]>([]); const [movements,setMovements]=useState<any[]>([]);
  const [orders,setOrders]=useState<any[]>([]); const [repSeries,setRepSeries]=useState<any[]>([]); const [repTotals,setRepTotals]=useState<any>(null); const [repBySource,setRepBySource]=useState<any[]>([]);
  const [pForm,setPForm]=useState<any>({name:"",categoryId:"",newCategory:"",newSupplier:"",supplierId:"",notes:"",imageKey:"",imageName:"",presentations:[{name:"Unidad",unitsPerPack:1,cost:0,price:0}]}); const [pEdit,setPEdit]=useState<any>(null); const [prodModalOpen,setProdModalOpen]=useState(false); const [stockModalOpen,setStockModalOpen]=useState(false); const [whForm,setWhForm]=useState<any>({name:"",locations:""}); const [stockForm,setStockForm]=useState<any>({productId:"",presentationId:"",warehouseId:"",qty:1,unitCost:0}); const [whModalOpen,setWhModalOpen]=useState(false); const [importModalOpen,setImportModalOpen]=useState(false); const [bajaModalOpen,setBajaModalOpen]=useState(false); const [bajaForm,setBajaForm]=useState<any>({presentationId:"",qty:1,reason:"Vencimiento"}); const [movModalOpen,setMovModalOpen]=useState(false); const [movLines,setMovLines]=useState<any[]>([{productId:"",presentationId:"",qty:1,fromWarehouseId:"",fromLocationId:"",toWarehouseId:"",toLocationId:""}]);
  const [invIn,setInvIn]=useState<any>({warehouseId:"",locationId:"",supplierId:"",registerExpense:false,items:[{productId:"",presentationId:"",qty:1,unitCost:0}]});
  const [invOut,setInvOut]=useState<any>({warehouseId:"",locationId:"",reason:"SALE",paymentMethod:"CASH",items:[{productId:"",presentationId:"",qty:1,unitPrice:0}],note:""});
  const [importState,setImportState]=useState<any>({warehouseId:"",locationId:"",csv:"",result:null,busy:false});
  const [repQuery,setRepQuery]=useState<any>({complexId:"",from:"",to:"",groupBy:"day"});
  const [maintenances,setMaintenances]=useState<any[]>([]);
  const [mForm,setMForm]=useState<any>({scenarioId:"",type:"ONE_TIME",date:new Date().toISOString().slice(0,10),start:"08:00",end:"10:00",reason:"",cost:"",registerExpense:true,repeatCount:undefined});


  async function loadAll(){ apiFetch<any>("/reports/summary").then(setSummary).catch(()=>{}); try{const r=await apiFetch<any>("/platform/my-tenants"); setTenants(r.data||[]); if(!selTenant&&r.data?.[0]) setSelTenant(r.data[0].id);}catch{setTenants([]);} try{const r=await apiFetch<any>("/complexes/mine"); setComplexes(r.data||[]); if(!selComplex&&r.data?.[0]) setSelComplex(r.data[0].id); if(!resComplex&&r.data?.[0]) setResComplex(r.data[0].id);}catch{setComplexes([]);} }
  async function loadScenarios(id:string){ if(!id){setScenarios([]);return;} try{const r=await apiFetch<any>(`/scenarios?complexId=${id}`); setScenarios(r.data||[]);}catch{setScenarios([]);} }
  async function loadMembers(id:string){ if(!id){setMembers([]);return;} try{const r=await apiFetch<any>(`/users/memberships?tenantId=${id}`); setMembers(r.data||[]);}catch{setMembers([]);} }
  async function loadResClients(tenantId?:string, complexId?:string){
    const tId = tenantId || selTenant || (complexes.find((c:any)=>c.id===(complexId||resComplex))?.tenantId) || "";
    if(!tId){ setResClients([]); return; }
    try{ const r=await apiFetch<any>(`/users/memberships?tenantId=${tId}&role=CLIENT`); setResClients(r.data||[]); }catch{ setResClients([]); }
  }
  async function loadReservations(id?:string, status?:string){ const cid = id ?? resComplex; try{ const qs = new URLSearchParams(); if(cid) qs.set("complexId", cid); if(status ?? resStatus) qs.set("status", (status ?? resStatus) as string); const r=await apiFetch<any>(`/reservations${qs.toString()?`?${qs.toString()}`:""}`); setReservations(r.data||[]);}catch{setReservations([]);} }
  async function loadCalendar(cid?:string, date?:string){
    const complexId = cid ?? resComplex; const d = date ?? calDate;
    if(!complexId){ setCalScenarios([]); setCalBlocks({}); return; }
    try{
      const sr = await apiFetch<any>(`/scenarios?complexId=${complexId}`); const scs = sr.data||[]; setCalScenarios(scs);
      setVisibleScenarios((prev:any)=>{ const next={...prev}; for(const s of scs){ if(next[s.id]===undefined) next[s.id]=true; } return next; });
      const {from,to}=weekRange(d);
      const entries = await Promise.all(scs.map(async (s:any)=>{ try{ const ar=await apiFetch<any>(`/scenarios/${s.id}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); return [s.id, ar.data?.blocks||[]] as const; }catch{ return [s.id, []] as const; } }));
      const map: Record<string, any[]> = {}; for(const [id,blocks] of entries) map[id]=blocks as any[]; setCalBlocks(map);
    }catch{ setCalScenarios([]); setCalBlocks({}); }
  }
  useEffect(()=>{ if(me) loadAll(); },[me?.id]);
  useEffect(()=>{ if(impersonate){ setSelTenant(impersonate.tenantId); if(impersonate.complexId){ setResComplex(impersonate.complexId); setSelComplex(impersonate.complexId); } } },[impersonate?.tenantId, impersonate?.complexId]); useEffect(()=>{loadScenarios(selComplex);},[selComplex]); useEffect(()=>{loadMembers(selTenant);},[selTenant]);   useEffect(()=>{ if(me && tab==="reservas"){ loadReservations(resComplex,resStatus); loadCalendar(resComplex,calDate); const tId = complexes.find((c:any)=>c.id===resComplex)?.tenantId; if(tId){ setSelTenant(tId); loadResClients(tId,resComplex); } } },[tab,resComplex,resStatus,calDate,complexes.length]);
  useEffect(()=>{ if(["productos","inventario","ventas","reportes"].includes(tab)){ const cid=resComplex||selComplex; if(cid){ loadSalesData(cid); if(tab==="reportes") loadReports(); } } },[tab,resComplex,selComplex]);
  useEffect(()=>{ if(tab==="escenarios"){ const cid=selComplex||resComplex; if(cid) loadSalesData(cid); } },[tab,selComplex,resComplex]);

  async function loadSalesData(cid?:string){
    const complexId = cid || resComplex || selComplex; if(!complexId) return;
    try{ const [pr,ca,su,wh,st,or,mv,mt,sc] = await Promise.all([
      apiFetch<any>(`/inventory/products?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/inventory/categories?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/inventory/suppliers?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/inventory/warehouses?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/inventory/stock?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/sales/orders?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/inventory/movements?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/maintenances?complexId=${complexId}`).catch(()=>({data:[]})),
      apiFetch<any>(`/scenarios?complexId=${complexId}`).catch(()=>({data:[]})),
    ]);
      setProducts(pr.data||[]); setCategories(ca.data||[]); setSuppliers(su.data||[]); setWarehouses(wh.data||[]); setStock(st.data||[]); setOrders(or.data||[]); setMovements(mv.data||[]); setMaintenances(mt.data||[]); if(Array.isArray(sc.data)&&sc.data.length) setScenarios(sc.data);
      const w0=(wh.data||[])[0];
      if(w0){ setInvIn((s:any)=>({ ...s, warehouseId:s.warehouseId||w0.id })); setInvOut((s:any)=>({ ...s, warehouseId:s.warehouseId||w0.id })); setImportState((s:any)=>({ ...s, warehouseId:s.warehouseId||w0.id })); }
      setRepQuery((s:any)=>({ ...s, complexId: s.complexId || complexId }));
    }catch{}
  }
  async function loadReports(){
    const complexId = repQuery.complexId || resComplex || selComplex;
    const qs = new URLSearchParams(); if(complexId) qs.set('complexId', complexId); if(repQuery.from) qs.set('from', new Date(repQuery.from).toISOString()); if(repQuery.to) qs.set('to', new Date(repQuery.to+'T23:59:59').toISOString()); if(repQuery.groupBy) qs.set('groupBy', repQuery.groupBy);
    try{ const r=await apiFetch<any>(`/reports/income-vs-expense?${qs.toString()}`); setRepSeries(r.data||[]); setRepTotals(r.totals||null);}catch{ setRepSeries([]); setRepTotals(null);}
    try{ const qs2=new URLSearchParams(); if(complexId) qs2.set('complexId',complexId); if(repQuery.from) qs2.set('from', new Date(repQuery.from).toISOString()); if(repQuery.to) qs2.set('to', new Date(repQuery.to+'T23:59:59').toISOString()); const r2=await apiFetch<any>(`/reports/by-source?${qs2.toString()}`); setRepBySource(r2.data||[]);}catch{ setRepBySource([]);}
  }
  async function uploadFile(file:File, complexId?:string){ const fd=new FormData(); fd.append('file', file); if(complexId) fd.append('complexId', complexId); const r=await apiFetch<any>('/uploads/file',{method:'POST', body: fd}); return r.data; }

  const run=async(fn:()=>Promise<any>, ok?: string)=>{setErr("");setMsg("");try{const res=await fn(); const msgOut = (typeof res==="string" && res) ? res : ok; if(msgOut) setMsg(msgOut);}catch(e:any){setErr(e.message||"Error");}};
  async function handleStockIn(){ const cid=resComplex||selComplex; if(!cid||!stockForm.warehouseId||!stockForm.presentationId){ alert("Completa los campos"); return; } try{ const body = {complexId:cid, warehouseId:stockForm.warehouseId, locationId:stockForm.locationId||null, items:[{productId:stockForm.productId, presentationId:stockForm.presentationId, qty:stockForm.qty, unitCost:0}]}; await apiFetch("/inventory/stock/in",{method:"POST",body:JSON.stringify(body)}); setStockModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }
  function addToCart(p:any, pres:any){ setCart((prev:any[])=>{ const ex=prev.find((c:any)=>c.productId===p.id && c.presentationId===(pres?.id||null)); if(ex){ return prev.map((c:any)=> c===ex?{...c,qty:c.qty+1}:c); } return [...prev,{productId:p.id,presentationId:pres?.id||null,name:p.name,presName:pres?.name||"Unidad",price:Number(pres?.price??p.price??0),qty:1}]; }); }  function decCart(productId:string,presentationId:any){ setCart((prev:any[])=> prev.map((c:any)=> (c.productId===productId && c.presentationId===presentationId)?{...c,qty:Math.max(0,c.qty-1)}:c).filter((c:any)=>c.qty>0)); }  const cartTotal = cart.reduce((a:number,c:any)=>a+c.price*c.qty,0);  async function confirmSale(){ setSaleBusy(true); setSaleErr(""); setSaleMsg(""); try{ const cid=resComplex||selComplex; if(!cid) throw new Error("Selecciona complejo"); const lines=cart.map((c:any)=>({productId:c.productId, presentationId:c.presentationId, qty:c.qty, unitPrice:c.price})); let receiptKey:string|null=null; if(saleReceiptFile){ const fd=new FormData(); fd.append("file",saleReceiptFile); fd.append("complexId",cid); const up=await apiFetch<any>("/uploads/file",{method:"POST",body:fd}); receiptKey=up?.data?.key||null; } await apiFetch("/sales/orders",{method:"POST",body:JSON.stringify({complexId:cid, paymentMethod:salePaymentMethod, lines, cashPaid: saleCashPaid?Number(saleCashPaid):null, receiptKey})}); setCart([]); setSaleModalOpen(false); setSaleCashPaid(""); setSaleReceiptFile(null); await loadSalesData(cid); setSaleMsg("Venta registrada."); }catch(e:any){ setSaleErr(e.message||"Error"); } finally{ setSaleBusy(false); } }
  const activeTenantId = selTenant || complexes.find((c:any)=>c.id===(resComplex||selComplex))?.tenantId || tenants[0]?.id || "";
  const activeTenant = tenants.find((t:any)=>t.id===activeTenantId);
  const tenantInactive = activeTenant ? (activeTenant.status && activeTenant.status !== "ACTIVE") : false;
  const roleCtx = impersonate ? { isPlatform: false, isTenantAdmin: impersonate.role==="TENANT_ADMIN", isComplexAdmin: impersonate.role==="COMPLEX_ADMIN", isSeller: impersonate.role==="SELLER" } : { isPlatform, isTenantAdmin: activeTenantId ? isTenantAdminFor(activeTenantId) : isPlatform, isComplexAdmin: activeTenantId ? isComplexAdminFor(activeTenantId) : false, isSeller: activeTenantId ? isSellerFor(activeTenantId) : false };
  const canManageUsers = roleCtx.isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin; // complex admin can create sellers; seller cannot
  const canCreateComplex = roleCtx.isPlatform || roleCtx.isTenantAdmin;
  const canCreateScenario = roleCtx.isPlatform || roleCtx.isTenantAdmin;
  const canManageInventoryProducts = roleCtx.isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin;
  const canManageOps = roleCtx.isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin || roleCtx.isSeller; // reservas/ventas/ingresos
  // Gran vistas (grupos) y sus sub-pestañas
  const viewDefs: { key:string; label:string; emoji:string; defaultTab:string; subTabs:[string,string][] }[] = [];
  if (isPlatform) viewDefs.push({ key:"tenants", label:"Tenants", emoji:"🏢", defaultTab:"tenants", subTabs:[["tenants","Tenants"]] });
  if (isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin || roleCtx.isSeller) { const _st:any = [["reservas","Reservas"],["mantenimiento","Mantenimiento"]]; if (isPlatform||roleCtx.isTenantAdmin||roleCtx.isComplexAdmin) { _st.push(["escenarios","Escenarios"],["complejos","Complejos"]); } viewDefs.push({ key:"complejo", label:"Complejo", emoji:"🏟️", defaultTab:"reservas", subTabs:_st }); }
  if ((!isPlatform || impersonate) && (isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin || roleCtx.isSeller)) viewDefs.push({ key:"ventas", label:"Ventas", emoji:"💰", defaultTab:"ventas", subTabs:[["ventas","Ventas"],["productos","Productos"],["inventario","Inventario"]] });
  if ((!isPlatform || impersonate) && (isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin || roleCtx.isSeller)) viewDefs.push({ key:"reportes", label:"Reportes", emoji:"📈", defaultTab:"reportes", subTabs:[["reportes","Del complejo"]] });
  if ((!isPlatform || impersonate) && (isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin || roleCtx.isSeller)) viewDefs.push({ key:"historial", label:"Historial", emoji:"📜", defaultTab:"historial", subTabs:[["historial","Ingresos"]] });
  if ((!isPlatform || impersonate) && (isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin)) viewDefs.push({ key:"usuarios", label:"Usuarios", emoji:"👥", defaultTab:"usuarios", subTabs:[["usuarios","Usuarios"]] });
  if ((!isPlatform || impersonate) && (isPlatform || roleCtx.isTenantAdmin)) viewDefs.push({ key:"complejos", label:"Complejos", emoji:"🏗️", defaultTab:"complejos", subTabs:[["complejos","Complejos"]] });
  const tabs = viewDefs.map(v=>[v.defaultTab, v.emoji+" "+v.label] as [string,string]);
  const currentView = viewDefs.find(v=> v.subTabs.some(st=>st[0]===tab)) || viewDefs[0];
  const subTabs = currentView ? currentView.subTabs : [];
  const tenantComplexesAll = complexes.filter((c:any)=>c.tenantId===selTenant || c.tenant?.id===selTenant);
  const allowedComplexIdsForActor = (activeTenantId && roleCtx.isComplexAdmin) ? myComplexIds(activeTenantId) : null;
  const tenantComplexes = allowedComplexIdsForActor ? tenantComplexesAll.filter((c:any)=>allowedComplexIdsForActor.includes(c.id)) : tenantComplexesAll;

  const tabKeys = tabs.map((t:any)=>t[0]).join(",");
  useEffect(()=>{ if(me && tabs.length && !tabs.find((x:any)=>x[0]===tab)) setTab(tabs[0][0]); },[me?.id, tabKeys]);

  if(!me) return <div className="rounded-xl border p-6 bg-white dark:bg-slate-900">Debes iniciar sesión. <Link to="/" className="text-blue-600 underline">Inicio</Link></div>;
  return (<div className="space-y-4">
    <div className="flex items-center justify-between flex-wrap gap-2"><h1 className="text-xl font-semibold">{currentView?currentView.emoji+" "+currentView.label:""}</h1><span className="text-xs text-slate-500">{me.email}{me.isPlatformAdmin?" · platform admin":""} · Notificaciones: {unreadCount}</span></div>
    <div className="flex flex-wrap gap-2 text-sm">{subTabs.map(([k,l])=> <button key={k} onClick={()=>setTab(k)} className={`px-3 py-1.5 rounded border ${tab===k?"bg-brand text-white border-brand":"hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{l}</button>)}</div>
    {(err||msg)&&<div className="text-sm">{err&&<span className="text-red-600 mr-3">{err}</span>}{msg&&<span className="text-green-700 dark:text-green-400">{msg}</span>}</div>}
    {tenantInactive && <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800 p-3 text-sm">Tenant inactivo: modo solo lectura. No se permiten cambios, ventas, reservas ni registros.</div>}

    {tab==="resumen"&&<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{[["Tenants",tenants.length],["Complejos",complexes.length],["Reservas",summary?.data?.reservations??"-"],["Ingresos",summary?.data?.income??"-"],["Egresos",summary?.data?.expense??"-"],["Notificaciones",unreadCount]].map(([l,v])=> <div key={String(l)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold mt-1 inline-flex items-center">{String(v)}{l==="Notificaciones" && <Badge count={unreadCount}/>}</div></div>)}</div>}

    {tab==="tenants"&&me.isPlatformAdmin&&<div className="grid md:grid-cols-2 gap-4">
      <button onClick={()=>{ setTForm({name:"",slug:"",contactName:"",contactEmail:"",maxComplexes:1}); setTenantModalOpen(true); }} className="rounded-md bg-brand text-white px-4 py-2 text-sm mb-3">➕ Nuevo tenant</button>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2"><h2 className="font-medium">Tenants</h2>
        {tenants.length===0?<p className="text-sm text-slate-500">Sin tenants.</p>:<ul className="text-sm space-y-3">{tenants.map(t=> <li key={t.id} className="border-b pb-2 space-y-1">
          <div className="flex items-center justify-between gap-2 flex-wrap"><div><b>{t.name}</b> <span className="text-slate-500">({t.slug})</span> <span className={`ml-1 text-xs px-2 py-0.5 rounded border ${t.status==="ACTIVE"?"text-green-700 border-green-300":"text-amber-700 border-amber-300"}`}>{t.status||"ACTIVE"}</span></div>
          <div className="flex gap-1 flex-wrap"><button className="text-xs px-2 py-1 rounded border" onClick={()=>setTEdit({id:t.id,name:t.name||"",contactName:t.contactName||"",contactEmail:t.contactEmail||"",contactPhone:t.contactPhone||"",maxComplexes:t.maxComplexes||1,status:t.status||"ACTIVE"})}>Editar</button>
          <button className="text-xs px-2 py-1 rounded border text-blue-700 border-blue-300 inline-flex items-center gap-1" onClick={()=>run(async()=>{if(!confirm("¿Reiniciar contraseña del admin del tenant? Se generará una contraseña temporal de un uso.")) return; const r=await apiFetch<any>(`/platform/tenants/${t.id}/reset-admin-password`,{method:"POST"}); return r?.notice || `Contraseña temporal: ${r?.temporaryPassword}`;})}><Icon.key className="w-3.5 h-3.5"/> Reiniciar contraseña</button>
          <button className={`text-xs px-2 py-1 rounded border ${t.status==="ACTIVE"?"text-amber-700 border-amber-300":"text-green-700 border-green-300"}`} onClick={()=>run(async()=>{await apiFetch('/platform/tenants/'+t.id,{method:'PATCH',body:JSON.stringify({status:t.status==="ACTIVE"?"INACTIVE":"ACTIVE"})}); await loadAll();}, t.status==="ACTIVE"?"Tenant desactivado (solo lectura).":"Tenant activado.")}>{t.status==="ACTIVE"?"Desactivar":"Activar"}</button></div></div>
          <div className="text-xs text-slate-500">{t.contactName} · {t.contactEmail}{t.contactPhone?(" · "+t.contactPhone):""} · Complejos: {t.complexes?.length||0}/{t.maxComplexes}</div>
<div className="flex flex-wrap gap-1 items-center text-xs mt-1"><span>Ver como:</span><select className="border rounded px-1 py-0.5 bg-transparent" defaultValue="" onChange={e=>{ (window as any).__viewRole = e.target.value; (window as any).__viewTenant = t.id; }}><option value="">—</option><option value="TENANT_ADMIN">Tenant admin</option><option value="COMPLEX_ADMIN">Admin de complejo</option><option value="SELLER">Vendedor</option></select>{ (t.complexes||[]).length>0 && <select className="border rounded px-1 py-0.5 bg-transparent" defaultValue="" onChange={e=>{ (window as any).__viewComplex = e.target.value; }}><option value="">Complejo</option>{(t.complexes||[]).map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}<button className="px-2 py-0.5 rounded border" onClick={()=>{ const role=(window as any).__viewRole; if(!role){ alert("Elige un rol"); return; } const cid = (role==="TENANT_ADMIN") ? null : ((window as any).__viewComplex || (t.complexes||[])[0]?.id); if(role!=="TENANT_ADMIN" && !cid){ alert("Elige un complejo"); return; } onImpersonate && onImpersonate({role, tenantId:t.id, complexId:cid}); }}>Ver</button></div>
        </li>)}</ul>}
      </div>
      {tEdit && <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch('/platform/tenants/'+tEdit.id,{method:'PATCH',body:JSON.stringify({name:tEdit.name,contactName:tEdit.contactName,contactEmail:tEdit.contactEmail,contactPhone:tEdit.contactPhone||null,maxComplexes:Number(tEdit.maxComplexes),status:tEdit.status})}); setTEdit(null); await loadAll();},"Tenant actualizado.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2"><h2 className="font-medium text-blue-700">Editar tenant</h2>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={tEdit.name} onChange={e=>setTEdit({...tEdit,name:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto nombre" value={tEdit.contactName} onChange={e=>setTEdit({...tEdit,contactName:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto email" value={tEdit.contactEmail} onChange={e=>setTEdit({...tEdit,contactEmail:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto teléfono" value={tEdit.contactPhone||""} onChange={e=>setTEdit({...tEdit,contactPhone:e.target.value})}/>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">Máx. complejos<input type="number" min={1} className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={tEdit.maxComplexes} onChange={e=>setTEdit({...tEdit,maxComplexes:Number(e.target.value)})}/></label><label className="text-sm">Estado<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={tEdit.status} onChange={e=>setTEdit({...tEdit,status:e.target.value})}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo (solo lectura)</option></select></label></div>
        <div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setTEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div>
      </form>}
    </div>}

    {tab==="complejos"&&<div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm">Complejos del tenant seleccionado: <b>{complexes.filter((c:any)=>c.tenantId===selTenant||c.tenant?.id===selTenant).length}</b> / <b>{tenants.find((t:any)=>t.id===selTenant)?.maxComplexes||"-"}</b></div>
      {canCreateComplex && <button onClick={()=>{ setCForm({name:"",slug:"",department:"Santa Cruz",timezone:"America/La_Paz",currency:"BOB",weeklySchedule:{0:{open:"08:00",close:"22:00",closed:false},1:{open:"08:00",close:"22:00",closed:false},2:{open:"08:00",close:"22:00",closed:false},3:{open:"08:00",close:"22:00",closed:false},4:{open:"08:00",close:"22:00",closed:false},5:{open:"08:00",close:"22:00",closed:false},6:{open:"08:00",close:"22:00",closed:false}},allowClientPayLater:false}); setCEdit(null); setComplexModalOpen(true); }} className="rounded-md bg-brand text-white px-4 py-2 text-sm mb-3">➕ Nuevo complejo</button>}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Complejos</h2><ul className="text-sm space-y-2">{complexes.map(c=> <li key={c.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{c.name}</b> <span className="text-slate-500">/{c.slug}</span><div className="text-xs text-slate-500">{c.tenant?.name} · {c.department || "Santa Cruz"} · {c.currency} · sin prepago: {c.allowClientPayLater?"sí":"no"}</div></div>{canCreateComplex && <div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setCEdit({...c})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar complejo?"))return; await apiFetch(`/complexes/${c.id}`,{method:"DELETE"}); await loadAll();},"Complejo eliminado.")}><Icon.trash className="w-4 h-4"/></IconBtn></div>}</li>)}{complexes.length===0&&<li className="text-slate-500">Sin complejos.</li>}</ul></div>
      {cEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/complexes/${cEdit.id}`,{method:"PATCH",body:JSON.stringify({name:cEdit.name,slug:cEdit.slug,department:cEdit.department,timezone:cEdit.timezone,currency:cEdit.currency,openTime:cEdit.openTime||null,closeTime:cEdit.closeTime||null,weekendOpenTime:cEdit.weekendOpenTime||null,weekendCloseTime:cEdit.weekendCloseTime||null,allowClientPayLater:!!cEdit.allowClientPayLater})}); setCEdit(null); await loadAll();},"Complejo actualizado.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar complejo</h2><input className="w-full border rounded px-2 py-2 bg-transparent" value={cEdit.name||""} onChange={e=>setCEdit({...cEdit,name:e.target.value})}/><input className="w-full border rounded px-2 py-2 bg-transparent" value={cEdit.slug||""} onChange={e=>setCEdit({...cEdit,slug:e.target.value})}/><select className="w-full border rounded px-2 py-2 bg-transparent" value={cEdit.department||"Santa Cruz"} onChange={e=>setCEdit({...cEdit,department:e.target.value})}>{DEPARTMENTS.map(d=> <option key={d} value={d}>{d}</option>)}</select><div className="grid grid-cols-2 gap-2"><input className="border rounded px-2 py-2 bg-transparent" value={cEdit.timezone||""} onChange={e=>setCEdit({...cEdit,timezone:e.target.value})}/><input className="border rounded px-2 py-2 bg-transparent" value={cEdit.currency||""} onChange={e=>setCEdit({...cEdit,currency:e.target.value})}/></div><div className="grid grid-cols-2 gap-2"><label className="text-sm">Horario entre semana desde<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={cEdit.openTime||""} onChange={e=>setCEdit({...cEdit,openTime:e.target.value})}/></label><label className="text-sm">Horario entre semana hasta<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={cEdit.closeTime||""} onChange={e=>setCEdit({...cEdit,closeTime:e.target.value})}/></label></div><div className="grid grid-cols-2 gap-2"><label className="text-sm">Horario fin de semana desde (opcional)<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={cEdit.weekendOpenTime||""} onChange={e=>setCEdit({...cEdit,weekendOpenTime:e.target.value})}/></label><label className="text-sm">Horario fin de semana hasta (opcional)<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={cEdit.weekendCloseTime||""} onChange={e=>setCEdit({...cEdit,weekendCloseTime:e.target.value})}/></label></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cEdit.allowClientPayLater} onChange={e=>setCEdit({...cEdit,allowClientPayLater:e.target.checked})}/> Permitir reservas sin prepago a clientes Habitual/VIP</label><div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setCEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}
    </div>}

    {tab==="escenarios"&&<div className="space-y-4">
      <div className="flex gap-2 items-center text-sm"><span>Complejo:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={selComplex} onChange={e=>setSelComplex(e.target.value)}>{complexes.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      {canCreateScenario && <button onClick={()=>{ setSForm({name:"",rentalFormat:"PER_HOUR",priceDay:80,priceNight:100,priceAdult:0,priceChild:0,childAge:10,basePrice:0,blockType:"DAY",openTime:"",closeTime:"",availableDays:[0,1,2,3,4,5,6]}); setSEdit(null); setScnModalOpen(true); }} className="rounded-md bg-brand text-white px-4 py-2 text-sm">➕ Crear escenario</button>}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Escenarios</h2><ul className="text-sm space-y-2">{scenarios.map(s=> <li key={s.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{s.name}</b><div className="text-xs text-slate-500">{s.rentalFormat} · {(s.openTime||s.complex?.openTime||"08:00")}-{(s.closeTime||s.complex?.closeTime||"22:00")} · días: {(Array.isArray(s.availableDays)?s.availableDays:[0,1,2,3,4,5,6]).join(",")}</div></div>{canCreateScenario && <div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setSEdit({...s, availableDays: Array.isArray(s.availableDays)?s.availableDays:[0,1,2,3,4,5,6], openTime: s.openTime||"", closeTime: s.closeTime||""})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar escenario?"))return; await apiFetch(`/scenarios/${s.id}`,{method:"DELETE"}); await loadScenarios(selComplex);},"Escenario eliminado.")}><Icon.trash className="w-4 h-4"/></IconBtn></div>}</li>)}{scenarios.length===0&&<li className="text-slate-500">Sin escenarios.</li>}</ul></div>
      {sEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/scenarios/${sEdit.id}`,{method:"PATCH",body:JSON.stringify({name:sEdit.name,openTime:sEdit.openTime||null,closeTime:sEdit.closeTime||null,availableDays:Array.isArray(sEdit.availableDays)?sEdit.availableDays:[0,1,2,3,4,5,6]})}); setSEdit(null); await loadScenarios(selComplex); await loadCalendar(resComplex,calDate);},"Escenario actualizado.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar escenario</h2><input className="w-full border rounded px-2 py-2 bg-transparent" value={sEdit.name||""} onChange={e=>setSEdit({...sEdit,name:e.target.value})}/><div className="grid grid-cols-2 gap-2"><label className="text-sm">Disponible desde<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sEdit.openTime||""} onChange={e=>setSEdit({...sEdit,openTime:e.target.value})}/></label><label className="text-sm">Disponible hasta<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sEdit.closeTime||""} onChange={e=>setSEdit({...sEdit,closeTime:e.target.value})}/></label></div><div className="text-sm"><div className="text-xs text-slate-600 dark:text-slate-300 mb-1">Días disponibles</div><div className="flex flex-wrap gap-2">{[["1","Lun"],["2","Mar"],["3","Mié"],["4","Jue"],["5","Vie"],["6","Sáb"],["0","Dom"]].map(([v,l])=>{ const n=Number(v); const on=(Array.isArray(sEdit.availableDays)?sEdit.availableDays:[0,1,2,3,4,5,6]).includes(n); return <label key={v} className={`px-2 py-1 rounded border text-xs cursor-pointer ${on?"bg-blue-50 border-blue-300 dark:bg-blue-950/30":""}`}><input type="checkbox" className="mr-1" checked={on} onChange={e=>{ const set=new Set<number>(Array.isArray(sEdit.availableDays)?sEdit.availableDays:[0,1,2,3,4,5,6]); if(e.target.checked) set.add(n); else set.delete(n); setSEdit({...sEdit,availableDays:Array.from(set)}); }} />{l}</label>; })}</div></div><p className="text-xs text-slate-500">Vacío usa el horario del complejo. El calendario mostrará cerrado/fuera de horario.</p><div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setSEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}

    </div>}

{tab==="mantenimiento"&&<div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
        <h2 className="font-medium">Mantenimientos de escenarios</h2>
        <p className="text-xs text-slate-500">Bloquea disponibilidad y, si tiene costo, registra egreso en reportes.</p>
        {canManageInventoryProducts && (<form onSubmit={e=>run(async()=>{e.preventDefault(); const cid=selComplex||resComplex; if(!cid) throw new Error("Selecciona complejo"); const startAt=new Date(mForm.date+'T'+mForm.start+':00').toISOString(); const endAt=new Date(mForm.date+'T'+mForm.end+':00').toISOString(); await apiFetch('/maintenances',{method:'POST',body:JSON.stringify({complexId:cid,scenarioId:mForm.scenarioId||null,type:mForm.type,startAt,endAt,reason:mForm.reason||null,cost:mForm.cost!==''?Number(mForm.cost):null,registerExpense:Boolean(mForm.registerExpense),repeatCount:mForm.repeatCount})}); setMForm((s:any)=>({...s,reason:'',cost:''})); await loadSalesData(cid); await loadCalendar(resComplex,calDate); },"Mantenimiento registrado.")} className="grid md:grid-cols-3 gap-2 text-sm">
          <select className="border rounded px-2 py-2 bg-transparent" value={mForm.scenarioId||""} onChange={e=>setMForm({...mForm,scenarioId:e.target.value})}><option value="">Todo el complejo</option>{scenarios.map((s:any)=> <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="border rounded px-2 py-2 bg-transparent" value={mForm.type} onChange={e=>setMForm({...mForm,type:e.target.value})}><option value="ONE_TIME">Único</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensual</option><option value="QUARTERLY">Trimestral</option><option value="SEMIANNUAL">Semestral</option><option value="ANNUAL">Anual</option></select>
          <input type="date" className="border rounded px-2 py-2 bg-transparent" value={mForm.date} onChange={e=>setMForm({...mForm,date:e.target.value})}/>{mForm.type!=="ONE_TIME" && <input type="number" min={1} max={60} className="border rounded px-2 py-2 bg-transparent" placeholder="Repeticiones" value={mForm.repeatCount||""} onChange={e=>setMForm({...mForm,repeatCount:e.target.value===""?undefined:Number(e.target.value)})}/>}
          <input type="time" className="border rounded px-2 py-2 bg-transparent" value={mForm.start} onChange={e=>setMForm({...mForm,start:e.target.value})}/>
          <input type="time" className="border rounded px-2 py-2 bg-transparent" value={mForm.end} onChange={e=>setMForm({...mForm,end:e.target.value})}/>
          <input type="number" step="0.01" className="border rounded px-2 py-2 bg-transparent" placeholder="Costo (opcional)" value={mForm.cost} onChange={e=>setMForm({...mForm,cost:e.target.value})}/>
          <input className="border rounded px-2 py-2 bg-transparent md:col-span-2" placeholder="Motivo" value={mForm.reason||""} onChange={e=>setMForm({...mForm,reason:e.target.value})}/>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(mForm.registerExpense)} onChange={e=>setMForm({...mForm,registerExpense:e.target.checked})}/> Registrar costo como egreso</label>
          {canManageInventoryProducts && <div className="md:col-span-3"><button className="rounded-md bg-brand text-white px-4 py-2">Registrar mantenimiento</button></div>}
        </form>)}
        {maintenances.length>0 && <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Inicio</th><th className="py-2 pr-2">Fin</th><th className="py-2 pr-2">Escenario</th><th className="py-2 pr-2">Motivo</th><th className="py-2 pr-2">Costo</th><th></th></tr></thead><tbody>{maintenances.map((m:any)=> <tr key={m.id} className="border-b"><td className="py-2 pr-2">{new Date(m.startAt).toLocaleString()}</td><td className="py-2 pr-2">{new Date(m.endAt).toLocaleString()}</td><td className="py-2 pr-2">{m.scenario?.name||"Complejo"}</td><td className="py-2 pr-2">{m.reason||"-"}</td><td className="py-2 pr-2">{m.cost!=null?Number(m.cost):"-"}</td><td className="py-2"><button className="text-xs text-red-700 underline" onClick={()=>run(async()=>{if(!confirm("Eliminar mantenimiento?"))return; await apiFetch('/maintenances/'+m.id,{method:'DELETE'}); await loadSalesData(selComplex||resComplex); await loadCalendar(resComplex,calDate);},"Mantenimiento eliminado.")}>Eliminar</button></td></tr>)}</tbody></table></div>}
      </div>
</div>}
    {tab==="reservas"&&<div className="space-y-4">
      <div className="flex items-center gap-2 text-sm"><span>Complejo: <b>{complexes.find((c:any)=>c.id===(resComplex||selComplex))?.name||"—"}</b></span><button onClick={()=>{const d=new Date(calDate); d.setDate(d.getDate()-7); setCalDate(d.toISOString().slice(0,10)); loadCalendar(resComplex||selComplex, d.toISOString().slice(0,10));}} className="rounded border px-2 py-1">◀</button><span className="text-xs text-slate-500">{calDate}</span><button onClick={()=>{const d=new Date(calDate); d.setDate(d.getDate()+7); setCalDate(d.toISOString().slice(0,10)); loadCalendar(resComplex||selComplex, d.toISOString().slice(0,10));}} className="rounded border px-2 py-1">▶</button></div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">Calendario de disponibilidad y reservas (staff)</h2><span className="text-xs text-slate-500">Colores por escenario · marca/desmarca para ocultar/mostrar</span></div>
        {!resComplex ? <p className="text-sm text-slate-500">Selecciona un complejo para ver el calendario de todos sus escenarios.</p> : (
          calScenarios.length===0 ? <p className="text-sm text-slate-500">Este complejo no tiene escenarios.</p> :
          <AvailabilityCalendar date={calDate} scenarios={calScenarios} blocksByScenario={calBlocks} visibleIds={visibleScenarios} onToggle={(id)=>setVisibleScenarios((v:any)=>({...v,[id]:!v[id]}))} weekView onPickSlotWeek={(sid:any,d:any,st:any,en:any)=>{ const cid=resComplex||selComplex||complexes[0]?.id||""; setResModalForm({complexId:cid,scenarioId:sid,date:d,start:st,end:en,clientName:"",clientEmail:"",clientPhone:"",people:1,note:"",showCalendar:false,newClient:false,hours:1,initialStatus:"PENDING_CONFIRMATION",membershipId:null}); const t2=complexes.find((c:any)=>c.id===cid)?.tenantId || tenants[0]?.id; if(t2){ apiFetch<any>(`/users/memberships?tenantId=${t2}&role=CLIENT`).then(r=>setClientOptions(r.data||[])).catch(()=>setClientOptions([])); } if(cid){ loadScenarios(cid); loadCalendar(cid,d); } setResModalOpen(true); }} onShowSlotReservations={(blocks:any[])=>{ setSlotResData(blocks); setSlotResModal(true); }} allowCreate={canManageOps} />
        )}
      </div>

      {resEdit && <form onSubmit={e=>run(async()=>{e.preventDefault(); await apiFetch(`/reservations/${resEdit.id}`,{method:"PATCH",body:JSON.stringify({scenarioId:resEdit.scenarioId,startAt:new Date(resEdit.startLocal).toISOString(),endAt:new Date(resEdit.endLocal).toISOString(),clientName:resEdit.clientName||null,note:resEdit.note||null})}); setResEdit(null); await loadReservations(); await loadCalendar(resComplex,calDate);} ,"Reserva actualizada.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-2xl">
        <h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar reserva {resEdit.code}</h2>
        <div className="grid md:grid-cols-2 gap-2">
          <select className="border rounded px-2 py-2 bg-transparent" value={resEdit.scenarioId} onChange={e=>setResEdit({...resEdit,scenarioId:e.target.value})}>{calScenarios.map((s:any)=> <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input className="border rounded px-2 py-2 bg-transparent" placeholder="Cliente" value={resEdit.clientName||""} onChange={e=>setResEdit({...resEdit,clientName:e.target.value})}/>
          <label className="text-sm">Inicio<input type="datetime-local" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={resEdit.startLocal} onChange={e=>setResEdit({...resEdit,startLocal:e.target.value})}/></label>
          <label className="text-sm">Fin<input type="datetime-local" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={resEdit.endLocal} onChange={e=>setResEdit({...resEdit,endLocal:e.target.value})}/></label>
        </div>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nota (opcional)" value={resEdit.note||""} onChange={e=>setResEdit({...resEdit,note:e.target.value})}/>
        <div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar cambios</button><button type="button" onClick={()=>setResEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div>
        <p className="text-xs text-slate-500">Al guardar se valida disponibilidad y se recalcula el total según la tarifa del escenario.</p>
      </form>}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="font-medium mb-2">Reservas</h2>
        {reservations.length===0 ? <p className="text-sm text-slate-500">Sin reservas o sin permisos.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Código/Serie</th><th className="py-2 pr-2">Escenario</th><th className="py-2 pr-2">Cliente</th><th className="py-2 pr-2">Horario</th><th className="py-2 pr-2">Estado</th><th className="py-2 pr-2">Total</th><th className="py-2">Acciones</th></tr></thead><tbody>
          {reservations.map(r=>{ const phone=r.membership?.user?.phone; const wa=phone?`https://wa.me/${String(phone).replace(/[^\d]/g,"")}`:null; const start=new Date(r.startAt).toLocaleString(); const end=new Date(r.endAt).toLocaleTimeString(); const isSeries = !!r.reservationSeriesId; const canEdit=["PENDING_PAYMENT","PENDING_CONFIRMATION","CONFIRMED"].includes(r.status) && !isSeries; const seriesCode = r.series?.code || r.seriesId || (isSeries?"serie":""); const debt = r.series?.debtCount ?? 0; const isCurrentSeries = !!r.isSeriesCurrent; const canPaySeriesNow = isSeries && isCurrentSeries && ["PENDING_PAYMENT","PENDING_CONFIRMATION"].includes(r.status) && !r.seriesPaidAt; return (
            <tr key={r.id} className="border-b align-top">
              <td className="py-2 pr-2"><div className="font-mono font-medium">{r.code}</div>{seriesCode && <div className="text-xs text-slate-500">Serie: {seriesCode}{isSeries && isCurrentSeries ? " · actual" : isSeries ? " · programada" : ""}</div>}{isSeries && <div className="text-xs mt-0.5">{debt>0 ? <span className="text-amber-700">Adeudos: {debt}</span> : <span className="text-emerald-700">Al día</span>}{r.series?.status ? ` · ${r.series.status}` : ""}</div>}</td>
              <td className="py-2 pr-2"><div>{r.scenario?.name||"-"}</div><div className="text-xs text-slate-500">{r.scenario?.complex?.name||""}</div></td>
              <td className="py-2 pr-2"><div>{r.membership?.user?.name||r.clientName||"-"}</div><div className="text-xs text-slate-500">{r.membership?.user?.email||""}{phone?` · ${phone}`:""}</div>{wa && <a className="text-xs text-green-700 underline" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}</td>
              <td className="py-2 pr-2"><div>{start}</div><div className="text-xs text-slate-500">hasta {end}</div></td>
              <td className="py-2 pr-2"><span className="inline-block px-2 py-0.5 rounded border text-xs">{STATUS_ES[r.status]||r.status}</span>{r.isVip && <span className="ml-1 text-xs text-amber-700">sin prepago</span>}{isSeries && r.seriesPaidAt && <span className="ml-1 text-xs text-emerald-700">pagada</span>}{isSeries && isCurrentSeries && r.seriesDueAt && !r.seriesPaidAt && <div className="text-xs text-slate-500">Vence: {new Date(r.seriesDueAt).toLocaleString()}</div>}</td>
              <td className="py-2 pr-2">{String(r.totalAmount)}</td>
              <td className="py-2"><div className="flex flex-wrap gap-1">
                {canEdit && <button className="px-2 py-1 rounded border text-blue-700 border-blue-300 text-xs inline-flex items-center gap-1" onClick={()=>{ setCalDate(new Date(r.startAt).toISOString().slice(0,10)); setResEdit({ id:r.id, code:r.code, scenarioId:r.scenarioId || r.scenario?.id, clientName:r.clientName||r.membership?.user?.name||"", note:r.note||"", startLocal: toLocalInput(r.startAt), endLocal: toLocalInput(r.endAt) }); }}><Icon.edit className="w-3.5 h-3.5"/> Editar</button>}
                {((!isSeries && (r.status==="PENDING_PAYMENT"||r.status==="PENDING_CONFIRMATION")) || canPaySeriesNow) && <button className="px-2 py-1 rounded border text-blue-700 border-blue-300 text-xs" onClick={()=>run(async()=>{await apiFetch(`/reservations/${r.id}/confirm-payment`,{method:"POST",body:JSON.stringify({method:"CASH"})}); await loadReservations(); await loadCalendar();}, isSeries?"Pago de semana confirmado (se habilita la siguiente).":"Pago confirmado.")}>Confirmar pago</button>}
                {(!isSeries && (r.status==="PENDING_PAYMENT"||r.status==="PENDING_CONFIRMATION")) && <button className="px-2 py-1 rounded border text-red-700 border-red-300 text-xs" onClick={()=>run(async()=>{if(!confirm("¿Rechazar pago y liberar reserva?"))return; await apiFetch(`/reservations/${r.id}/reject-payment`,{method:"POST"}); await loadReservations(); await loadCalendar();},"Pago rechazado.")}>Rechazar</button>}
                {isSeries && isCurrentSeries && !r.seriesPaidAt && ["PENDING_PAYMENT","PENDING_CONFIRMATION"].includes(r.status) && <button className="px-2 py-1 rounded border text-xs text-amber-700 border-amber-300" onClick={()=>run(async()=>{if(!confirm("Marcar esta ocurrencia como no pagada/no asistida. Genera 2 adeudos y habilita la siguiente con deuda."))return; await apiFetch(`/reservations/${r.id}/mark-unpaid`,{method:"POST"}); await loadReservations(); await loadCalendar();},"Marcada como impaga (2 adeudos).")}>Marcar impago</button>}
                {isSeries && r.reservationSeriesId && debt>0 && <button className="px-2 py-1 rounded border text-xs text-emerald-700 border-emerald-300" onClick={()=>run(async()=>{await apiFetch(`/reservations/series/${r.reservationSeriesId}/pay-debt`,{method:"POST",body:JSON.stringify({method:"CASH"})}); await loadReservations(); await loadCalendar();},"Adeudo pagado.")}>Pagar adeudo ({debt})</button>}
                {!isSeries && ["PENDING_PAYMENT","PENDING_CONFIRMATION","CONFIRMED"].includes(r.status) && <button className="px-2 py-1 rounded border text-xs" onClick={()=>run(async()=>{if(!confirm("¿Cancelar esta reserva?"))return; await apiFetch(`/reservations/${r.id}/cancel`,{method:"POST"}); await loadReservations(); await loadCalendar();},"Reserva cancelada.")}>Cancelar</button>}
                {isSeries && r.reservationSeriesId && r.series?.status !== "CANCELLED" && <button className="px-2 py-1 rounded border text-xs text-red-700 border-red-300" onClick={()=>run(async()=>{if(!confirm("¿Cancelar toda la serie y liberar horarios futuros?"))return; await apiFetch(`/reservations/series/${r.reservationSeriesId}/cancel`,{method:"POST"}); await loadReservations(); await loadCalendar();},"Serie cancelada.")}>Cancelar serie</button>}
                {!isSeries && ["PENDING_PAYMENT","PENDING_CONFIRMATION","CONFIRMED"].includes(r.status) && <button className="px-2 py-1 rounded border text-xs text-amber-700 border-amber-300" onClick={()=>run(async()=>{const cancelSeries = r.seriesId ? confirm("Marcar falta. ¿Cancelar también las reservas futuras de la serie? (Aceptar = sí, Cancelar = solo esta)") : false; await apiFetch(`/reservations/${r.id}/no-show`,{method:"POST",body:JSON.stringify({cancelSeries})}); await loadReservations(); await loadCalendar();},"Falta marcada.")}>Marcar falta</button>}
              </div></td>
            </tr>
          );})}
        </tbody></table></div>}
        <p className="text-xs text-slate-500 mt-2">Reservas fijas (series): solo la ocurrencia actual es visible/pagable. “Confirmar pago” habilita la siguiente; “Marcar impago” o cierre de semana sin pago genera 2 adeudos (pagar 1 adeudo mantiene la serie, pero debe regularizarse antes de que termine la siguiente semana o se cancela y se libera el horario). Cancelar serie libera futuros. Editar aplica solo a reservas normales.</p>
      </div>
    </div>}

    {tab==="usuarios"&&<div className="space-y-4">
      <div className="flex gap-2 items-center text-sm"><span>Tenant:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={selTenant} onChange={e=>setSelTenant(e.target.value)}>{tenants.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <form onSubmit={e=>run(async()=>{e.preventDefault(); if((uForm.role==="COMPLEX_ADMIN"||uForm.role==="SELLER") && (!uForm.complexIds||uForm.complexIds.length===0)) throw new Error("Selecciona al menos un complejo para este rol"); await apiFetch("/users/memberships",{method:"POST",body:JSON.stringify({...uForm,tenantId:selTenant,phone:uForm.phone||undefined,complexIds:(uForm.role==="COMPLEX_ADMIN"||uForm.role==="SELLER")?uForm.complexIds:[],clientTier:uForm.role==="CLIENT"?uForm.clientTier:"NORMAL"})}); setUForm({email:"",name:"",phone:"",role:"SELLER",clientTier:"NORMAL",complexIds:[]}); await loadMembers(selTenant);},"Usuario/membresía guardada.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Agregar usuario/membresía</h2>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Email" value={uForm.email} onChange={e=>setUForm({...uForm,email:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={uForm.name} onChange={e=>setUForm({...uForm,name:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="WhatsApp / teléfono (ej. +591...)" value={uForm.phone||""} onChange={e=>setUForm({...uForm,phone:e.target.value})}/>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={uForm.role} onChange={e=>setUForm({...uForm,role:e.target.value, complexIds:[], clientTier:"NORMAL"})}>
          {(isPlatform || roleCtx.isTenantAdmin) && <option value="TENANT_ADMIN">Admin tenant</option>}
          {(isPlatform || roleCtx.isTenantAdmin) && <option value="COMPLEX_ADMIN">Admin complejo</option>}
          {(isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin) && <option value="SELLER">Vendedor</option>}
          <option value="CLIENT">Cliente</option></select>
        {(uForm.role==="COMPLEX_ADMIN"||uForm.role==="SELLER") && <div className="border rounded p-2 space-y-1">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Complejos asignados (requerido)</div>
          {tenantComplexes.length===0 ? <div className="text-xs text-amber-600">No hay complejos en este tenant. Crea un complejo primero.</div> : tenantComplexes.map((c:any)=> (
            <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(uForm.complexIds||[]).includes(c.id)} onChange={e=>{ const ids=new Set(uForm.complexIds||[]); if(e.target.checked) ids.add(c.id); else ids.delete(c.id); setUForm({...uForm,complexIds:Array.from(ids)}); }} /> {c.name} <span className="text-slate-500">/{c.slug}</span></label>
          ))}
          <p className="text-xs text-slate-500">Admins/vendedores reciben notificaciones in-app; WhatsApp se gestiona externamente con el teléfono registrado.</p>
        </div>}
        {uForm.role==="CLIENT" && <div><label className="text-xs text-slate-600">Tipo de cliente</label><select className="w-full border rounded px-2 py-2 bg-transparent" value={uForm.clientTier} onChange={e=>setUForm({...uForm,clientTier:e.target.value})}><option value="NORMAL">Normal</option><option value="HABITUAL">Habitual</option><option value="PREFERENCIAL">Preferencial (VIP, sin prepago si el complejo lo permite)</option></select></div>}
        <button className="rounded-md bg-brand text-white px-4 py-2" disabled={!selTenant}>Guardar</button>
        <p className="text-xs text-slate-500">El usuario establecerá su contraseña en el primer inicio de sesión.</p>
      </form>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Usuarios del tenant</h2><ul className="text-sm space-y-2">{members.map(m=> <li key={m.id} className="border-b pb-2 flex justify-between gap-2"><div><b>{m.user?.name||m.user?.email}</b> <span className="text-slate-500">({m.user?.email})</span>{m.user?.phone && <span className="text-slate-500"> · {m.user.phone}</span>}<div className="text-xs text-slate-500">{m.role}{m.role==="CLIENT"?` · ${m.clientTier}`:""}{(m.complexIds||[]).length?` · complejos: ${m.complexIds.length}`:""} · contraseña: {m.user?.hasPassword?"sí":"pendiente"}</div></div>{(roleCtx.isTenantAdmin || isPlatform || !(m.role==="TENANT_ADMIN"||m.role==="COMPLEX_ADMIN")) && <div className="flex gap-1"><IconBtn color="blue" title="Editar" onClick={()=>setUEdit({...m, phone: m.user?.phone || "", complexIds: m.complexIds || []})}><Icon.edit className="w-4 h-4"/></IconBtn><IconBtn color="red" title="Eliminar" onClick={()=>run(async()=>{if(!confirm("¿Eliminar membresía?"))return; await apiFetch(`/users/memberships/${m.id}`,{method:"DELETE"}); await loadMembers(selTenant);},"Membresía eliminada.")}><Icon.trash className="w-4 h-4"/></IconBtn></div>}</li>)}{members.length===0&&<li className="text-slate-500">Sin usuarios o sin permisos.</li>}</ul></div>
      {uEdit&&<form onSubmit={e=>run(async()=>{e.preventDefault(); if((uEdit.role==="COMPLEX_ADMIN"||uEdit.role==="SELLER") && (!uEdit.complexIds||uEdit.complexIds.length===0)) throw new Error("Selecciona al menos un complejo para este rol"); await apiFetch(`/users/memberships/${uEdit.id}`,{method:"PATCH",body:JSON.stringify({role:uEdit.role,clientTier:uEdit.role==="CLIENT"?uEdit.clientTier:"NORMAL",complexIds:(uEdit.role==="COMPLEX_ADMIN"||uEdit.role==="SELLER")?(uEdit.complexIds||[]):[],phone:uEdit.phone||null})}); setUEdit(null); await loadMembers(selTenant);},"Membresía actualizada.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl"><h2 className="font-medium text-blue-700 inline-flex items-center gap-2"><Icon.edit className="w-4 h-4"/> Editar membresía</h2><div className="text-sm">{uEdit.user?.email}</div><input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="WhatsApp / teléfono" value={uEdit.phone||""} onChange={e=>setUEdit({...uEdit,phone:e.target.value})}/>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={uEdit.role} onChange={e=>setUEdit({...uEdit,role:e.target.value, complexIds: (e.target.value===uEdit.role)?(uEdit.complexIds||[]):[], clientTier:"NORMAL"})}>
          {(isPlatform || roleCtx.isTenantAdmin) && <option value="TENANT_ADMIN">Admin tenant</option>}
          {(isPlatform || roleCtx.isTenantAdmin) && <option value="COMPLEX_ADMIN">Admin complejo</option>}
          {(isPlatform || roleCtx.isTenantAdmin || roleCtx.isComplexAdmin) && <option value="SELLER">Vendedor</option>}
          <option value="CLIENT">Cliente</option></select>
        {(uEdit.role==="COMPLEX_ADMIN"||uEdit.role==="SELLER") && <div className="border rounded p-2 space-y-1"><div className="text-xs font-medium">Complejos asignados (requerido)</div>{tenantComplexes.length===0 ? <div className="text-xs text-amber-600">No hay complejos en este tenant.</div> : tenantComplexes.map((c:any)=> (<label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(uEdit.complexIds||[]).includes(c.id)} onChange={e=>{ const ids=new Set(uEdit.complexIds||[]); if(e.target.checked) ids.add(c.id); else ids.delete(c.id); setUEdit({...uEdit,complexIds:Array.from(ids)}); }} /> {c.name}</label>))}</div>}
        {uEdit.role==="CLIENT" && <select className="w-full border rounded px-2 py-2 bg-transparent" value={uEdit.clientTier||"NORMAL"} onChange={e=>setUEdit({...uEdit,clientTier:e.target.value})}><option value="NORMAL">Normal</option><option value="HABITUAL">Habitual</option><option value="PREFERENCIAL">Preferencial</option></select>}
        <div className="flex gap-2"><button className="rounded-md bg-blue-600 text-white px-4 py-2">Guardar</button><button type="button" onClick={()=>setUEdit(null)} className="rounded-md border px-4 py-2">Cancelar</button></div></form>}
    </div>}
    {tab==="productos"&&<div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="font-medium">Productos</h2>{canManageInventoryProducts && <button onClick={()=>{ setPForm({name:"",categoryId:"",newCategory:"",newSupplier:"",supplierId:"",notes:"",imageKey:"",imageName:"",presentations:[{name:"Unidad",unitsPerPack:1,cost:0,price:0}]}); setPEdit(null); setProdModalOpen(true); }} className="rounded-md bg-brand text-white px-4 py-2 text-sm">➕ Nuevo producto</button>}</div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">{products.map((p:any)=> (
        <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2">
          <div className="flex items-center gap-2">{p.imageUrl?<img src={p.imageUrl} alt={p.name} className="w-12 h-12 rounded object-cover"/>:<div className="w-12 h-12 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl">📦</div>}<div className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.category?.name||"Sin categoría"} · {p.presentations?.length||0} pres.</div></div></div>
          <div className="flex gap-1 justify-end">
            {canManageInventoryProducts && <button onClick={()=>{ setPEdit(p); setPForm({name:p.name||"",categoryId:p.categoryId||"",newCategory:"",newSupplier:"",supplierId:p.supplierId||"",notes:p.notes||"",imageKey:p.imageKey||"",imageName:"",presentations:p.presentations?.length?p.presentations.map((pr:any)=>({id:pr.id,name:pr.name,unitsPerPack:pr.unitsPerPack,cost:Number(pr.cost||0),price:Number(pr.price||0)})):[{name:"Unidad",unitsPerPack:1,cost:0,price:0}]}); setProdModalOpen(true); }} className="px-2 py-1 rounded border text-sm" title="Editar">✏️</button>}
            <button onClick={()=>{ setStockForm({productId:p.id,presentationId:(p.presentations||[])[0]?.id||"",warehouseId:warehouses[0]?.id||"",qty:1,unitCost:Number((p.presentations||[])[0]?.cost||0)}); setStockModalOpen(true); }} className="px-2 py-1 rounded border text-sm" title="Aumentar stock">➕</button>
            {canManageInventoryProducts && <button onClick={async()=>{ if(!confirm("¿Eliminar producto?")) return; try{ await apiFetch(`/inventory/products/${p.id}`,{method:"DELETE"}); await loadSalesData(resComplex||selComplex); }catch(e:any){ alert(e.message||"Error"); } }} className="px-2 py-1 rounded border text-sm text-red-600" title="Eliminar">🗑️</button>}
          </div>
        </div>
      ))}</div>
    </div>}
    {tab==="inventario"&&<div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center text-sm"><span>Complejo:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={resComplex||selComplex} onChange={e=>{setResComplex(e.target.value); setSelComplex(e.target.value); loadSalesData(e.target.value);}}><option value="">Selecciona</option>{complexes.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
        <h2 className="font-medium">Almacenes y ubicaciones</h2>
        {canManageInventoryProducts && <div className="flex flex-wrap gap-2"><button onClick={()=>setWhModalOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 text-sm">➕ Crear almacén</button><button onClick={()=>setImportModalOpen(true)} className="rounded-md border px-4 py-2 text-sm">📥 Importar inventario</button><button onClick={()=>setBajaModalOpen(true)} className="rounded-md border border-red-300 text-red-700 px-4 py-2 text-sm">🗑️ Salida / baja</button></div>}
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="font-medium mb-2">Stock por presentación y ubicación</h2>
        {stock.length===0 ? <p className="text-sm text-slate-500">Sin stock.</p> : <div className="space-y-2">{stock.map((s:any)=> (
          <div key={s.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm">
            <div className="flex-1"><div className="font-medium">{s.presentation?.product?.name||"—"} · {s.presentation?.name||"—"}</div><div className="text-xs text-slate-500">{s.warehouse?.name||"—"}:{s.location?.name||"—"}</div></div>
            <div className="flex items-center gap-1"><button disabled className="px-2 py-1 rounded border opacity-40 cursor-not-allowed">-</button><span className="w-10 text-center font-semibold">{s.qty}</span><button onClick={()=>{ setStockForm({productId:s.presentation?.product?.id||"",presentationId:s.presentation?.id||"",warehouseId:s.warehouseId,qty:1,unitCost:Number(s.presentation?.cost||0)}); setStockModalOpen(true); }} className="px-2 py-1 rounded border bg-emerald-500 text-white">+</button></div>
            <button onClick={()=>{ setBajaForm({presentationId:s.presentation?.id||"",qty:1,reason:"Vencimiento"}); setBajaModalOpen(true); }} className="text-xs text-red-600 underline">Baja</button>
          </div>
        ))}</div>}
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center justify-between mb-2"><h2 className="font-medium">Movimientos recientes</h2>{canManageInventoryProducts && <button onClick={()=>setMovModalOpen(true)} className="rounded-md border px-3 py-1.5 text-sm">🔄 Hacer movimiento</button>}</div>
        {movements.length===0 ? <p className="text-sm text-slate-500">Sin movimientos.</p> : <div className="overflow-auto max-h-64"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Tipo</th><th className="py-2 pr-2">Producto</th><th className="py-2 pr-2">Cant.</th><th className="py-2 pr-2">Usuario</th></tr></thead><tbody>{movements.slice(0,20).map((m:any)=> <tr key={m.id} className="border-b"><td className="py-2 pr-2 text-xs">{new Date(m.createdAt).toLocaleString()}</td><td className="py-2 pr-2">{m.type}</td><td className="py-2 pr-2 text-xs">{m.presentation?.product?.name||m.product?.name||"—"}</td><td className="py-2 pr-2">{m.qty}</td><td className="py-2 pr-2 text-xs">{m.user?.name||m.createdBy||"—"}</td></tr>)}</tbody></table></div>}
      </div>
    </div>}
    {tab==="ventas"&&<div className="space-y-4">{pendingResPayment && <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex items-center justify-between gap-2 flex-wrap"><span>💳 Reserva pendiente de pago: <b>{pendingResPayment.scenario?.name||"Reserva"}</b> · {Number(pendingResPayment.totalAmount||0)}</span><button onClick={async()=>{ try{ await apiFetch(`/reservations/${pendingResPayment.id}/confirm-payment`,{method:"POST",body:JSON.stringify({})}); setPendingResPayment(null); await loadReservations(resComplex,resStatus); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-3 py-1.5 text-sm">Cobrar</button><button onClick={()=>setPendingResPayment(null)} className="text-xs underline">Descartar</button></div>}
<div className="flex flex-wrap gap-2 items-center text-sm"><span>Complejo:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={resComplex||selComplex} onChange={e=>{setResComplex(e.target.value); setSelComplex(e.target.value); loadSalesData(e.target.value);}}><option value="">Selecciona</option>{complexes.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="rounded border px-3 py-1.5" onClick={()=>loadSalesData(resComplex||selComplex)}>Actualizar</button><Link to={"/menu/"+(complexes.find(c=>c.id===(resComplex||selComplex))?.slug||"central")} target="_blank" className="text-blue-600 underline">Ver menu digital + QR</Link></div><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">{products.map((p:any)=>{ const pres=(p.presentations||[])[0]; const inCart=cart.find((c:any)=>c.productId===p.id && c.presentationId===(pres?.id||null)); const qty=inCart?inCart.qty:0; return (<div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex flex-col items-center gap-1 relative"><div className="w-full aspect-square rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">{p.imageUrl?<img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover"/>:<span className="text-4xl">🍽️</span>}</div><div className="font-medium text-sm text-center">{p.name}</div><div className="text-green-600 dark:text-green-400 font-bold">{money(pres?.price??p.price, (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency||"BOB"))}</div><div className="flex items-center gap-2 mt-1"><button onClick={()=>decCart(p.id,pres?.id||null)} className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center">-</button><span className="w-6 text-center font-semibold">{qty}</span><button onClick={()=>addToCart(p,pres)} className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center">+</button></div>{qty>0 && <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">{qty}</span>}</div>); })}</div>{cart.length>0 && <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2"><div className="font-medium">🛒 Carrito ({cart.reduce((a:number,c:any)=>a+c.qty,0)} items) - Total: {money(cartTotal, (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency||"BOB"))}</div><ul className="text-sm space-y-1">{cart.map((c:any,i:number)=><li key={i} className="flex justify-between border-b pb-1"><span>{c.qty} x {c.name} {c.presName!=="Unidad"?"("+c.presName+")":""}</span><span>{money(c.price*c.qty, (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency||"BOB"))}</span></li>)}</ul><div className="flex gap-2"><button onClick={()=>setSaleModalOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 flex-1">✅ Confirmar venta</button><button onClick={()=>{ const cid=resComplex||selComplex||complexes[0]?.id||""; const t=complexes.find((c:any)=>c.id===cid)?.tenantId || tenants[0]?.id; setResModalForm({complexId:cid,scenarioId:"",date:calDate,start:"10:00",end:"11:00",clientName:"",clientEmail:"",clientPhone:"",people:1,note:"",showCalendar:true,newClient:false,hours:1,initialStatus:"PENDING_CONFIRMATION",membershipId:null}); if(cid){ loadScenarios(cid); loadCalendar(cid, calDate); } if(t){ apiFetch<any>(`/users/memberships?tenantId=${t}&role=CLIENT`).then(r=>setClientOptions(r.data||[])).catch(()=>setClientOptions([])); } setResModalOpen(true); }} className="rounded-md border px-4 py-2 flex-1">📅 Agregar reserva</button></div></div>}{orders.length>0 && <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Historial de ventas</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Estado</th><th className="py-2 pr-2">Total</th><th className="py-2 pr-2">Detalle</th></tr></thead><tbody>{orders.map((o:any)=> <tr key={o.id} className="border-b align-top"><td className="py-2 pr-2">{new Date(o.createdAt).toLocaleString()}</td><td className="py-2 pr-2">{o.status}</td><td className="py-2 pr-2">{Number(o.total)}</td><td className="py-2 pr-2 text-xs">{(o.lines||[]).map((l:any)=> <div key={l.id}>{l.qty} x {l.product?.name||"?"}{l.presentation?(" ("+l.presentation.name+")"):""} @ {Number(l.unitPrice)}</div>)}</td></tr>)}</tbody></table></div></div>} </div>}
    {tab==="reportes"&&<div className="space-y-4"><div className="flex flex-wrap gap-2 items-center text-sm"><span>Complejo:</span><select className="border rounded px-2 py-1.5 bg-transparent" value={repQuery.complexId||resComplex||selComplex||""} onChange={e=>setRepQuery({...repQuery,complexId:e.target.value})}><option value="">Todos</option>{complexes.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</select><input type="date" className="border rounded px-2 py-1.5 bg-transparent" value={repQuery.from||""} onChange={e=>setRepQuery({...repQuery,from:e.target.value})}/><input type="date" className="border rounded px-2 py-1.5 bg-transparent" value={repQuery.to||""} onChange={e=>setRepQuery({...repQuery,to:e.target.value})}/><select className="border rounded px-2 py-1.5 bg-transparent" value={repQuery.groupBy||"day"} onChange={e=>setRepQuery({...repQuery,groupBy:e.target.value})}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mes</option><option value="year">Anio</option></select><button className="rounded border px-3 py-1.5" onClick={()=>loadReports()}>Actualizar</button></div><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[["Ingresos",repTotals?.income??summary?.data?.income??0],["Egresos",repTotals?.expense??summary?.data?.expense??0],["Neto",(repTotals?.net ?? (Number(summary?.data?.income||0)-Number(summary?.data?.expense||0)))]].map(([l,v])=> <div key={String(l)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold mt-1">{money(v)}</div></div>)}</div><div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Ingresos vs egresos (reservas/alquileres, ventas, compras, mantenimientos/bajas)</h2>{repSeries.length===0 ? <p className="text-sm text-slate-500">Sin datos.</p> : <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Periodo</th><th className="py-2 pr-2">Ingresos</th><th className="py-2 pr-2">Egresos</th><th className="py-2 pr-2">Neto</th></tr></thead><tbody>{repSeries.map((r:any)=> <tr key={r.period} className="border-b"><td className="py-2 pr-2">{r.period}</td><td className="py-2 pr-2">{Number(r.income).toFixed(2)}</td><td className="py-2 pr-2">{Number(r.expense).toFixed(2)}</td><td className="py-2 pr-2 font-medium">{Number(r.net).toFixed(2)}</td></tr>)}</tbody></table></div>}</div><div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-2">Detalle por origen</h2>{repBySource.length===0 ? <p className="text-sm text-slate-500">Sin detalle.</p> : <ul className="text-sm space-y-1">{repBySource.map((r:any,i:number)=> <li key={i} className="flex justify-between border-b pb-1"><span>{r.source} · {r.type}</span><span>{Number(r.amount).toFixed(2)}</span></li>)}</ul>}</div></div>}
    {tab==="historial"&&<div className="space-y-4">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="font-medium mb-2">📜 Historial de ingresos</h2>
        <p className="text-sm text-slate-500 mb-3">Ventas y reservas registradas. Toca 👁️ para ver el recibo, 🛑 para anular.</p>
        {orders.length===0 && reservations.length===0 ? <p className="text-sm text-slate-500">Sin ingresos registrados.</p> : <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Cliente</th><th className="py-2 pr-2">Tipo</th><th className="py-2 pr-2">Monto</th><th className="py-2 pr-2">Acciones</th></tr></thead><tbody>
          {orders.map((o:any)=> <tr key={"o-"+o.id} className="border-b"><td className="py-2 pr-2 text-xs">{new Date(o.createdAt).toLocaleString()}</td><td className="py-2 pr-2">{o.clientName||o.membership?.user?.name||"—"}</td><td className="py-2 pr-2">Venta</td><td className="py-2 pr-2">{Number(o.total)}</td><td className="py-2 pr-2"><button onClick={()=>{ setReceiptData({type:"order",data:o}); setReceiptOpen(true); }} className="text-lg mr-1" title="Ver recibo">👁️</button><button onClick={async()=>{ if(!confirm("¿Anular esta venta?")) return; try{ const cid=resComplex||selComplex; await apiFetch(`/sales/orders/${o.id}/cancel`,{method:"POST"}); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="text-lg text-red-600" title="Anular">🛑</button></td></tr>)}
          {reservations.filter((r:any)=>r.status!=="CANCELLED").map((r:any)=> <tr key={"r-"+r.id} className="border-b"><td className="py-2 pr-2 text-xs">{new Date(r.startAt).toLocaleString()}</td><td className="py-2 pr-2">{r.clientName||r.membership?.user?.name||"—"}</td><td className="py-2 pr-2">Reserva</td><td className="py-2 pr-2">{Number(r.totalAmount||0)}</td><td className="py-2 pr-2"><button onClick={()=>{ setReceiptData({type:"reservation",data:r}); setReceiptOpen(true); }} className="text-lg mr-1" title="Ver recibo">👁️</button><button onClick={async()=>{ if(!confirm("¿Anular esta reserva?")) return; try{ await apiFetch(`/reservations/${r.id}/cancel`,{method:"POST",body:JSON.stringify({})}); await loadReservations(resComplex,resStatus); await loadCalendar(resComplex,calDate); }catch(e:any){ alert(e.message||"Error"); } }} className="text-lg text-red-600" title="Anular">🛑</button></td></tr>)}
        </tbody></table></div>}
      </div>
    </div>}
    {saleModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Confirmar venta</h2><button onClick={()=>setSaleModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      {saleErr && <p className="text-sm text-red-600">{saleErr}</p>}{saleMsg && <p className="text-sm text-green-700 dark:text-green-400">{saleMsg}</p>}
      <div className="text-sm">Total: <b>{money(cartTotal, (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency||"BOB"))}</b></div>
      <div className="flex gap-2 text-sm"><button onClick={()=>setSalePaymentMethod("CASH")} className={`px-3 py-1.5 rounded border ${salePaymentMethod==="CASH"?"bg-brand text-white border-brand":""}`}>Efectivo</button><button onClick={()=>setSalePaymentMethod("QR")} className={`px-3 py-1.5 rounded border ${salePaymentMethod==="QR"?"bg-brand text-white border-brand":""}`}>QR</button><button onClick={()=>setSalePaymentMethod("MIXED")} className={`px-3 py-1.5 rounded border ${salePaymentMethod==="MIXED"?"bg-brand text-white border-brand":""}`}>Mixto</button></div>
      {(salePaymentMethod==="CASH"||salePaymentMethod==="MIXED") && <div className="space-y-1"><label className="text-sm">Monto pagado (opcional, para calcular cambio)<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent" value={saleCashPaid} onChange={e=>setSaleCashPaid(e.target.value)}/></label>{saleCashPaid && Number(saleCashPaid)>=cartTotal && <p className="text-sm text-emerald-700 dark:text-emerald-400">Cambio: {money(Number(saleCashPaid)-cartTotal, (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency||"BOB"))}</p>}</div>}
      {(salePaymentMethod==="QR"||salePaymentMethod==="MIXED") && <div className="space-y-1"><label className="text-sm">Comprobante de {money(salePaymentMethod==="QR"?cartTotal:Math.max(0,cartTotal-(Number(saleCashPaid)||0)), (complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency)||(complexes.find((cc:any)=>cc.id===(resComplex||selComplex))?.currency)||"BOB")}<input type="file" accept="image/*,application/pdf" capture="environment" className="w-full border rounded px-3 py-2 bg-transparent" onChange={e=>setSaleReceiptFile(e.target.files?.[0]||null)}/></label>{saleReceiptFile && <p className="text-xs text-slate-500">{saleReceiptFile.name}</p>}</div>}
      <button onClick={confirmSale} disabled={saleBusy||cart.length===0} className="rounded-md bg-brand text-white px-4 py-2 w-full">{saleBusy?"Registrando...":"Registrar venta"}</button>
    </div></div>}
    {resModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">📅 Agregar reserva</h2><button onClick={()=>setResModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      {resModalErr && <p className="text-sm text-red-600">{resModalErr}</p>}
      <div className="text-sm">Complejo: <b>{complexes.find((c:any)=>c.id===(resModalForm.complexId||resComplex||selComplex))?.name||"—"}</b></div>
      {resModalForm.showCalendar && <>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={()=>{const d=new Date(resModalForm.date||calDate); d.setDate(d.getDate()-7); setResModalForm({...resModalForm,date:d.toISOString().slice(0,10)}); loadCalendar(resModalForm.complexId||resComplex||selComplex, d.toISOString().slice(0,10));}} className="rounded border px-2 py-1">◀</button>
          <span className="text-xs text-slate-500">Semana del {resModalForm.date||calDate}</span>
          <button onClick={()=>{const d=new Date(resModalForm.date||calDate); d.setDate(d.getDate()+7); setResModalForm({...resModalForm,date:d.toISOString().slice(0,10)}); loadCalendar(resModalForm.complexId||resComplex||selComplex, d.toISOString().slice(0,10));}} className="rounded border px-2 py-1">▶</button>
        </div>
        <AvailabilityCalendar date={resModalForm.date||calDate} scenarios={calScenarios} blocksByScenario={calBlocks} visibleIds={visibleScenarios} onToggle={(id:any)=>setVisibleScenarios((v:any)=>({...v,[id]:!v[id]}))} onPickSlotWeek={(sid:any,d:any,st:any,en:any)=>{ setResModalForm((f:any)=>({...f,scenarioId:sid,date:d,start:st,end:en,showCalendar:false})); }} allowCreate={true} weekView />
      </>}
      {!resModalForm.showCalendar && <div className="text-xs text-slate-500">Seleccionado: {resModalForm.date} {resModalForm.start}-{resModalForm.end}</div>}
      <div className="grid sm:grid-cols-2 gap-2 text-sm">
        <select className="border rounded px-2 py-2 bg-transparent" value={resModalForm.scenarioId} onChange={e=>setResModalForm({...resModalForm,scenarioId:e.target.value})}><option value="">Escenario</option>{scenarios.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <label className="text-xs text-slate-500">Cantidad de horas<input type="number" min={1} step={1} className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="Cantidad de horas" value={resModalForm.hours} onChange={e=>{ const h=Number(e.target.value)||1; const [sh,sm]=resModalForm.start.split(":").map(Number); const endH=Math.min(23,sh+h); const endStr=String(endH).padStart(2,"0")+":"+String(sm).padStart(2,"0"); setResModalForm({...resModalForm,hours:h,end:endStr}); }}/></label>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-sm">
        <select className="border rounded px-2 py-2 bg-transparent" value={resModalForm.initialStatus} onChange={e=>setResModalForm({...resModalForm,initialStatus:e.target.value})}><option value="PENDING_PAYMENT">Pendiente de pago</option><option value="PENDING_CONFIRMATION">Pendiente de confirmación</option><option value="CONFIRMED">Confirmado (pagado)</option></select>
        {!resModalForm.showCalendar && <button type="button" onClick={()=>setResModalForm({...resModalForm,showCalendar:true})} className="rounded border px-2 py-2 text-sm">📅 Cambiar horario</button>}
      </div>
      <div className="space-y-1 text-sm">
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Buscar cliente (nombre o email)" value={resModalForm.clientName} onChange={e=>setResModalForm({...resModalForm,clientName:e.target.value,newClient:false,membershipId:null})}/>
        {resModalForm.clientName && !resModalForm.newClient && clientOptions.filter((c:any)=> (c.user?.name||"").toLowerCase().includes(resModalForm.clientName.toLowerCase()) || (c.user?.email||"").toLowerCase().includes(resModalForm.clientName.toLowerCase())).length>0 && <div className="border rounded max-h-32 overflow-auto text-sm">{clientOptions.filter((c:any)=> (c.user?.name||"").toLowerCase().includes(resModalForm.clientName.toLowerCase()) || (c.user?.email||"").toLowerCase().includes(resModalForm.clientName.toLowerCase())).slice(0,8).map((c:any)=> <button key={c.id} type="button" onClick={()=>setResModalForm({...resModalForm,clientName:c.user?.name||c.user?.email, membershipId:c.id, newClient:false})} className="w-full text-left px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">{c.user?.name||"—"} <span className="text-xs text-slate-500">{c.user?.email}</span></button>)}</div>}
        {resModalForm.clientName && !resModalForm.newClient && clientOptions.filter((c:any)=> (c.user?.name||"").toLowerCase().includes(resModalForm.clientName.toLowerCase()) || (c.user?.email||"").toLowerCase().includes(resModalForm.clientName.toLowerCase())).length===0 && <p className="text-xs text-slate-500">No se encontró. Marca "Agregar cliente nuevo".</p>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!resModalForm.newClient} onChange={e=>setResModalForm({...resModalForm,newClient:e.target.checked})}/> Agregar cliente nuevo</label>
        {resModalForm.newClient && <div className="grid sm:grid-cols-2 gap-2"><input className="border rounded px-2 py-2 bg-transparent" placeholder="Email del nuevo cliente" value={resModalForm.clientEmail} onChange={e=>setResModalForm({...resModalForm,clientEmail:e.target.value})}/><input className="border rounded px-2 py-2 bg-transparent" placeholder="Teléfono" value={resModalForm.clientPhone} onChange={e=>setResModalForm({...resModalForm,clientPhone:e.target.value})}/></div>}
      </div>
      <input className="w-full border rounded px-2 py-2 bg-transparent text-sm" placeholder="Nota" value={resModalForm.note} onChange={e=>setResModalForm({...resModalForm,note:e.target.value})}/>
      <div className="flex gap-2"><button disabled={resModalBusy} onClick={async()=>{ setResModalBusy(true); setResModalErr(""); try{ const cid=resModalForm.complexId||resComplex||selComplex; const sid=resModalForm.scenarioId; if(!sid) throw new Error("Selecciona escenario"); const startAt=new Date(resModalForm.date+"T"+resModalForm.start+":00").toISOString(); const endAt=new Date(resModalForm.date+"T"+resModalForm.end+":00").toISOString(); await apiFetch("/reservations",{method:"POST",body:JSON.stringify({scenarioId:sid,startAt,endAt,people:resModalForm.people,clientName:resModalForm.clientName||null,client: resModalForm.newClient?{email:resModalForm.clientEmail,name:resModalForm.clientName,phone:resModalForm.clientPhone}:null, membershipId: resModalForm.membershipId||null, note:resModalForm.note||null,initialStatus:"PENDING_PAYMENT"})}); setResModalOpen(false); await loadReservations(resComplex,resStatus); await loadCalendar(resComplex,calDate); }catch(e:any){ setResModalErr(e.message||"Error"); } finally{ setResModalBusy(false); } }} className="rounded-md border px-4 py-2 flex-1">Crear reserva</button>
      <button disabled={resModalBusy} onClick={async()=>{ setResModalBusy(true); setResModalErr(""); try{ const cid=resModalForm.complexId||resComplex||selComplex; const sid=resModalForm.scenarioId; if(!sid) throw new Error("Selecciona escenario"); const startAt=new Date(resModalForm.date+"T"+resModalForm.start+":00").toISOString(); const endAt=new Date(resModalForm.date+"T"+resModalForm.end+":00").toISOString(); const r=await apiFetch<any>("/reservations",{method:"POST",body:JSON.stringify({scenarioId:sid,startAt,endAt,people:resModalForm.people,clientName:resModalForm.clientName||null,client: resModalForm.newClient?{email:resModalForm.clientEmail,name:resModalForm.clientName,phone:resModalForm.clientPhone}:null, membershipId: resModalForm.membershipId||null, note:resModalForm.note||null,initialStatus:"PENDING_PAYMENT"})}); setResModalOpen(false); setPendingResPayment(r?.data||null); setTab("ventas"); await loadReservations(resComplex,resStatus); await loadCalendar(resComplex,calDate); }catch(e:any){ setResModalErr(e.message||"Error"); } finally{ setResModalBusy(false); } }} className="rounded-md bg-brand text-white px-4 py-2 flex-1">💵 Confirmar con pago</button></div>
    </div></div>}

    {slotResModal && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">📋 Reservas del horario</h2><button onClick={()=>setSlotResModal(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      {slotResData.length===0 ? <p className="text-sm text-slate-500">Sin reservas.</p> : <ul className="space-y-2 text-sm">{slotResData.map((b:any,i:number)=> <li key={i} className="border border-slate-200 dark:border-slate-700 rounded p-2 space-y-1">
        <div className="flex justify-between"><b>{b.scenario?.name||"—"}</b><span className="text-xs text-slate-500">{STATUS_ES[b.status]||b.status}</span></div>
        <div className="text-xs text-slate-500">{new Date(b.s).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} - {new Date(b.e).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {b.people||1} pers.</div>
        {b.client && <div className="text-xs">👤 {b.client.name||b.client.email||"Cliente"} {b.client.phone && <a href={`tel:${b.client.phone}`} className="text-blue-600 underline ml-1">📞 {b.client.phone}</a>}</div>}
        {!b.client && b.clientName && <div className="text-xs">👤 {b.clientName}</div>}
        {b.note && <div className="text-xs text-slate-500">📝 {b.note}</div>}
        {b.type==="MAINTENANCE" && <div className="text-xs text-amber-700">Mantenimiento{b.reason?(" · "+b.reason):""}</div>}
        {b.type==="CLOSED" && <div className="text-xs text-slate-500">{b.reason||"Cerrado"}</div>}
        {b.type==="RESERVATION" && b.status !== "CANCELLED" && b.status !== "COMPLETED" && <div className="flex flex-wrap gap-2 mt-1">
          <button onClick={async()=>{ if(!confirm("¿Cancelar esta reserva?")) return; try{ await apiFetch(`/reservations/${b.id}/cancel`,{method:"POST",body:JSON.stringify({})}); setSlotResModal(false); await loadCalendar(resComplex||selComplex, calDate); }catch(e:any){ alert(e.message||"Error"); } }} className="text-xs px-2 py-1 rounded border border-red-300 text-red-700">Cancelar reserva</button>
          {(b.status==="CONFIRMED"||b.status==="SCHEDULED"||b.seriesPaidAt) && <div className="flex flex-wrap gap-1"><button onClick={async()=>{ if(!confirm("¿Recorrer a la siguiente semana?")) return; try{ const ns=new Date(b.s); ns.setDate(ns.getDate()+7); const ne=new Date(b.e); ne.setDate(ne.getDate()+7); await apiFetch(`/reservations/${b.id}`,{method:"PATCH",body:JSON.stringify({startAt:ns.toISOString(),endAt:ne.toISOString()})}); setSlotResModal(false); await loadCalendar(resComplex||selComplex, calDate); }catch(e:any){ alert(e.message||"Error"); } }} className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-700">Recorrer a siguiente semana</button><button onClick={async()=>{ if(!confirm("¿Devolver el dinero y cancelar?")) return; try{ await apiFetch(`/reservations/${b.id}/cancel`,{method:"POST",body:JSON.stringify({})}); setSlotResModal(false); await loadCalendar(resComplex||selComplex, calDate); }catch(e:any){ alert(e.message||"Error"); } }} className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700">Devolver dinero</button></div>}
        </div>}
      </li>)}</ul>}
    </div></div>}

    {prodModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{pEdit?"✏️ Editar producto":"➕ Nuevo producto"}</h2><button onClick={()=>setProdModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="grid md:grid-cols-2 gap-2 text-sm">
        <input className="border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={pForm.name} onChange={e=>setPForm({...pForm,name:e.target.value})}/>
        <select className="border rounded px-2 py-2 bg-transparent" value={pForm.categoryId} onChange={e=>setPForm({...pForm,categoryId:e.target.value})}><option value="">Categoría</option>{categories.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="border rounded px-2 py-2 bg-transparent" value={pForm.supplierId} onChange={e=>setPForm({...pForm,supplierId:e.target.value})}><option value="">Proveedor</option>{suppliers.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className="border rounded px-2 py-2 bg-transparent" placeholder="Notas" value={pForm.notes} onChange={e=>setPForm({...pForm,notes:e.target.value})}/>
      </div>
      <div className="text-sm space-y-1">
        <label className="font-medium">Foto (URL o subir archivo)</label>
        <div className="flex flex-wrap gap-2"><input className="flex-1 border rounded px-2 py-2 bg-transparent" placeholder="URL de imagen" value={pForm.imageUrl||""} onChange={e=>setPForm({...pForm,imageUrl:e.target.value,imageKey:""})}/><label className="rounded border px-3 py-2 cursor-pointer text-xs">Subir<input type="file" accept="image/*" className="hidden" onChange={async(e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ const fd=new FormData(); fd.append("file",f); fd.append("complexId",resComplex||selComplex); const r=await apiFetch<any>("/uploads/file",{method:"POST",body:fd}); setPForm((s:any)=>({...s,imageUrl:r?.data?.url||s.imageUrl,imageKey:r?.data?.key||s.imageKey,imageName:f.name})); }catch(err:any){ alert(err.message||"Error"); } }}/></label></div>
        {pForm.imageName && <p className="text-xs text-slate-500">{pForm.imageName}</p>}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Presentaciones</div>
        {(pForm.presentations||[]).map((pr:any,i:number)=> (
          <div key={i} className="grid grid-cols-4 gap-2 text-sm">
            <input className="border rounded px-2 py-1 bg-transparent" placeholder="Nombre" value={pr.name} onChange={e=>{ const arr=[...pForm.presentations]; arr[i]={...arr[i],name:e.target.value}; setPForm({...pForm,presentations:arr}); }}/>
            <input type="number" className="border rounded px-2 py-1 bg-transparent" placeholder="Unid/paq" value={pr.unitsPerPack} onChange={e=>{ const arr=[...pForm.presentations]; arr[i]={...arr[i],unitsPerPack:Number(e.target.value)}; setPForm({...pForm,presentations:arr}); }}/>
            <input type="number" step="0.01" className="border rounded px-2 py-1 bg-transparent" placeholder="Costo" value={pr.cost} onChange={e=>{ const arr=[...pForm.presentations]; arr[i]={...arr[i],cost:Number(e.target.value)}; setPForm({...pForm,presentations:arr}); }}/>
            <input type="number" step="0.01" className="border rounded px-2 py-1 bg-transparent" placeholder="Precio" value={pr.price} onChange={e=>{ const arr=[...pForm.presentations]; arr[i]={...arr[i],price:Number(e.target.value)}; setPForm({...pForm,presentations:arr}); }}/>
          </div>
        ))}
        <button type="button" onClick={()=>setPForm({...pForm,presentations:[...(pForm.presentations||[]),{name:"Unidad",unitsPerPack:1,cost:0,price:0}]})} className="text-xs underline text-blue-600">+ Agregar presentación</button>
      </div>
      <button onClick={async()=>{ const cid=resComplex||selComplex; if(!cid){ alert("Selecciona complejo"); return; } try{ const payload={ complexId:cid, name:pForm.name, categoryId:pForm.categoryId||null, supplierId:pForm.supplierId||null, notes:pForm.notes||null, imageKey:pForm.imageKey||null, imageUrl:pForm.imageUrl||null, cost:Number(pForm.cost||0), price:Number(pForm.price||0) }; if(pEdit){ await apiFetch(`/inventory/products/${pEdit.id}`,{method:"PATCH",body:JSON.stringify(payload)}); for(const pr of (pForm.presentations||[])){ if(pr.id) await apiFetch(`/inventory/presentations/${pr.id}`,{method:"PATCH",body:JSON.stringify({name:pr.name,unitsPerPack:pr.unitsPerPack,cost:pr.cost,price:pr.price})}); else await apiFetch(`/inventory/products/${pEdit.id}/presentations`,{method:"POST",body:JSON.stringify({name:pr.name,unitsPerPack:pr.unitsPerPack,cost:pr.cost,price:pr.price})}); } } else { const r=await apiFetch<any>("/inventory/products",{method:"POST",body:JSON.stringify(payload)}); const pid=r?.data?.id; if(pid && pForm.presentations?.length){ for(const pr of pForm.presentations){ await apiFetch(`/inventory/products/${pid}/presentations`,{method:"POST",body:JSON.stringify({name:pr.name,unitsPerPack:pr.unitsPerPack,cost:pr.cost,price:pr.price})}); } } } setProdModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">{pEdit?"Guardar cambios":"Crear producto"}</button>
    </div></div>}

    {stockModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">➕ Aumentar stock</h2><button onClick={()=>setStockModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">Almacén<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={stockForm.warehouseId} onChange={e=>setStockForm({...stockForm,warehouseId:e.target.value,locationId:""})}><option value="">Selecciona</option>{warehouses.map((w:any)=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="text-xs text-slate-500">Ubicación<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={stockForm.locationId||""} onChange={e=>setStockForm({...stockForm,locationId:e.target.value})}><option value="">(opcional)</option>{(warehouses.find((w:any)=>w.id===stockForm.warehouseId)?.locations||[]).map((l:any)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        </div>
        <label className="text-xs text-slate-500">Presentación<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={stockForm.presentationId} onChange={e=>setStockForm({...stockForm,presentationId:e.target.value})}><option value="">Selecciona</option>{products.find((p:any)=>p.id===stockForm.productId)?.presentations?.map((pr:any)=><option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></label>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Cantidad</label>
          <div className="flex items-center justify-center gap-3 mt-1">
            <button type="button" onClick={()=>setStockForm({...stockForm,qty:Math.max(1,(stockForm.qty||1)-1)})} className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 text-2xl font-bold flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-600">−</button>
            <input type="number" min={1} className="w-20 border rounded px-2 py-2 bg-transparent text-center text-lg font-semibold" value={stockForm.qty} onChange={e=>setStockForm({...stockForm,qty:Number(e.target.value)})}/>
            <button type="button" onClick={()=>setStockForm({...stockForm,qty:(stockForm.qty||0)+1})} className="w-12 h-12 rounded-full bg-emerald-500 text-white text-2xl font-bold flex items-center justify-center hover:bg-emerald-600">+</button>
          </div>
        </div>
      </div>
      <button onClick={handleStockIn} className="rounded-md bg-brand text-white px-4 py-2 w-full">Registrar ingreso</button>
    </div></div>}


    {whModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">➕ Crear almacén</h2><button onClick={()=>setWhModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre del almacén" value={whForm?.name||""} onChange={e=>setWhForm({...whForm,name:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Ubicaciones (separadas por coma)" value={whForm?.locations||""} onChange={e=>setWhForm({...whForm,locations:e.target.value})}/>
      </div>
      <button onClick={async()=>{ const cid=resComplex||selComplex; if(!cid||!whForm?.name){ alert("Completa los campos"); return; } try{ const locs=(whForm.locations||"").split(",").map((x:string)=>x.trim()).filter(Boolean); await apiFetch("/inventory/warehouses",{method:"POST",body:JSON.stringify({complexId:cid,name:whForm.name,locations:locs})}); setWhModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Crear almacén</button>
    </div></div>}

    {importModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">📥 Importar inventario</h2><button onClick={()=>setImportModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={importState.warehouseId} onChange={e=>setImportState({...importState,warehouseId:e.target.value})}><option value="">Almacén</option>{warehouses.map((w:any)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input type="file" accept=".csv" className="w-full border rounded px-2 py-2 bg-transparent" onChange={e=>{ const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=>setImportState({...importState,csv:String(r.result||"")}); r.readAsText(f); }}/>
        <textarea className="w-full border rounded px-2 py-2 bg-transparent font-mono text-xs" rows={6} placeholder="Pega CSV aquí" value={importState.csv} onChange={e=>setImportState({...importState,csv:e.target.value})}/>
      </div>
      <button onClick={async()=>{ const cid=resComplex||selComplex; if(!cid||!importState.warehouseId||!importState.csv){ alert("Completa los campos"); return; } try{ await apiFetch("/inventory/import-csv",{method:"POST",body:JSON.stringify({complexId:cid,warehouseId:importState.warehouseId,csv:importState.csv})}); setImportModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Importar</button>
    </div></div>}

    {bajaModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">🗑️ Salida / baja</h2><button onClick={()=>setBajaModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={bajaForm.presentationId} onChange={e=>setBajaForm({...bajaForm,presentationId:e.target.value})}><option value="">Presentación</option>{products.flatMap((p:any)=> (p.presentations||[]).map((pr:any)=><option key={pr.id} value={pr.id}>{p.name} · {pr.name}</option>))}</select>
        <input type="number" min={1} className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Cantidad" value={bajaForm.qty} onChange={e=>setBajaForm({...bajaForm,qty:Number(e.target.value)})}/>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={bajaForm.reason} onChange={e=>setBajaForm({...bajaForm,reason:e.target.value})}><option value="Vencimiento">Vencimiento</option><option value="Mal estado">Mal estado</option><option value="Otro">Otro motivo</option></select>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Motivo (si otro)" value={bajaForm.note||""} onChange={e=>setBajaForm({...bajaForm,note:e.target.value})}/>
      </div>
      <button onClick={async()=>{ const cid=resComplex||selComplex; if(!cid||!bajaForm.presentationId){ alert("Completa los campos"); return; } const pres=products.flatMap((p:any)=>p.presentations||[]).find((pr:any)=>pr.id===bajaForm.presentationId); try{ await apiFetch("/inventory/stock/out",{method:"POST",body:JSON.stringify({complexId:cid,warehouseId:warehouses[0]?.id||"",reason:"WASTE",notes:bajaForm.reason+(bajaForm.note?": "+bajaForm.note:""),items:[{productId:pres?.productId||"",presentationId:bajaForm.presentationId,qty:bajaForm.qty}]})}); setBajaModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Registrar baja</button>
    </div></div>}

    {movModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">🔄 Hacer movimiento</h2><button onClick={()=>setMovModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2">
        {movLines.map((ml:any,i:number)=> (
          <div key={i} className="border rounded p-2 space-y-2 text-sm">
            <select className="w-full border rounded px-2 py-2 bg-transparent" value={ml.productId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],productId:e.target.value,presentationId:""}; setMovLines(arr); }}><option value="">Producto</option>{products.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="w-full border rounded px-2 py-2 bg-transparent" value={ml.presentationId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],presentationId:e.target.value}; setMovLines(arr); }}><option value="">Presentación</option>{products.find((p:any)=>p.id===ml.productId)?.presentations?.map((pr:any)=><option key={pr.id} value={pr.id}>{pr.name}</option>)}</select>
            <div className="grid grid-cols-2 gap-2">
              <select className="border rounded px-2 py-2 bg-transparent" value={ml.fromWarehouseId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],fromWarehouseId:e.target.value,fromLocationId:""}; setMovLines(arr); }}><option value="">Desde almacén</option>{warehouses.map((w:any)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select className="border rounded px-2 py-2 bg-transparent" value={ml.fromLocationId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],fromLocationId:e.target.value}; setMovLines(arr); }}><option value="">Desde ubicación</option>{(warehouses.find((w:any)=>w.id===ml.fromWarehouseId)?.locations||[]).map((l:any)=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="border rounded px-2 py-2 bg-transparent" value={ml.toWarehouseId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],toWarehouseId:e.target.value,toLocationId:""}; setMovLines(arr); }}><option value="">Hacia almacén</option>{warehouses.map((w:any)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select className="border rounded px-2 py-2 bg-transparent" value={ml.toLocationId} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],toLocationId:e.target.value}; setMovLines(arr); }}><option value="">Hacia ubicación</option>{(warehouses.find((w:any)=>w.id===ml.toWarehouseId)?.locations||[]).map((l:any)=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </div>
            <input type="number" min={1} className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Cantidad" value={ml.qty} onChange={e=>{ const arr=[...movLines]; arr[i]={...arr[i],qty:Number(e.target.value)}; setMovLines(arr); }}/>
          </div>
        ))}
        <button onClick={()=>setMovLines([...movLines,{productId:"",presentationId:"",qty:1,fromWarehouseId:"",fromLocationId:"",toWarehouseId:"",toLocationId:""}])} className="text-xs underline text-blue-600">+ Agregar línea</button>
      </div>
      <button onClick={async()=>{ const cid=resComplex||selComplex; if(!cid){ alert("Selecciona complejo"); return; } try{ for(const ml of movLines){ if(!ml.presentationId||!ml.fromWarehouseId||!ml.toWarehouseId) continue; await apiFetch("/inventory/stock/out",{method:"POST",body:JSON.stringify({complexId:cid,warehouseId:ml.fromWarehouseId,locationId:ml.fromLocationId||null,reason:"ADJUST",notes:"Movimiento",items:[{productId:ml.productId,presentationId:ml.presentationId,qty:ml.qty}]})}); await apiFetch("/inventory/stock/in",{method:"POST",body:JSON.stringify({complexId:cid,warehouseId:ml.toWarehouseId,locationId:ml.toLocationId||null,items:[{productId:ml.productId,presentationId:ml.presentationId,qty:ml.qty,unitCost:0}]})}); } setMovModalOpen(false); await loadSalesData(cid); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Registrar movimiento</button>
    </div></div>}


    {receiptOpen && receiptData && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto" id="receipt">
      <div className="flex items-center justify-between"><h2 className="font-semibold">🧾 Recibo</h2><button onClick={()=>setReceiptOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="text-sm space-y-1">
        <div><b>Fecha:</b> {receiptData.type==="order" ? new Date(receiptData.data.createdAt).toLocaleString() : new Date(receiptData.data.startAt).toLocaleString()}</div>
        <div><b>Cliente:</b> {receiptData.type==="order" ? (receiptData.data.clientName||receiptData.data.membership?.user?.name||"—") : (receiptData.data.clientName||receiptData.data.membership?.user?.name||"—")}</div>
        <div><b>Tipo:</b> {receiptData.type==="order" ? "Venta" : "Reserva"}</div>
        {receiptData.type==="order" && <div><b>Total:</b> {Number(receiptData.data.total)}</div>}
        {receiptData.type==="order" && (receiptData.data.lines||[]).length>0 && <ul className="text-xs space-y-1 border-t pt-1">{receiptData.data.lines.map((l:any)=> <li key={l.id}>{l.qty} x {l.product?.name||"?"} @ {Number(l.unitPrice)}</li>)}</ul>}
        {receiptData.type==="reservation" && <div><b>Escenario:</b> {receiptData.data.scenario?.name||"—"}</div>}
        {receiptData.type==="reservation" && <div><b>Monto:</b> {Number(receiptData.data.totalAmount||0)}</div>}
        {receiptData.type==="reservation" && <div><b>Estado:</b> {STATUS_ES[receiptData.data.status]||receiptData.data.status}</div>}
      </div>
      <div className="flex gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent("Recibo AdCoDe: " + (receiptData.type==="order"?"Venta":"Reserva") + " - " + (receiptData.type==="order"?Number(receiptData.data.total):Number(receiptData.data.totalAmount||0)))}`} target="_blank" className="rounded-md bg-green-500 text-white px-4 py-2 text-sm flex-1 text-center">📲 WhatsApp</a>
        <button onClick={()=>window.print()} className="rounded-md border px-4 py-2 text-sm flex-1">📄 Guardar PDF</button>
      </div>
    </div></div>}

    {tenantModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">➕ Nuevo tenant</h2><button onClick={()=>setTenantModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre del tenant" value={tForm.name} onChange={e=>{ const name=e.target.value; setTForm({...tForm,name,slug:slugify(name)}); }}/>
        <div className="text-xs text-slate-500">Slug: <span className="font-mono">{tForm.slug||"—"}</span> (se genera automáticamente)</div>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto nombre" value={tForm.contactName} onChange={e=>setTForm({...tForm,contactName:e.target.value})}/>
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto email" value={tForm.contactEmail} onChange={e=>setTForm({...tForm,contactEmail:e.target.value})}/>
        <div className="space-y-1"><label className="text-xs text-slate-500">Cantidad de complejos</label><div className="flex items-center justify-center gap-3 mt-1"><button type="button" onClick={()=>setTForm({...tForm,maxComplexes:Math.max(1,(tForm.maxComplexes||1)-1)})} className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 text-xl font-bold flex items-center justify-center">−</button><span className="w-12 text-center font-semibold text-lg">{tForm.maxComplexes}</span><button type="button" onClick={()=>setTForm({...tForm,maxComplexes:(tForm.maxComplexes||0)+1})} className="w-10 h-10 rounded-full bg-emerald-500 text-white text-xl font-bold flex items-center justify-center">+</button></div></div>
      </div>
      <button onClick={async()=>{ try{ const r=await apiFetch<any>("/platform/tenants",{method:"POST",body:JSON.stringify({...tForm,maxComplexes:Number(tForm.maxComplexes)})}); setTenantModalOpen(false); setTForm({name:"",slug:"",contactName:"",contactEmail:"",maxComplexes:1}); await loadAll(); if(r?.notice) setMsg(r.notice); else if(r?.temporaryPassword) setMsg(`Tenant creado. Contraseña temporal: ${r.temporaryPassword}`); }catch(e:any){ setErr(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Crear tenant</button>
    </div></div>}

    {scnModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">➕ Crear escenario</h2><button onClick={()=>setScnModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <form onSubmit={e=>run(async()=>{e.preventDefault(); const pricing:any[]=[]; if(sForm.rentalFormat==="PER_HOUR"||sForm.rentalFormat==="MIXED"){ pricing.push({period:"DAY",pricePerHour:Number(sForm.priceDay||0)}); pricing.push({period:"NIGHT",pricePerHour:Number(sForm.priceNight||0)}); } if(sForm.rentalFormat==="PER_PERSON"||sForm.rentalFormat==="MIXED"){ if(!pricing.find((p:any)=>p.period==="DAY")) pricing.push({period:"DAY"}); if(!pricing.find((p:any)=>p.period==="NIGHT")) pricing.push({period:"NIGHT"}); const d=pricing.find((p:any)=>p.period==="DAY"); const n=pricing.find((p:any)=>p.period==="NIGHT"); if(d){ d.pricePerPerson=Number(sForm.priceAdult||0); d.childPrice=Number(sForm.priceChild||0); d.childAgeThreshold=Number(sForm.childAge||10); } if(n){ n.pricePerPerson=Number(sForm.priceAdult||0); n.childPrice=Number(sForm.priceChild||0); n.childAgeThreshold=Number(sForm.childAge||10); } } if(sForm.rentalFormat==="FLAT_BLOCK"){ if(!pricing.find((p:any)=>p.period==="DAY")) pricing.push({period:"DAY"}); const d=pricing.find((p:any)=>p.period==="DAY"); if(d){ d.basePrice=Number(sForm.basePrice||0); d.blockType=sForm.blockType; } } await apiFetch("/scenarios",{method:"POST",body:JSON.stringify({complexId:selComplex,name:sForm.name,rentalFormat:sForm.rentalFormat,openTime:sForm.openTime||null,closeTime:sForm.closeTime||null,availableDays:sForm.availableDays||[0,1,2,3,4,5,6],pricing})}); setSForm({name:"",rentalFormat:"PER_HOUR",priceDay:80,priceNight:100,priceAdult:0,priceChild:0,childAge:10,basePrice:0,blockType:"DAY",openTime:"",closeTime:"",availableDays:[0,1,2,3,4,5,6]}); await loadScenarios(selComplex); await loadCalendar(resComplex,calDate);},"Escenario creado.")} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2 max-w-xl">
        <h2 className="font-medium inline-flex items-center gap-2"><Icon.plus className="w-4 h-4 text-green-700"/> Crear escenario</h2>
        <label className="text-sm">Nombre del escenario<input className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="Ej. Cancha 1" value={sForm.name} onChange={e=>setSForm({...sForm,name:e.target.value})}/></label>
        <label className="text-sm">Forma de alquiler<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sForm.rentalFormat} onChange={e=>setSForm({...sForm,rentalFormat:e.target.value})}><option value="PER_HOUR">Por hora</option><option value="PER_PERSON">Por persona</option><option value="MIXED">Mixto (hora + persona)</option><option value="FLAT_BLOCK">Bloque fijo</option></select></label>
        {(sForm.rentalFormat==="PER_HOUR"||sForm.rentalFormat==="MIXED") && <div className="grid grid-cols-2 gap-2"><label className="text-sm">Precio por hora (día)<input type="number" step="0.01" className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="0.00" value={sForm.priceDay} onChange={e=>setSForm({...sForm,priceDay:Number(e.target.value)})}/></label><label className="text-sm">Precio por hora (noche)<input type="number" step="0.01" className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="0.00" value={sForm.priceNight} onChange={e=>setSForm({...sForm,priceNight:Number(e.target.value)})}/></label></div>}
        {(sForm.rentalFormat==="PER_PERSON"||sForm.rentalFormat==="MIXED") && <div className="grid grid-cols-3 gap-2"><label className="text-sm">Precio por adulto<input type="number" step="0.01" className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="0.00" value={sForm.priceAdult} onChange={e=>setSForm({...sForm,priceAdult:Number(e.target.value)})}/></label><label className="text-sm">Precio por niño<input type="number" step="0.01" className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="0.00" value={sForm.priceChild} onChange={e=>setSForm({...sForm,priceChild:Number(e.target.value)})}/></label><label className="text-sm">Edad niño (hasta)<input type="number" min={1} max={17} className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="10" value={sForm.childAge} onChange={e=>setSForm({...sForm,childAge:Number(e.target.value)})}/></label></div>}
        {sForm.rentalFormat==="FLAT_BLOCK" && <div className="grid grid-cols-2 gap-2"><label className="text-sm">Tipo de bloque<select className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sForm.blockType} onChange={e=>setSForm({...sForm,blockType:e.target.value})}><option value="MORNING">Mañana</option><option value="AFTERNOON">Tarde</option><option value="DAY">Día completo</option><option value="MULTI_DAY">Varios días</option></select></label><label className="text-sm">Precio total del bloque<input type="number" step="0.01" className="w-full border rounded px-2 py-2 bg-transparent mt-1" placeholder="0.00" value={sForm.basePrice} onChange={e=>setSForm({...sForm,basePrice:Number(e.target.value)})}/></label></div>}
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">Disponible desde (opcional)<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sForm.openTime||""} onChange={e=>setSForm({...sForm,openTime:e.target.value})}/></label><label className="text-sm">Disponible hasta (opcional)<input type="time" className="w-full border rounded px-2 py-2 bg-transparent mt-1" value={sForm.closeTime||""} onChange={e=>setSForm({...sForm,closeTime:e.target.value})}/></label></div>
        <div className="text-sm"><div className="text-xs text-slate-600 dark:text-slate-300 mb-1">Días disponibles</div><div className="flex flex-wrap gap-2">{[["1","Lun"],["2","Mar"],["3","Mié"],["4","Jue"],["5","Vie"],["6","Sáb"],["0","Dom"]].map(([v,l])=>{ const n=Number(v); const on=(sForm.availableDays||[]).includes(n); return <label key={v} className={`px-2 py-1 rounded border text-xs cursor-pointer ${on?"bg-blue-50 border-blue-300 dark:bg-blue-950/30":""}`}><input type="checkbox" className="mr-1" checked={on} onChange={e=>{ const set=new Set<number>(sForm.availableDays||[]); if(e.target.checked) set.add(n); else set.delete(n); setSForm({...sForm,availableDays:Array.from(set)}); }} />{l}</label>; })}</div></div>
        <p className="text-xs text-slate-500">Si no defines horario, se usa el horario de atención del complejo (entre semana y fin de semana si está configurado).</p>
        <button className="rounded-md bg-brand text-white px-4 py-2" disabled={!selComplex}>Crear escenario</button>
      </form>
      <button onClick={()=>setScnModalOpen(false)} className="text-xs text-slate-500 underline">Cerrar</button>
    </div></div>}
    {complexModalOpen && <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3 max-h-[90vh] overflow-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold">➕ Nuevo complejo</h2><button onClick={()=>setComplexModalOpen(false)} className="text-sm px-2 py-1 rounded border">Cerrar</button></div>
      <div className="space-y-2 text-sm">
        <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={cForm.name} onChange={e=>{const name=e.target.value; setCForm({...cForm,name,slug:slugify(name)});}}/>
        <div className="text-xs text-slate-500">Slug: <span className="font-mono">{cForm.slug||"—"}</span></div>
        <select className="w-full border rounded px-2 py-2 bg-transparent" value={cForm.department} onChange={e=>setCForm({...cForm,department:e.target.value})}><option value="Santa Cruz">Santa Cruz</option><option value="La Paz">La Paz</option><option value="Cochabamba">Cochabamba</option><option value="Oruro">Oruro</option><option value="Potosí">Potosí</option><option value="Tarija">Tarija</option><option value="Sucre">Sucre</option><option value="Beni">Beni</option><option value="Pando">Pando</option></select>
        <div className="grid grid-cols-2 gap-2"><input className="border rounded px-2 py-2 bg-transparent" value={cForm.timezone} onChange={e=>setCForm({...cForm,timezone:e.target.value})} placeholder="Zona horaria"/><input className="border rounded px-2 py-2 bg-transparent" value={cForm.currency} onChange={e=>setCForm({...cForm,currency:e.target.value})} placeholder="Moneda (BOB)"/></div>
        <div className="space-y-1"><div className="font-medium text-sm">Horario de atención por día</div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Domingo</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[0] && cForm.weeklySchedule[0].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[0]={...(ws[0]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[0] && cForm.weeklySchedule[0].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[0]={...(ws[0]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[0] && cForm.weeklySchedule[0].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[0]={...(ws[0]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Lunes</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[1] && cForm.weeklySchedule[1].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[1]={...(ws[1]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[1] && cForm.weeklySchedule[1].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[1]={...(ws[1]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[1] && cForm.weeklySchedule[1].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[1]={...(ws[1]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Martes</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[2] && cForm.weeklySchedule[2].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[2]={...(ws[2]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[2] && cForm.weeklySchedule[2].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[2]={...(ws[2]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[2] && cForm.weeklySchedule[2].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[2]={...(ws[2]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Miércoles</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[3] && cForm.weeklySchedule[3].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[3]={...(ws[3]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[3] && cForm.weeklySchedule[3].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[3]={...(ws[3]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[3] && cForm.weeklySchedule[3].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[3]={...(ws[3]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Jueves</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[4] && cForm.weeklySchedule[4].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[4]={...(ws[4]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[4] && cForm.weeklySchedule[4].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[4]={...(ws[4]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[4] && cForm.weeklySchedule[4].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[4]={...(ws[4]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Viernes</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[5] && cForm.weeklySchedule[5].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[5]={...(ws[5]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[5] && cForm.weeklySchedule[5].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[5]={...(ws[5]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[5] && cForm.weeklySchedule[5].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[5]={...(ws[5]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-24">Sábado</span><input type="checkbox" checked={!(cForm.weeklySchedule && cForm.weeklySchedule[6] && cForm.weeklySchedule[6].closed)} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[6]={...(ws[6]||{}), closed:!e.target.checked}; setCForm({...cForm,weeklySchedule:ws}); }} /><span className="text-slate-500">Abierto</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[6] && cForm.weeklySchedule[6].open) || "08:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[6]={...(ws[6]||{}), open:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /><span>-</span><input type="time" className="border rounded px-1 py-1 bg-transparent" value={(cForm.weeklySchedule && cForm.weeklySchedule[6] && cForm.weeklySchedule[6].close) || "22:00"} onChange={e=>{ const ws={...(cForm.weeklySchedule||{})}; ws[6]={...(ws[6]||{}), close:e.target.value}; setCForm({...cForm,weeklySchedule:ws}); }} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cForm.allowClientPayLater} onChange={e=>setCForm({...cForm,allowClientPayLater:e.target.checked})}/> Permitir pago posterior al cliente</label>
      </div>
      <button onClick={async()=>{ const cid=selTenant; if(!cid) { alert("Selecciona tenant"); return; } try{ const slug=cForm.slug||slugify(cForm.name); if(!slug||slug.length<2) throw new Error("Nombre invalido"); const payload={...cForm, slug, tenantId:cid, openTime:(cForm.weeklySchedule && cForm.weeklySchedule[1] && cForm.weeklySchedule[1].open) || "08:00", closeTime:(cForm.weeklySchedule && cForm.weeklySchedule[1] && cForm.weeklySchedule[1].close) || "22:00"}; await apiFetch("/complexes",{method:"POST",body:JSON.stringify(payload)}); setComplexModalOpen(false); setCForm({name:"",slug:"",department:"Santa Cruz",timezone:"America/La_Paz",currency:"BOB",weeklySchedule:null,allowClientPayLater:false}); await loadAll(); }catch(e:any){ alert(e.message||"Error"); } }} className="rounded-md bg-brand text-white px-4 py-2 w-full">Crear complejo</button>
    </div></div>}
  </div>);
}

export default function App(){
  const location = useLocation();
  const navigate = useNavigate();
  const [me,setMe]=useState<Me|null>(null);
  const [impersonate,setImpersonate]=useState<any>(null);
  const [notifications,setNotifications]=useState<any[]>([]);
  const [unreadCount,setUnreadCount]=useState(0);
  async function refreshMe(){ try{const r=await apiFetch<any>("/auth/me"); setMe(r.user||null);}catch{setMe(null);} }
  async function loadNotifications(){ try{ const r=await apiFetch<any>("/notifications"); setNotifications(r.data||[]); setUnreadCount(Number(r.unreadCount||0)); }catch{ setNotifications([]); setUnreadCount(0); } }
  async function readAll(){ try{ await apiFetch("/notifications/read",{method:"POST",body:JSON.stringify({all:true})}); }catch{} await loadNotifications(); }
  async function logout(){ try{await apiFetch("/auth/logout",{method:"POST"});}catch{} setMe(null); setNotifications([]); setUnreadCount(0); navigate("/"); }
  useEffect(()=>{refreshMe();},[]);
  useEffect(()=>{ if(me) loadNotifications(); else { setNotifications([]); setUnreadCount(0); } },[me?.id]);
  return (<Layout me={me} onLogout={logout} unread={unreadCount} refreshMe={refreshMe} hideHeader={location.pathname==="/" && !me} impersonate={impersonate} onBackToPlatform={()=>setImpersonate(null)}><Routes>
    <Route path="/" element={<HomePage me={me} refreshMe={refreshMe} unreadCount={unreadCount} notifications={notifications} onReadAll={readAll}/>}/>
    <Route path="/c/:slug" element={<ComplexPage me={me}/>}/>
    <Route path="/menu/:slug" element={<PublicMenuPage/>}/>
    <Route path="/admin/*" element={<AdminPage me={me} unreadCount={unreadCount} impersonate={impersonate} onImpersonate={setImpersonate}/>}/>
    <Route path="*" element={<div className="text-sm text-slate-500">Página no encontrada</div>}/>
  </Routes></Layout>);
}
