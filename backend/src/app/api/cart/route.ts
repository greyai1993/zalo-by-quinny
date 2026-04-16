/**
 * POST /api/cart — Add / update / remove cart items
 *
 * Actions:
 *   { action: 'add',    customer_id, product_id, variant_id?, qty }
 *   { action: 'update', customer_id, item_id,    qty }  — qty=0 → remove
 *   { action: 'remove', customer_id, item_id }
 *   { action: 'clear',  customer_id }
 *
 * GET /api/cart?customer_id=xxx — Get cart items
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ─── GET /api/cart ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const customerId = req.nextUrl.searchParams.get('customer_id');
    if (!customerId) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('cart_items')
      .select(
        `id, qty, created_at,
         product:products(id, name, price, sale_price, images, status),
         variant:variants(id, color, size, price, sale_price, stock_qty, is_active)`
      )
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[cart] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate cart total
    const items = data ?? [];
    const cartTotal = items.reduce((sum, item) => {
      const product = item.product as { price?: number; sale_price?: number } | null;
      const variant = item.variant as { price?: number; sale_price?: number } | null;
      const unitPrice =
        variant?.sale_price ?? variant?.price ??
        product?.sale_price ?? product?.price ?? 0;
      return sum + unitPrice * item.qty;
    }, 0);

    return NextResponse.json({ items, cart_total: cartTotal, count: items.length });
  } catch (err) {
    console.error('[cart] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST /api/cart ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, customer_id } = body as { action: string; customer_id: string };

    if (!customer_id) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
    }

    switch (action) {
      case 'add': {
        const { product_id, variant_id, qty = 1 } = body as {
          product_id: string; variant_id?: string; qty?: number;
        };

        if (!product_id) {
          return NextResponse.json({ error: 'product_id is required for add' }, { status: 400 });
        }
        if (qty < 1) {
          return NextResponse.json({ error: 'qty must be >= 1' }, { status: 400 });
        }

        // Check stock
        if (variant_id) {
          const { data: variant } = await supabaseAdmin
            .from('variants')
            .select('stock_qty, is_active')
            .eq('id', variant_id)
            .single();
          if (!variant || !variant.is_active) {
            return NextResponse.json({ error: 'Variant not available' }, { status: 400 });
          }
          if (variant.stock_qty < qty) {
            return NextResponse.json(
              { error: `Only ${variant.stock_qty} items in stock` },
              { status: 400 }
            );
          }
        }

        // Upsert: if same product+variant exists, increment qty
        const existing = await supabaseAdmin
          .from('cart_items')
          .select('id, qty')
          .eq('customer_id', customer_id)
          .eq('product_id', product_id)
          .eq('variant_id', variant_id ?? '')
          .single();

        if (existing.data) {
          const newQty = existing.data.qty + qty;
          const { error } = await supabaseAdmin
            .from('cart_items')
            .update({ qty: newQty, updated_at: new Date().toISOString() })
            .eq('id', existing.data.id);
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
          return NextResponse.json({ success: true, item_id: existing.data.id, qty: newQty });
        }

        const { data: newItem, error } = await supabaseAdmin
          .from('cart_items')
          .insert({ customer_id, product_id, variant_id: variant_id || null, qty })
          .select('id, qty')
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, item_id: newItem.id, qty: newItem.qty }, { status: 201 });
      }

      case 'update': {
        const { item_id, qty } = body as { item_id: string; qty: number };
        if (!item_id) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });
        if (qty === undefined) return NextResponse.json({ error: 'qty is required' }, { status: 400 });

        if (qty <= 0) {
          // Remove item
          const { error } = await supabaseAdmin
            .from('cart_items')
            .delete()
            .eq('id', item_id)
            .eq('customer_id', customer_id);
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
          return NextResponse.json({ success: true, removed: true });
        }

        const { error } = await supabaseAdmin
          .from('cart_items')
          .update({ qty, updated_at: new Date().toISOString() })
          .eq('id', item_id)
          .eq('customer_id', customer_id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, item_id, qty });
      }

      case 'remove': {
        const { item_id } = body as { item_id: string };
        if (!item_id) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

        const { error } = await supabaseAdmin
          .from('cart_items')
          .delete()
          .eq('id', item_id)
          .eq('customer_id', customer_id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, removed: true });
      }

      case 'clear': {
        const { error } = await supabaseAdmin
          .from('cart_items')
          .delete()
          .eq('customer_id', customer_id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, cleared: true });
      }

      default:
        return NextResponse.json(
          { error: `Invalid action "${action}". Must be: add | update | remove | clear` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error('[cart] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
