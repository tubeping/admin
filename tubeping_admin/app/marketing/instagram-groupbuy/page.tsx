"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type Outreach = {
  id: string;
  ig_username: string;
  ig_url: string | null;
  ig_full_name: string | null;
  followers: number | null;
  category: string | null;
  product_name: string;
  product_brand: string | null;
  proposed_margin: string | null;
  dm_content: string | null;
  proposed_at: string;
  replied_at: string | null;
  reply_content: string | null;
  status: string;
  campaign_date: string | null;
  agreed_margin: string | null;
  sales_amount: number | null;
  assigned_to: string | null;
  memo: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type ApiResponse = {
  rows: Outreach[];
  stats: {
    total: number;
    by_status: Record<string, number>;
    reply_rate: number;
  };
};

const STATUS_OPTIONS: { key: string; label: string; color: string }[] = [
  { key: "sent", label: "발송", color: "bg-gray-100 text-gray-700" },
  { key: "no_reply", label: "무응답", color: "bg-yellow-100 text-yellow-800" },
  { key: "interested", label: "관심있음", color: "bg-blue-100 text-blue-700" },
  { key: "negotiating", label: "협의중", color: "bg-purple-100 text-purple-700" },
  { key: "accepted", label: "수락", color: "bg-green-100 text-green-700" },
  { key: "rejected", label: "거절", color: "bg-red-100 text-red-700" },
  { key: "running", label: "진행중", color: "bg-indigo-100 text-indigo-700" },
  { key: "done", label: "완료", color: "bg-emerald-100 text-emerald-700" },
];

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.key, s]));

type FormState = Partial<Outreach> & { id?: string };

