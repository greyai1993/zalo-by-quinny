'use client';

import { useEffect, useMemo, useState } from 'react';

type ProductStatus = 'active' | 'inactive' | 'draft';
type TabKey = 'basic' | 'images' | 'variants';

const BRAND = '#7C5F40';
const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
const MAX_IMAGES = 9;

type VariantRow = {
  id?: string;
  sku?: string;
  color?: string;
  size: string;
  stock_qty: number;
  price?: number | null;
  sale_price?: number | null;
  is_active: boolean;
  sort_order?: number;
};

type Product = {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  price: number;
  sale_price?: number;
  status: ProductStatus;
  is_featured: boolean;
  images?: string[];
  hashtags?: string[];
  tags?: string[];
  variants?: VariantRow[];
  created_at: string;
};

type VariantCell = {
  sku: string;
  stock_qty: number;
  price?: string;
};

type FormState = {
  name: string;
  description: string;
  hashtagInput: string;
  price: string;
  sale_price: string;
  status: ProductStatus;
  is_featured: boolean;
  images: string[];
  colors: string[];
  variantMap: Record<string, VariantCell>;
};

const statusOptions: ProductStatus[] = ['active', 'inactive', 'draft'];

function colorToCode(color: string) {
  return color
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

function variantKey(color: string, size: string) {
  return `${color}__${size}`;
}

function parseHashtags(input: string) {
  const raw = input
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v.startsWith('#') ? v : `#${v}`));

  return Array.from(new Set(raw));
}

