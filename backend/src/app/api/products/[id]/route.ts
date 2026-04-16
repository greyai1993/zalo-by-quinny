/**
 * GET    /api/products/[id]  — Product detail with variants
 * PUT    /api/products/[id]  — Update product + variants (admin)
 * DELETE /api/products/[id]  — Delete product (sets status=inactive)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

type VariantInput = {
  sku?: string;
  color?: string;
  size: string;
  price?: number;
  sale_price?: number;
  stock_qty?: number;
  is_active?: boolean;
  sort_order?: number;
};

async function tryUpdateProductTags(productId: string, tags: string[]) {
  // Best-effort only: supports either `hashtags` or `tags` columns if they exist.
  let lastError: unknown = null;
  const candidates: Array<Record<string, unknown>> = [
    { hashtags: tags },
    { tags },
    { hashtags: tags, tags },
  ];

  for (const payload of candidates) {
    const { error } = await supabaseAdmin.from('products').update(payload).eq('id', productId);
    if (!error) return;
    lastError = error;
  }

  if (tags.length) {
    console.warn('[products/:id] tag columns not updated (safe to ignore):', lastError);
  }
}

async function syncVariants(productId: string, variantsInput: VariantInput[]) {
  const { error: delErr } = await supabaseAdmin.from('variants').delete().eq('product_id', productId);
  if (delErr) throw delErr;

  if (!variantsInput.length) return;

  const payload = variantsInput.map((v, idx) => ({
    product_id: productId,
    sku: v.sku?.trim() || null,
    color: v.color?.trim() || null,
    size: v.size?.trim() || null,
    price: typeof v.price === 'number' ? v.price : null,
    sale_price: typeof v.sale_price === 'number' ? v.sale_price : null,
    stock_qty: Math.max(0, Number(v.stock_qty ?? 0)),
    is_active: v.is_active ?? true,
    sort_order: typeof v.sort_order === 'number' ? v.sort_order : idx,
  }));

  const { error: insErr } = await supabaseAdmin.from('variants').insert(payload);
  if (insErr) throw insErr;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from('products')
      .select(
        `id, sku, name, description, price, sale_price, images, status,
         is_featured, created_at, updated_at,
         category:categories(id, name, slug),
         variants(id, sku, color, size, price, sale_price, stock_qty, is_active, sort_order)`,
      )
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
      console.error('[products/:id] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[products/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      sku?: string;
      name?: string;
      description?: string;
      category_id?: string;
      price?: number;
      sale_price?: number;
      images?: string[];
      status?: 'active' | 'inactive' | 'draft';
      is_featured?: boolean;
      tags?: string[];
      hashtags?: string[];
      variants?: VariantInput[];
    };

    const allowed = [
      'sku',
      'name',
      'description',
      'category_id',
      'price',
      'sale_price',
      'images',
      'status',
      'is_featured',
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key as keyof typeof body];
    }

    if ('price' in updates && (typeof updates.price !== 'number' || updates.price < 0)) {
      return NextResponse.json({ error: 'price must be a non-negative number' }, { status: 400 });
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error: updateErr } = await supabaseAdmin.from('products').update(updates).eq('id', id);
      if (updateErr) {
        console.error('[products/:id] PUT product update error:', updateErr);
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
    }

    const mergedTags = Array.from(new Set([...(body.tags || []), ...(body.hashtags || [])].map((v) => v.trim()).filter(Boolean)));
    await tryUpdateProductTags(id, mergedTags);

    if (Array.isArray(body.variants)) {
      await syncVariants(id, body.variants);
    }

    const { data: refreshed, error: getErr } = await supabaseAdmin
      .from('products')
      .select(
        `id, sku, name, description, price, sale_price, images, status,
         is_featured, created_at, updated_at,
         variants(id, sku, color, size, price, sale_price, stock_qty, is_active, sort_order)`,
      )
      .eq('id', id)
      .single();

    if (getErr) {
      console.error('[products/:id] PUT refresh error:', getErr);
      return NextResponse.json({ success: true, id });
    }

    return NextResponse.json(refreshed);
  } catch (err) {
    console.error('[products/:id] PUT error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    const { error } = await supabaseAdmin
      .from('products')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
      console.error('[products/:id] DELETE supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[products/:id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
