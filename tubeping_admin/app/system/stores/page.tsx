"use client";

import { useState, useEffect, useCallback } from "react";

type Store = {
  id: string;
  mall_id: string;
  name: string;
  channel: string | null;
  subscribers: number;
  store_url: string | null;
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  active: { label: "연동됨", cls: "bg-green-100 text-green-700" },
  pending: { label: "미연동", cls: "bg-yellow-100 text-yellow-700" },
  building: { label: "구축중", cls: "bg-blue-100 text-blue-700" },
  paused: { label: "중지", cls: "bg-gray-100 text-gray-500" },
  error: { label: "오류", cls: "bg-red-100 text-red-700" },
  auth_failed: { label: "재인증 필요", cls: "bg-red-100 text-red-700" },
};

function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  return n.toLocaleString();
}

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ mall_id: "", name: "", channel: "", subscribers: "", store_url: "" });
  const [addError, setAddError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // URL 파라미터에서 연동 성공 메시지 확인
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected) {
      setSuccessMsg(`${connected} 스토어 연동 완료!`);
      setTimeout(() => setSuccessMsg(""), 5000);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/admin/api/stores");
      const data = await res.json();
      setStores(data.stores || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const handleAdd = async () => {
    setAddError("");
    if (!addForm.mall_id || !addForm.name) {
      setAddError("카페24 Mall ID와 스토어 이름은 필수입니다");
      return;
    }
    const res = await fetch("/admin/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mall_id: addForm.mall_id.trim(),
        name: addForm.name.trim(),
        channel: addForm.channel.trim() || null,
        subscribers: Number(addForm.subscribers) || 0,
        store_url: addForm.store_url.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      setAddError(err.error || "추가 실패");
      return;
    }
    setAddForm({ mall_id: "", name: "", channel: "", subscribers: "", store_url: "" });
    setShowAdd(false);
    fetchStores();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`${name} 스토어를 삭제하시겠습니까?`)) return;
    await fetch(`/admin/api/stores/${id}`, { method: "DELETE" });
    fetchStores();
  };

  const handleOAuth = (id: string) => {
    window.location.href = `/admin/api/stores/${id}/oauth`;
  };

  const handleOAuthAll = () => {
    // 마스터(tubeping) + 더미(manual_/excel_/test_) 제외, 나머지 전부 큐에 (스코프 갱신/강제 재인증 용도)
    const targets = stores.filter((s) => {
      if (s.mall_id === "tubeping") return false;
      if (s.mall_id.startsWith("manual_") || s.mall_id.startsWith("excel_") || s.mall_id.startsWith("test_")) return false;
      return true;
    });
    if (targets.length === 0) {
      alert("OAuth 가능한 sub-mall이 없습니다.");
      return;
    }
    if (!confirm(`${targets.length}개 sub-mall을 순차로 OAuth합니다. 카페24에서 권한 승인 화면이 ${targets.length}번 뜹니다. 진행할까요?`)) return;
    const [first, ...rest] = targets.map((s) => s.id);
    const url = rest.length > 0
      ? `/admin/api/stores/${first}/oauth?queue=${rest.join(",")}`
      : `/admin/api/stores/${first}/oauth`;
    window.location.href = url;
  };

  const isTokenExpired = (expiresAt: string | null) => {
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() < Date.now();
  };

  const activeCount = stores.filter((s) => s.status === "active").length;
  const pendingCount = stores.filter((s) => s.status === "pending").length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">카페24 스토어 관리</h1>
          <p className="text-sm text-gray-500 mt-1">유튜버별 카페24 계정을 연동하고 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOAuthAll}
            className="px-4 py-2.5 bg-white border border-[#C41E1E] text-[#C41E1E] text-sm font-medium rounded-lg hover:bg-red-50 cursor-pointer"
          >
            전체 일괄 OAuth
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer"
          >
            + 스토어 추가
          </button>
        </div>
      </div>

      {/* 성공 메시지 */}
      {successMsg && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 text-sm rounded-lg border border-green-200 flex items-center gap-2">
          <span className="text-lg">&#10003;</span>
          {successMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">전체 스토어</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stores.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">연동 완료</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">미연동</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{pendingCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">공유 앱</p>
          <p className="text-sm font-bold text-gray-900 mt-1 font-mono">{process.env.NEXT_PUBLIC_SUPABASE_URL ? "연결됨" : "-"}</p>
        </div>
      </div>

      {/* 스토어 추가 폼 */}
      {showAdd && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">새 카페24 스토어 추가</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">카페24 Mall ID *</label>
              <input
                type="text"
                placeholder="예: comicmart"
                value={addForm.mall_id}
                onChange={(e) => setAddForm({ ...addForm, mall_id: e.target.value })}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
              <p className="text-[10px] text-gray-400 mt-1">{addForm.mall_id || "mall_id"}.cafe24.com</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">스토어 이름 *</label>
              <input
                type="text"
                placeholder="예: 코믹마트"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
            </div>
          </div>
          {addError && <p className="text-xs text-red-500 mb-3">{addError}</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleAdd} className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">
              추가
            </button>
            <button onClick={() => { setShowAdd(false); setAddError(""); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
              취소
            </button>
          </div>
        </div>
      )}

      {/* 스토어 목록 */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left px-6 py-3 font-medium">스토어</th>
                <th className="text-left px-3 py-3 font-medium">카페24 ID</th>
                <th className="text-right px-3 py-3 font-medium">구독자</th>
                <th className="text-center px-3 py-3 font-medium">연동 상태</th>
                <th className="text-center px-3 py-3 font-medium">토큰</th>
                <th className="text-right px-3 py-3 font-medium">마지막 동기화</th>
                <th className="text-center px-6 py-3 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const st = STATUS_CONFIG[store.status] || STATUS_CONFIG.pending;
                const expired = isTokenExpired(store.token_expires_at);
                const isMaster = store.mall_id === "tubeping";

                return (
                  <tr key={store.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold ${isMaster ? "bg-[#C41E1E]" : "bg-gray-700"}`}>
                          {store.name.slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {store.name}
                            {isMaster && <span className="ml-1.5 text-[10px] bg-[#C41E1E] text-white px-1.5 py-0.5 rounded font-bold">MASTER</span>}
                          </p>
                          {store.channel && <p className="text-xs text-gray-400">{store.channel}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-xs text-blue-500 font-mono">{store.mall_id}</span>
                    </td>
                    <td className="px-3 py-3.5 text-sm text-gray-700 text-right">
                      {store.subscribers > 0 ? formatNumber(store.subscribers) : "-"}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {store.access_token ? (
                        expired ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">만료</span>
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">유효</span>
                        )
                      ) : (
                        <span className="text-[10px] text-gray-400">없음</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-xs text-gray-500 text-right">
                      {store.last_sync_at ? new Date(store.last_sync_at).toLocaleDateString("ko") : "-"}
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {store.status === "pending" || store.status === "auth_failed" || (store.access_token && expired) ? (
                          <button
                            onClick={() => handleOAuth(store.id)}
                            className="text-xs font-medium text-white bg-[#C41E1E] px-3 py-1.5 rounded-lg hover:bg-[#A01818] cursor-pointer"
                          >
                            연동하기
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOAuth(store.id)}
                            className="text-xs text-gray-500 hover:text-[#C41E1E] cursor-pointer"
                          >
                            재연동
                          </button>
                        )}
                        {!isMaster && (
                          <button
                            onClick={() => handleDelete(store.id, store.name)}
                            className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 연동 안내 */}
      <div className="mt-6 bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/10 p-6">
        <h3 className="text-sm font-bold text-[#C41E1E] mb-3">카페24 스토어 연동 방법</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { step: "1", title: "스토어 추가", desc: "유튜버 카페24 Mall ID와 이름 입력" },
            { step: "2", title: "연동하기 클릭", desc: "카페24 OAuth 인증 → 권한 승인" },
            { step: "3", title: "자동 완료", desc: "토큰 자동 저장, 상품관리에서 바로 사용" },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-8 h-8 rounded-full bg-[#C41E1E] text-white font-bold text-sm flex items-center justify-center mx-auto mb-2">
                {item.step}
              </div>
              <p className="text-sm font-semibold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