function createEmptyForm(): FormState {
  return {
    name: '',
    description: '',
    hashtagInput: '',
    price: '',
    sale_price: '',
    status: 'draft',
    is_featured: false,
    images: [],
    colors: [],
    variantMap: {},
  };
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string>('');

  const [showModal, setShowModal] = useState(false);
  const [tab, setTab] = useState<TabKey>('basic');
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(createEmptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [colorDraft, setColorDraft] = useState('');
  const [dragImageIndex, setDragImageIndex] = useState<number | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  async function fetchProducts() {
    setLoading(true);
    try {
      const url =
        statusFilter === 'all'
          ? '/api/products?limit=100&status=all'
          : `/api/products?limit=100&status=${statusFilter}`;
      const res = await fetch(url);
      const json = (await res.json()) as { products?: Product[] };
      setProducts(json.products || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProducts();
  }, [statusFilter]);

  async function updateProductStatus(id: string, status: ProductStatus) {
    setUpdatingId(id);
    try {
      await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await fetchProducts();
    } finally {
      setUpdatingId('');
    }
  }

  async function toggleFeatured(p: Product) {
    setUpdatingId(p.id);
    try {
      await fetch(`/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_featured: !p.is_featured }),
      });
      await fetchProducts();
    } finally {
      setUpdatingId('');
    }
  }

  function openCreate() {
    setEditProduct(null);
    setForm(createEmptyForm());
    setColorDraft('');
    setSaveError('');
    setTab('basic');
    setShowModal(true);
  }

  function openEdit(p: Product) {
    const rawTags = p.hashtags?.length ? p.hashtags : p.tags?.length ? p.tags : [];
    const hashtags = rawTags.map((v) => (v.startsWith('#') ? v : `#${v}`));

    const colors = Array.from(
      new Set(
        (p.variants || [])
          .map((v) => (v.color || '').trim())
          .filter(Boolean),
      ),
    );

    const variantMap: Record<string, VariantCell> = {};
    (p.variants || []).forEach((v) => {
      if (!v.color) return;
      const key = variantKey(v.color, v.size);
      variantMap[key] = {
        sku: v.sku || `BQ-${colorToCode(v.color)}-${v.size}`,
        stock_qty: Number(v.stock_qty || 0),
        price: v.price ? String(v.price) : '',
      };
    });

    setEditProduct(p);
    setForm({
      name: p.name,
      description: p.description || '',
      hashtagInput: hashtags.join(' '),
      price: String(p.price || ''),
      sale_price: p.sale_price ? String(p.sale_price) : '',
      status: p.status,
      is_featured: p.is_featured,
      images: (p.images || []).slice(0, MAX_IMAGES),
      colors,
      variantMap,
    });
    setColorDraft('');
    setSaveError('');
    setTab('basic');
    setShowModal(true);
  }

  function setVariantCell(color: string, size: string, update: Partial<VariantCell>) {
    const key = variantKey(color, size);
    setForm((prev) => {
      const existed = prev.variantMap[key] || {
        sku: `BQ-${colorToCode(color)}-${size}`,
        stock_qty: 0,
        price: '',
      };
      return {
        ...prev,
        variantMap: {
          ...prev.variantMap,
          [key]: { ...existed, ...update },
        },
      };
    });
  }

  function addColorFromDraft() {
    const value = colorDraft.trim();
    if (!value) return;
    if (form.colors.includes(value)) {
      setColorDraft('');
      return;
    }
    setForm((prev) => ({ ...prev, colors: [...prev.colors, value] }));
    setColorDraft('');
  }

  function removeColor(color: string) {
    setForm((prev) => {
      const nextMap = { ...prev.variantMap };
      SIZES.forEach((size) => delete nextMap[variantKey(color, size)]);
      return {
        ...prev,
        colors: prev.colors.filter((c) => c !== color),
        variantMap: nextMap,
      };
    });
  }

  function reorderImage(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= form.images.length || to >= form.images.length) return;
    const next = [...form.images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setForm((prev) => ({ ...prev, images: next }));
  }

  async function uploadSingleFile(file: File, oldUrl?: string) {
    const fd = new FormData();
    fd.append('file', file);
    if (oldUrl) fd.append('oldUrl', oldUrl);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: fd,
    });

    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.error || 'Upload failed');
    }
    return data.url;
  }

  async function handleAddFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;

    const remain = MAX_IMAGES - form.images.length;
    if (remain <= 0) return;

    const uploading = list.slice(0, remain);
    setUploadingCount((v) => v + uploading.length);

    try {
      const uploadedUrls: string[] = [];
      for (const file of uploading) {
        const url = await uploadSingleFile(file);
        uploadedUrls.push(url);
      }

      setForm((prev) => ({
        ...prev,
        images: [...prev.images, ...uploadedUrls].slice(0, MAX_IMAGES),
      }));
    } catch (err) {
      setSaveError((err as Error).message || 'Lỗi upload ảnh');
    } finally {
      setUploadingCount((v) => Math.max(0, v - uploading.length));
    }
  }

  async function replaceImageAt(index: number, file: File) {
    const oldUrl = form.images[index];
    setUploadingCount((v) => v + 1);
    try {
      const newUrl = await uploadSingleFile(file, oldUrl);
      setForm((prev) => {
        const next = [...prev.images];
        next[index] = newUrl;
        return { ...prev, images: next };
      });
    } catch (err) {
      setSaveError((err as Error).message || 'Lỗi thay ảnh');
    } finally {
      setUploadingCount((v) => Math.max(0, v - 1));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');

    if (!form.name.trim()) {
      setSaveError('Tên sản phẩm là bắt buộc');
      setSaving(false);
      return;
    }
    if (!form.price || Number(form.price) < 0) {
      setSaveError('Giá gốc không hợp lệ');
      setSaving(false);
      return;
    }

    const hashtags = parseHashtags(form.hashtagInput);

    const variants = form.colors.flatMap((color) =>
      SIZES.map((size, index) => {
        const key = variantKey(color, size);
        const cell = form.variantMap[key] || {
          sku: `BQ-${colorToCode(color)}-${size}`,
          stock_qty: 0,
          price: '',
        };

        return {
          color,
          size,
          sku: cell.sku?.trim() || `BQ-${colorToCode(color)}-${size}`,
          stock_qty: Number(cell.stock_qty || 0),
          price: cell.price ? Number(cell.price) : undefined,
          is_active: true,
          sort_order: index,
        };
      }),
    );

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price: Number(form.price),
      sale_price: form.sale_price ? Number(form.sale_price) : undefined,
      status: form.status,
      is_featured: form.is_featured,
      images: form.images,
      hashtags,
      tags: hashtags,
      variants,
    };

    try {
      const res = editProduct
        ? await fetch(`/api/products/${editProduct.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Lỗi khi lưu sản phẩm');
        return;
      }

      setShowModal(false);
      await fetchProducts();
    } catch {
      setSaveError('Lỗi kết nối API');
    } finally {
      setSaving(false);
    }
  }

  const totalStock = useMemo(
    () => products.reduce((sum, p) => sum + (p.variants || []).reduce((vs, v) => vs + (v.stock_qty || 0), 0), 0),
    [products],
  );

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'Inter, Open Sans, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, color: BRAND }}>Seller Centre · Products</h1>
          <p style={{ margin: '4px 0 0', color: '#8c7a62', fontSize: 13 }}>By Quinny Admin — quản lý sản phẩm & tồn kho</p>
        </div>
        <button onClick={openCreate} style={btnPrimary}>+ Thêm sản phẩm</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={statCard}>Tổng SP: <b>{products.length}</b></div>
        <div style={statCard}>Tổng tồn: <b>{totalStock}</b></div>
        <div style={statCard}>Nổi bật: <b>{products.filter((p) => p.is_featured).length}</b></div>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>Trạng thái:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">Tất cả</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e8dfd2', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F6F2EA' }}>
              {['Ảnh', 'Tên sản phẩm', 'Giá', 'Tồn kho', 'Nổi bật', 'Trạng thái', 'Action'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={td}>Đang tải...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} style={td}>Chưa có sản phẩm</td></tr>
            ) : (
              products.map((p) => {
                const stock = (p.variants || []).reduce((s, v) => s + (v.stock_qty || 0), 0);
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid #f0e7da' }}>
                    <td style={td}>
                      {p.images?.[0] ? (
                        <img src={p.images[0]} alt={p.name} style={{ width: 44, height: 56, objectFit: 'cover', borderRadius: 6 }} />
                      ) : (
                        <div style={{ width: 44, height: 56, background: '#F6F2EA', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧵</div>
                      )}
                    </td>
                    <td style={td}><b style={{ color: '#3a2c1e' }}>{p.name}</b></td>
                    <td style={td}>
                      {p.sale_price ? (
                        <>
                          <span style={{ color: BRAND, fontWeight: 700 }}>{p.sale_price.toLocaleString('vi-VN')}đ</span><br />
                          <span style={{ textDecoration: 'line-through', color: '#aaa', fontSize: 12 }}>{p.price.toLocaleString('vi-VN')}đ</span>
                        </>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{p.price.toLocaleString('vi-VN')}đ</span>
                      )}
                    </td>
                    <td style={td}>{stock}</td>
                    <td style={td}>
                      <button onClick={() => toggleFeatured(p)} disabled={updatingId === p.id} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>
                        {p.is_featured ? '⭐' : '☆'}
                      </button>
                    </td>
                    <td style={td}>
                      <select value={p.status} disabled={updatingId === p.id} onChange={(e) => updateProductStatus(p.id, e.target.value as ProductStatus)} style={{ ...selectStyle, fontSize: 12 }}>
                        {statusOptions.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <button onClick={() => openEdit(p)} style={{ ...btnSecondary, fontSize: 12, padding: '4px 10px' }}>Sửa</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 980, maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 14, border: '1px solid #efe6da' }}>
            <div style={{ borderBottom: '1px solid #efe6da', padding: '16px 18px' }}>
              <h2 style={{ margin: 0, color: BRAND }}>{editProduct ? 'Cập nhật sản phẩm' : 'Tạo sản phẩm mới'}</h2>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setTab('basic')} style={tabBtn(tab === 'basic')}>Thông tin cơ bản</button>
                <button onClick={() => setTab('images')} style={tabBtn(tab === 'images')}>Hình ảnh</button>
                <button onClick={() => setTab('variants')} style={tabBtn(tab === 'variants')}>Phân loại & Kho</button>
              </div>
            </div>

            <div style={{ padding: 18 }}>
              {tab === 'basic' && (
                <div>
                  <label style={labelStyle}>Tên sản phẩm *</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="VD: Áo tơ bội cổ tròn" />

                  <label style={labelStyle}>Mô tả dài</label>
                  <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={4} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Mô tả chất liệu, form, cách bảo quản..." />

                  <label style={labelStyle}>Hashtag (VD: #tơbội #linenvn)</label>
                  <input value={form.hashtagInput} onChange={(e) => setForm((f) => ({ ...f, hashtagInput: e.target.value }))} style={inputStyle} placeholder="#toboi #linenvn" />

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
                    <div>
                      <label style={labelStyle}>Giá gốc *</label>
                      <input type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} style={inputStyle} placeholder="289000" />
                    </div>
                    <div>
                      <label style={labelStyle}>Giá sale</label>
                      <input type="number" min={0} value={form.sale_price} onChange={(e) => setForm((f) => ({ ...f, sale_price: e.target.value }))} style={inputStyle} placeholder="249000" />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <label style={labelStyle}>Trạng thái</label>
                      <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProductStatus }))} style={selectStyle}>
                        {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22, fontSize: 14, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.is_featured} onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.checked }))} />
                      ⭐ Nổi bật
                    </label>
                  </div>
                </div>
              )}

              {tab === 'images' && (
                <div>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files?.length) handleAddFiles(e.dataTransfer.files);
                    }}
                    style={{ border: `1.5px dashed ${BRAND}`, borderRadius: 12, padding: 16, background: '#faf7f3' }}
                  >
                    <p style={{ margin: 0, color: '#6f5a3d', fontSize: 13 }}>Kéo thả ảnh vào đây hoặc chọn file (tối đa {MAX_IMAGES} ảnh)</p>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => e.target.files && handleAddFiles(e.target.files)}
                      style={{ marginTop: 10 }}
                    />
                    <p style={{ margin: '8px 0 0', fontSize: 12, color: '#8e7b66' }}>Có thể drag & drop để đổi thứ tự ảnh sau khi upload.</p>
                  </div>

                  <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
                    {form.images.map((url, index) => (
                      <div
                        key={`${url}-${index}`}
                        draggable
                        onDragStart={() => setDragImageIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragImageIndex !== null) reorderImage(dragImageIndex, index);
                          setDragImageIndex(null);
                        }}
                        style={{ border: '1px solid #e8dfd2', borderRadius: 10, padding: 8, background: '#fff' }}
                      >
                        <img src={url} alt={`Ảnh ${index + 1}`} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 8 }} />
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <label style={{ ...smallAction, flex: 1 }}>
                            Thay
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) replaceImageAt(index, file);
                                e.currentTarget.value = '';
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            style={smallDanger}
                            onClick={() => setForm((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }))}
                          >
                            Xoá
                          </button>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>{index + 1 === 1 ? 'Ảnh bìa' : `Thứ tự ${index + 1}`}</div>
                      </div>
                    ))}
                  </div>
                  {uploadingCount > 0 && <p style={{ color: '#8b6d4a', fontSize: 13 }}>Đang upload {uploadingCount} ảnh...</p>}
                </div>
              )}

              {tab === 'variants' && (
                <div>
                  <label style={labelStyle}>Màu sắc (nhập tự do)</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      value={colorDraft}
                      onChange={(e) => setColorDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addColorFromDraft();
                        }
                      }}
                      style={{ ...inputStyle, marginBottom: 0 }}
                      placeholder="VD: Nude, Xanh lá, Trắng sữa"
                    />
                    <button onClick={addColorFromDraft} style={btnSecondary}>Thêm màu</button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {form.colors.map((c) => (
                      <div key={c} style={{ background: '#f6f2ea', border: '1px solid #e7ddcf', borderRadius: 999, padding: '6px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{c}</span>
                        <button type="button" onClick={() => removeColor(c)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a08767' }}>✕</button>
                      </div>
                    ))}
                  </div>

                  {form.colors.length === 0 ? (
                    <p style={{ color: '#8f826f', fontSize: 13 }}>Thêm ít nhất 1 màu để tạo bảng variants màu × size.</p>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid #efe5d8', borderRadius: 12 }}>
                      <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#fbf8f4' }}>
                            <th style={th}>Màu</th>
                            <th style={th}>Size</th>
                            <th style={th}>SKU</th>
                            <th style={th}>Tồn kho</th>
                            <th style={th}>Giá riêng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.colors.flatMap((color) =>
                            SIZES.map((size) => {
                              const key = variantKey(color, size);
                              const cell = form.variantMap[key] || {
                                sku: `BQ-${colorToCode(color)}-${size}`,
                                stock_qty: 0,
                                price: '',
                              };
                              return (
                                <tr key={key} style={{ borderTop: '1px solid #f3ebdf' }}>
                                  <td style={td}>{color}</td>
                                  <td style={td}><b>{size}</b></td>
                                  <td style={td}>
                                    <input value={cell.sku} onChange={(e) => setVariantCell(color, size, { sku: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }} />
                                  </td>
                                  <td style={td}>
                                    <input type="number" min={0} value={cell.stock_qty} onChange={(e) => setVariantCell(color, size, { stock_qty: Number(e.target.value) })} style={{ ...inputStyle, marginBottom: 0 }} />
                                  </td>
                                  <td style={td}>
                                    <input type="number" min={0} value={cell.price || ''} onChange={(e) => setVariantCell(color, size, { price: e.target.value })} placeholder="Theo giá chung" style={{ ...inputStyle, marginBottom: 0 }} />
                                  </td>
                                </tr>
                              );
                            }),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid #efe6da', padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>{saveError && <span style={{ color: '#d43f3a', fontSize: 13 }}>{saveError}</span>}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowModal(false)} style={btnSecondary}>Huỷ</button>
                <button onClick={handleSave} disabled={saving || uploadingCount > 0} style={{ ...btnPrimary, opacity: saving || uploadingCount > 0 ? 0.6 : 1 }}>
                  {saving ? 'Đang lưu...' : editProduct ? 'Cập nhật sản phẩm' : 'Tạo sản phẩm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, color: BRAND };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, verticalAlign: 'middle' };
const statCard: React.CSSProperties = { background: '#fff', border: '1px solid #e8dfd2', borderRadius: 10, padding: '10px 16px', fontSize: 14 };
const btnPrimary: React.CSSProperties = { background: BRAND, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { background: '#fff', color: BRAND, border: `1.5px solid ${BRAND}`, borderRadius: 9, padding: '9px 14px', fontSize: 14, cursor: 'pointer' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1.5px solid #E8DDD0', borderRadius: 8, fontSize: 13, marginBottom: 12, boxSizing: 'border-box', background: '#FDFAF7' };
const selectStyle: React.CSSProperties = { padding: '8px 10px', border: '1.5px solid #E8DDD0', borderRadius: 8, fontSize: 13, background: '#FDFAF7' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: BRAND, marginBottom: 4 };
const smallAction: React.CSSProperties = { border: '1px solid #dbcdb8', borderRadius: 7, padding: '5px 8px', fontSize: 12, cursor: 'pointer', textAlign: 'center', background: '#fff8ef' };
const smallDanger: React.CSSProperties = { border: '1px solid #f0c4c1', borderRadius: 7, padding: '5px 8px', fontSize: 12, cursor: 'pointer', background: '#fff4f4', color: '#b94a48' };
const tabBtn = (active: boolean): React.CSSProperties => ({
  border: active ? `1.5px solid ${BRAND}` : '1px solid #e6dccd',
  background: active ? '#f4ede4' : '#fff',
  color: active ? BRAND : '#7e6c55',
  borderRadius: 999,
  padding: '7px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
});
