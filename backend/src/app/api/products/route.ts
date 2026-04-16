/**
 * GET  /api/products   — List products (pagination, filter, search)
 * POST /api/products   — Create product (admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

type ProductStatus = 'active' | 'inactive' | 'draft';

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

function validateCreateProduct(body: Record<string, unknown>) {
  const errors: string[] = [];
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('name is required');
  }
  if (body.price === undefined || typeof body.price !== 'number' || body.price < 0) {
    errors.push('price must be a non-negative number');
  }
  if (body.sale_price !== undefined && body.sale_price !== null) {
    if (typeof body.sale_price !== 'number' || body.sale_price < 0) {
      errors.push('sale_price must be a non-negative number');
    }
  }
  if (body.variants !== undefined && !Array.isArray(body.variants)) {
    errors.push('variants must be an array');
  }
  return errors;
}

async function tryUpdateProductTags(productId: string, tags: string[]) {
  if (!tags.length) return;

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

  console.warn('[products] tag columns not updated (safe to ignore):', lastError);
}

async function syncVariants(productId: string, variantsInput: VariantInput[]) {
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

  if (!payload.length) {
    const { error: deactivateErr } = await supabaseAdmin
      .from('variants')
      .update({ is_active: false })
      .eq('product_id', productId);

    if (deactivateErr) throw deactivateErr;
    return;
  }

  const { error: upsertErr } = await supabaseAdmin
    .from('variants')
    .upsert(payload, { onConflict: 'sku', ignoreDuplicates: false });

  if (upsertErr) throw upsertErr;

  const activeSkus = payload.map((v) => v.sku).filter((sku): sku is string => Boolean(sku));

  let deactivateQuery = supabaseAdmin
    .from('variants')
    .update({ is_active: false })
    .eq('product_id', productId);

  if (activeSkus.length > 0) {
    deactivateQuery = deactivateQuery.not('sku', 'in', `(${activeSkus.map((sku) => `"${sku}"`).join(',')})`);
  }

  const { error: deactivateErr } = await deactivateQuery;
  if (deactivateErr) throw deactivateErr;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const category = searchParams.get('category');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const filter = searchParams.get('filter');
    const search = searchParams.get('search');
    const status = searchParams.get('status') || 'active';

    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('products')
      .select(
        `id, sku, name, description, price, sale_price, images, status,
         is_featured, created_at, allow_preorder, preorder_days, preorder_note,
         category:categories(id, name, slug),
         variants(id, sku, color, size, price, sale_price, stock_qty, is_active, sort_order)`,
        { count: 'exact' },
      )
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (status !== 'all') query = query.eq('status', status);

    if (category) {
      const { data: cat, error: catErr } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('slug', category)
        .single();
      if (catErr || !cat) {
        return NextResponse.json({ error: `Category "${category}" not found` }, { status: 404 });
      }
      query = query.eq('category_id', cat.id);
    }

    if (filter === 'sale') query = query.not('sale_price', 'is', null);
    else if (filter === 'featured') query = query.eq('is_featured', true);

    if (search) query = query.ilike('name', `%${search.trim()}%`);

    const { data, error, count } = await query;

    if (error) {
      console.error('[products] GET supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      products: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
        hasMore: (data?.length ?? 0) === limit,
      },
    });
  } catch (err) {
    console.error('[products] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sku?: string;
      name: string;
      description?: string;
      category_id?: string;
      price: number;
      sale_price?: number;
      images?: string[];
      status?: ProductStatus;
      is_featured?: boolean;
      tags?: string[];
      hashtags?: string[];
      variants?: VariantInput[];
    };

    const errors = validateCreateProduct(body as unknown as Record<string, unknown>);
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        sku: body.sku?.trim() || null,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        category_id: body.category_id || null,
        price: body.price,
        sale_price: body.sale_price ?? null,
        images: body.images ?? [],
        status: body.status ?? 'draft',
        is_featured: body.is_featured ?? false,
      })
      .select('id, sku, name, price, sale_price, status, created_at, allow_preorder, preorder_days, preorder_note')
      .single();

    if (error || !data) {
      console.error('[products] POST supabase error:', error);
      return NextResponse.json({ error: error?.message || 'Create product failed' }, { status: 500 });
    }

    const mergedTags = Array.from(new Set([...(body.tags || []), ...(body.hashtags || [])].map((v) => v.trim()).filter(Boolean)));
    await tryUpdateProductTags(data.id, mergedTags);

    if (Array.isArray(body.variants)) {
      await syncVariants(data.id, body.variants);
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[products] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
