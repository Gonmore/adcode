import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { getRuntimeConfig } from "../lib/config";
import { apiFetch } from "../lib/api";

type Me = { id: string; email: string; name?: string | null; memberships?: any[]; isPlatformAdmin?: boolean };

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

function Layout({ children, me, onLogout }: { children: React.ReactNode; me: Me | null; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const cfg = getRuntimeConfig();
  const sntLogo = theme === "dark" ? "/brand/snt-blanco.png" : "/brand/snt-azul.png";
  const navItems = [
    { to: "/", label: "Inicio" },
    { to: "/c/central", label: "Complejo demo" },
    { to: "/admin", label: "Admin" },
  ];
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
          <button className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Abrir menú" onClick={() => setMenuOpen((v) => !v)}>
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current mb-1" />
            <span className="block w-5 h-0.5 bg-current" />
          </button>
          <Link to="/" className="flex items-center justify-center" aria-label="Inicio">
            <img src="/brand/logo.png" alt={cfg.appName} className="h-9 w-9 object-contain" />
          </Link>
          <div className="relative">
            <button className="h-9 w-9 rounded-full bg-brand text-white font-semibold flex items-center justify-center" aria-label="Usuario" onClick={() => setUserMenuOpen((v) => !v)}>
              {(me?.name || me?.email || "A").slice(0, 1).toUpperCase()}
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-1 text-sm">
                <div className="px-3 py-2 text-xs text-slate-500 truncate">{me ? me.email : "Sin sesión"}</div>
                <button onClick={() => { toggle(); setUserMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Cambiar tema ({theme === "dark" ? "oscuro" : "claro"})</button>
                <button className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60 cursor-not-allowed">Editar perfil</button>
                <button onClick={() => { setUserMenuOpen(false); onLogout(); }} className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-red-600">Cerrar sesión</button>
              </div>
            )}
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
            <div className="mx-auto max-w-6xl px-4 py-2 flex flex-col">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `px-2 py-2 rounded ${isActive ? "bg-slate-100 dark:bg-slate-800 font-medium" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-4">
        <div className="mx-auto max-w-6xl flex items-center justify-center gap-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
          <span>POWERED by</span>
          <img src={sntLogo} alt="Supernovatel" className="h-5 sm:h-6 object-contain" />
        </div>
      </footer>
    </div>
  );
}

function HomePage({ me, refreshMe }: { me: Me | null; refreshMe: () => Promise<void> }) {
  const [authConfig, setAuthConfig] = useState<{ googleAuthEnabled: boolean; devLoginEnabled: boolean } | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [email, setEmail] = useState("admin@supernovatel.com");
  const [msg, setMsg] = useState<string>("");
  useEffect(() => {
    apiFetch<any>("/auth/config").then(setAuthConfig).catch(() => setAuthConfig({ googleAuthEnabled: false, devLoginEnabled: false }));
    apiFetch<any>("/health").then(setHealth).catch(() => setHealth(null));
  }, []);
  async function devLogin(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await apiFetch("/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) });
      await refreshMe();
      setMsg("Sesión iniciada.");
    } catch (err: any) {
      setMsg(err.message || "Error de login");
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <h1 className="text-2xl font-semibold mb-2">AdCoDe v1.0 (pruebas)</h1>
        <p className="text-slate-600 dark:text-slate-300">Administración de complejos deportivos: reservas, escenarios, ventas, inventario y reportes.</p>
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <a href={authConfig?.googleAuthEnabled ? "/api/v1/auth/google/start" : undefined} onClick={(e) => { if (!authConfig?.googleAuthEnabled) e.preventDefault(); }} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 ${authConfig?.googleAuthEnabled ? "" : "opacity-50 cursor-not-allowed"}`}>
            <img src="/brand/google-g.png" alt="Google" className="h-5 w-5" /> Continuar con Google
          </a>
          <Link to="/c/central" className="inline-flex items-center rounded-md bg-brand text-white px-4 py-2">Ver complejo demo</Link>
        </div>
        {authConfig?.devLoginEnabled && !me && (
          <form onSubmit={devLogin} className="mt-4 flex flex-col sm:flex-row gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="border rounded-md px-3 py-2 bg-transparent flex-1" placeholder="Email para login dev" />
            <button className="rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-4 py-2">Login desarrollo</button>
          </form>
        )}
        {msg && <p className="text-sm mt-2">{msg}</p>}
        <p className="mt-3 text-xs text-slate-500">API: {health?.ok ? `OK (${health.version || "dev"})` : "sin conexión"} · Google: {authConfig?.googleAuthEnabled ? "configurado" : "pendiente"} · Dev login: {authConfig?.devLoginEnabled ? "habilitado" : "deshabilitado"} · Sesión: {me ? `${me.email}${me.isPlatformAdmin ? " (platform admin)" : ""}` : "no iniciada"}</p>
      </section>
      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[ ["Escenarios", "Precios día/noche, disponibilidad y mantenimientos."], ["Reservas", "Hold 15 min, estados y confirmación de pago."], ["Ventas e inventario", "Kioscos, menú, productos y stock."], ["Reportes", "Ingresos vs egresos y resumen operativo."], ["Multi-tenant", "Tenants, complejos, módulos y usuarios por rol."], ["PWA", "Instalable, tema claro/oscuro y layout móvil."] ].map(([t,d]) => (
          <div key={t} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><h2 className="font-medium mb-1">{t}</h2><p className="text-sm text-slate-600 dark:text-slate-300">{d}</p></div>
        ))}
      </section>
    </div>
  );
}

