-- Add color column for product variants table.
-- Run in Supabase SQL Editor if your current table does not have this field.

ALTER TABLE variants
  ADD COLUMN IF NOT EXISTS color text;

-- Optional: index for filtering by product + color
CREATE INDEX IF NOT EXISTS idx_variants_product_color
  ON variants(product_id, color);
