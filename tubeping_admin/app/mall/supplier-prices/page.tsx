"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_product_code: string | null;
  supply_price: number;
  supply_shipping_fee: number;
  tax_type: string;
  created_at: string;
  suppliers: { id: string; name: string } | null;
  products: { id: string; product_name: string; price: number } | null;
}

interface Supplier { id: string; name: string; }
interface Product { id: string; product_name: string; price: number; tp_code: string; }

export default function SupplierPricesPage() {
  const [items, setItems] = useState<SupplierProduct[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterKeyword, setFilterKeyword] = useState("");

  // 추가/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<SupplierProduct | null>(null);
  const [form, setForm] = useState({
    supplier_id: "",
    product_id: "",
    supply_price: 0,
    supply_shipping_fee: 0,
    tax_type: "과세",
    supplier_product_code: "",
  });
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [spRes, supRes, prodRes] = await Promise.all([
      fetch("/admin/api/supplier-products"),
      fetch("/admin/api/suppliers?status=active"),
      fetch("/admin/api/products?limit=5000"),
    ]);
    const [spData, supData, prodData] = await Promise.all([spRes.json(), supRes.json(), prodRes.json()]);
    setItems(spData.items || []);
    setSuppliers(supData.suppliers || []);
    setProducts((prodData.products || []).map((p: any) => ({ id: p.id, product_name: p.product_name, price: p.price, tp_code: p.tp_code })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let list = items;
    if (filterSupplier) list = list.filter((i) => i.supplier_id === filterSupplier);
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase();
      list = list.filter((i) =>
        i.products?.product_name?.toLowerCase().includes(kw) ||
        i.supplier_product_code?.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [items, filterSupplier, filterKeyword]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 50);
    const kw = productSearch.toLowerCase();
    return products.filter((p) => p.product_name.toLowerCase().includes(kw) || p.tp_code?.toLowerCase().includes(kw)).slice(0, 50);
  }, [products, productSearch]);

  const openAdd = () => {
    setEditItem(null);
    setForm({ supplier_id: "", product_id: "", supply_price: 0, supply_shipping_fee: 0, tax_type: "과세", supplier_product_code: "" });
    setProductSearch("");
    setShowModal(true);
  };

  const openEdit = (item: SupplierProduct) => {
    setEditItem(item);
    setForm({
      supplier_id: item.supplier_id,
      product_id: item.product_id,
      supply_price: item.supply_price,
      supply_shipping_fee: item.supply_shipping_fee,
      tax_type: item.tax_type || "과세",
      supplier_product_code: item.supplier_product_code || "",
    });
    setProductSearch(item.products?.product_name || "");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.supplier_id || !form.product_id) return alert("공급사와 상품을 선택하세요.");
    setSaving(true);
    const res = await fetch("/admin/api/supplier-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowModal(false);
      fetchData();
    } else {
      const err = await res.json();
      alert(err.error || "저장 실패");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/admin/api/supplier-products?id=${id}`, { method: "DELETE" });
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">공급사별 상품가격</h1>
          <p className="text-xs text-gray-400 mt-0.5">공급사+상품 조합별 공급가/배송비를 관리합니다</p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 추가
        </button>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-3">
        <select
          value={filterSupplier}
          onChange={(e) => setFilterSupplier(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-3 py-1.5 bg-gray-50 min-w-[160px]"
        >
          <option value="">전체 공급사</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          type="text"
          placeholder="상품명 / 상품코드 검색"
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-3 py-1.5 bg-gray-50 flex-1 max-w-[300px]"
        />
        <span className="text-xs text-gray-400 ml-auto">{filtered.length}건</span>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500">공급사</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500">상품명</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500">공급사 상품코드</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500">판매가</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500">공급가</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500">공급배송비</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500">과세</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500">마진</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 w-20">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-300">등록된 항목이 없습니다</td></tr>
              )}
              {filtered.map((item) => {
                const salePrice = item.products?.price || 0;
                const margin = salePrice - item.supply_price - item.supply_shipping_fee;
                const marginRate = salePrice > 0 ? Math.round((margin / salePrice) * 100) : 0;
                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-700 whitespace-nowrap">{item.suppliers?.name || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-900 max-w-[250px] truncate">{item.products?.product_name || "-"}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{item.supplier_product_code || "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right tabular-nums">{salePrice.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900 text-right tabular-nums">{item.supply_price.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-right tabular-nums">{item.supply_shipping_fee.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.tax_type === "면세" ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-500"}`}>
                        {item.tax_type || "과세"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums whitespace-nowrap">
                      <span className={margin >= 0 ? "text-blue-600" : "text-red-500"}>
                        {margin.toLocaleString()} ({marginRate}%)
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="text-[10px] text-blue-500 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50">수정</button>
                        <button onClick={() => handleDelete(item.id)} className="text-[10px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 추가/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-gray-900">{editItem ? "공급사별 상품가격 수정" : "공급사별 상품가격 추가"}</h2>

            <div className="space-y-3">
              {/* 공급사 */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">공급사</label>
                <select
                  value={form.supplier_id}
                  onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                  disabled={!!editItem}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">선택</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* 상품 */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">상품</label>
                {editItem ? (
                  <input type="text" value={editItem.products?.product_name || ""} disabled className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-400" />
                ) : (
                  <div className="space-y-1">
                    <input
                      type="text"
                      placeholder="상품명 또는 코드로 검색..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2"
                    />
                    {productSearch && (
                      <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                        {filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setForm((f) => ({ ...f, product_id: p.id }));
                              setProductSearch(p.product_name);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 transition-colors ${form.product_id === p.id ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
                          >
                            <span className="font-mono text-gray-400 mr-2">{p.tp_code}</span>
                            {p.product_name}
                            <span className="text-gray-300 ml-2">{p.price.toLocaleString()}원</span>
                          </button>
                        ))}
                        {filteredProducts.length === 0 && <div className="px-3 py-2 text-xs text-gray-300">검색 결과 없음</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 가격 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">공급가 (원)</label>
                  <input
                    type="number"
                    value={form.supply_price}
                    onChange={(e) => setForm((f) => ({ ...f, supply_price: parseInt(e.target.value) || 0 }))}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">공급배송비 (원)</label>
                  <input
                    type="number"
                    value={form.supply_shipping_fee}
                    onChange={(e) => setForm((f) => ({ ...f, supply_shipping_fee: parseInt(e.target.value) || 0 }))}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">과세 구분</label>
                  <select
                    value={form.tax_type}
                    onChange={(e) => setForm((f) => ({ ...f, tax_type: e.target.value }))}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2"
                  >
                    <option value="과세">과세</option>
                    <option value="면세">면세</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">공급사 상품코드</label>
                  <input
                    type="text"
                    value={form.supplier_product_code}
                    onChange={(e) => setForm((f) => ({ ...f, supplier_product_code: e.target.value }))}
                    placeholder="선택사항"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50">취소</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
