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
  created_at: string;
}

const DEFAULT_COLUMNS = ["주문번호", "주문상품고유번호", "상품코드", "상품명", "옵션", "수량", "수령자", "배송지", "우편번호", "택배사", "배송번호"];

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<Supplier | null>(null);
  const [configForm, setConfigForm] = useState<POConfig>({
    extra_columns: [],
    column_aliases: {},
    note: "",
  });
  const [newColumn, setNewColumn] = useState("");
  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    email: "",
    phone: "",
    business_no: "",
    memo: "",
  });

  const fetchSuppliers = async () => {
    setLoading(true);
    const res = await fetch("/admin/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.email) return;

    await fetch("/admin/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setForm({ name: "", contact_name: "", email: "", phone: "", business_no: "", memo: "" });
    setShowForm(false);
    fetchSuppliers();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">공급사 관리</h1>
          <p className="text-sm text-gray-500 mt-1">발주서를 발송할 공급사 목록을 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <label className="px-4 py-2.5 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer">
            엑셀 업로드
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/admin/api/suppliers/import", { method: "POST", body: fd });
                const data = await res.json();
                if (res.ok) {
                  alert(`${data.imported}건 등록 완료${data.errors?.length ? ` (${data.errors.length}건 오류)` : ""}`);
                  fetchSuppliers();
                } else {
                  alert(`오류: ${data.error}`);
                }
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer"
          >
            + 공급사 추가
          </button>
        </div>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">새 공급사 등록</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">공급사명 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="테크월드"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">이메일 *</label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="order@techworld.co.kr"
                type="email"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">담당자</label>
              <input
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="김담당"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">연락처</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="02-1234-5678"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">사업자번호</label>
              <input
                value={form.business_no}
                onChange={(e) => setForm({ ...form, business_no: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="123-45-67890"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">메모</label>
              <input
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer"
            >
              등록
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-12 text-center text-gray-400">불러오는 중...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            등록된 공급사가 없습니다. &quot;공급사 추가&quot; 버튼으로 등록하세요.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-3 font-medium">공급사코드</th>
                <th className="text-left px-3 py-3 font-medium">공급사명</th>
                <th className="text-left px-3 py-3 font-medium">담당자</th>
                <th className="text-left px-3 py-3 font-medium">이메일</th>
                <th className="text-left px-3 py-3 font-medium">연락처</th>
                <th className="text-center px-3 py-3 font-medium">발주양식</th>
                <th className="text-center px-3 py-3 font-medium">상태</th>
                <th className="text-center px-3 py-3 font-medium">설정</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-6 py-3.5">
                    <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                      {s.cafe24_supplier_code || "-"}
                    </code>
                  </td>
                  <td className="px-3 py-3.5 text-sm font-medium text-gray-900">{s.name}</td>
                  <td className="px-3 py-3.5 text-sm text-gray-700">{s.contact_name || "-"}</td>
                  <td className="px-3 py-3.5 text-sm text-gray-500">{s.email}</td>
                  <td className="px-3 py-3.5 text-sm text-gray-500">{s.phone || "-"}</td>
                  <td className="px-3 py-3.5 text-center">
                    {s.po_config?.extra_columns?.length ? (
                      <span className="text-xs text-blue-600">+{s.po_config.extra_columns.length}컬럼</span>
                    ) : (
                      <span className="text-xs text-gray-300">기본</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${
                        s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {s.status === "active" ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <button
                      onClick={() => {
                        setEditingConfig(s);
                        setConfigForm(s.po_config || { extra_columns: [], column_aliases: {}, note: "" });
                        setNewColumn("");
                      }}
                      className="text-xs text-[#C41E1E] hover:underline cursor-pointer"
                    >
                      양식설정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 발주서 양식 설정 모달 */}
      {editingConfig && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              발주서 양식 설정
            </h3>
            <p className="text-sm text-gray-500 mb-5">{editingConfig.name}</p>

            {/* 기본 컬럼 */}
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

            {/* 컬럼명 변경 */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-2">컬럼명 변경 (선택)</label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {DEFAULT_COLUMNS.map((col) => (
                  <div key={col} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-20 shrink-0">{col}</span>
                    <input
                      value={configForm.column_aliases[col] || ""}
                      onChange={(e) => {
                        const aliases = { ...configForm.column_aliases };
                        if (e.target.value) aliases[col] = e.target.value;
                        else delete aliases[col];
                        setConfigForm({ ...configForm, column_aliases: aliases });
                      }}
                      className="text-xs border border-gray-200 rounded px-2 py-1 w-full"
                      placeholder={col}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 추가 컬럼 */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 block mb-2">추가 컬럼</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {configForm.extra_columns.map((col) => (
                  <span
                    key={col}
                    className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1"
                  >
                    {col}
                    <button
                      onClick={() =>
                        setConfigForm({
                          ...configForm,
                          extra_columns: configForm.extra_columns.filter((c) => c !== col),
                        })
                      }
                      className="text-blue-400 hover:text-blue-600 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newColumn.trim()) {
                      setConfigForm({
                        ...configForm,
                        extra_columns: [...configForm.extra_columns, newColumn.trim()],
                      });
                      setNewColumn("");
                    }
                  }}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 flex-1"
                  placeholder="바코드, 입고예정일, 공급가 등"
                />
                <button
                  onClick={() => {
                    if (newColumn.trim()) {
                      setConfigForm({
                        ...configForm,
                        extra_columns: [...configForm.extra_columns, newColumn.trim()],
                      });
                      setNewColumn("");
                    }
                  }}
                  className="px-3 py-1.5 bg-gray-100 text-sm rounded-lg hover:bg-gray-200 cursor-pointer"
                >
                  추가
                </button>
              </div>
            </div>

            {/* 비고 */}
            <div className="mb-6">
              <label className="text-xs font-medium text-gray-500 block mb-2">발주서 비고</label>
              <input
                value={configForm.note}
                onChange={(e) => setConfigForm({ ...configForm, note: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                placeholder="배송 시 부직포 포장 필수 등"
              />
            </div>

            {/* 버튼 */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingConfig(null)}
                className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  await fetch(`/admin/api/suppliers/${editingConfig.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ po_config: configForm }),
                  });
                  setEditingConfig(null);
                  fetchSuppliers();
                }}
                className="px-4 py-2 bg-[#C41E1E] text-white text-sm rounded-lg hover:bg-[#A01818] cursor-pointer"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
