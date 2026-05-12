"use client";

import { useEffect, useState, useCallback } from "react";

// ─── 타입 ────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  role: string | null;
  emoji: string;
  color: string;
  goal_text: string | null;
  goal_target: number | null;
  goal_current: number;
  goal_unit: string | null;
  kakao_user_id: string | null;
  kakao_link_code: string | null;
  kakao_linked_at: string | null;
  status: "active" | "inactive";
  counts: { doing: number; wait: number; block: number };
}

interface Task {
  id: string;
  member_id: string;
  title: string;
  due_date: string | null;
  priority: "low" | "normal" | "high";
  tag: string | null;
  status: "doing" | "wait" | "block" | "done";
  memo: string | null;
  block_reason: string | null;
  source: string;
  created_at: string;
}

interface KPI {
  title: string;
  current: number;
  target: number;
  unit: string;
  note?: string;
}

interface Checkin {
  note: string;
  checked_at: string;
  checked_by?: string | null;
}

interface Objective {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  emoji: string;
  color: string;
  status: "active" | "done" | "archived";
  kpis: KPI[];
  checkins: Checkin[];
  sort_order: number;
}

const COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  sky:     { bar: "bg-sky-500",     bg: "bg-sky-50",     text: "text-sky-700"     },
  violet:  { bar: "bg-violet-500",  bg: "bg-violet-50",  text: "text-violet-700"  },
  emerald: { bar: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  amber:   { bar: "bg-amber-500",   bg: "bg-amber-50",   text: "text-amber-700"   },
  rose:    { bar: "bg-rose-500",    bg: "bg-rose-50",    text: "text-rose-700"    },
  gray:    { bar: "bg-gray-500",    bg: "bg-gray-100",   text: "text-gray-700"    },
};

const STATUS: Record<string, { dot: string; label: string }> = {
  doing: { dot: "bg-emerald-500", label: "진행" },
  wait:  { dot: "bg-amber-400",   label: "대기" },
  block: { dot: "bg-rose-500",    label: "블록" },
  done:  { dot: "bg-gray-300",    label: "완료" },
};

// ─── 메인 ────────────────────────────────────────

type Tab = "company" | "month" | "member";

