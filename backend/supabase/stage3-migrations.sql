-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 3 Backend: Supporting SQL functions + inventory_sync table
-- Run this in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. inventory_sync table ──────────────────────────────────────────────────
-- Stores inventory data pulled from Abit every 15 minutes

CREATE TABLE IF NOT EXISTS inventory_sync (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  abit_price  numeric(12, 0) DEFAULT 0,
  stock_qty   int DEFAULT 0,
  sync_method text DEFAULT 'direct_api',
  synced_at   timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sync_sku ON inventory_sync(sku);

-- ─── 2. sync_logs table ───────────────────────────────────────────────────────
-- General purpose sync operation log

CREATE TABLE IF NOT EXISTS sync_logs (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type         text NOT NULL,    -- 'abit_order_push' | 'inventory_pull'
  reference_id text,             -- order_id for order push
  status       text NOT NULL,    -- 'success' | 'failed' | 'partial'
  data_json    jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_type ON sync_logs(type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at DESC);

-- ─── 3. RPC: increment_customer_stats ────────────────────────────────────────
-- Atomic update of customer total_points + total_spent + recalc tier

CREATE OR REPLACE FUNCTION increment_customer_stats(
  p_customer_id uuid,
  p_points      int,
  p_spent       numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_points  int;
  v_new_spent   numeric;
  v_new_tier    text;
BEGIN
  UPDATE customers
  SET
    total_points = total_points + p_points,
    total_spent  = total_spent + p_spent,
    order_count  = order_count + 1,
    updated_at   = now()
  WHERE id = p_customer_id
  RETURNING total_points, total_spent INTO v_new_points, v_new_spent;

  -- Recalculate tier
  v_new_tier := CASE
    WHEN v_new_points >= 3000 THEN 'vip'
    WHEN v_new_points >= 1500 THEN 'gold'
    WHEN v_new_points >= 500  THEN 'silver'
    ELSE 'bronze'
  END;

  UPDATE customers
  SET tier = v_new_tier
  WHERE id = p_customer_id AND tier != v_new_tier;
END;
$$;

-- ─── 4. RPC: decrement_customer_points ───────────────────────────────────────
-- Atomic deduction of points (for redemption)

CREATE OR REPLACE FUNCTION decrement_customer_points(
  p_customer_id uuid,
  p_points      int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE customers
  SET
    total_points = GREATEST(0, total_points - p_points),
    updated_at   = now()
  WHERE id = p_customer_id;
END;
$$;

-- ─── 5. RLS Policies for new tables ──────────────────────────────────────────

ALTER TABLE inventory_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (no public access)
CREATE POLICY "service_role_only_inventory" ON inventory_sync
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_only_sync_logs" ON sync_logs
  USING (auth.role() = 'service_role');

-- ─── 6. Add missing columns to existing tables (if not already there) ─────────

-- zns_logs: add reference_id + params_json if not present
ALTER TABLE zns_logs
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS params_json  jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_json jsonb DEFAULT '{}'::jsonb;

-- variants: ensure sku column exists for inventory matching
ALTER TABLE variants ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE variants ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_variants_sku ON variants(sku) WHERE sku IS NOT NULL;

-- orders: ensure abit_invoice_no + voucher_code columns exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS abit_invoice_no text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voucher_code text;

-- ─── 7. Updated_at auto-trigger for variants ─────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS variants_updated_at ON variants;
CREATE TRIGGER variants_updated_at
  BEFORE UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
