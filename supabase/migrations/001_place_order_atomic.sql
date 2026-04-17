-- Atomic stock reservation: decrement variant stock_qty safely
-- Returns TRUE if stock was sufficient, FALSE otherwise
-- SECURITY DEFINER so anon/authenticated can call via RPC

CREATE OR REPLACE FUNCTION place_order_atomic(
  p_variant_id UUID,
  p_qty INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  -- Lock the row to prevent race conditions
  SELECT stock_qty INTO v_current_stock
  FROM variants
  WHERE id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant % not found', p_variant_id;
  END IF;

  IF v_current_stock < p_qty THEN
    RETURN FALSE;
  END IF;

  UPDATE variants
  SET stock_qty = stock_qty - p_qty,
      updated_at = NOW()
  WHERE id = p_variant_id;

  RETURN TRUE;
END;
$$;

-- Grant execute to anon and authenticated (miniapp uses anon key)
GRANT EXECUTE ON FUNCTION place_order_atomic(UUID, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION place_order_atomic(UUID, INTEGER) TO authenticated;