const EMPTY_FORM: FormState = {
  ig_username: "",
  ig_url: "",
  ig_full_name: "",
  followers: null,
  category: "",
  product_name: "",
  product_brand: "",
  proposed_margin: "",
  dm_content: "",
  proposed_at: new Date().toISOString().slice(0, 16),
  replied_at: null,
  reply_content: "",
  status: "sent",
  campaign_date: null,
  agreed_margin: "",
  sales_amount: null,
  assigned_to: "",
  memo: "",
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function fmtDateOnly(s: string | null | undefined): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

function fmtFollowers(n: number | null): string {
  if (!n) return "-";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function daysBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export default function InstagramGroupbuyPage() {
  const [rows, setRows] = useState<Outreach[]>([]);
  const [stats, setStats] = useState<ApiResponse["stats"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [productFilter, setProductFilter] = useState<string>("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/admin/api/instagram-groupbuy");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiResponse = await res.json();
      setRows(data.rows);
      setStats(data.stats);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const products = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.product_name && s.add(r.product_name));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (productFilter && r.product_name !== productFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [
          r.ig_username, r.ig_full_name, r.product_name,
          r.product_brand, r.memo, r.dm_content, r.reply_content,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, productFilter]);

  function openNew() {
    setForm({ ...EMPTY_FORM, proposed_at: new Date().toISOString().slice(0, 16) });
    setShowForm(true);
  }

  function openEdit(row: Outreach) {
    setForm({
      ...row,
      proposed_at: row.proposed_at ? row.proposed_at.slice(0, 16) : "",
      replied_at: row.replied_at ? row.replied_at.slice(0, 16) : null,
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.ig_username?.trim()) {
      alert("인스타 계정명을 입력하세요.");
      return;
    }
    if (!form.product_name?.trim()) {
      alert("공구 상품명을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (payload.proposed_at && typeof payload.proposed_at === "string") {
        payload.proposed_at = new Date(payload.proposed_at).toISOString();
      }
      if (payload.replied_at && typeof payload.replied_at === "string") {
        payload.replied_at = new Date(payload.replied_at).toISOString();
      } else if (payload.replied_at === "") {
        payload.replied_at = null;
      }

      const url = form.id
        ? `/admin/api/instagram-groupbuy/${form.id}`
        : `/admin/api/instagram-groupbuy`;
      const method = form.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      alert("저장 실패: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/admin/api/instagram-groupbuy/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      alert("삭제 실패: " + String(e));
    }
  }

  async function quickStatus(id: string, status: string) {
    const patch: Record<string, unknown> = { status };
    if (status !== "sent" && status !== "no_reply") {
      const row = rows.find((r) => r.id === id);
      if (row && !row.replied_at) patch.replied_at = new Date().toISOString();
    }
    try {
      const res = await fetch(`/admin/api/instagram-groupbuy/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      alert("상태 변경 실패: " + String(e));
    }
  }

  function statusCount(key: string): number {
    return stats?.by_status[key] || 0;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">인스타 공동구매</h1>
          <p className="text-sm text-gray-500 mt-1">
            인플루언서 DM 제안을 추적합니다. 발송일, 답변일, 상태, 공구 상품을 한 곳에서 관리.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            새로고침
          </button>
          <button
            onClick={openNew}
            className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded hover:bg-[#A01818]"
          >
            + 새 제안 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="전체 제안" value={stats?.total || 0} color="gray" />
        <StatCard label="응답률" value={`${stats?.reply_rate || 0}%`} color="blue" />
        <StatCard label="협의/관심" value={statusCount("interested") + statusCount("negotiating")} color="purple" />
        <StatCard label="수락/진행" value={statusCount("accepted") + statusCount("running")} color="green" />
        <StatCard label="완료" value={statusCount("done")} color="emerald" />
        <StatCard label="거절·무응답" value={statusCount("rejected") + statusCount("no_reply")} color="red" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="검색 (계정/상품/메모/DM 내용...)"
          className="px-3 py-2 border border-gray-300 rounded text-sm flex-1 min-w-[200px] max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">상태 전체</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label} ({statusCount(s.key)})
            </option>
          ))}
        </select>
        <select
          className="px-3 py-2 border border-gray-300 rounded text-sm"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
        >
          <option value="">상품 전체</option>
          {products.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="text-xs text-gray-500 ml-2">
          {filtered.length} / {rows.length}건
        </div>
      </div>

      {err && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          로딩 실패: {err}
          {err.includes("instagram_groupbuy_outreach") && (
            <div className="text-xs mt-2 text-red-600">
              ⚠️ Supabase에 <code className="bg-red-100 px-1 rounded">instagram_groupbuy_outreach</code> 테이블이 없습니다.
              <br />
              Supabase SQL Editor에서 <code className="bg-red-100 px-1 rounded">supabase/migrations/014_instagram_groupbuy.sql</code> 를 실행하세요.
            </div>
          )}
        </div>
      )}
      {loading && (
        <div className="p-8 text-center text-gray-500 text-sm">불러오는 중...</div>
      )}

      {!loading && !err && (
        <>
          <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left">인플루언서</th>
                  <th className="px-3 py-2 text-left">팔로워</th>
                  <th className="px-3 py-2 text-left">공구상품</th>
                  <th className="px-3 py-2 text-left">발송일</th>
                  <th className="px-3 py-2 text-left">답변일</th>
                  <th className="px-3 py-2 text-left">소요</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">담당/메모</th>
                  <th className="px-3 py-2 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-gray-400">
                      제안 기록이 없습니다. 우측 상단 [+ 새 제안 추가] 를 눌러 시작하세요.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const s = STATUS_MAP[r.status] || { label: r.status, color: "bg-gray-100 text-gray-700" };
                  const days = daysBetween(r.proposed_at, r.replied_at);
                  return (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                      <td className="px-3 py-3">
                        <a
                          href={r.ig_url || `https://www.instagram.com/${r.ig_username}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-gray-900 hover:text-blue-600"
                        >
                          @{r.ig_username}
                        </a>
                        {r.ig_full_name && (
                          <div className="text-xs text-gray-500">{r.ig_full_name}</div>
                        )}
                        {r.category && (
                          <div className="text-xs text-gray-400 mt-0.5">{r.category}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{fmtFollowers(r.followers)}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-800">{r.product_name}</div>
                        {r.product_brand && (
                          <div className="text-xs text-gray-500">{r.product_brand}</div>
                        )}
                        {r.proposed_margin && (
                          <div className="text-xs text-gray-400 mt-0.5">제안: {r.proposed_margin}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {fmtDate(r.proposed_at)}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {r.replied_at ? fmtDate(r.replied_at) : <span className="text-gray-300">미응답</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {days !== null ? `${days}일` : "-"}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          className={`text-xs font-medium rounded px-2 py-1 border-0 cursor-pointer ${s.color}`}
                          value={r.status}
                          onChange={(e) => quickStatus(r.id, e.target.value)}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600 max-w-xs">
                        {r.assigned_to && <div className="text-gray-700">담당: {r.assigned_to}</div>}
                        {r.memo && <div className="text-gray-500 line-clamp-2">{r.memo}</div>}
                        {r.campaign_date && (
                          <div className="text-emerald-700 mt-0.5">공구일: {fmtDateOnly(r.campaign_date)}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-xs text-blue-600 hover:underline mr-2"
                        >
                          편집
                        </button>
                        <button
                          onClick={() => remove(r.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {filtered.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm border border-gray-200 rounded-lg">
                제안 기록이 없습니다.
              </div>
            )}
            {filtered.map((r) => {
              const s = STATUS_MAP[r.status] || { label: r.status, color: "bg-gray-100 text-gray-700" };
              return (
                <div key={r.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <a
                        href={r.ig_url || `https://www.instagram.com/${r.ig_username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-900"
                      >
                        @{r.ig_username}
                      </a>
                      <div className="text-xs text-gray-500">
                        {r.ig_full_name} · 팔로워 {fmtFollowers(r.followers)}
                      </div>
                    </div>
                    <span className={`text-xs font-medium rounded px-2 py-1 ${s.color}`}>
                      {s.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 font-medium">{r.product_name}</div>
                  {r.product_brand && (
                    <div className="text-xs text-gray-500">{r.product_brand}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-2 space-y-0.5">
                    <div>발송: {fmtDate(r.proposed_at)}</div>
                    <div>답변: {r.replied_at ? fmtDate(r.replied_at) : "미응답"}</div>
                    {r.memo && <div className="text-gray-700 mt-1">{r.memo}</div>}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => openEdit(r)}
                      className="flex-1 text-xs py-1.5 border border-gray-300 rounded"
                    >
                      편집
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="text-xs py-1.5 px-3 border border-red-200 text-red-600 rounded"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <FormModal
          form={form}
          setForm={setForm}
          onClose={() => setShowForm(false)}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "gray",
}: {
  label: string;
  value: number | string;
  color?: "gray" | "blue" | "green" | "purple" | "red" | "emerald";
}) {
  const colors = {
    gray: "bg-gray-50 text-gray-900",
    blue: "bg-blue-50 text-blue-900",
    green: "bg-green-50 text-green-900",
    purple: "bg-purple-50 text-purple-900",
    red: "bg-red-50 text-red-900",
    emerald: "bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`${colors[color]} rounded-lg p-3`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="text-xl md:text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function FormModal({
  form,
  setForm,
  onClose,
  onSave,
  saving,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm({ ...form, [key]: value });
  }

  function autoIgUrl(name: string): string {
    const clean = name.replace(/^@/, "").trim();
    return clean ? `https://www.instagram.com/${clean}/` : "";
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-0 md:p-4 overflow-y-auto">
      <div className="bg-white w-full md:max-w-3xl md:rounded-lg max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {form.id ? "제안 편집" : "새 제안 추가"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="인스타 계정명 *" required>
              <input
                type="text"
                placeholder="예: tubeping_kr"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.ig_username || ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/^@/, "");
                  const url = form.ig_url && !form.ig_url.includes(form.ig_username || "")
                    ? form.ig_url
                    : autoIgUrl(v);
                  setForm({ ...form, ig_username: v, ig_url: url });
                }}
              />
            </Field>
            <Field label="인스타 URL">
              <input
                type="url"
                placeholder="https://www.instagram.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.ig_url || ""}
                onChange={(e) => update("ig_url", e.target.value)}
              />
            </Field>
            <Field label="표시 이름">
              <input
                type="text"
                placeholder="예: 김미소 / 뷰티 인플루언서"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.ig_full_name || ""}
                onChange={(e) => update("ig_full_name", e.target.value)}
              />
            </Field>
            <Field label="팔로워">
              <input
                type="number"
                placeholder="50000"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.followers ?? ""}
                onChange={(e) => update("followers", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            <Field label="카테고리">
              <input
                type="text"
                placeholder="예: 뷰티 / 패션 / 푸드 / 라이프"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.category || ""}
                onChange={(e) => update("category", e.target.value)}
              />
            </Field>
            <Field label="담당자">
              <input
                type="text"
                placeholder="예: 최준우 / 마케팅팀"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.assigned_to || ""}
                onChange={(e) => update("assigned_to", e.target.value)}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="공구 상품 *" required>
              <input
                type="text"
                placeholder="예: 이너피스 마스크팩 30매"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.product_name || ""}
                onChange={(e) => update("product_name", e.target.value)}
              />
            </Field>
            <Field label="브랜드">
              <input
                type="text"
                placeholder="예: 신산애널리틱스 / 초이스메디케어"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.product_brand || ""}
                onChange={(e) => update("product_brand", e.target.value)}
              />
            </Field>
            <Field label="제안 조건/마진">
              <input
                type="text"
                placeholder='예: "건당 5000원" / "매출 30%"'
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.proposed_margin || ""}
                onChange={(e) => update("proposed_margin", e.target.value)}
              />
            </Field>
            <Field label="협의된 조건 (수락 후)">
              <input
                type="text"
                placeholder="협상 결과"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.agreed_margin || ""}
                onChange={(e) => update("agreed_margin", e.target.value)}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <Field label="DM 본문 (보낸 메시지)">
              <textarea
                rows={5}
                placeholder="안녕하세요 ㅇㅇ님, ..."
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                value={form.dm_content || ""}
                onChange={(e) => update("dm_content", e.target.value)}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="DM 발송일시 *" required>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={(form.proposed_at as string) || ""}
                onChange={(e) => update("proposed_at", e.target.value)}
              />
            </Field>
            <Field label="답변 받은 일시">
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={(form.replied_at as string) || ""}
                onChange={(e) => update("replied_at", e.target.value || null)}
              />
            </Field>
            <Field label="상태">
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.status || "sent"}
                onChange={(e) => update("status", e.target.value)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </Field>
            <Field label="공구 진행일">
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={(form.campaign_date as string) || ""}
                onChange={(e) => update("campaign_date", e.target.value || null)}
              />
            </Field>
            <Field label="매출 (완료 후)">
              <input
                type="number"
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.sales_amount ?? ""}
                onChange={(e) => update("sales_amount", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <Field label="답변 내용 요약">
              <textarea
                rows={3}
                placeholder="인플루언서가 보내온 답변 요약"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.reply_content || ""}
                onChange={(e) => update("reply_content", e.target.value)}
              />
            </Field>
            <Field label="메모">
              <textarea
                rows={2}
                placeholder="협의 메모, 일정, 추가 조건 등"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={form.memo || ""}
                onChange={(e) => update("memo", e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded hover:bg-[#A01818] disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
