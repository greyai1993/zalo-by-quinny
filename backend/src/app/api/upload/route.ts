import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const BUCKET = 'product-images';
const MAX_MB = 10;

function extractStoragePath(url: string) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
  if (listError) throw listError;

  const found = buckets?.find((b) => b.name === BUCKET);
  if (found) return;

  const { error: createError } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_MB}MB`,
  });

  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw createError;
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureBucket();

    const formData = await req.formData();
    const file = formData.get('file');
    const oldUrl = String(formData.get('oldUrl') || '');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      return NextResponse.json({ error: `File too large (max ${MAX_MB}MB)` }, { status: 400 });
    }

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'jpg';
    const filePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${safeExt}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filePath);
    const url = data.publicUrl;

    if (oldUrl) {
      const oldPath = extractStoragePath(oldUrl);
      if (oldPath) {
        await supabaseAdmin.storage.from(BUCKET).remove([oldPath]);
      }
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error('[upload] error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
