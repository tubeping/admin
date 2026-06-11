"use client";

import { useState, useEffect } from "react";

interface POConfig {
  extra_columns: string[];
  column_aliases: Record<string, string>;
  note: string;
}

interface Supplier {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  business_no: string;
  memo: string;
  status: string;
  po_config: POConfig | null;
  cafe24_supplier_code: string | null;
  short_code: string | null;
  order_email: string | null;
  settlement_email: string | null;
  created_at: string;
}

const DEFAULT_COLUMNS = ["주문번호", "주문상품고유번호", "상품코드", "상품명", "옵션", "수량", "수령자", "배송지", "우편번호", "택배사", "배송번호"];

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", contact_name: "", email: "", phone: "", business_no: "", memo: "",
    cafe24_supplier_code: "", short_code: "", order_email: "", settlement_email: "",
  });
  const [editingConfig, setEditingConfig] = useState<Supplier | null>(null);
  const [configForm, setConfigForm] = useState<POConfig>({ extra_columns: [], column_aliases: {}, note: "" });
  const [newColumn, setNewColumn] = useState("");
  const [form, setForm] = useState({
    name: "", contact_name: "", email: "", phone: "", business_no: "", memo: "",
    cafe24_supplier_code: "", short_code: "", order_email: "", settlement_email: "",
  });
  const [searchKeyword, setSearchKeyword] = useState("");
  const [filters, setFilters] = useState({
    short_code: "", cafe24: "", name: "", contact: "", order_email: "", settlement_email: "",
    form: "all", status: "active",
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchSuppliers = async () => {
    setLoading(true);
    const res = await fetch("/admin/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers || []);
    setLoading(false);
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.email) return;
    await fetch("/admin/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", contact_name: "", email: "", phone: "", business_no: "", memo: "", cafe24_supplier_code: "", short_code: "", order_email: "", settlement_email: "" });
    setShowForm(false);
    fetchSuppliers();
  };

  const handleEdit = async () => {
    if (!editingSupplier) return;
    await fetch(`/admin/api/suppliers/${editingSupplier.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditingSupplier(null);
    fetchSuppliers();
  };

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`"${s.name}" 공급사를 삭제하시겠습니까?\n주문 이력이 있으면 삭제 대신 '비활성' 처리됩니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
    const res = await fetch(`/admin/api/suppliers/${s.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`삭제 실패: ${data.error || res.statusText}`);
      return;
    }
    if (data.soft) alert(`"${s.name}"은(는) 연결된 주문 이력이 있어 삭제 대신 '비활성' 처리되었습니다.`);
    fetchSuppliers();
  };

  const openEdit = (s: Supplier) => {
    setEditingSupplier(s);
    setEditForm({
      name: s.name || "", contact_name: s.contact_name || "", email: s.email || "",
      phone: s.phone || "", business_no: s.business_no || "", memo: s.memo || "",
      cafe24_supplier_code: s.cafe24_supplier_code || "", short_code: s.short_code || "",
      order_email: s.order_email || "", settlement_email: s.settlement_email || "",
    });
  };

  // 검색 + 컬럼별 필터
  const has = (val: string | null | undefined, kw: string) => (val || "").toLowerCase().includes(kw.toLowerCase());
  const filtered = suppliers.filter((s) => {
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      if (!(has(s.name, kw) || has(s.cafe24_supplier_code, kw) || has(s.short_code, kw) || has(s.email, kw))) return false;
    }
    const f = filters;
    if (f.short_code && !has(s.short_code, f.short_code)) return false;
    if (f.cafe24 && !has(s.cafe24_supplier_code, f.cafe24)) return false;
    if (f.name && !has(s.name, f.name)) return false;
    if (f.contact && !has(s.contact_name, f.contact)) return false;
    if (f.order_email && !has(s.order_email || s.email, f.order_email)) return false;
    if (f.settlement_email && !has(s.settlement_email, f.settlement_email)) return false;
    if (f.form !== "all") {
      const hasExtra = (s.po_config?.extra_columns?.length || 0) > 0;
      if (f.form === "custom" && !hasExtra) return false;
      if (f.form === "default" && hasExtra) return false;
    }
    if (f.status !== "all" && s.status !== f.status) return false;
    return true;
  });

  // 체크박스 선택
  const toggleOne = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const toggleAll = () => setSelectedIds(allChecked ? new Set() : new Set(filtered.map((s) => s.id)));

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`선택한 ${ids.length}개 공급사를 삭제하시겠습니까?\n주문 이력이 있는 공급사는 삭제 대신 '비활성' 처리됩니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/admin/api/suppliers/${id}`, { method: "DELETE" })
          .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
          .catch(() => ({ ok: false, data: {} as Record<string, unknown> }))
      )
    );
    const deleted = results.filter((r) => r.ok && r.data.deleted).length;
    const soft = results.filter((r) => r.ok && r.data.soft).length;
    const failed = results.filter((r) => !r.ok).length;
    const msg = [
      deleted ? `${deleted}개 삭제` : "",
      soft ? `${soft}개 비활성 처리(주문 이력 있음)` : "",
      failed ? `${failed}개 실패` : "",
    ].filter(Boolean).join(", ");
    if (msg) alert(msg);
    setSelectedIds(new Set());
    fetchSuppliers();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">공급사 관리</h1>
          <p className="text-sm text-gray-500 mt-1">공급사 코드 관리, 발주/정산 이메일 설정</p>
        </div>
        <div className="flex gap-2">
          <label className="px-4 py-2.5 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer">
            엑셀 업로드
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              const fd = new FormData(); fd.append("file", file);
              const res = await fetch("/admin/api/suppliers/import", { method: "POST", body: fd });
              const data = await res.json();
              if (res.ok) { alert(`${data.imported}건 등록`); fetchSuppliers(); } else alert(`오류: ${data.error}`);
              e.target.value = "";
            }} />
          </label>
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">
            + 공급사 추가
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="mb-4">
        <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-64"
          placeholder="공급사명, 코드, 이메일 검색" />
        <span className="text-sm text-gray-400 ml-3">{filtered.length}개</span>
        {selectedIds.size > 0 && (
          <span className="ml-3 inline-flex items-center gap-2">
            <span className="text-sm text-gray-500">{selectedIds.size}개 선택</span>
            <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 cursor-pointer">선택 삭제</button>
          </span>
        )}
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">새 공급사 등록</h3>
          <div className="grid grid-cols-4 gap-4">
            {[
              { key: "name", label: "공급사명 *", ph: "테크월드" },
              { key: "short_code", label: "공급사 코드 *", ph: "BA (2~4자)" },
              { key: "cafe24_supplier_code", label: "카페24 코드", ph: "S00000BA" },
              { key: "email", label: "대표 이메일 *", ph: "order@techworld.co.kr" },
              { key: "order_email", label: "발주 이메일", ph: "발주서 수신용 (없으면 대표)" },
              { key: "settlement_email", label: "정산 이메일", ph: "정산서 수신용 (없으면 대표)" },
              { key: "contact_name", label: "담당자", ph: "김담당" },
              { key: "phone", label: "연락처", ph: "02-1234-5678" },
              { key: "business_no", label: "사업자번호", ph: "123-45-67890" },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                <input value={form[f.key as keyof typeof form]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={f.ph} />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">상품코드 규칙: TP + 공급사코드 + 상품번호 (예: TP + BA + 00015 = TPBA00015)</p>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSubmit} className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer">등록</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-auto max-h-[calc(100vh-260px)]">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">조건에 맞는 공급사가 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                {[
                  { node: <input type="checkbox" checked={allChecked} onChange={toggleAll} className="cursor-pointer accent-[#C41E1E]" />, align: "text-center", pad: "px-4", filter: null },
                  { label: "코드", align: "text-left", pad: "px-4", key: "short_code", ph: "코드" },
                  { label: "카페24", align: "text-left", pad: "px-3", key: "cafe24", ph: "카페24" },
                  { label: "공급사명", align: "text-left", pad: "px-3", key: "name", ph: "공급사명" },
                  { label: "담당자", align: "text-left", pad: "px-3", key: "contact", ph: "담당자" },
                  { label: "발주 이메일", align: "text-left", pad: "px-3", key: "order_email", ph: "이메일" },
                  { label: "정산 이메일", align: "text-left", pad: "px-3", key: "settlement_email", ph: "이메일" },
                  { label: "양식", align: "text-center", pad: "px-3", select: "form" },
                  { label: "상태", align: "text-center", pad: "px-3", select: "status" },
                  { label: "관리", align: "text-center", pad: "px-3", filter: null },
                ].map((c, i) => (
                  <th key={i} className={`${c.align} ${c.pad} py-2.5 font-medium align-top sticky top-0 z-10 bg-gray-50`}>
                    <div className={`mb-1.5 ${c.align === "text-center" ? "text-center" : ""}`}>{c.node ?? c.label}</div>
                    {c.key && (
                      <input value={filters[c.key as keyof typeof filters]} onChange={(e) => setFilters({ ...filters, [c.key as string]: e.target.value })}
                        className="w-full text-[11px] font-normal border border-gray-200 rounded px-1.5 py-1 bg-white" placeholder={c.ph} />
                    )}
                    {c.select === "form" && (
                      <select value={filters.form} onChange={(e) => setFilters({ ...filters, form: e.target.value })}
                        className="w-full text-[11px] font-normal border border-gray-200 rounded px-1 py-1 bg-white cursor-pointer">
                        <option value="all">전체</option>
                        <option value="default">기본</option>
                        <option value="custom">추가</option>
                      </select>
                    )}
                    {c.select === "status" && (
                      <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                        className="w-full text-[11px] font-normal border border-gray-200 rounded px-1 py-1 bg-white cursor-pointer">
                        <option value="all">전체</option>
                        <option value="active">활성</option>
                        <option value="inactive">비활성</option>
                      </select>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${selectedIds.has(s.id) ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleOne(s.id)} className="cursor-pointer accent-[#C41E1E]" />
                  </td>
                  <td className="px-4 py-3">
                    {s.short_code ? (
                      <code className="text-xs font-mono font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{s.short_code}</code>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <code className="text-[11px] font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-500">
                      {s.cafe24_supplier_code || "-"}
                    </code>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-3 py-3 text-gray-600">{s.contact_name || "-"}</td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{s.order_email || s.email || "-"}</td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{s.settlement_email || "-"}</td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => { setEditingConfig(s); setConfigForm(s.po_config || { extra_columns: [], column_aliases: {}, note: "" }); setNewColumn(""); }}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer">
                      {s.po_config?.extra_columns?.length ? `+${s.po_config.extra_columns.length}` : "기본"}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {s.status === "active" ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <button onClick={() => openEdit(s)} className="text-xs text-[#C41E1E] hover:underline cursor-pointer">수정</button>
                      <button onClick={() => handleDelete(s)} className="text-xs text-red-400 hover:text-red-600 hover:underline cursor-pointer">삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 수정 모달 */}
      {editingSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-1">공급사 수정</h3>
            <p className="text-sm text-gray-500 mb-5">{editingSupplier.name}</p>

            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "name", label: "공급사명" },
                { key: "short_code", label: "공급사 코드 (TP 뒤 2~4자)", ph: "BA" },
                { key: "cafe24_supplier_code", label: "카페24 공급사 코드", ph: "S00000BA" },
                { key: "contact_name", label: "담당자" },
                { key: "email", label: "대표 이메일" },
                { key: "order_email", label: "발주 이메일 (발주서 발송용)", ph: "없으면 대표 이메일 사용" },
                { key: "settlement_email", label: "정산 이메일 (정산서 발송용)", ph: "없으면 대표 이메일 사용" },
                { key: "phone", label: "연락처" },
                { key: "business_no", label: "사업자번호" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                  <input value={editForm[f.key as keyof typeof editForm]}
                    onChange={(e) => setEditForm({ ...editForm, [f.key]: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder={f.ph || ""} />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-1">메모</label>
                <input value={editForm.memo} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-3">상품코드 매핑: TP + {editForm.short_code || "??"} + 상품번호 → 예: TP{editForm.short_code || "BA"}00015</p>

            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEditingSupplier(null)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={handleEdit} className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 발주서 양식 설정 모달 */}
      {editingConfig && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">발주서 양식 설정</h3>
            <p className="text-sm text-gray-500 mb-5">{editingConfig.name}</p>

            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-2">기본 컬럼 (고정)</label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_COLUMNS.map((col) => (
                  <span key={col} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    {configForm.column_aliases[col] || col}
                  </span>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-2">컬럼명 변경 (선택)</label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {DEFAULT_COLUMNS.map((col) => (
                  <div key={col} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-20 shrink-0">{col}</span>
                    <input value={configForm.column_aliases[col] || ""}
                      onChange={(e) => {
                        const aliases = { ...configForm.column_aliases };
                        if (e.target.value) aliases[col] = e.target.value; else delete aliases[col];
                        setConfigForm({ ...configForm, column_aliases: aliases });
                      }}
                      className="text-xs border border-gray-200 rounded px-2 py-1 w-full" placeholder={col} />
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-2">추가 컬럼</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {configForm.extra_columns.map((col) => (
                  <span key={col} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1">
                    {col}
                    <button onClick={() => setConfigForm({ ...configForm, extra_columns: configForm.extra_columns.filter((c) => c !== col) })}
                      className="text-blue-400 hover:text-blue-600 cursor-pointer">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newColumn} onChange={(e) => setNewColumn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newColumn.trim()) { setConfigForm({ ...configForm, extra_columns: [...configForm.extra_columns, newColumn.trim()] }); setNewColumn(""); } }}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 flex-1" placeholder="바코드, 입고예정일 등" />
                <button onClick={() => { if (newColumn.trim()) { setConfigForm({ ...configForm, extra_columns: [...configForm.extra_columns, newColumn.trim()] }); setNewColumn(""); } }}
                  className="px-3 py-1.5 bg-gray-100 text-sm rounded-lg hover:bg-gray-200 cursor-pointer">추가</button>
              </div>
            </div>

            <div className="mb-6">
              <label className="text-xs font-medium text-gray-500 block mb-2">발주서 비고</label>
              <input value={configForm.note} onChange={(e) => setConfigForm({ ...configForm, note: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" placeholder="배송 시 부직포 포장 필수 등" />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingConfig(null)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={async () => {
                await fetch(`/admin/api/suppliers/${editingConfig.id}`, {
                  method: "PUT", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ po_config: configForm }),
                });
                setEditingConfig(null); fetchSuppliers();
              }} className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
