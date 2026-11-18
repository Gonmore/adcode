import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hashPw(pw: string) { return bcrypt.hash(pw, 10); }

async function main() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || "admin@supernovatel.com").toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME || "Platform Admin";
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || "Admin123!";
  const demoPassword = process.env.DEFAULT_USER_PASSWORD || "User123!";

  const adminHash = await hashPw(adminPassword);
  const demoHash = await hashPw(demoPassword);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, isActive: true, passwordHash: adminHash },
    create: { email, name, isActive: true, passwordHash: adminHash },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-sports" },
    update: { name: "Complejo Demo", contactName: "Admin Demo", contactEmail: "admin.demo@adcode.test", maxComplexes: 3 },
    create: {
      name: "Complejo Demo",
      slug: "demo-sports",
      status: "ACTIVE",
      maxComplexes: 3,
      contactName: "Admin Demo",
      contactEmail: "admin.demo@adcode.test",
      contactPhone: "70000000",
    },
  });

  for (const t of [
    { name: "Normal", type: "NORMAL" as const, allowVipBooking: false },
    { name: "Habitual", type: "HABITUAL" as const, allowVipBooking: true, discountPercent: 5, creditLimit: 500 },
    { name: "Preferencial", type: "PREFERENCIAL" as const, allowVipBooking: true, discountPercent: 10, creditLimit: 1500 },
  ]) {
    await prisma.clientTier.upsert({
      where: { tenantId_type: { tenantId: tenant.id, type: t.type } },
      update: { name: t.name, allowVipBooking: t.allowVipBooking, discountPercent: t.discountPercent as any, creditLimit: t.creditLimit as any },
      create: { tenantId: tenant.id, name: t.name, type: t.type, allowVipBooking: t.allowVipBooking, discountPercent: t.discountPercent as any, creditLimit: t.creditLimit as any },
    });
  }

  const contactUser = await prisma.user.upsert({
    where: { email: "admin.demo@adcode.test" },
    update: { name: "Admin Demo", isActive: true, passwordHash: demoHash },
    create: { email: "admin.demo@adcode.test", name: "Admin Demo", isActive: true, passwordHash: demoHash },
  });
  const existingContactMembership = await prisma.membership.findFirst({ where: { userId: contactUser.id, tenantId: tenant.id, role: "TENANT_ADMIN" } });
  if (!existingContactMembership) {
    await prisma.membership.create({ data: { userId: contactUser.id, tenantId: tenant.id, role: "TENANT_ADMIN", clientTier: "NORMAL" } });
  }

  const complex = await prisma.complex.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "central" } },
    update: { name: "Complejo Central", department: "Santa Cruz", timezone: "America/La_Paz", currency: "BOB", nightStart: "18:00", nightEnd: "06:00", isActive: true },
    create: {
      tenantId: tenant.id,
      name: "Complejo Central",
      slug: "central",
      department: "Santa Cruz",
      timezone: "America/La_Paz",
      currency: "BOB",
      nightStart: "18:00",
      nightEnd: "06:00",
      isActive: true,
      paymentSettings: {
        create: {
          bankName: "Banco Demo",
          accountNumber: "000-123456",
          accountHolder: "Complejo Demo",
          methods: ["CASH", "TRANSFER", "QR"],
        },
      },
    },
  });

  for (const module of ["USERS", "SCENARIOS", "SALES", "INVENTORY"] as const) {
    const existing = await prisma.moduleSubscription.findFirst({ where: { tenantId: tenant.id, complexId: null, module } });
    if (!existing) {
      await prisma.moduleSubscription.create({
        data: {
          tenantId: tenant.id,
          complexId: null,
          module,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: new Date("2027-12-31T23:59:59.000Z"),
        },
      });
    }
  }

  let group = await prisma.scenarioGroup.findFirst({ where: { complexId: complex.id, name: "Canchas" } });
  if (!group) group = await prisma.scenarioGroup.create({ data: { complexId: complex.id, name: "Canchas", kind: "CANCHA" } });

  let scenario = await prisma.scenario.findFirst({ where: { complexId: complex.id, name: "Cancha Fútbol 1" } });
  if (!scenario) {
    scenario = await prisma.scenario.create({
      data: {
        complexId: complex.id,
        groupId: group.id,
        name: "Cancha Fútbol 1",
        rentalFormat: "PER_HOUR",
        exclusive: true,
        capacity: 12,
        minDuration: 60,
        stepMinutes: 30,
        isActive: true,
      },
    });
  }
  if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario.id, period: "DAY" } }))) {
    await prisma.pricingRule.create({ data: { scenarioId: scenario.id, period: "DAY", pricePerHour: 80 } });
  }
  if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario.id, period: "NIGHT" } }))) {
    await prisma.pricingRule.create({ data: { scenarioId: scenario.id, period: "NIGHT", pricePerHour: 100 } });
  }

  const warehouse = (await prisma.warehouse.findFirst({ where: { complexId: complex.id, name: "Almacén Principal" } })) ||
    (await prisma.warehouse.create({ data: { complexId: complex.id, name: "Almacén Principal", locations: { create: [{ name: "Mostrador" }, { name: "Depósito" }] } } }));
  const kiosk = (await prisma.kiosk.findFirst({ where: { complexId: complex.id, name: "Kiosco Principal" } })) ||
    (await prisma.kiosk.create({ data: { complexId: complex.id, warehouseId: warehouse.id, name: "Kiosco Principal", isActive: true } }));
  const category = (await prisma.productCategory.findFirst({ where: { name: "Bebidas" } })) || (await prisma.productCategory.create({ data: { name: "Bebidas" } }));
  let product = await prisma.product.findFirst({ where: { name: "Agua 500ml" } });
  if (!product) product = await prisma.product.create({ data: { categoryId: category.id, name: "Agua 500ml", cost: 3, price: 6, active: true } });
  const loc = await prisma.warehouseLocation.findFirst({ where: { warehouseId: warehouse.id } });
  if (!(await prisma.stockLot.findFirst({ where: { productId: product.id, warehouseId: warehouse.id } }))) {
    await prisma.stockLot.create({ data: { productId: product.id, warehouseId: warehouse.id, locationId: loc?.id, qty: 100, unitCost: 3 } });
  }


  // ---- Escenarios adicionales ----
  let scenario2 = await prisma.scenario.findFirst({ where: { complexId: complex.id, name: "Cancha Fútbol 2" } });
  if (!scenario2) {
    scenario2 = await prisma.scenario.create({ data: { complexId: complex.id, groupId: group.id, name: "Cancha Fútbol 2", rentalFormat: "PER_HOUR", exclusive: true, capacity: 10, minDuration: 60, stepMinutes: 30, isActive: true } });
    if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario2.id, period: "DAY" } }))) await prisma.pricingRule.create({ data: { scenarioId: scenario2.id, period: "DAY", pricePerHour: 70 } });
    if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario2.id, period: "NIGHT" } }))) await prisma.pricingRule.create({ data: { scenarioId: scenario2.id, period: "NIGHT", pricePerHour: 90 } });
  }
  let scenario3 = await prisma.scenario.findFirst({ where: { complexId: complex.id, name: "Cancha Tenis" } });
  if (!scenario3) {
    scenario3 = await prisma.scenario.create({ data: { complexId: complex.id, groupId: group.id, name: "Cancha Tenis", rentalFormat: "PER_HOUR", exclusive: true, capacity: 4, minDuration: 60, stepMinutes: 30, isActive: true } });
    if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario3.id, period: "DAY" } }))) await prisma.pricingRule.create({ data: { scenarioId: scenario3.id, period: "DAY", pricePerHour: 50 } });
    if (!(await prisma.pricingRule.findFirst({ where: { scenarioId: scenario3.id, period: "NIGHT" } }))) await prisma.pricingRule.create({ data: { scenarioId: scenario3.id, period: "NIGHT", pricePerHour: 65 } });
  }

  // ---- Productos adicionales ----
  const catSnacks = (await prisma.productCategory.findFirst({ where: { name: "Snacks" } })) || (await prisma.productCategory.create({ data: { name: "Snacks" } }));
  const products = [
    { name: "Gatorade 500ml", cost: 5, price: 10, category: category.id },
    { name: "Coca Cola 600ml", cost: 4, price: 8, category: category.id },
    { name: "Papas fritas", cost: 3, price: 7, category: catSnacks.id },
    { name: "Chocolate", cost: 2, price: 5, category: catSnacks.id },
  ];
  for (const p of products) {
    let prod = await prisma.product.findFirst({ where: { name: p.name } });
    if (!prod) prod = await prisma.product.create({ data: { categoryId: p.category, name: p.name, cost: p.cost, price: p.price, active: true } });
    if (!(await prisma.stockLot.findFirst({ where: { productId: prod.id, warehouseId: warehouse.id } }))) {
      const loc2 = await prisma.warehouseLocation.findFirst({ where: { warehouseId: warehouse.id } });
      await prisma.stockLot.create({ data: { productId: prod.id, warehouseId: warehouse.id, locationId: loc2?.id, qty: 50, unitCost: p.cost } });
    }
    if (!(await prisma.productPresentation.findFirst({ where: { productId: prod.id } }))) {
      await prisma.productPresentation.create({ data: { productId: prod.id, name: "Unidad", unitsPerPack: 1, cost: p.cost, price: p.price } });
    }
  }

  // ---- Reservas de ejemplo (pasadas y futuras) ----
  const scenarios = [scenario, scenario2, scenario3].filter(Boolean) as any[];
  const today = new Date();
  for (let i = -3; i <= 5; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i); d.setHours(0,0,0,0);
    const sc = scenarios[((i % scenarios.length) + scenarios.length) % scenarios.length];
    const start = new Date(d); start.setHours(10,0,0,0);
    const end = new Date(d); end.setHours(11,30,0,0);
    const exists = await prisma.reservation.findFirst({ where: { scenarioId: sc.id, startAt: start } });
    if (!exists) {
      await prisma.reservation.create({ data: { code: "ADC-" + Math.random().toString(36).slice(2,8).toUpperCase(), complexId: complex.id, scenarioId: sc.id, startAt: start, endAt: end, status: i < 0 ? "COMPLETED" : (i === 0 ? "CONFIRMED" : "PENDING_CONFIRMATION"), clientName: `Cliente ${i+4}`, people: 2 + (i % 4), totalAmount: 80 + (i % 3) * 20, priceSubtotal: 80 + (i % 3) * 20 } });
    }
  }

  // ---- Ventas de ejemplo ----
  const prods = await prisma.product.findMany({ take: 3 });
  for (let i = 0; i < 8; i++) {
    const d = new Date(today); d.setDate(today.getDate() - (i % 5)); d.setHours(12 + (i % 6), 0, 0, 0);
    const lines = prods.slice(0, 1 + (i % prods.length)).map((p:any) => ({ productId: p.id, presentationId: (p.presentations?.[0]?.id) || null, qty: 1 + (i % 3), unitPrice: Number(p.price),  }));
    const total = lines.reduce((a:any,l:any)=>a + l.unitPrice * l.qty, 0);
    await prisma.order.create({ data: { complexId: complex.id, status: "PAID", total: total as any, lines: { create: lines.map((l:any) => ({ productId: l.productId, presentationId: l.presentationId, qty: l.qty, unitPrice: l.unitPrice as any })) } } });
    await prisma.financialTransaction.create({ data: { complexId: complex.id, type: "INCOME", source: "SALE", amount: total as any, occurredAt: d, note: "Venta demo" } });
  }

  // ---- Mantenimiento de ejemplo ----
  const maint = await prisma.maintenance.findFirst({ where: { complexId: complex.id } });
  if (!maint) {
    const mStart = new Date(today); mStart.setDate(today.getDate() + 7); mStart.setHours(6,0,0,0);
    const mEnd = new Date(mStart); mEnd.setHours(8,0,0,0);
    await prisma.maintenance.create({ data: { complexId: complex.id, scenarioId: scenario.id, type: "MONTHLY", startAt: mStart, endAt: mEnd, reason: "Mantenimiento preventivo", cost: 150 } });
    await prisma.financialTransaction.create({ data: { complexId: complex.id, type: "EXPENSE", source: "MAINTENANCE", amount: 150, occurredAt: mStart, note: "Mantenimiento preventivo" } });
  }

  // ---- Movimiento de inventario de ejemplo ----
  const wh2 = await prisma.warehouse.findFirst({ where: { complexId: complex.id, name: "Almacén 2" } }) || await prisma.warehouse.create({ data: { complexId: complex.id, name: "Almacén 2", locations: { create: [{ name: "Estante A" }] } } });
  const prod0 = await prisma.product.findFirst({ where: { name: "Agua 500ml" } });
  const pres0 = prod0 ? await prisma.productPresentation.findFirst({ where: { productId: prod0.id } }) : null;
  if (prod0 && pres0) {
    await prisma.stockMovement.create({ data: { complexId: complex.id, type: "TRANSFER_OUT", productId: prod0.id, presentationId: pres0.id, qty: 10, fromWarehouseId: warehouse.id, toWarehouseId: wh2.id, refType: "TRANSFER", note: "Reabastecimiento" } });
  }

  console.log(`Seed OK: admin=${admin.email} (password: ${adminPassword}) demoTenantAdmin=admin.demo@adcode.test (password: ${demoPassword}) tenant=${tenant.slug} complex=${complex.slug}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
