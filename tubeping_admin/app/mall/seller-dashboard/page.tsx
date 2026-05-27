"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";

interface SellerLink {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  memo: string | null;
  status: string;
  view_token: string | null;
}

type ModalState =
  | { type: null }
  | { type: "add" }
  | { type: "edit"; seller: SellerLink }
  | { type: "delete"; seller: SellerLink };

const TABLE_HEADERS = ["판매처명", "담당자", "대시보드 URL", "상태", "관리"] as const;

export default function SellerDashboardPage() {
  const [clients, setClients] = useState<SellerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formMemo, setFormMemo] = useState("");

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/admin/api/phone-order-clients");
      const data = await res.json();
      setClients(data.clients || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const copyLink = async (client: SellerLink) => {
    if (!client.view_token) return;
    const url = `${baseUrl}/admin/seller/${client.view_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(client.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt("링크를 복사하세요:", url);
    }
  };

  const openAdd = () => {
    setFormName("");
    setFormContact("");
    setFormPhone("");
    setFormMemo("");
    setError(null);
    setModal({ type: "add" });
  };

  const openEdit = (seller: SellerLink) => {
    setFormName(seller.name);
    setFormContact(seller.contact_name || "");
    setFormPhone(seller.phone || "");
    setFormMemo(seller.memo || "");
    setError(null);
    setModal({ type: "edit", seller });
  };

  const openDelete = (seller: SellerLink) => {
    setError(null);
    setModal({ type: "delete", seller });
  };

  const closeModal = () => {
    setModal({ type: null });
    setError(null);
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!formName.trim()) {
      setError("판매처명을 입력해주세요.");
      return;
    }
    const isEdit = modal.type === "edit";
    setSaving(true);
    setError(null);
    try {
      const body = isEdit
        ? { id: modal.seller.id, updates: { name: formName.trim(), contact_name: formContact.trim() || null, phone: formPhone.trim() || null, memo: formMemo.trim() || null } }
        : { name: formName.trim(), contact_name: formContact.trim() || null, phone: formPhone.trim() || null, memo: formMemo.trim() || null };
      const res = await fetch("/admin/api/phone-order-clients", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (isEdit ? "수정에 실패했습니다." : "추가에 실패했습니다."));
        return;
      }
      closeModal();
      fetchClients();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (modal.type !== "delete") return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/admin/api/phone-order-clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: modal.seller.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "삭제에 실패했습니다.");
        return;
      }
      closeModal();
      fetchClients();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (seller: SellerLink) => {
    if (togglingId) return;
    setTogglingId(seller.id);
    try {
      const res = await fetch("/admin/api/phone-order-clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: seller.id,
          updates: { status: seller.status === "active" ? "inactive" : "active" },
        }),
      });
      if (res.ok) fetchClients();
    } finally {
      setTogglingId(null);
    }
  };

  const activeClients = clients.filter((c) => c.status === "active");
  const inactiveClients = clients.filter((c) => c.status !== "active");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">판매사 대시보드</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            판매사별 주문 현황 조회 링크를 관리합니다
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[#C41E1E] text-white hover:bg-[#A01818] transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          판매사 추가
        </button>
      </div>

      <SellerTable
        title="활성 판매사"
        clients={activeClients}
        loading={loading}
        baseUrl={baseUrl}
        copied={copied}
        togglingId={togglingId}
        onCopy={copyLink}
        onEdit={openEdit}
        onDelete={openDelete}
        onToggleStatus={handleToggleStatus}
      />

      {!loading && inactiveClients.length > 0 && (
        <SellerTable
          title="비활성 판매사"
          inactive
          clients={inactiveClients}
          loading={false}
          baseUrl={baseUrl}
          copied={copied}
          togglingId={togglingId}
          onCopy={copyLink}
          onEdit={openEdit}
          onDelete={openDelete}
          onToggleStatus={handleToggleStatus}
        />
      )}

      {/* Modal */}
      {modal.type && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {modal.type === "delete" ? (
              <div className="p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-2">판매사 삭제</h2>
                <p className="text-sm text-gray-600 mb-1">
                  <strong>{modal.seller.name}</strong>을(를) 삭제하시겠습니까?
                </p>
                <p className="text-xs text-gray-400 mb-5">
                  주문이 존재하는 판매처는 삭제할 수 없으며, 비활성화만 가능합니다.
                </p>
                {error && <ErrorBanner message={error} />}
                <div className="flex gap-2 justify-end">
                  <button onClick={closeModal} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    취소
                  </button>
                  <button onClick={handleDelete} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                    {saving ? "삭제 중..." : "삭제"}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-5">
                  {modal.type === "add" ? "판매사 추가" : "판매사 수정"}
                </h2>
                {error && <ErrorBanner message={error} />}
                <div className="space-y-4">
                  <Field label="판매처명" required value={formName} onChange={setFormName} placeholder="판매처 이름" />
                  <Field label="담당자" value={formContact} onChange={setFormContact} placeholder="담당자 이름" />
                  <Field label="연락처" value={formPhone} onChange={setFormPhone} placeholder="010-0000-0000" />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">메모</label>
                    <textarea
                      value={formMemo}
                      onChange={(e) => setFormMemo(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E] resize-none"
                      placeholder="메모 (선택)"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-6">
                  <button type="button" onClick={closeModal} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    취소
                  </button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-[#C41E1E] text-white hover:bg-[#A01818] disabled:opacity-50">
                    {saving ? (modal.type === "add" ? "추가 중..." : "저장 중...") : (modal.type === "add" ? "추가" : "저장")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Shared Components ─── */

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      {message}
    </div>
  );
}

function Field({ label, required, value, onChange, placeholder }: {
  label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
        placeholder={placeholder}
      />
    </div>
  );
}

function SellerTable({ title, inactive, clients, loading, baseUrl, copied, togglingId, onCopy, onEdit, onDelete, onToggleStatus }: {
  title: string; inactive?: boolean; clients: SellerLink[]; loading: boolean; baseUrl: string;
  copied: string | null; togglingId: string | null;
  onCopy: (c: SellerLink) => void; onEdit: (c: SellerLink) => void;
  onDelete: (c: SellerLink) => void; onToggleStatus: (c: SellerLink) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <span className={`text-xs font-semibold ${inactive ? "text-gray-400" : "text-gray-600"}`}>
          {title} ({clients.length})
        </span>
      </div>
      {loading ? (
        <p className="py-16 text-center text-gray-400">불러오는 중...</p>
      ) : clients.length === 0 ? (
        <p className="py-16 text-center text-gray-400">등록된 판매처가 없습니다</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {TABLE_HEADERS.map((h) => (
                <th key={h} className={`px-5 py-3 text-xs font-semibold text-gray-500 ${h === "관리" ? "text-center" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <SellerRow key={c.id} client={c} baseUrl={baseUrl} copied={copied} togglingId={togglingId}
                onCopy={onCopy} onEdit={onEdit} onDelete={onDelete} onToggleStatus={onToggleStatus} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SellerRow({ client: c, baseUrl, copied, togglingId, onCopy, onEdit, onDelete, onToggleStatus }: {
  client: SellerLink; baseUrl: string; copied: string | null; togglingId: string | null;
  onCopy: (c: SellerLink) => void; onEdit: (c: SellerLink) => void;
  onDelete: (c: SellerLink) => void; onToggleStatus: (c: SellerLink) => void;
}) {
  const isActive = c.status === "active";
  const url = c.view_token ? `${baseUrl}/admin/seller/${c.view_token}` : null;
  const tokenDisplay = c.view_token ? (c.view_token.length > 10 ? c.view_token.slice(0, 8) + "..." : c.view_token) : null;
  const isToggling = togglingId === c.id;

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50/50 ${!isActive ? "opacity-50" : ""}`}>
      <td className="px-5 py-3.5">
        <span className="text-sm font-medium text-gray-900">{c.name}</span>
      </td>
      <td className="px-5 py-3.5 text-xs text-gray-500">
        {c.contact_name || "-"}
        {c.phone && <span className="ml-2 text-gray-400">{c.phone}</span>}
      </td>
      <td className="px-5 py-3.5">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-mono">
            /admin/seller/{tokenDisplay}
          </a>
        ) : (
          <span className="text-xs text-gray-400">토큰 없음</span>
        )}
      </td>
      <td className="px-5 py-3.5">
        <button
          onClick={() => onToggleStatus(c)}
          disabled={isToggling}
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full transition-colors disabled:opacity-50 ${
            isActive ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
          {isToggling ? "..." : isActive ? "활성" : "비활성"}
        </button>
      </td>
      <td className="px-5 py-3.5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          {url && (
            <>
              <button
                onClick={() => onCopy(c)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  copied === c.id ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {copied === c.id ? "복사됨!" : "링크 복사"}
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#C41E1E] text-white hover:bg-[#A01818] transition-colors">
                열기
              </a>
            </>
          )}
          <button onClick={() => onEdit(c)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
            수정
          </button>
          <button onClick={() => onDelete(c)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
            삭제
          </button>
        </div>
      </td>
    </tr>
  );
}
