import ProductGrid from "@/components/product-grid";
import { useAtomValue } from "jotai";
import { filteredProductsState } from "@/state";
import { Suspense } from "react";

function FilteredProductsInner() {
  const products = useAtomValue(filteredProductsState);

  if (!products.length) {
    return (
      <div className="text-center py-8 text-subtitle text-sm">
        Không có sản phẩm nào
      </div>
    );
  }

  return <ProductGrid products={products} />;
}

export default function FilteredProducts() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-8 text-subtitle text-sm">
          Đang tải...
        </div>
      }
    >
      <FilteredProductsInner />
    </Suspense>
  );
}
