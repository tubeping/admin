"use client";

import { useState, useEffect, useCallback } from "react";

type KeyResult = {
  id: string;
  objective_id: string;
  title: string;
  metric_type: "number" | "percent" | "currency" | "boolean";
  unit: string;
  start_value: number;
  current_value: number;
  target_value: number;
  note: string | null;
  progress: number;
  sort_order: number;
};

type Objective = {
  id: string;
  quarter: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: number;
  emoji: string;
  owner: string | null;
  status: string;
  sort_order: number;
  key_results: KeyResult[];
  progress: number;
};

const PRIORITY_STYLE: Record<number, { label: string; color: string }> = {
  1: { label: "최우선", color: "bg-red-100 text-red-700 border-red-200" },
  2: { label: "높음", color: "bg-orange-100 text-orange-700 border-orange-200" },
  3: { label: "중간", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  4: { label: "낮음", color: "bg-blue-100 text-blue-700 border-blue-200" },
  5: { label: "보류", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

const CATEGORY_STYLE: Record<string, string> = {
  운영: "bg-blue-50 text-blue-700",
  성장: "bg-green-50 text-green-700",
  수익화: "bg-purple-50 text-purple-700",
  투자: "bg-pink-50 text-pink-700",
};

function formatValue(kr: KeyResult, value: number): string {
  if (kr.metric_type === "boolean") return value >= 1 ? "✓ 완료" : "미완료";
  if (kr.metric_type === "currency") return `₩${value.toLocaleString()}`;
  if (kr.metric_type === "percent") return `${value}%`;
  return `${value.toLocaleString()}${kr.unit ? ` ${kr.unit}` : ""}`;
}

function quarterOptions(): string[] {
  const opts: string[] = [];
  const now = new Date();
  const curY = now.getFullYear();
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < 4; i++) {
    let y = curY;
    let q = curQ - i;
    while (q <= 0) {
      q += 4;
      y -= 1;
    }
    opts.push(`${y}-Q${q}`);
  }
  // 다음 분기도
  let nq = curQ + 1, ny = curY;
  if (nq > 4) { nq = 1; ny += 1; }
  opts.unshift(`${ny}-Q${nq}`);
  return opts;
}

export default function OkrPage() {
  const [quarter, setQuarter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  });
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKr, setEditingKr] = useState<KeyResult | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAddObj, setShowAddObj] = useState(false);
  const [showAddKr, setShowAddKr] = useState<string | null>(null); // objective_id

  const fetchOkrs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/admin/api/okrs?quarter=${quarter}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setObjectives(data.objectives || []);
    } catch (err) {
      console.error("OKR 로드 실패:", err);
      setObjectives([]);
    } finally {
      setLoading(false);
    }
  }, [quarter]);

  useEffect(() => { fetchOkrs(); }, [fetchOkrs]);

  const updateKrValue = async () => {
    if (!editingKr) return;
    const value = Number(editValue);
    if (isNaN(value)) return alert("숫자를 입력하세요");
    try {
      const res = await fetch(`/admin/api/okrs/key-results/${editingKr.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_value: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(`업데이트 실패: ${err.error || "오류"}`);
      }
      setEditingKr(null);
      setEditValue("");
      fetchOkrs();
    } catch {
      alert("네트워크 오류");
    }
  };

  const deleteKr = async (id: string) => {
    if (!confirm("이 KR을 삭제하시겠습니까?")) return;
    await fetch(`/admin/api/okrs/key-results/${id}`, { method: "DELETE" });
    fetchOkrs();
  };

  const deleteObj = async (id: string) => {
    if (!confirm("이 Objective와 모든 KR을 삭제하시겠습니까?")) return;
    await fetch(`/admin/api/okrs/${id}`, { method: "DELETE" });
    fetchOkrs();
  };

  const overallProgress = objectives.length > 0
    ? Math.round(objectives.reduce((s, o) => s + o.progress, 0) / objectives.length)
    : 0;

  const onTrack = objectives.filter((o) => o.progress >= 70).length;
  const atRisk = objectives.filter((o) => o.progress < 30).length;

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OKR 관리</h1>
          <p className="text-sm text-gray-500 mt-1">분기별 목표(Objective)와 핵심결과(KR) 추적</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {quarterOptions().map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddObj(true)}
            className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer"
          >
            + Objective
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="전체 Objective" value={`${objectives.length}개`} />
        <SummaryCard label="전체 진행률" value={`${overallProgress}%`} highlight />
        <SummaryCard label="On Track (70%+)" value={`${onTrack}개`} color="text-green-600" />
        <SummaryCard label="At Risk (<30%)" value={`${atRisk}개`} color="text-red-600" />
      </div>

      {/* Overview Grid — 한눈에 보기 */}
      {objectives.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">한눈에 보기</h2>
            <span className="text-xs text-gray-400">클릭하면 해당 Objective로 이동</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            {objectives.map((o) => (
              <a
                key={o.id}
                href={`#obj-${o.id}`}
                className="group flex flex-col items-center p-3 rounded-lg border border-gray-100 hover:border-[#C41E1E] hover:bg-[#FFF0F5]/30 transition-all cursor-pointer"
              >
                <span className="text-2xl mb-1">{o.emoji}</span>
                <ProgressRing value={o.progress} size="sm" />
                <p className="mt-2 text-[11px] font-semibold text-gray-700 text-center line-clamp-2 leading-tight group-hover:text-[#C41E1E]">
                  {o.title.split(" — ")[0]}
                </p>
                <span className={`mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${PRIORITY_STYLE[o.priority]?.color || ""}`}>
                  P{o.priority}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : objectives.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          이 분기에 등록된 OKR이 없습니다. 새 Objective를 추가하세요.
        </div>
      ) : (
        <div className="space-y-5">
          {objectives.map((o) => (
            <div key={o.id} id={`obj-${o.id}`} className="bg-white rounded-xl border border-gray-200 overflow-hidden scroll-mt-4">
              {/* Objective Header */}
              <div className="p-5 border-b border-gray-100">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <span className="text-3xl">{o.emoji}</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h2 className="text-base font-bold text-gray-900">{o.title}</h2>
                      {o.category && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_STYLE[o.category] || "bg-gray-100 text-gray-600"}`}>
                          {o.category}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${PRIORITY_STYLE[o.priority]?.color || ""}`}>
                        {PRIORITY_STYLE[o.priority]?.label}
                      </span>
                    </div>
                    {o.description && (
                      <p className="text-sm text-gray-500">{o.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <ProgressRing value={o.progress} />
                    <button
                      onClick={() => deleteObj(o.id)}
                      className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>

              {/* Key Results */}
              <div className="divide-y divide-gray-50">
                {o.key_results.map((kr) => (
                  <div key={kr.id} className="px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-[#C41E1E]">KR</span>
                          <p className="text-sm font-medium text-gray-900">{kr.title}</p>
                        </div>
                        {/* Progress bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                kr.progress >= 70 ? "bg-green-500" :
                                kr.progress >= 30 ? "bg-yellow-500" : "bg-red-500"
                              }`}
                              style={{ width: `${kr.progress}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-gray-600 tabular-nums w-10 text-right">
                            {kr.progress}%
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 sm:w-auto">
                        <div className="text-right">
                          <p className="text-xs text-gray-400">현재 → 목표</p>
                          <p className="text-sm font-bold text-gray-900 tabular-nums">
                            {formatValue(kr, kr.current_value)} <span className="text-gray-400">/</span> {formatValue(kr, kr.target_value)}
                          </p>
                        </div>
                        <button
                          onClick={() => { setEditingKr(kr); setEditValue(String(kr.current_value)); }}
                          className="text-xs text-[#C41E1E] hover:underline cursor-pointer font-medium"
                        >
                          업데이트
                        </button>
                        <button
                          onClick={() => deleteKr(kr.id)}
                          className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-3">
                  <button
                    onClick={() => setShowAddKr(o.id)}
                    className="text-xs text-gray-500 hover:text-[#C41E1E] cursor-pointer"
                  >
                    + KR 추가
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit KR Modal */}
      {editingKr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-gray-900 mb-1">진행 업데이트</h3>
            <p className="text-sm text-gray-500 mb-4">{editingKr.title}</p>
            <label className="text-xs text-gray-500 block mb-1">현재값</label>
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
              autoFocus
            />
            <p className="text-xs text-gray-400 mb-4">
              시작 {formatValue(editingKr, editingKr.start_value)} → 목표 {formatValue(editingKr, editingKr.target_value)}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingKr(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
              <button onClick={updateKrValue} className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] cursor-pointer">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Objective Modal */}
      {showAddObj && (
        <AddObjectiveModal
          quarter={quarter}
          onClose={() => setShowAddObj(false)}
          onSaved={() => { setShowAddObj(false); fetchOkrs(); }}
        />
      )}

      {/* Add KR Modal */}
      {showAddKr && (
        <AddKrModal
          objectiveId={showAddKr}
          onClose={() => setShowAddKr(null)}
          onSaved={() => { setShowAddKr(null); fetchOkrs(); }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color || (highlight ? "text-[#C41E1E]" : "text-gray-900")}`}>
        {value}
      </p>
    </div>
  );
}

function ProgressRing({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const dims = size === "sm" ? { box: 44, r: 17, sw: 4, text: "text-[10px]" } : { box: 56, r: 22, sw: 5, text: "text-xs" };
  const c = 2 * Math.PI * dims.r;
  const offset = c - (value / 100) * c;
  const color = value >= 70 ? "#10b981" : value >= 30 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative" style={{ width: dims.box, height: dims.box }}>
      <svg className="-rotate-90" width={dims.box} height={dims.box} viewBox={`0 0 ${dims.box} ${dims.box}`}>
        <circle cx={dims.box / 2} cy={dims.box / 2} r={dims.r} fill="none" stroke="#f3f4f6" strokeWidth={dims.sw} />
        <circle
          cx={dims.box / 2}
          cy={dims.box / 2}
          r={dims.r}
          fill="none"
          stroke={color}
          strokeWidth={dims.sw}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${dims.text} font-bold text-gray-700 tabular-nums`}>{value}%</span>
      </div>
    </div>
  );
}

function AddObjectiveModal({ quarter, onClose, onSaved }: { quarter: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", category: "운영", priority: 3, emoji: "🎯" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title) return alert("제목을 입력하세요");
    setSaving(true);
    try {
      const res = await fetch("/admin/api/okrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quarter, ...form }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(`저장 실패: ${err.error || "오류"}`);
      }
      onSaved();
    } catch {
      alert("네트워크 오류");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-bold text-gray-900 mb-4">새 Objective ({quarter})</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">이모지</label>
            <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })}
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">제목 *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="예: 어드민 운영 안정화" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">설명 (Why)</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">카테고리</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option>운영</option>
                <option>성장</option>
                <option>수익화</option>
                <option>투자</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">우선순위</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value={1}>1 - 최우선</option>
                <option value={2}>2 - 높음</option>
                <option value={3}>3 - 중간</option>
                <option value={4}>4 - 낮음</option>
                <option value={5}>5 - 보류</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddKrModal({ objectiveId, onClose, onSaved }: { objectiveId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", metric_type: "number", unit: "건", start_value: 0, target_value: 0 });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title || !form.target_value) return alert("제목과 목표값 필수");
    setSaving(true);
    try {
      const res = await fetch("/admin/api/okrs/key-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective_id: objectiveId, ...form }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(`저장 실패: ${err.error || "오류"}`);
      }
      onSaved();
    } catch {
      alert("네트워크 오류");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-bold text-gray-900 mb-4">새 Key Result</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">측정 지표 *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="예: 발행 리뷰 수" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">단위 종류</label>
              <select value={form.metric_type} onChange={(e) => setForm({ ...form, metric_type: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="number">숫자</option>
                <option value="percent">퍼센트</option>
                <option value="currency">금액(원)</option>
                <option value="boolean">완료여부</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">단위명</label>
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="건, 명, 회 등" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">시작값</label>
              <input type="number" value={form.start_value} onChange={(e) => setForm({ ...form, start_value: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">목표값 *</label>
              <input type="number" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">취소</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#C41E1E] text-white rounded-lg hover:bg-[#A01818] disabled:opacity-50 cursor-pointer">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
