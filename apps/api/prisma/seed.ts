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
    update: { name: "Complejo Central", timezone: "America/La_Paz", currency: "BOB", nightStart: "18:00", nightEnd: "06:00", isActive: true },
    create: {
      tenantId: tenant.id,
      name: "Complejo Central",
      slug: "central",
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

  console.log(`Seed OK: admin=${admin.email} (password: ${adminPassword}) demoTenantAdmin=admin.demo@adcode.test (password: ${demoPassword}) tenant=${tenant.slug} complex=${complex.slug}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
