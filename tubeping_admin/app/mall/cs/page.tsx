"use client";

import { useState, useEffect, useCallback } from "react";

interface Store {
  id: string;
  name: string;
  mall_id: string;
  status: string;
}

interface CSTicket {
  id: string;
  store_id: string | null;
  channel: string;
  channel_ticket_id: string;
  ticket_type: string;
  category: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  order_id: string | null;
  product_name: string | null;
  subject: string;
  content: string | null;
  reply: string | null;
  replied_at: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  memo: string | null;
  created_at: string;
  stores: { name: string; mall_id: string } | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  cafe24: "카페24",
  sms: "문자",
  phone: "전화",
  kakao: "카카오톡",
  naver_talk: "네이버톡",
};

const CHANNEL_STYLE: Record<string, string> = {
  cafe24: "bg-blue-100 text-blue-700",
  sms: "bg-green-100 text-green-700",
  phone: "bg-purple-100 text-purple-700",
  kakao: "bg-yellow-100 text-yellow-800",
  naver_talk: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABEL: Record<string, string> = {
  open: "미답변",
  in_progress: "처리중",
  replied: "답변완료",
  closed: "종료",
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  replied: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-500",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "낮음",
  normal: "보통",
  high: "높음",
  urgent: "긴급",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "text-gray-400",
  normal: "text-gray-600",
  high: "text-orange-500",
  urgent: "text-red-600 font-bold",
};

const TYPE_LABEL: Record<string, string> = {
  inquiry: "문의",
  complaint: "불만",
  return: "반품",
  exchange: "교환",
  cancel: "취소",
  etc: "기타",
};

interface CSChannel {
  id: string;
  channel_type: string;
  name: string;
  account_id: string | null;
  auth_key: string | null;
  webhook_url: string | null;
  status: string;
  last_event_at: string | null;
  total_chats: number;
  store_id: string | null;
  memo: string | null;
  created_at: string;
  stores: { name: string; mall_id: string } | null;
}

export default function CSPage() {
  const [activeTab, setActiveTab] = useState<"tickets" | "channels">("tickets");
  const [tickets, setTickets] = useState<CSTicket[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<CSChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // 채널 등록 폼
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [channelForm, setChannelForm] = useState({ name: "", account_id: "", auth_key: "", store_id: "", memo: "" });

  // 필터
  const [filterChannel, setFilterChannel] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterType, setFilterType] = useState("");
  const [keyword, setKeyword] = useState("");

  // 상세 보기
  const [selectedTicket, setSelectedTicket] = useState<CSTicket | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterChannel) params.set("channel", filterChannel);
    if (filterStatus) params.set("status", filterStatus);
    if (filterStore) params.set("store_id", filterStore);
    if (filterType) params.set("ticket_type", filterType);
    if (keyword) params.set("keyword", keyword);

    const res = await fetch(`/admin/api/cs?${params}`);
    const data = await res.json();
    setTickets(data.tickets || []);
    setLoading(false);
  }, [filterChannel, filterStatus, filterStore, filterType, keyword]);

  const fetchStores = async () => {
    const res = await fetch("/admin/api/stores");
    const data = await res.json();
    setStores(data.stores || []);
  };

  const fetchChannels = async () => {
    const res = await fetch("/admin/api/cs/channels");
    const data = await res.json();
    setChannels(data.channels || []);
  };

  const handleAddChannel = async () => {
    if (!channelForm.name || !channelForm.account_id) return;
    await fetch("/admin/api/cs/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_type: "naver_talk",
        name: channelForm.name,
        account_id: channelForm.account_id,
        auth_key: channelForm.auth_key || null,
        store_id: channelForm.store_id || null,
        memo: channelForm.memo || null,
      }),
    });
    setChannelForm({ name: "", account_id: "", auth_key: "", store_id: "", memo: "" });
    setShowAddChannel(false);
    fetchChannels();
  };

  const handleDeleteChannel = async (id: string, name: string) => {
    if (!confirm(`"${name}" 채널을 삭제하시겠습니까?`)) return;
    await fetch("/admin/api/cs/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchChannels();
  };

  useEffect(() => {
    fetchTickets();
    fetchStores();
    fetchChannels();
  }, [fetchTickets]);

  // 카페24 CS 수집
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/admin/api/cafe24/cs");
      const data = await res.json();
      const total = data.total_synced || 0;
      alert(`카페24 CS 수집 완료: ${total}건 동기화`);
      await fetchTickets();
    } catch {
      alert("수집 실패");
    }
    setSyncing(false);
  };

  // 답변 등록 (채널별 자동 발송)
  const handleReply = async () => {
    if (!selectedTicket || !replyText.trim()) return;
    setReplying(true);

    // 네이버톡톡이면 전용 발송 API 사용
    if (selectedTicket.channel === "naver_talk") {
      const res = await fetch("/admin/api/navertalk/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: selectedTicket.id, message: replyText }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedTicket({ ...selectedTicket, reply: replyText, status: "replied", replied_at: new Date().toISOString() });
        setReplyText("");
        fetchTickets();
      } else {
        alert(`발송 실패: ${data.error}`);
      }
    } else {
      // 카페24/기타 기존 로직
      const res = await fetch("/admin/api/cs/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: selectedTicket.id, reply: replyText }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedTicket({ ...selectedTicket, reply: replyText, status: "replied", replied_at: new Date().toISOString() });
        setReplyText("");
        fetchTickets();
        if (data.cafe24_synced) alert("답변 등록 + 카페24 동기화 완료");
      }
    }
    setReplying(false);
  };

  // 상태 변경
  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    await fetch("/admin/api/cs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [ticketId], updates: { status: newStatus } }),
    });
    fetchTickets();
    if (selectedTicket?.id === ticketId) {
      setSelectedTicket({ ...selectedTicket, status: newStatus });
    }
  };

  // 통계
  const stats = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    inProgress: tickets.filter((t) => t.status === "in_progress").length,
    replied: tickets.filter((t) => t.status === "replied").length,
    urgent: tickets.filter((t) => t.priority === "urgent" || t.priority === "high").length,
  };

  // 채널별 통계
  const channelStats = Object.entries(
    tickets.reduce<Record<string, number>>((acc, t) => {
      acc[t.channel] = (acc[t.channel] || 0) + 1;
      return acc;
    }, {})
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CS 통합 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            카페24 · 문자 · 전화 · 카카오톡 · 네이버톡 — 모든 채널 CS를 한 곳에서
          </p>
        </div>
        {activeTab === "tickets" && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedTicket(null);
                const channel = prompt("채널 (sms / phone / kakao / naver_talk):");
                if (!channel) return;
                const subject = prompt("제목:");
                if (!subject) return;
                const content = prompt("내용:");
                const customerName = prompt("고객명:");
                const customerPhone = prompt("연락처:");
                fetch("/admin/api/cs/manual", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ channel, subject, content, customer_name: customerName, customer_phone: customerPhone }),
                }).then(() => fetchTickets());
              }}
              className="px-4 py-2.5 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              수동 등록
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer disabled:opacity-50"
            >
              {syncing ? "수집 중..." : "카페24 CS 수집"}
            </button>
          </div>
        )}
        {activeTab === "channels" && (
          <button
            onClick={() => setShowAddChannel(true)}
            className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer"
          >
            + 네이버톡톡 계정 추가
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("tickets")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeTab === "tickets" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          문의 관리
        </button>
        <button
          onClick={() => setActiveTab("channels")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeTab === "channels" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          채널 설정
          {channels.length > 0 && (
            <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
              {channels.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══════ 채널 설정 탭 ═══════ */}
      {activeTab === "channels" && (
        <>
          {/* 등록 폼 */}
          {showAddChannel && (
            <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">네이버톡톡 계정 등록</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">계정 이름 *</label>
                  <input
                    type="text"
                    placeholder="예: 신산 네이버톡톡"
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">파트너 ID *</label>
                  <input
                    type="text"
                    placeholder="파트너센터 > 개발자도구 > 챗봇API"
                    value={channelForm.account_id}
                    onChange={(e) => setChannelForm({ ...channelForm, account_id: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Authorization 키</label>
                  <input
                    type="password"
                    placeholder="보내기 API 인증 키"
                    value={channelForm.auth_key}
                    onChange={(e) => setChannelForm({ ...channelForm, auth_key: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">파트너센터 &gt; API 설정 &gt; 보내기 API에서 확인</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">연결 스토어</label>
                  <select
                    value={channelForm.store_id}
                    onChange={(e) => setChannelForm({ ...channelForm, store_id: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg"
                  >
                    <option value="">선택 안 함</option>
                    {stores.filter((s) => s.status === "active").map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">메모</label>
                <input
                  type="text"
                  placeholder="예: 건강식품 전용 톡톡"
                  value={channelForm.memo}
                  onChange={(e) => setChannelForm({ ...channelForm, memo: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleAddChannel} className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] cursor-pointer">
                  등록
                </button>
                <button onClick={() => setShowAddChannel(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 채널 목록 */}
          {channels.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm mb-2">등록된 네이버톡톡 계정이 없습니다</p>
              <p className="text-gray-400 text-xs">위의 &quot;+ 네이버톡톡 계정 추가&quot; 버튼으로 등록하세요</p>
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((ch) => (
                <div key={ch.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-gray-900">{ch.name}</h3>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            ch.status === "active" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {ch.status === "active" ? "활성" : "대기"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span>파트너ID: <span className="font-mono text-gray-700">{ch.account_id}</span></span>
                          {ch.stores?.name && <span>· {ch.stores.name}</span>}
                          {ch.memo && <span>· {ch.memo}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-right">
                        <p className="text-gray-400">누적 대화</p>
                        <p className="font-bold text-gray-900">{ch.total_chats}건</p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-400">마지막 수신</p>
                        <p className="text-gray-700">{ch.last_event_at ? ch.last_event_at.slice(0, 16).replace("T", " ") : "-"}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteChannel(ch.id, ch.name)}
                        className="text-gray-400 hover:text-red-500 cursor-pointer ml-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 웹훅 URL */}
                  {ch.webhook_url && (
                    <div className="mt-3 bg-gray-50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-medium text-gray-500 mb-0.5">웹훅 URL (파트너센터에 등록)</p>
                        <p className="text-xs font-mono text-gray-700 break-all">{ch.webhook_url}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(ch.webhook_url || "");
                          alert("복사되었습니다");
                        }}
                        className="text-xs text-[#C41E1E] font-medium hover:underline cursor-pointer shrink-0 ml-3"
                      >
                        복사
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 연동 안내 */}
          <div className="mt-6 bg-[#FFF0F5] rounded-xl border border-[#C41E1E]/10 p-6">
            <h3 className="text-sm font-bold text-[#C41E1E] mb-3">네이버톡톡 연동 방법</h3>
            <div className="grid grid-cols-4 gap-4">
              {[
                { step: "1", title: "계정 추가", desc: "파트너 ID + Auth 키 입력" },
                { step: "2", title: "웹훅 등록", desc: "생성된 URL을 파트너센터에 등록" },
                { step: "3", title: "이벤트 선택", desc: "파트너센터에서 send 이벤트 활성화" },
                { step: "4", title: "자동 수신", desc: "고객 메시지가 CS 관리에 자동 표시" },
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
        </>
      )}

      {/* ═══════ 문의 관리 탭 ═══════ */}
      {activeTab === "tickets" && <>
      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "전체", value: `${stats.total}건`, onClick: () => setFilterStatus("") },
          { label: "미답변", value: `${stats.open}건`, highlight: stats.open > 0, onClick: () => setFilterStatus("open") },
          { label: "처리중", value: `${stats.inProgress}건`, onClick: () => setFilterStatus("in_progress") },
          { label: "답변완료", value: `${stats.replied}건`, onClick: () => setFilterStatus("replied") },
          { label: "긴급/높음", value: `${stats.urgent}건`, highlight: stats.urgent > 0, onClick: () => {} },
        ].map((s) => (
          <div
            key={s.label}
            onClick={s.onClick}
            className={`bg-white rounded-xl border p-4 cursor-pointer hover:shadow-sm transition-shadow ${
              s.highlight ? "border-[#C41E1E]/30" : "border-gray-200"
            }`}
          >
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-lg font-bold mt-1 ${s.highlight ? "text-[#C41E1E]" : "text-gray-900"}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Channel Badges */}
      {channelStats.length > 0 && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setFilterChannel("")}
            className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
              !filterChannel ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            전체 채널
          </button>
          {channelStats.map(([ch, cnt]) => (
            <button
              key={ch}
              onClick={() => setFilterChannel(filterChannel === ch ? "" : ch)}
              className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                filterChannel === ch
                  ? "bg-gray-900 text-white border-gray-900"
                  : `${CHANNEL_STYLE[ch] || "bg-gray-100 text-gray-600"} border-transparent hover:opacity-80`
              }`}
            >
              {CHANNEL_LABEL[ch] || ch} ({cnt})
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select
          value={filterStore}
          onChange={(e) => setFilterStore(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="">전체 스토어</option>
          {stores.filter((s) => s.status === "active").map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className="relative">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchTickets()}
            placeholder="검색 (제목, 내용, 고객명)"
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-64 pr-8"
          />
          <svg className="w-4 h-4 text-gray-400 absolute right-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Main Content — List + Detail Split */}
      <div className="flex gap-4">
        {/* Ticket List */}
        <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${selectedTicket ? "w-1/2" : "w-full"}`}>
          {loading ? (
            <div className="p-12 text-center text-gray-400">불러오는 중...</div>
          ) : tickets.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              CS 문의가 없습니다. &quot;카페24 CS 수집&quot; 버튼으로 문의를 가져오세요.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {tickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    setSelectedTicket(t);
                    setReplyText(t.reply || "");
                  }}
                  className={`px-4 py-3.5 cursor-pointer transition-colors hover:bg-gray-50 ${
                    selectedTicket?.id === t.id ? "bg-blue-50/50 border-l-2 border-l-[#C41E1E]" : ""
                  } ${t.status === "open" ? "" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Channel Badge */}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${CHANNEL_STYLE[t.channel] || "bg-gray-100 text-gray-600"}`}>
                      {CHANNEL_LABEL[t.channel] || t.channel}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Title Row */}
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${t.status === "open" ? "text-gray-900" : "text-gray-600"}`}>
                          {t.subject}
                        </span>
                        {t.priority === "urgent" && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">긴급</span>
                        )}
                        {t.priority === "high" && (
                          <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">높음</span>
                        )}
                      </div>

                      {/* Meta Row */}
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        {t.stores?.name && <span>{t.stores.name}</span>}
                        {t.customer_name && <span>· {t.customer_name}</span>}
                        {t.ticket_type && <span>· {TYPE_LABEL[t.ticket_type] || t.ticket_type}</span>}
                        <span>· {t.created_at?.slice(0, 10)}</span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[t.status] || STATUS_STYLE.open}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedTicket && (
          <div className="w-1/2 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            {/* Detail Header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CHANNEL_STYLE[selectedTicket.channel]}`}>
                    {CHANNEL_LABEL[selectedTicket.channel] || selectedTicket.channel}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[selectedTicket.status]}`}>
                    {STATUS_LABEL[selectedTicket.status]}
                  </span>
                  <span className={`text-xs ${PRIORITY_STYLE[selectedTicket.priority]}`}>
                    {PRIORITY_LABEL[selectedTicket.priority]}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mt-2">{selectedTicket.subject}</h2>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                {selectedTicket.stores?.name && <span>{selectedTicket.stores.name}</span>}
                {selectedTicket.customer_name && <span>· {selectedTicket.customer_name}</span>}
                {selectedTicket.customer_phone && <span>· {selectedTicket.customer_phone}</span>}
                {selectedTicket.customer_email && <span>· {selectedTicket.customer_email}</span>}
                <span>· {selectedTicket.created_at?.slice(0, 16).replace("T", " ")}</span>
              </div>
              {selectedTicket.order_id && (
                <p className="text-xs text-blue-600 mt-1">주문번호: {selectedTicket.order_id}</p>
              )}
              {selectedTicket.product_name && (
                <p className="text-xs text-gray-500 mt-0.5">{selectedTicket.product_name}</p>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* 고객 문의 */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-900">{selectedTicket.customer_name || "고객"}</span>
                </div>
                <div className="ml-9 bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
                  {selectedTicket.content || "(내용 없음)"}
                </div>
              </div>

              {/* 기존 답변 */}
              {selectedTicket.reply && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-[#C41E1E] flex items-center justify-center">
                      <span className="text-white text-xs font-bold">TP</span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">관리자</span>
                    {selectedTicket.replied_at && (
                      <span className="text-xs text-gray-400">
                        {selectedTicket.replied_at.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                  </div>
                  <div className="ml-9 bg-blue-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
                    {selectedTicket.reply}
                  </div>
                </div>
              )}
            </div>

            {/* Reply Input */}
            <div className="border-t border-gray-100 px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-gray-500">상태 변경:</span>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => handleStatusChange(selectedTicket.id, k)}
                    className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                      selectedTicket.status === k
                        ? `${STATUS_STYLE[k]} font-bold`
                        : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="답변을 입력하세요..."
                rows={3}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-400">
                  {selectedTicket.channel === "cafe24"
                    ? "카페24 게시판에도 자동 동기화됩니다"
                    : selectedTicket.channel === "naver_talk"
                    ? "네이버톡톡으로 자동 발송됩니다"
                    : "DB에만 저장됩니다"}
                </p>
                <button
                  onClick={handleReply}
                  disabled={replying || !replyText.trim()}
                  className="px-4 py-2 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {replying ? "등록 중..." : "답변 등록"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
