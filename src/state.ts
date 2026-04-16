import { atom } from "jotai";
import { atomFamily, unwrap } from "jotai/utils";
import { Cart, Category, Color, Product } from "@/types";
import { request, requestWithFallback } from "@/utils/request";
import { getUserInfo } from "zmp-sdk";

export const userState = atom(() =>
  getUserInfo({
    avatarType: "normal",
  })
);

export const bannersState = atom(() =>
  requestWithFallback<string[]>("/banners", [])
);

export const selectedTabIndexState = atom(0);

// Fetch categories from real API, map to miniapp format
export const categoriesState = atom(async () => {
  try {
    const res = await request<{ products: { category: { id: string; name: string; slug: string } | null }[] }>(
      "/api/products?limit=100&status=active"
    );
    // Extract unique categories from products
    const catMap = new Map<string, Category>();
    let idx = 1;
    for (const p of res.products) {
      if (p.category && !catMap.has(p.category.id)) {
        catMap.set(p.category.id, {
          id: p.category.id as unknown as number,
          name: p.category.name,
          image: "",
        });
        idx++;
      }
    }
    return Array.from(catMap.values());
  } catch {
    return [];
  }
});

export const categoriesStateUpwrapped = unwrap(
  categoriesState,
  (prev) => prev ?? []
);

// Tabs derived from real categories
export const tabsState = atom(async (get) => {
  const categories = await get(categoriesState);
  return ["Tất cả", ...categories.map((c) => c.name)];
});

export const tabsStateUnwrapped = unwrap(tabsState, (prev) => prev ?? ["Tất cả"]);

// Fetch products from real API
export const productsState = atom(async (get) => {
  try {
    const res = await request<{
      products: Array<{
        id: string;
        sku: string;
        name: string;
        price: number;
        sale_price: number | null;
        images: string[];
        description: string;
        status: string;
        category: { id: string; name: string; slug: string } | null;
        variants: Array<{
          id: string;
          sku: string;
          color: string | null;
          size: string | null;
          price: number | null;
          sale_price: number | null;
          stock_qty: number;
          is_active: boolean;
        }>;
      }>;
    }>("/api/products?limit=100&status=active");

    return res.products.map((p) => ({
      id: p.id as unknown as number,
      name: p.name,
      price: p.price,
      originalPrice: p.sale_price ? p.price : undefined,
      image: p.images?.[0] || "",
      category: p.category
        ? { id: p.category.id as unknown as number, name: p.category.name, image: "" }
        : { id: 0 as unknown as number, name: "Khác", image: "" },
      sizes: [...new Set(p.variants?.filter((v) => v.is_active && v.size).map((v) => v.size!))] || [],
      colors: [...new Set(p.variants?.filter((v) => v.is_active && v.color).map((v) => v.color!))].map(
        (c) => ({ name: c, hex: "#D9E2ED" })
      ),
      details: p.description
        ? [{ title: "Mô tả", content: p.description }]
        : [],
      _images: p.images || [],
      _variants: p.variants || [],
    })) as Product[];
  } catch {
    return [];
  }
});

// Filter products by selected tab/category
export const filteredProductsState = atom(async (get) => {
  const products = await get(productsState);
  const tabIndex = get(selectedTabIndexState);
  const tabs = await get(tabsState);
  if (tabIndex === 0 || !tabs[tabIndex]) return products; // "Tất cả"
  const categoryName = tabs[tabIndex];
  return products.filter((p) => p.category?.name === categoryName);
});

export const flashSaleProductsState = atom((get) => get(productsState));

export const recommendedProductsState = atom((get) => get(productsState));

export const sizesState = atom(["S", "M", "L", "XL"]);

export const selectedSizeState = atom<string | undefined>(undefined);

export const colorsState = atom<Color[]>([
  {
    name: "Đỏ",
    hex: "#FFC7C7",
  },
  {
    name: "Xanh dương",
    hex: "#DBEBFF",
  },
  {
    name: "Xanh lá",
    hex: "#D1F0DB",
  },
  {
    name: "Xám",
    hex: "#D9E2ED",
  },
]);

export const selectedColorState = atom<Color | undefined>(undefined);

export const productState = atomFamily((id: number) =>
  atom(async (get) => {
    const products = await get(productsState);
    return products.find((product) => product.id === id);
  })
);

export const cartState = atom<Cart>([]);

export const selectedCartItemIdsState = atom<number[]>([]);

export const checkoutItemsState = atom((get) => {
  const ids = get(selectedCartItemIdsState);
  const cart = get(cartState);
  return cart.filter((item) => ids.includes(item.id));
});

export const cartTotalState = atom((get) => {
  const items = get(checkoutItemsState);
  return {
    totalItems: items.length,
    totalAmount: items.reduce(
      (total, item) => total + item.product.price * item.quantity,
      0
    ),
  };
});

export const keywordState = atom("");

export const searchResultState = atom(async (get) => {
  const keyword = get(keywordState);
  const products = await get(productsState);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return products.filter((product) =>
    product.name.toLowerCase().includes(keyword.toLowerCase())
  );
});
