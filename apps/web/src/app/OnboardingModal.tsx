import { useState, useEffect, FormEvent } from "react";
import { apiFetch } from "../lib/api";

const DEPARTMENTS = ["La Paz","Cochabamba","Santa Cruz","Oruro","Potosí","Chuquisaca","Tarija","Beni","Pando"] as const;

function slugify(s: string){ return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""); }

const STEPS = [
  { key: "complex", label: "Complejo", emoji: "🏟️", desc: "Crea tu primer complejo deportivo" },
  { key: "scenario", label: "Escenario", emoji: "⚽", desc: "Crea un escenario (cancha) para alquilar" },
  { key: "warehouse", label: "Almacén", emoji: "📦", desc: "Crea un almacén y ubicaciones" },
  { key: "product", label: "Producto", emoji: "🛒", desc: "Crea tu primer producto" },
  { key: "stock", label: "Stock", emoji: "📊", desc: "Registra stock del producto" },
] as const;

export default function OnboardingModal({ open, tenantId, onClose, onComplete }: { open: boolean; tenantId: string; onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [created, setCreated] = useState<any>({});

  // Form states
  const [cForm, setCForm] = useState<any>({ name: "", slug: "", department: "Santa Cruz", timezone: "America/La_Paz", currency: "BOB", openTime: "08:00", closeTime: "22:00", allowClientPayLater: false });
  const [sForm, setSForm] = useState<any>({ name: "", rentalFormat: "PER_HOUR", priceDay: 80, priceNight: 100 });
  const [whForm, setWhForm] = useState<any>({ name: "", locations: "" });
  const [pForm, setPForm] = useState<any>({ name: "", cost: 0, price: 0, presentationName: "Unidad" });
  const [stockForm, setStockForm] = useState<any>({ qty: 10, unitCost: 0 });

  useEffect(() => {
    if (open) {
      setStep(0); setBusy(false); setErr(""); setDone(false); setCreated({});
      setCForm({ name: "", slug: "", department: "Santa Cruz", timezone: "America/La_Paz", currency: "BOB", openTime: "08:00", closeTime: "22:00", allowClientPayLater: false });
      setSForm({ name: "", rentalFormat: "PER_HOUR", priceDay: 80, priceNight: 100 });
      setWhForm({ name: "", locations: "" });
      setPForm({ name: "", cost: 0, price: 0, presentationName: "Unidad" });
      setStockForm({ qty: 10, unitCost: 0 });
    }
  }, [open]);

  if (!open) return null;

  async function next() {
    setErr(""); setBusy(true);
    try {
      if (step === 0) {
        // Create complex
        const slug = cForm.slug || slugify(cForm.name);
        if (!slug || slug.length < 2) throw new Error("Nombre inválido");
        const r = await apiFetch<any>("/complexes", { method: "POST", body: JSON.stringify({ ...cForm, slug, tenantId, openTime: cForm.openTime || "08:00", closeTime: cForm.closeTime || "22:00" }) });
        setCreated((c: any) => ({ ...c, complex: r.data }));
      } else if (step === 1) {
        // Create scenario
        const pricing: any[] = [{ period: "DAY", pricePerHour: Number(sForm.priceDay || 0) }, { period: "NIGHT", pricePerHour: Number(sForm.priceNight || 0) }];
        const r = await apiFetch<any>("/scenarios", { method: "POST", body: JSON.stringify({ complexId: created.complex.id, name: sForm.name, rentalFormat: sForm.rentalFormat, availableDays: [0,1,2,3,4,5,6], pricing }) });
        setCreated((c: any) => ({ ...c, scenario: r.data }));
      } else if (step === 2) {
        // Create warehouse
        const locs = (whForm.locations || "").split(",").map((x: string) => x.trim()).filter(Boolean);
        const r = await apiFetch<any>("/inventory/warehouses", { method: "POST", body: JSON.stringify({ complexId: created.complex.id, name: whForm.name, locations: locs }) });
        setCreated((c: any) => ({ ...c, warehouse: r.data }));
      } else if (step === 3) {
        // Create product
        const r = await apiFetch<any>("/inventory/products", { method: "POST", body: JSON.stringify({ complexId: created.complex.id, name: pForm.name, cost: Number(pForm.cost || 0), price: Number(pForm.price || 0), presentations: [{ name: pForm.presentationName || "Unidad", unitsPerPack: 1, cost: Number(pForm.cost || 0), price: Number(pForm.price || 0) }] }) });
        setCreated((c: any) => ({ ...c, product: r.data }));
      } else if (step === 4) {
        // Add stock
        const pres = created.product.presentations?.[0];
        if (!pres) throw new Error("Producto sin presentación");
        await apiFetch("/inventory/stock/in", { method: "POST", body: JSON.stringify({ complexId: created.complex.id, warehouseId: created.warehouse.id, locationId: created.warehouse.locations?.[0]?.id || null, items: [{ productId: created.product.id, presentationId: pres.id, qty: Number(stockForm.qty || 1), unitCost: Number(stockForm.unitCost || 0) }] }) });
        setDone(true);
      }
      if (step < 4) setStep(step + 1);
    } catch (e: any) {
      setErr(e.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    onComplete();
    onClose();
  }

  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">🧩 Configuración inicial</h2>
            {!done && <button onClick={onClose} className="text-sm px-2 py-1 rounded border text-slate-500">Saltar</button>}
          </div>
          {/* Progress bar */}
          <div className="mt-3 flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.key} className={`flex-1 h-2 rounded-full ${i < step ? "bg-green-500" : i === step ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
          <div className="mt-1 text-xs text-slate-500 text-center">Paso {step + 1} de 5</div>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h3 className="text-xl font-bold text-green-600">¡Todo listo!</h3>
            <p className="text-sm text-slate-500">Tu complejo está configurado y listo para recibir reservas.</p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-left text-sm space-y-1">
              <div>🏟️ Complejo: <b>{created.complex?.name}</b></div>
              <div>⚽ Escenario: <b>{created.scenario?.name}</b></div>
              <div>📦 Almacén: <b>{created.warehouse?.name}</b></div>
              <div>🛒 Producto: <b>{created.product?.name}</b></div>
              <div>📊 Stock: <b>{stockForm.qty}</b> unidades</div>
            </div>
            <button onClick={finish} className="w-full rounded-md bg-green-600 text-white px-4 py-2.5 font-medium">Ir a Reservas →</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Step indicator */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-2xl">{current.emoji}</div>
              <div>
                <h3 className="font-semibold">{current.label}</h3>
                <p className="text-xs text-slate-500">{current.desc}</p>
              </div>
            </div>

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded p-2">{err}</div>}

            {/* Step 0: Complex */}
            {step === 0 && <div className="space-y-2 text-sm">
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre del complejo (ej. Complejo Deportivo Central)" value={cForm.name} onChange={e => { const name = e.target.value; setCForm({ ...cForm, name, slug: slugify(name) }); }} />
              <div className="text-xs text-slate-500">Slug: <span className="font-mono">{cForm.slug || "—"}</span></div>
              <div className="grid grid-cols-2 gap-2">
                <select className="border rounded px-3 py-2 bg-transparent" value={cForm.department} onChange={e => setCForm({ ...cForm, department: e.target.value })}>{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select>
                <input className="border rounded px-3 py-2 bg-transparent" value={cForm.currency} onChange={e => setCForm({ ...cForm, currency: e.target.value })} placeholder="Moneda (BOB)" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Hora apertura<input type="time" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={cForm.openTime} onChange={e => setCForm({ ...cForm, openTime: e.target.value })} /></label>
                <label className="text-xs">Hora cierre<input type="time" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={cForm.closeTime} onChange={e => setCForm({ ...cForm, closeTime: e.target.value })} /></label>
              </div>
            </div>}

            {/* Step 1: Scenario */}
            {step === 1 && <div className="space-y-2 text-sm">
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre del escenario (ej. Cancha 1)" value={sForm.name} onChange={e => setSForm({ ...sForm, name: e.target.value })} />
              <select className="w-full border rounded px-3 py-2 bg-transparent" value={sForm.rentalFormat} onChange={e => setSForm({ ...sForm, rentalFormat: e.target.value })}>
                <option value="PER_HOUR">Por hora</option>
                <option value="PER_PERSON">Por persona</option>
                <option value="MIXED">Mixto</option>
                <option value="FLAT_BLOCK">Bloque fijo</option>
              </select>
              {(sForm.rentalFormat === "PER_HOUR" || sForm.rentalFormat === "MIXED") && <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Precio/hora día<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={sForm.priceDay} onChange={e => setSForm({ ...sForm, priceDay: Number(e.target.value) })} /></label>
                <label className="text-xs">Precio/hora noche<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={sForm.priceNight} onChange={e => setSForm({ ...sForm, priceNight: Number(e.target.value) })} /></label>
              </div>}
            </div>}

            {/* Step 2: Warehouse */}
            {step === 2 && <div className="space-y-2 text-sm">
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre del almacén (ej. Almacén Principal)" value={whForm.name} onChange={e => setWhForm({ ...whForm, name: e.target.value })} />
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Ubicaciones separadas por coma (ej. Estante A, Estante B)" value={whForm.locations} onChange={e => setWhForm({ ...whForm, locations: e.target.value })} />
              <p className="text-xs text-slate-500">Las ubicaciones son opcionales pero ayudan a organizar el inventario.</p>
            </div>}

            {/* Step 3: Product */}
            {step === 3 && <div className="space-y-2 text-sm">
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre del producto (ej. Pelota de fútbol)" value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Costo unitario<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={pForm.cost} onChange={e => setPForm({ ...pForm, cost: Number(e.target.value) })} /></label>
                <label className="text-xs">Precio de venta<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={pForm.price} onChange={e => setPForm({ ...pForm, price: Number(e.target.value) })} /></label>
              </div>
              <input className="w-full border rounded px-3 py-2 bg-transparent" placeholder="Nombre de presentación (ej. Unidad)" value={pForm.presentationName} onChange={e => setPForm({ ...pForm, presentationName: e.target.value })} />
            </div>}

            {/* Step 4: Stock */}
            {step === 4 && <div className="space-y-2 text-sm">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-xs">
                <b>Producto:</b> {created.product?.name} · <b>Almacén:</b> {created.warehouse?.name}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Cantidad<input type="number" min={1} className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={stockForm.qty} onChange={e => setStockForm({ ...stockForm, qty: Number(e.target.value) })} /></label>
                <label className="text-xs">Costo unitario<input type="number" step="0.01" className="w-full border rounded px-3 py-2 bg-transparent mt-1" value={stockForm.unitCost} onChange={e => setStockForm({ ...stockForm, unitCost: Number(e.target.value) })} /></label>
              </div>
            </div>}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {step > 0 && <button onClick={() => { setStep(step - 1); setErr(""); }} className="rounded-md border px-4 py-2 text-sm">← Atrás</button>}
              <button onClick={next} disabled={busy} className="flex-1 rounded-md bg-indigo-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
                {busy ? "Guardando..." : step === 4 ? "Registrar stock" : "Siguiente →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}