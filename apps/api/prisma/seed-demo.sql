INSERT INTO "User"(id,email,name,"isActive","createdAt","updatedAt") VALUES
('usr_admin_platform','admin@supernovatel.com','Platform Admin',true,now(),now())
ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, "isActive"=true;

INSERT INTO "Tenant"(id,name,slug,status,"maxComplexes","contactName","contactEmail","contactPhone","createdAt","updatedAt") VALUES
('ten_demo','Complejo Demo','demo-sports','ACTIVE',3,'Admin Demo','admin.demo@adcode.test','70000000',now(),now())
ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,"contactName"=EXCLUDED."contactName","contactEmail"=EXCLUDED."contactEmail";

INSERT INTO "ClientTier"(id,"tenantId",name,type,"discountPercent","discountAmount","allowVipBooking","creditLimit") VALUES
('tier_demo_n','ten_demo','Normal','NORMAL',NULL,NULL,false,NULL),
('tier_demo_h','ten_demo','Habitual','HABITUAL',5,NULL,true,500),
('tier_demo_p','ten_demo','Preferencial','PREFERENCIAL',10,NULL,true,1500)
ON CONFLICT ("tenantId", type) DO UPDATE SET name=EXCLUDED.name,"allowVipBooking"=EXCLUDED."allowVipBooking","discountPercent"=EXCLUDED."discountPercent","creditLimit"=EXCLUDED."creditLimit";

INSERT INTO "Complex"(id,"tenantId",name,slug,timezone,currency,"nightStart","nightEnd","isActive","createdAt","updatedAt") VALUES
('cpx_demo_central','ten_demo','Complejo Central','central','America/La_Paz','BOB','18:00','06:00',true,now(),now())
ON CONFLICT ("tenantId", slug) DO UPDATE SET name=EXCLUDED.name,timezone=EXCLUDED.timezone,currency=EXCLUDED.currency;

INSERT INTO "PaymentSettings"(id,"complexId","bankName","accountNumber","accountHolder",methods,"createdAt","updatedAt") VALUES
('payset_demo','cpx_demo_central','Banco Demo','000-123456','Complejo Demo',ARRAY['CASH','TRANSFER','QR']::"PaymentMethod"[],now(),now())
ON CONFLICT ("complexId") DO UPDATE SET "bankName"=EXCLUDED."bankName","accountNumber"=EXCLUDED."accountNumber","accountHolder"=EXCLUDED."accountHolder";

INSERT INTO "ModuleSubscription"(id,"tenantId","complexId",module,"startsAt","endsAt","createdAt","updatedAt") VALUES
('sub_demo_users','ten_demo',NULL,'USERS','2026-01-01T00:00:00Z','2027-12-31T23:59:59Z',now(),now()),
('sub_demo_scen','ten_demo',NULL,'SCENARIOS','2026-01-01T00:00:00Z','2027-12-31T23:59:59Z',now(),now()),
('sub_demo_sale','ten_demo',NULL,'SALES','2026-01-01T00:00:00Z','2027-12-31T23:59:59Z',now(),now()),
('sub_demo_inv','ten_demo',NULL,'INVENTORY','2026-01-01T00:00:00Z','2027-12-31T23:59:59Z',now(),now())
ON CONFLICT DO NOTHING;

INSERT INTO "ScenarioGroup"(id,"complexId",name,kind,"createdAt") VALUES
('sg_demo_canchas','cpx_demo_central','Canchas','CANCHA',now())
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name;

INSERT INTO "Scenario"(id,"complexId","groupId",name,"rentalFormat",exclusive,capacity,"minDuration","stepMinutes","isActive",photos,"availableDays","createdAt","updatedAt") VALUES
('scn_demo_fut1','cpx_demo_central','sg_demo_canchas','Cancha Fútbol 1','PER_HOUR',true,12,60,30,true,ARRAY[]::text[],ARRAY[0,1,2,3,4,5,6]::int[],now(),now())
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, "availableDays"=EXCLUDED."availableDays";

INSERT INTO "PricingRule"(id,"scenarioId",period,"pricePerHour") VALUES
('pr_demo_day','scn_demo_fut1','DAY',80),
('pr_demo_night','scn_demo_fut1','NIGHT',100)
ON CONFLICT DO NOTHING;

INSERT INTO "Warehouse"(id,"complexId",name,"createdAt") VALUES ('wh_demo','cpx_demo_central','Almacén Principal',now()) ON CONFLICT DO NOTHING;
INSERT INTO "WarehouseLocation"(id,"warehouseId",name) VALUES ('wloc_demo_1','wh_demo','Mostrador'),('wloc_demo_2','wh_demo','Depósito') ON CONFLICT DO NOTHING;
INSERT INTO "Kiosk"(id,"complexId","warehouseId",name,"isActive","createdAt") VALUES ('kiosk_demo','cpx_demo_central','wh_demo','Kiosco Principal',true,now()) ON CONFLICT DO NOTHING;
INSERT INTO "ProductCategory"(id,"complexId",name) VALUES ('cat_bebidas','cpx_demo_central','Bebidas') ON CONFLICT DO NOTHING;
INSERT INTO "Product"(id,"complexId","categoryId",name,cost,price,active,"createdAt","updatedAt") VALUES ('prod_agua','cpx_demo_central','cat_bebidas','Agua 500ml',3,6,true,now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO "StockLot"(id,"productId","warehouseId","locationId",qty,"unitCost","createdAt") VALUES ('lot_agua','prod_agua','wh_demo','wloc_demo_1',100,3,now()) ON CONFLICT DO NOTHING;

INSERT INTO "Membership"(id,"userId","tenantId",role,"complexIds","clientTier","createdAt","updatedAt")
SELECT 'mem_demo_admin','usr_admin_platform','ten_demo','TENANT_ADMIN',ARRAY[]::text[],'NORMAL',now(),now()
WHERE NOT EXISTS (SELECT 1 FROM "Membership" WHERE "userId"='usr_admin_platform' AND "tenantId"='ten_demo' AND role='TENANT_ADMIN');
