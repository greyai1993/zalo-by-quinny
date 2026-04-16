/**
 * GET /api/sync/inventory — Pull inventory from Abit into Supabase
 *
 * Called by Vercel Cron every 15 minutes.
 * Also callable manually for ad-hoc sync.
 *
 * Security: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}` header.
 * Set CRON_SECRET env var to secure this endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { pullInventoryFromAbit, deriveInventoryFromInvoices } from '@/lib/abit-sync';

export async function GET(req: NextRequest) {
  try {
    const syncSecret = req.headers.get('x-sync-secret');
    const requiredSyncSecret = process.env.SYNC_SECRET_KEY;
    if (requiredSyncSecret && syncSecret !== requiredSyncSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Auth: verify cron secret
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const syncStarted = new Date().toISOString();
    let products: Array<{ productcode: string; productName: string; price: string; stock_qty?: number }> = [];
    let method = 'direct_api';

    // Try direct Abit product API first
    const directProducts = await pullInventoryFromAbit();

    if (directProducts.length > 0) {
      products = directProducts as typeof products;
    } else {
      // Fallback: derive from recent invoices
      method = 'invoice_derived';
      console.log('[sync/inventory] Direct API returned 0 products, falling back to invoice derivation');

      const skuCounts = await deriveInventoryFromInvoices(3);

      // Convert Map to product-like objects
      for (const [sku, count] of skuCounts) {
        products.push({
          productcode: sku,
          productName: sku, // No name available from this method
          price: '0',
          stock_qty: count,
        });
      }
    }

    if (products.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No products returned from Abit',
        synced_at: syncStarted,
      });
    }

    // Upsert into inventory_sync table (create if not exists, update if exists)
    const records = products.map((p) => ({
      sku: p.productcode,
      name: p.productName || p.productcode,
      abit_price: parseFloat(p.price ?? '0') || 0,
      stock_qty: p.stock_qty ?? 0,
      synced_at: syncStarted,
      sync_method: method,
    }));

    // Batch upsert in chunks of 50
    const CHUNK_SIZE = 50;
    let upsertedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from('inventory_sync')
        .upsert(chunk, { onConflict: 'sku' });

      if (error) {
        errors.push(error.message);
      } else {
        upsertedCount += chunk.length;
      }
    }

    // Update product stock_qty in variants table based on SKU matching
    // Match inventory_sync.sku → variants.sku
    let variantsUpdated = 0;
    for (const record of records) {
      if (!record.sku || record.stock_qty === 0) continue;

      const { data: variants } = await supabaseAdmin
        .from('variants')
        .select('id')
        .eq('sku', record.sku);

      if (variants && variants.length > 0) {
        for (const variant of variants) {
          await supabaseAdmin
            .from('variants')
            .update({
              stock_qty: record.stock_qty,
              updated_at: new Date().toISOString(),
            })
            .eq('id', variant.id);
          variantsUpdated++;
        }
      }
    }

    // Log sync (non-fatal, fire and forget)
    void supabaseAdmin.from('sync_logs').insert({
      type: 'inventory_pull',
      status: errors.length > 0 ? 'partial' : 'success',
      data_json: {
        products_fetched: products.length,
        upserted: upsertedCount,
        variants_updated: variantsUpdated,
        method,
        errors: errors.slice(0, 10),
      },
    });

    return NextResponse.json({
      success: true,
      products_fetched: products.length,
      upserted: upsertedCount,
      variants_updated: variantsUpdated,
      method,
      errors: errors.length > 0 ? errors : undefined,
      synced_at: syncStarted,
    });
  } catch (err) {
    console.error('[sync/inventory] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