function ComplexPage() {
  const { slug } = useParams();
  const complexSlug = slug || "central";
  const [complex, setComplex] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);
  const [form, setForm] = useState({ scenarioId: "", date: new Date().toISOString().slice(0,10), start: "10:00", end: "11:00", clientName: "" });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    apiFetch<any>(`/complexes/${complexSlug}`).then(r => setComplex(r.data)).catch(() => {});
    apiFetch<any>(`/scenarios?slug=${complexSlug}`).then(r => setScenarios(r.data || [])).catch(() => setScenarios([]));
    apiFetch<any>(`/sales/menu/${complexSlug}`).then(r => setMenu(r.data?.items || [])).catch(() => setMenu([]));
  }, [complexSlug]);
  useEffect(() => { if (scenarios[0] && !form.scenarioId) setForm(f => ({ ...f, scenarioId: scenarios[0].id })); }, [scenarios]);
  async function createReservation(e: FormEvent) {
    e.preventDefault(); setErr(""); setResult(null);
    try {
      const startAt = new Date(`${form.date}T${form.start}:00`).toISOString();
      const endAt = new Date(`${form.date}T${form.end}:00`).toISOString();
      const r = await apiFetch<any>("/reservations", { method: "POST", body: JSON.stringify({ scenarioId: form.scenarioId, startAt, endAt, clientName: form.clientName || undefined }) });
      setResult(r);
    } catch (e: any) { setErr(e.message || "Error creando reserva"); }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{complex?.name || `Complejo: ${complexSlug}`}</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="font-medium">Escenarios y reserva</h2>
          {scenarios.length === 0 ? <p className="text-sm text-slate-500">Sin escenarios cargados (verifica seed/migraciones).</p> : (
            <form onSubmit={createReservation} className="space-y-2 text-sm">
              <select value={form.scenarioId} onChange={e=>setForm({...form, scenarioId:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent">{scenarios.map(s => <option key={s.id} value={s.id}>{s.name} ({s.rentalFormat})</option>)}</select>
              <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent" />
              <div className="grid grid-cols-2 gap-2"><input type="time" value={form.start} onChange={e=>setForm({...form,start:e.target.value})} className="border rounded px-2 py-2 bg-transparent" /><input type="time" value={form.end} onChange={e=>setForm({...form,end:e.target.value})} className="border rounded px-2 py-2 bg-transparent" /></div>
              <input placeholder="Nombre cliente (opcional)" value={form.clientName} onChange={e=>setForm({...form,clientName:e.target.value})} className="w-full border rounded px-2 py-2 bg-transparent" />
              <div className="flex gap-2 pt-1">
                <button className="rounded-md bg-brand text-white px-4 py-2">Confirmar reserva</button>
                <span className="inline-block" title="No requiere pago anticipado"><button type="button" disabled className="rounded-md border px-4 py-2 opacity-50 cursor-not-allowed">Reserva VIP</button></span>
              </div>
              <p className="text-xs text-slate-500">Para clientes habituales y preferenciales</p>
            </form>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {result?.data && (
            <div className="text-sm rounded border p-3 space-y-1">
              <div><b>Código:</b> {result.data.code}</div>
              <div><b>Estado:</b> {result.data.status}</div>
              <div><b>Total:</b> {result.data.totalAmount} {complex?.currency || "BOB"}</div>
              <div><b>Hold:</b> {result.holdMinutes ? `${result.holdMinutes} min` : "N/A"}</div>
              {result.data.conversation?.id && <div className="text-xs text-slate-500">Conversación creada (chat/comprobante pendiente de UI completa).</div>}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h2 className="font-medium mb-2">Menú digital / stock (demo)</h2>
          {menu.length === 0 ? <p className="text-sm text-slate-500">Sin productos/stock disponibles.</p> : (
            <ul className="space-y-2 text-sm">{menu.map((m:any)=> <li key={m.id} className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1"><span>{m.name}</span><span>{m.price} · stock {m.stock}</span></li>)}</ul>
          )}
          <div className="mt-4 text-xs text-slate-500">Los comprobantes/QR de pago se muestran en el flujo completo de reserva (backend listo para estados y chat de reserva).</div>
        </div>
      </div>
    </div>
  );
}

function AdminPage({ me }: { me: Me | null }) {
  const [summary, setSummary] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [complexes, setComplexes] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [tenantForm, setTenantForm] = useState({ name: "", slug: "", contactName: "", contactEmail: "", maxComplexes: 1 });
  async function load() {
    setErr("");
    apiFetch<any>("/reports/summary").then(setSummary).catch(() => setSummary(null));
    apiFetch<any>("/complexes").then(r => setComplexes(r.data || [])).catch(()=>setComplexes([]));
    if (me?.isPlatformAdmin) {
      apiFetch<any>("/platform/tenants").then(r => setTenants(r.data || [])).catch((e) => { setTenants([]); setErr(e.message); });
    }
  }
  useEffect(() => { load(); }, [me?.isPlatformAdmin]);
  async function createTenant(e: FormEvent) {
    e.preventDefault(); setErr("");
    try {
      await apiFetch("/platform/tenants", { method: "POST", body: JSON.stringify({ ...tenantForm, maxComplexes: Number(tenantForm.maxComplexes) }) });
      setTenantForm({ name: "", slug: "", contactName: "", contactEmail: "", maxComplexes: 1 });
      await load();
    } catch (e: any) { setErr(e.message || "Error"); }
  }
  const cards = [["Tenants", summary?.data?.tenants ?? "-"], ["Complejos", summary?.data?.complexes ?? "-"], ["Reservas", summary?.data?.reservations ?? "-"], ["Transacciones", summary?.data?.transactions ?? "-"], ["Ingresos", summary?.data?.income ?? "-"], ["Egresos", summary?.data?.expense ?? "-"]];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Panel de administración</h1>
      {!me && <p className="text-sm text-amber-600">Inicia sesión (login desarrollo en Inicio) para acciones administrativas.</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(([label, value]) => (<div key={label as string} className="rounded-xl border bg-white dark:bg-slate-900 p-4"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold mt-1">{String(value)}</div></div>))}
      </div>
      {me?.isPlatformAdmin && (
        <div className="grid md:grid-cols-2 gap-4">
          <form onSubmit={createTenant} className="rounded-xl border bg-white dark:bg-slate-900 p-4 space-y-2">
            <h2 className="font-medium">Crear tenant (platform admin)</h2>
            <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Nombre" value={tenantForm.name} onChange={e=>setTenantForm({...tenantForm,name:e.target.value})} />
            <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="slug (a-z0-9-)" value={tenantForm.slug} onChange={e=>setTenantForm({...tenantForm,slug:e.target.value})} />
            <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto nombre" value={tenantForm.contactName} onChange={e=>setTenantForm({...tenantForm,contactName:e.target.value})} />
            <input className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Contacto email" value={tenantForm.contactEmail} onChange={e=>setTenantForm({...tenantForm,contactEmail:e.target.value})} />
            <input type="number" min={1} className="w-full border rounded px-2 py-2 bg-transparent" placeholder="Máx complejos" value={tenantForm.maxComplexes} onChange={e=>setTenantForm({...tenantForm,maxComplexes:Number(e.target.value)})} />
            <button className="rounded-md bg-brand text-white px-4 py-2">Crear tenant</button>
          </form>
          <div className="rounded-xl border bg-white dark:bg-slate-900 p-4">
            <h2 className="font-medium mb-2">Tenants</h2>
            {tenants.length===0 ? <p className="text-sm text-slate-500">Sin tenants o sin permisos.</p> : <ul className="text-sm space-y-2">{tenants.map(t=> <li key={t.id} className="border-b pb-1"><b>{t.name}</b> <span className="text-slate-500">({t.slug})</span> · complejos {t.complexes?.length||0}/{t.maxComplexes}</li>)}</ul>}
          </div>
        </div>
      )}
      <div className="rounded-xl border bg-white dark:bg-slate-900 p-4">
        <h2 className="font-medium mb-2">Complejos</h2>
        {complexes.length===0 ? <p className="text-sm text-slate-500">Sin complejos visibles.</p> : <ul className="text-sm space-y-1">{complexes.map(c=> <li key={c.id}><b>{c.name}</b> <span className="text-slate-500">/{c.slug}</span> · {c.tenant?.name||""}</li>)}</ul>}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="text-xs text-slate-500">v1.0-test: API y modelo de datos implementados para flujos base (auth dev, tenants/complejos, escenarios/disponibilidad, reservas/pagos/chat, ventas/inventario básico, reportes). Algunas pantallas avanzadas quedan para iteraciones siguientes.</div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  async function refreshMe() {
    try { const r = await apiFetch<any>("/auth/me"); setMe(r.user || null); } catch { setMe(null); }
  }
  async function logout() {
    try { await apiFetch("/auth/logout", { method: "POST" }); } catch {}
    setMe(null);
  }
  useEffect(() => { refreshMe(); }, []);
  return (
    <Layout me={me} onLogout={logout}>
      <Routes>
        <Route path="/" element={<HomePage me={me} refreshMe={refreshMe} />} />
        <Route path="/c/:slug" element={<ComplexPage />} />
        <Route path="/admin/*" element={<AdminPage me={me} />} />
        <Route path="*" element={<div className="text-sm text-slate-500">Página no encontrada</div>} />
      </Routes>
    </Layout>
  );
}