export default function TeamWorkboardPage() {
  const [tab, setTab] = useState<Tab>("company");
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberModal, setMemberModal] = useState<{ open: boolean; editing?: Member }>({ open: false });
  const [linkModal, setLinkModal] = useState<{ open: boolean; member?: Member; code?: string }>({ open: false });
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [objectiveModal, setObjectiveModal] = useState<{ open: boolean; editing?: Objective }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, tRes, oRes] = await Promise.all([
        fetch("/admin/api/team/members").then((r) => r.json()),
        fetch("/admin/api/team/task").then((r) => r.json()),
        fetch("/admin/api/team/objectives").then((r) => r.json()),
      ]);
      setMembers(mRes.members ?? []);
      setTasks(tRes.tasks ?? []);
      setObjectives(oRes.objectives ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const todayKST = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const totalOpen = tasks.length;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      {/* 헤더 */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">조직&시스템 관리</span>
          <span className="text-gray-300">›</span>
          <h1 className="text-lg font-semibold">업무관리</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={load} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200">새로고침</button>
          <button onClick={() => setMemberModal({ open: true })} className="px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-black">+ 멤버</button>
        </div>
      </header>

      {/* 가로 탭 바 */}
      <div className="bg-white border-b px-6">
        <div className="flex items-center gap-1">
          <TopTab active={tab === "company"} label="전사 진행사항" badge={`${members.length}명`}        onClick={() => setTab("company")} />
          <TopTab active={tab === "month"}   label="월별 진행사항" badge={`${tasks.length}건`}           onClick={() => setTab("month")} />
          <TopTab active={tab === "member"}  label="개인별 진행사항" badge={`${members.length}명 · ${totalOpen}건`} onClick={() => setTab("member")} />
        </div>
      </div>

      {/* 메인 */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {loading ? (
          <div className="p-8 text-center text-gray-400">불러오는 중...</div>
        ) : tab === "company" ? (
          <CompanyTab
            objectives={objectives}
            onAddNew={() => setObjectiveModal({ open: true })}
            onEdit={(o) => setObjectiveModal({ open: true, editing: o })}
            onPatch={async (id, patch) => {
              const r = await fetch(`/admin/api/team/objectives/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              if (r.ok) await load();
            }}
          />
        ) : tab === "month" ? (
          <MonthTab tasks={tasks} members={members} todayStr={todayKST} />
        ) : (
          <MemberTab
            members={members}
            tasks={tasks}
            todayStr={todayKST}
            onTaskClick={setDetailTask}
            onAddTask={async (memberId, rawText) => {
              const r = await fetch("/admin/api/team/task", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ member_id: memberId, raw_text: rawText, source: "web" }),
              });
              if (r.ok) await load();
              else {
                const err = await r.json();
                alert(`추가 실패: ${err.error ?? "오류"}`);
              }
            }}
            onLinkClick={async (member) => {
              const r = await fetch("/admin/api/team/link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "issue", member_id: member.id }),
              });
              const data = await r.json();
              setLinkModal({ open: true, member, code: data.code });
            }}
            onEditMember={(m) => setMemberModal({ open: true, editing: m })}
          />
        )}
      </main>

      {/* 목표 등록·편집 모달 */}
      {objectiveModal.open && (
        <ObjectiveFormModal
          editing={objectiveModal.editing}
          onClose={() => setObjectiveModal({ open: false })}
          onSaved={async () => { setObjectiveModal({ open: false }); await load(); }}
          onDeleted={async () => { setObjectiveModal({ open: false }); await load(); }}
        />
      )}

      {/* 멤버 등록·편집 모달 */}
      {memberModal.open && (
        <MemberFormModal
          editing={memberModal.editing}
          onClose={() => setMemberModal({ open: false })}
          onSaved={async () => { setMemberModal({ open: false }); await load(); }}
        />
      )}

      {/* LINK 코드 모달 */}
      {linkModal.open && linkModal.member && linkModal.code && (
        <LinkCodeModal
          member={linkModal.member}
          code={linkModal.code}
          onClose={() => setLinkModal({ open: false })}
        />
      )}

      {/* 카드 상세 패널 */}
      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          member={members.find((m) => m.id === detailTask.member_id)}
          onClose={() => setDetailTask(null)}
          onChange={async (patch) => {
            const r = await fetch(`/admin/api/team/task/${detailTask.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (r.ok) {
              const d = await r.json();
              setDetailTask(d.task);
              await load();
            }
          }}
          onDelete={async () => {
            if (!confirm("이 카드를 삭제할까요?")) return;
            await fetch(`/admin/api/team/task/${detailTask.id}`, { method: "DELETE" });
            setDetailTask(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─── 탭 버튼 ─────────────────────────────────────

function TopTab({ active, label, badge, onClick }: { active: boolean; label: string; badge: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
      }`}
    >
      {label}
      <span className={`ml-2 text-[11px] ${active ? "text-gray-500" : "text-gray-400"}`}>{badge}</span>
    </button>
  );
}

// ─── 전사 탭 ─────────────────────────────────────

function CompanyTab({
  objectives, onAddNew, onEdit, onPatch,
}: {
  objectives: Objective[];
  onAddNew: () => void;
  onEdit: (o: Objective) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const overall = objectives.length === 0 ? 0 : Math.round(
    objectives.reduce((sum, o) => {
      const totalKpi = o.kpis.reduce((s, k) => s + Math.min(100, k.target > 0 ? (k.current / k.target) * 100 : 0), 0);
      return sum + (o.kpis.length > 0 ? totalKpi / o.kpis.length : 0);
    }, 0) / objectives.length
  );

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="text-xs text-gray-500 mb-1">전사 진행사항</div>
          <h2 className="text-2xl font-bold leading-tight">2026 회사 목표</h2>
        </div>
        <button onClick={onAddNew} className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-black">
          + 목표 추가
        </button>
      </div>

      {/* 전체 진행률 */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">전체 평균 진행률</div>
            <div className="text-3xl font-bold">{overall}<span className="text-lg text-gray-400">%</span></div>
          </div>
          <div className="text-right text-xs text-gray-300">
            <div>활성 목표 {objectives.filter((o) => o.status === "active").length}개</div>
            <div>완료 {objectives.filter((o) => o.status === "done").length}개</div>
          </div>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-white" style={{ width: `${overall}%` }} />
        </div>
      </div>

      {/* 목표 카드 리스트 */}
      {objectives.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <div className="text-gray-400 mb-3">아직 등록된 목표가 없습니다.</div>
          <button onClick={onAddNew} className="text-sm text-sky-600 hover:underline">+ 첫 목표 추가하기</button>
        </div>
      ) : (
        <div className="space-y-4">
          {objectives.map((o) => (
            <ObjectiveCard
              key={o.id}
              objective={o}
              onEdit={() => onEdit(o)}
              onAddCheckin={(note) => onPatch(o.id, { add_checkin: { note } })}
              onUpdateKpi={(idx, patch) => {
                const next = o.kpis.map((k, i) => (i === idx ? { ...k, ...patch } : k));
                return onPatch(o.id, { kpis: next });
              }}
              onToggleStatus={() => onPatch(o.id, { status: o.status === "done" ? "active" : "done" })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveCard({
  objective, onEdit, onAddCheckin, onUpdateKpi, onToggleStatus,
}: {
  objective: Objective;
  onEdit: () => void;
  onAddCheckin: (note: string) => Promise<void>;
  onUpdateKpi: (idx: number, patch: Partial<KPI>) => Promise<void>;
  onToggleStatus: () => Promise<void>;
}) {
  const [checkinInput, setCheckinInput] = useState("");
  const [showAllCheckins, setShowAllCheckins] = useState(false);
  const c = COLORS[objective.color] ?? COLORS.gray;

  const kpiPct = objective.kpis.length === 0 ? 0 : Math.round(
    objective.kpis.reduce((s, k) => s + Math.min(100, k.target > 0 ? (k.current / k.target) * 100 : 0), 0) / objective.kpis.length
  );

  const isDone = objective.status === "done";
  const visibleCheckins = showAllCheckins ? objective.checkins : objective.checkins.slice(0, 3);

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${isDone ? "border-emerald-300 opacity-75" : "border-gray-200"}`}>
      {/* 헤더 */}
      <div className={`px-5 py-4 ${c.bg} border-b ${isDone ? "border-emerald-300" : "border-gray-100"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-2xl">{objective.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className={`text-base font-bold ${c.text} ${isDone ? "line-through" : ""}`}>{objective.title}</h3>
                {objective.category && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.bg} ${c.text} border border-current/20`}>{objective.category}</span>
                )}
              </div>
              {objective.description && (
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{objective.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className={`text-sm font-bold ${kpiPct >= 80 ? "text-emerald-600" : kpiPct >= 50 ? c.text : "text-gray-500"}`}>{kpiPct}%</div>
            <button onClick={onToggleStatus} title={isDone ? "다시 활성화" : "완료 표시"} className="ml-2 text-gray-500 hover:text-emerald-600 text-sm">
              {isDone ? "↩" : "✓"}
            </button>
            <button onClick={onEdit} title="편집" className="text-gray-500 hover:text-gray-900 text-sm">✏️</button>
          </div>
        </div>
      </div>

      {/* KPI 리스트 */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">KPI</div>
        {objective.kpis.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-3">KPI가 없습니다. ✏️ 버튼으로 추가하세요.</div>
        ) : (
          <div className="space-y-3">
            {objective.kpis.map((k, idx) => (
              <KpiRow key={idx} kpi={k} color={c} onUpdate={(patch) => onUpdateKpi(idx, patch)} />
            ))}
          </div>
        )}
      </div>

      {/* 진행사항 점검 */}
      <div className="px-5 py-4 bg-gray-50/50">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">진행사항 점검</div>
          {objective.checkins.length > 3 && (
            <button onClick={() => setShowAllCheckins((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-900">
              {showAllCheckins ? "접기" : `전체보기 (${objective.checkins.length})`}
            </button>
          )}
        </div>

        {visibleCheckins.length === 0 ? (
          <div className="text-xs text-gray-400 mb-2">점검 메모가 없습니다.</div>
        ) : (
          <div className="space-y-2 mb-3">
            {visibleCheckins.map((ch, idx) => (
              <div key={idx} className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="text-[10px] text-gray-400 mb-0.5">{new Date(ch.checked_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</div>
                <div className="text-gray-800 whitespace-pre-line">{ch.note}</div>
              </div>
            ))}
          </div>
        )}

        <input
          type="text"
          value={checkinInput}
          onChange={(e) => setCheckinInput(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && checkinInput.trim()) {
              await onAddCheckin(checkinInput.trim());
              setCheckinInput("");
            }
          }}
          placeholder="+ 점검 메모 추가 (Enter)"
          className="w-full text-xs border border-dashed border-gray-300 bg-white rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500 placeholder:text-gray-400"
        />
      </div>
    </div>
  );
}

function KpiRow({ kpi, color, onUpdate }: { kpi: KPI; color: typeof COLORS["sky"]; onUpdate: (patch: Partial<KPI>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(kpi.current.toString());
  const pct = kpi.target > 0 ? Math.min(100, Math.round((kpi.current / kpi.target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm flex-1 min-w-0 truncate">{kpi.title}</div>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              autoFocus
              onBlur={async () => {
                const n = Number(val);
                if (!Number.isNaN(n) && n !== kpi.current) await onUpdate({ current: n });
                setEditing(false);
              }}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  const n = Number(val);
                  if (!Number.isNaN(n) && n !== kpi.current) await onUpdate({ current: n });
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-16 border rounded px-1.5 py-0.5 text-xs tabular-nums text-right"
            />
            <span className="text-xs text-gray-400">/ {kpi.target}{kpi.unit}</span>
          </div>
        ) : (
          <button onClick={() => { setVal(kpi.current.toString()); setEditing(true); }} className="text-xs text-gray-600 tabular-nums hover:bg-gray-100 px-1.5 py-0.5 rounded">
            {kpi.current} / {kpi.target}{kpi.unit}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${pct >= 100 ? "bg-emerald-500" : color.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <div className={`text-[11px] tabular-nums ${pct >= 100 ? "text-emerald-600" : "text-gray-500"}`}>{pct}%</div>
      </div>
      {kpi.note && <div className="text-[11px] text-gray-500 mt-1">{kpi.note}</div>}
    </div>
  );
}

// ─── 목표 등록·편집 모달 ──────────────────────────

function ObjectiveFormModal({
  editing, onClose, onSaved, onDeleted,
}: {
  editing?: Objective;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [emoji, setEmoji] = useState(editing?.emoji ?? "🎯");
  const [color, setColor] = useState(editing?.color ?? "gray");
  const [kpis, setKpis] = useState<KPI[]>(editing?.kpis ?? []);
  const [saving, setSaving] = useState(false);

  const addKpi = () => setKpis([...kpis, { title: "", current: 0, target: 1, unit: "" }]);
  const updateKpi = (i: number, patch: Partial<KPI>) => setKpis(kpis.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  const removeKpi = (i: number) => setKpis(kpis.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!title.trim()) return alert("목표 제목을 입력해주세요");
    setSaving(true);
    try {
      const payload = {
        title, description: description || null, category: category || null, emoji, color,
        kpis: kpis.filter((k) => k.title.trim()),
      };
      const url = editing ? `/admin/api/team/objectives/${editing.id}` : `/admin/api/team/objectives`;
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const e = await r.json();
        alert(`저장 실패: ${e.error ?? "오류"}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!editing || !confirm(`"${editing.title}" 목표를 보관할까요? (다시 복원 가능)`)) return;
    await fetch(`/admin/api/team/objectives/${editing.id}`, { method: "DELETE" });
    onDeleted();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b sticky top-0 bg-white">
          <h3 className="text-base font-semibold">{editing ? "목표 편집" : "새 목표 추가"}</h3>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <Field label="목표 제목"><input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="시스템 개발" /></Field>
          <Field label="내용 (자유 텍스트)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border rounded-md px-3 py-2 h-20" placeholder="어드민 안정화 + tubeping builder MVP 완성·배포" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="카테고리"><input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="시스템" /></Field>
            <Field label="이모지"><input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="w-full border rounded-md px-3 py-2 text-center text-xl" /></Field>
            <Field label="색상">
              <select value={color} onChange={(e) => setColor(e.target.value)} className="w-full border rounded-md px-3 py-2">
                <option value="sky">하늘</option>
                <option value="violet">보라</option>
                <option value="emerald">초록</option>
                <option value="amber">노랑</option>
                <option value="rose">빨강</option>
                <option value="gray">회색</option>
              </select>
            </Field>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-700">📊 KPI 항목</div>
              <button onClick={addKpi} className="text-xs text-sky-600 hover:underline">+ KPI 추가</button>
            </div>
            {kpis.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-4 border border-dashed rounded">KPI가 없습니다</div>
            ) : (
              <div className="space-y-2">
                {kpis.map((k, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <input value={k.title} onChange={(e) => updateKpi(i, { title: e.target.value })} placeholder="KPI 제목 (예: 월 매출 1천만+ 유튜버)" className="flex-1 border rounded-md px-2 py-1 text-sm" />
                      <button onClick={() => removeKpi(i)} className="text-rose-500 hover:bg-rose-50 px-2 py-1 rounded text-xs">삭제</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" value={k.current} onChange={(e) => updateKpi(i, { current: Number(e.target.value) })} placeholder="현재" className="border rounded-md px-2 py-1 text-xs" />
                      <input type="number" value={k.target} onChange={(e) => updateKpi(i, { target: Number(e.target.value) })} placeholder="목표" className="border rounded-md px-2 py-1 text-xs" />
                      <input value={k.unit} onChange={(e) => updateKpi(i, { unit: e.target.value })} placeholder="단위 (개/명/%)" className="border rounded-md px-2 py-1 text-xs" />
                    </div>
                    <input value={k.note ?? ""} onChange={(e) => updateKpi(i, { note: e.target.value })} placeholder="측정 방법·메모 (선택)" className="w-full border rounded-md px-2 py-1 text-xs" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="p-4 border-t flex justify-between items-center sticky bottom-0 bg-white">
          {editing ? <button onClick={del} className="text-xs text-rose-500 hover:bg-rose-50 px-3 py-1.5 rounded">🗄 보관</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-gray-100">취소</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-md text-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50">{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 월별 탭 ─────────────────────────────────────

function MonthTab({ tasks, members, todayStr }: { tasks: Task[]; members: Member[]; todayStr: string }) {
  const today = new Date(todayStr);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: { day: number | null; dateStr: string | null }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, dateStr: null });

  const tasksByDate = new Map<string, Task[]>();
  tasks.forEach((t) => {
    if (!t.due_date) return;
    const list = tasksByDate.get(t.due_date) ?? [];
    list.push(t);
    tasksByDate.set(t.due_date, list);
  });

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <h2 className="text-xl font-bold mb-4">{year}년 {month}월</h2>
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        {["일","월","화","수","목","금","토"].map((d, i) => (
          <div key={d} className={`bg-gray-50 text-[11px] font-medium text-center py-1.5 ${i === 0 ? "text-rose-500" : i === 6 ? "text-sky-500" : "text-gray-600"}`}>{d}</div>
        ))}
        {cells.map((c, idx) => {
          const dayTasks = c.dateStr ? tasksByDate.get(c.dateStr) ?? [] : [];
          const isToday = c.dateStr === todayStr;
          return (
            <div key={idx} className={`min-h-[80px] px-1.5 py-1 ${c.day === null ? "bg-gray-50" : "bg-white"}`}>
              {c.day !== null && (
                <>
                  <div className="mb-1">
                    {isToday ? (
                      <span className="bg-gray-900 text-white text-[11px] font-semibold px-1.5 py-0.5 rounded">{c.day}</span>
                    ) : (
                      <span className="text-[11px] font-medium text-gray-700 px-1">{c.day}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 2).map((t) => {
                      const m = members.find((x) => x.id === t.member_id);
                      const cc = COLORS[m?.color ?? "gray"] ?? COLORS.gray;
                      return (
                        <div key={t.id} className={`text-[10px] ${cc.bg} ${cc.text} px-1 py-0.5 rounded truncate`}>{t.title}</div>
                      );
                    })}
                    {dayTasks.length > 2 && <div className="text-[10px] text-gray-500 px-1">+{dayTasks.length - 2}건</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 개인별 탭 ───────────────────────────────────

function MemberTab({
  members, tasks, todayStr, onTaskClick, onAddTask, onLinkClick, onEditMember,
}: {
  members: Member[];
  tasks: Task[];
  todayStr: string;
  onTaskClick: (t: Task) => void;
  onAddTask: (memberId: string, rawText: string) => Promise<void>;
  onLinkClick: (m: Member) => Promise<void>;
  onEditMember: (m: Member) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-gray-400 mb-4">아직 등록된 팀원이 없습니다.</div>
        <div className="text-xs text-gray-400">우상단 [+ 멤버] 버튼으로 첫 멤버를 추가해보세요.</div>
      </div>
    );
  }
  return (
    <div className="px-6 py-6">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {members.map((m) => (
          <MemberColumn
            key={m.id}
            member={m}
            tasks={tasks.filter((t) => t.member_id === m.id)}
            todayStr={todayStr}
            onTaskClick={onTaskClick}
            onAddTask={(text) => onAddTask(m.id, text)}
            onLinkClick={() => onLinkClick(m)}
            onEdit={() => onEditMember(m)}
          />
        ))}
      </div>
    </div>
  );
}

function MemberColumn({
  member, tasks, todayStr, onTaskClick, onAddTask, onLinkClick, onEdit,
}: {
  member: Member;
  tasks: Task[];
  todayStr: string;
  onTaskClick: (t: Task) => void;
  onAddTask: (text: string) => Promise<void>;
  onLinkClick: () => void;
  onEdit: () => void;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const c = COLORS[member.color] ?? COLORS.gray;
  const target = member.goal_target ?? 0;
  const current = member.goal_current ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const sorted = [...tasks].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  const handleAdd = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !input.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddTask(input.trim());
      setInput("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-shrink-0 w-72">
      <div className={`rounded-xl ${c.bg} px-3 pt-2.5 pb-3 mb-2`}>
        <div className="flex items-center justify-between mb-2">
          <button onClick={onEdit} className="flex items-center gap-2 text-left hover:opacity-80">
            <span className="text-lg">{member.emoji}</span>
            <div>
              <div className={`text-sm font-semibold ${c.text}`}>{member.name}</div>
              <div className="text-[11px] text-gray-500">{member.role ?? "—"} · {tasks.length}건</div>
            </div>
          </button>
          <button onClick={onLinkClick} className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 hover:bg-white text-gray-700" title={member.kakao_linked_at ? "재연결" : "카톡 연결"}>
            {member.kakao_linked_at ? "🔗 연결됨" : "🔗 연결"}
          </button>
        </div>
        {member.goal_text && (
          <div className="bg-white/70 rounded-lg px-2.5 py-2">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[11px] text-gray-500">🎯 핵심 목표</div>
              <div className={`text-[11px] font-semibold ${c.text}`}>{pct}%</div>
            </div>
            <div className="text-[12px] font-medium text-gray-800 leading-tight mb-1.5 truncate">{member.goal_text}</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${c.bar}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] text-gray-600 tabular-nums">{current} / {target}{member.goal_unit ?? ""}</div>
            </div>
          </div>
        )}
      </div>

      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleAdd}
        disabled={submitting}
        placeholder={submitting ? "추가 중..." : "+ 한 줄로 입력 (예: 내일까지 썸네일 3개)"}
        className="w-full text-sm border border-dashed border-gray-300 bg-white rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-gray-500 placeholder:text-gray-400 disabled:opacity-50"
      />

      <div className="space-y-1.5">
        {sorted.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-6">할 일이 없습니다</div>
        ) : (
          sorted.map((t) => <TaskCard key={t.id} task={t} todayStr={todayStr} onClick={() => onTaskClick(t)} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, todayStr, onClick }: { task: Task; todayStr: string; onClick: () => void }) {
  const s = STATUS[task.status];
  const overdue = task.due_date && task.due_date < todayStr && task.status !== "done";
  const dueLabel = task.due_date
    ? task.due_date === todayStr ? "오늘"
      : task.due_date.slice(5).replace("-", "/")
    : "";
  return (
    <div onClick={onClick} className="bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-400 hover:shadow-sm cursor-pointer flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${s.dot} flex-shrink-0`} title={s.label} />
      <span className="text-sm flex-1 truncate">{task.title}</span>
      {task.source === "kakao" && <span className="text-[10px] text-yellow-600">🟡</span>}
      <span className={`text-[11px] ${overdue ? "text-rose-600 font-medium" : "text-gray-400"}`}>{dueLabel}</span>
    </div>
  );
}

// ─── 멤버 등록/편집 모달 ─────────────────────────

function MemberFormModal({ editing, onClose, onSaved }: { editing?: Member; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [role, setRole] = useState(editing?.role ?? "");
  const [emoji, setEmoji] = useState(editing?.emoji ?? "👤");
  const [color, setColor] = useState(editing?.color ?? "sky");
  const [goalText, setGoalText] = useState(editing?.goal_text ?? "");
  const [goalTarget, setGoalTarget] = useState(editing?.goal_target?.toString() ?? "");
  const [goalCurrent, setGoalCurrent] = useState(editing?.goal_current?.toString() ?? "0");
  const [goalUnit, setGoalUnit] = useState(editing?.goal_unit ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return alert("이름을 입력해주세요");
    setSaving(true);
    try {
      const payload = {
        name, role: role || null, emoji, color,
        goal_text: goalText || null,
        goal_target: goalTarget ? Number(goalTarget) : null,
        goal_current: goalCurrent ? Number(goalCurrent) : 0,
        goal_unit: goalUnit || null,
      };
      const url = editing ? `/admin/api/team/members/${editing.id}` : `/admin/api/team/members`;
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const e = await r.json();
        alert(`저장 실패: ${e.error ?? "오류"}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="text-base font-semibold">{editing ? "멤버 편집" : "새 멤버 추가"}</h3>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Field label="이름"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="최준수" /></Field>
          <Field label="역할"><input value={role} onChange={(e) => setRole(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="대표 / 편집 / 디자인 ..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="이모지"><input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="w-full border rounded-md px-3 py-2 text-center text-xl" /></Field>
            <Field label="색상">
              <select value={color} onChange={(e) => setColor(e.target.value)} className="w-full border rounded-md px-3 py-2">
                <option value="sky">하늘</option>
                <option value="violet">보라</option>
                <option value="emerald">초록</option>
                <option value="amber">노랑</option>
                <option value="rose">빨강</option>
                <option value="gray">회색</option>
              </select>
            </Field>
          </div>
          <div className="border-t pt-3 mt-3">
            <div className="text-xs text-gray-500 mb-2">🎯 이번 주 핵심 목표 (선택)</div>
            <Field label="목표"><input value={goalText} onChange={(e) => setGoalText(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="주 2회 영상 업로드" /></Field>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Field label="현재"><input value={goalCurrent} onChange={(e) => setGoalCurrent(e.target.value)} type="number" className="w-full border rounded-md px-2 py-2" /></Field>
              <Field label="목표"><input value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} type="number" className="w-full border rounded-md px-2 py-2" /></Field>
              <Field label="단위"><input value={goalUnit} onChange={(e) => setGoalUnit(e.target.value)} className="w-full border rounded-md px-2 py-2" placeholder="편" /></Field>
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm hover:bg-gray-100">취소</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-md text-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50">{saving ? "저장 중..." : "저장"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

// ─── LINK 코드 모달 ──────────────────────────────

function LinkCodeModal({ member, code, onClose }: { member: Member; code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="text-base font-semibold">🔗 카카오 연결 — {member.name}</h3>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-gray-600 mb-4">아래 코드를 카카오톡 <strong>Tubeping 채널</strong>에 보내주세요.</p>
          <div className="bg-gray-100 rounded-lg p-5 mb-3">
            <div className="text-2xl font-mono font-bold tracking-widest">{code}</div>
          </div>
          <button onClick={copy} className="text-xs text-sky-600 hover:underline">{copied ? "✓ 복사됨" : "코드 복사"}</button>
          <p className="text-[11px] text-gray-400 mt-4">⏰ 24시간 후 만료</p>
        </div>
        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm bg-gray-900 text-white hover:bg-black">확인</button>
        </div>
      </div>
    </div>
  );
}

// ─── 카드 상세 패널 ──────────────────────────────

function TaskDetailPanel({ task, member, onClose, onChange, onDelete }: {
  task: Task;
  member: Member | undefined;
  onClose: () => void;
  onChange: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-96 bg-white border-l shadow-xl z-40 overflow-y-auto">
        <div className="p-5 border-b flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-500 mb-1">{member?.emoji} {member?.name} · {member?.role ?? "—"}</div>
            <h3 className="text-base font-semibold leading-snug">{task.title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-16">상태</span>
            <div className="flex gap-1.5">
              {(["doing", "wait", "block", "done"] as const).map((k) => (
                <button key={k} onClick={() => onChange({ status: k })} className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${task.status === k ? "bg-gray-900 text-white" : "bg-gray-100 hover:bg-gray-200"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS[k].dot}`} />{STATUS[k].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-16">마감</span>
            <input type="date" value={task.due_date ?? ""} onChange={(e) => onChange({ due_date: e.target.value || null })} className="border rounded-md px-2 py-1 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-16">태그</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{task.tag ?? "—"}</span>
          </div>
          {task.status === "block" && (
            <div>
              <div className="text-gray-500 mb-2">블록 사유</div>
              <textarea defaultValue={task.block_reason ?? ""} onBlur={(e) => onChange({ block_reason: e.target.value })} className="w-full border rounded-md p-2 text-sm h-20" />
            </div>
          )}
          <div>
            <div className="text-gray-500 mb-2">메모</div>
            <textarea defaultValue={task.memo ?? ""} onBlur={(e) => onChange({ memo: e.target.value })} className="w-full border rounded-md p-2 text-sm h-24" placeholder="메모를 남겨두세요..." />
          </div>
          <div className="text-xs text-gray-400 pt-3 border-t">
            출처: {task.source === "kakao" ? "🟡 카카오톡" : task.source === "telegram" ? "텔레그램" : "웹"}<br />
            ID: <span className="font-mono">#{task.id.slice(-4).toUpperCase()}</span>
          </div>
          <button onClick={onDelete} className="w-full text-xs text-rose-600 hover:bg-rose-50 rounded py-2">🗑 카드 삭제</button>
        </div>
      </aside>
    </>
  );
}
