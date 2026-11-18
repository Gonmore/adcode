-- Sales/Inventory v2: presentations, suppliers, scoped catalog, stock by presentation/location, movements, entries

-- Supplier
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "complexId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Supplier_complexId_idx" ON "Supplier"("complexId");

-- ProductCategory
ALTER TABLE "ProductCategory" ADD COLUMN IF NOT EXISTS "complexId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductCategory_complexId_idx" ON "ProductCategory"("complexId");

-- Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "complexId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "notes" TEXT;
CREATE INDEX IF NOT EXISTS "Product_complexId_active_idx" ON "Product"("complexId","active");

-- ProductPresentation
ALTER TABLE "ProductPresentation" ADD COLUMN IF NOT EXISTS "cost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ProductPresentation" ADD COLUMN IF NOT EXISTS "price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ProductPresentation" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
-- backfill presentation cost/price from product when zero
UPDATE "ProductPresentation" pp SET "cost" = p."cost", "price" = p."price"
FROM "Product" p WHERE p.id = pp."productId" AND pp."cost" = 0 AND pp."price" = 0;
CREATE INDEX IF NOT EXISTS "ProductPresentation_productId_active_idx" ON "ProductPresentation"("productId","active");

-- OrderLine
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;

-- StockLot
ALTER TABLE "StockLot" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
CREATE INDEX IF NOT EXISTS "StockLot_presentationId_warehouseId_locationId_idx" ON "StockLot"("presentationId","warehouseId","locationId");
-- backfill lot presentation: pick first presentation of product when unambiguous
UPDATE "StockLot" sl SET "presentationId" = sub.pid
FROM (
  SELECT p.id as product_id, MIN(pp.id) as pid, COUNT(*) as cnt
  FROM "Product" p JOIN "ProductPresentation" pp ON pp."productId" = p.id
  GROUP BY p.id
) sub
WHERE sl."productId" = sub.product_id AND sl."presentationId" IS NULL AND sub.cnt = 1;

-- StockMovement
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "complexId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "presentationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(12,2);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(12,2);
CREATE INDEX IF NOT EXISTS "StockMovement_complexId_createdAt_idx" ON "StockMovement"("complexId","createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId","createdAt");

-- StockEntry
ALTER TABLE "StockEntry" ADD COLUMN IF NOT EXISTS "complexId" TEXT;
ALTER TABLE "StockEntry" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "StockEntry" ADD COLUMN IF NOT EXISTS "notes" TEXT;
CREATE INDEX IF NOT EXISTS "StockEntry_complexId_createdAt_idx" ON "StockEntry"("complexId","createdAt");

-- Foreign keys (idempotent via DO blocks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_complexId_fkey') THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductCategory_complexId_fkey') THEN
    ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_complexId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_supplierId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderLine_presentationId_fkey') THEN
    ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockLot_presentationId_fkey') THEN
    ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_complexId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_productId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_presentationId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "ProductPresentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_locationId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockEntry_complexId_fkey') THEN
    ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockEntry_warehouseId_fkey') THEN
    ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockEntry_locationId_fkey') THEN
    ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Ensure each product has at least one default presentation (for legacy/import safety)
INSERT INTO "ProductPresentation" ("id","productId","name","unitsPerPack","cost","price","active")
SELECT 'pp_default_' || p."id", p."id", 'Unidad', 1, p."cost", p."price", true
FROM "Product" p
WHERE NOT EXISTS (SELECT 1 FROM "ProductPresentation" pp WHERE pp."productId" = p."id");