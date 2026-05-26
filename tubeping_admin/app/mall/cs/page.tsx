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
  channel_talk: "채널톡",
};

const CHANNEL_STYLE: Record<string, string> = {
  cafe24: "bg-blue-100 text-blue-700",
  sms: "bg-green-100 text-green-700",
  phone: "bg-purple-100 text-purple-700",
  kakao: "bg-yellow-100 text-yellow-800",
  naver_talk: "bg-emerald-100 text-emerald-700",
  channel_talk: "bg-indigo-100 text-indigo-700",
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

interface ChannelTalkAlert {
  id: string;
  subject: string;
  date: string;
  snippet: string;
  channelName: string | null;
  customerName: string | null;
  messagePreview: string | null;
  isRead: boolean;
}

export default function CSPage() {
  const [activeTab, setActiveTab] = useState<"tickets" | "channels" | "channel_talk">("tickets");
  const [tickets, setTickets] = useState<CSTicket[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<CSChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // 채널 등록 폼
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [addChannelType, setAddChannelType] = useState<"naver_talk" | "kakao">("naver_talk");
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

  // 채널톡 알림 상태 (Gmail 기반)
  const [ctAlerts, setCtAlerts] = useState<ChannelTalkAlert[]>([]);
  const [ctLoading, setCtLoading] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterChannel) params.set("channel", filterChannel);
    if (filterStatus) params.set("status", filterStatus);
    if (filterStore) params.set("store_id", filterStore);
    if (filterType) params.set("ticket_type", filterType);
    if (keyword) params.set("keyword", keyword);

    try {
      const res = await fetch(`/admin/api/cs?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (err) {
      console.error("CS 로드 실패:", err);
      setTickets([]);
    } finally {
      setLoading(false);
    }
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
        channel_type: addChannelType,
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

  // 채널톡 알림 조회 (Gmail 기반)
  const fetchCtAlerts = useCallback(async () => {
    setCtLoading(true);
    try {
      const res = await fetch("/admin/api/channeltalk/alerts?limit=20");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCtAlerts(data.alerts || []);
    } catch (err) {
      console.error("채널톡 알림 로드 실패:", err);
      setCtAlerts([]);
    } finally {
      setCtLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchStores();
    fetchChannels();
  }, [fetchTickets]);

  useEffect(() => {
    if (activeTab === "channel_talk") {
      fetchCtAlerts();
    }
  }, [activeTab, fetchCtAlerts]);

  // 카페24 CS 수집
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/admin/api/cafe24/cs");
      const data = await res.json();
      await fetchTickets();
    } catch {
      // 수집 실패
    }
    setSyncing(false);
  };

  // 답변 등록 (채널별 자동 발송)
  const handleReply = async () => {
    if (!selectedTicket || !replyText.trim()) return;
    setReplying(true);

    // 채널톡이면 전용 발송 API 사용
    if (selectedTicket.channel === "channel_talk") {
      const res = await fetch("/admin/api/channeltalk/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: selectedTicket.id, message: replyText }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedTicket({ ...selectedTicket, reply: replyText, status: "replied", replied_at: new Date().toISOString() });
        setReplyText("");
        fetchTickets();
      }
      setReplying(false);
      return;
    }

    // 네이버톡톡 / 카카오톡이면 전용 발송 API 사용
    if (selectedTicket.channel === "naver_talk" || selectedTicket.channel === "kakao") {
      const apiPath = selectedTicket.channel === "kakao" ? "/admin/api/kakaotalk/send" : "/admin/api/navertalk/send";
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: selectedTicket.id, message: replyText }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedTicket({ ...selectedTicket, reply: replyText, status: "replied", replied_at: new Date().toISOString() });
        setReplyText("");
        fetchTickets();
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
            카페24 · 문자 · 전화 · 카카오톡 · 네이버톡 · 채널톡 — 모든 채널 CS를 한 곳에서
          </p>
        </div>
        {activeTab === "channel_talk" && (
          <div className="flex gap-2">
            <a
              href="https://desk.channel.io"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              채널톡 데스크 열기
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
        {activeTab === "tickets" && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSelectedTicket(null);
                const channel = prompt("채널 (sms / phone / kakao / naver_talk / channel_talk):");
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
          <div className="flex gap-2">
            <button
              onClick={() => { setAddChannelType("naver_talk"); setShowAddChannel(true); }}
              className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 cursor-pointer"
            >
              + 네이버톡톡
            </button>
            <button
              onClick={() => { setAddChannelType("kakao"); setShowAddChannel(true); }}
              className="px-4 py-2.5 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 cursor-pointer"
            >
              + 카카오톡
            </button>
          </div>
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
          onClick={() => setActiveTab("channel_talk")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeTab === "channel_talk" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          채널톡
          {ctAlerts.filter((a) => !a.isRead).length > 0 && (
            <span className="ml-1.5 text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">
              {ctAlerts.filter((a) => !a.isRead).length}
            </span>
          )}
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

      {/* ═══════ 채널톡 탭 ═══════ */}
      {activeTab === "channel_talk" && (
        <>
          {/* 알림 목록 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {ctLoading ? (
              <div className="p-12 text-center text-gray-400">불러오는 중...</div>
            ) : ctAlerts.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm mb-1">채널톡 알림이 없습니다</p>
                <p className="text-gray-400 text-xs">채널톡 알림 이메일이 master@shinsananalytics.com으로 수신되면 여기에 표시됩니다</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {ctAlerts.map((alert) => (
                  <a
                    key={alert.id}
                    href="https://desk.channel.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block px-5 py-4 transition-colors hover:bg-gray-50 ${
                      !alert.isRead ? "bg-indigo-50/30" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* 읽음 표시 */}
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${!alert.isRead ? "bg-indigo-500" : "bg-transparent"}`} />

                      {/* 아바타 */}
                      <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-indigo-600">
                          {(alert.customerName || "?").charAt(0).toUpperCase()}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {alert.channelName && (
                            <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full shrink-0">
                              {alert.channelName}
                            </span>
                          )}
                          {alert.customerName && (
                            <span className={`text-sm truncate ${!alert.isRead ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
                              {alert.customerName}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">{alert.messagePreview || alert.snippet}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(alert.date).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                        </p>
                      </div>

                      {/* 답변하기 링크 */}
                      <span className="text-xs text-indigo-600 font-medium shrink-0 mt-1">
                        답변하기 &rarr;
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* 새로고침 + 안내 */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={fetchCtAlerts}
              disabled={ctLoading}
              className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 cursor-pointer disabled:opacity-50"
            >
              {ctLoading ? "새로고침 중..." : "새로고침"}
            </button>
            <p className="text-xs text-gray-400">채널톡 알림 이메일 (feedback@channel.io) 기반 — 답변은 채널톡 데스크에서</p>
          </div>

          {/* 연동 안내 */}
          {ctAlerts.length === 0 && !ctLoading && (
            <div className="mt-6 bg-indigo-50 rounded-xl border border-indigo-200/50 p-5">
              <h3 className="text-sm font-bold text-indigo-700 mb-3">채널톡 알림 연동 (무료 플랜 OK)</h3>
              <ol className="space-y-2 text-xs text-gray-600">
                <li><span className="font-bold text-indigo-700">1.</span> 채널톡 알림 이메일이 <code className="bg-white px-1.5 py-0.5 rounded text-indigo-700 text-[11px]">master@shinsananalytics.com</code>으로 수신되는지 확인</li>
                <li><span className="font-bold text-indigo-700">2.</span> Vercel 환경변수에 Gmail OAuth 키 설정:
                  <div className="mt-1 space-y-1 ml-4">
                    <code className="block bg-white px-2 py-1 rounded text-[11px] text-gray-700">GMAIL_CLIENT_ID</code>
                    <code className="block bg-white px-2 py-1 rounded text-[11px] text-gray-700">GMAIL_CLIENT_SECRET</code>
                    <code className="block bg-white px-2 py-1 rounded text-[11px] text-gray-700">GMAIL_REFRESH_TOKEN</code>
                  </div>
                </li>
                <li><span className="font-bold text-indigo-700">3.</span> 고객 응대 대기 알림이 여기에 자동 표시 &rarr; 클릭하면 채널톡 데스크에서 바로 답변</li>
              </ol>
            </div>
          )}
        </>
      )}

      {/* ═══════ 채널 설정 탭 ═══════ */}
      {activeTab === "channels" && (
        <>
          {/* 등록 폼 */}
          {showAddChannel && (
            <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                {addChannelType === "kakao" ? "카카오톡 채널 등록" : "네이버톡톡 계정 등록"}
              </h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">계정 이름 *</label>
                  <input
                    type="text"
                    placeholder={addChannelType === "kakao" ? "예: 신산 카카오채널" : "예: 신산 네이버톡톡"}
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {addChannelType === "kakao" ? "봇 ID / 채널 ID *" : "파트너 ID *"}
                  </label>
                  <input
                    type="text"
                    placeholder={addChannelType === "kakao" ? "카카오 i 오픈빌더 > 설정 > 봇 ID" : "파트너센터 > 개발자도구 > 챗봇API"}
                    value={channelForm.account_id}
                    onChange={(e) => setChannelForm({ ...channelForm, account_id: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {addChannelType === "kakao" ? "REST API 키" : "Authorization 키"}
                  </label>
                  <input
                    type="password"
                    placeholder={addChannelType === "kakao" ? "카카오 디벨로퍼스 > 앱 설정 > REST API 키" : "보내기 API 인증 키"}
                    value={channelForm.auth_key}
                    onChange={(e) => setChannelForm({ ...channelForm, auth_key: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C41E1E]/20 focus:border-[#C41E1E]"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {addChannelType === "kakao"
                      ? "developers.kakao.com > 내 애플리케이션 > 앱 키"
                      : "파트너센터 > API 설정 > 보내기 API에서 확인"}
                  </p>
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
              <p className="text-gray-500 text-sm mb-2">등록된 채널 계정이 없습니다</p>
              <p className="text-gray-400 text-xs">위의 &quot;+ 네이버톡톡&quot; 또는 &quot;+ 카카오톡&quot; 버튼으로 등록하세요</p>
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((ch) => (
                <div key={ch.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        ch.channel_type === "kakao" ? "bg-yellow-100" : "bg-emerald-100"
                      }`}>
                        <svg className={`w-5 h-5 ${ch.channel_type === "kakao" ? "text-yellow-600" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-gray-900">{ch.name}</h3>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ch.channel_type === "kakao" ? "bg-yellow-100 text-yellow-800" : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {ch.channel_type === "kakao" ? "카카오톡" : "네이버톡톡"}
                          </span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            ch.status === "active" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {ch.status === "active" ? "활성" : "대기"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span>{ch.channel_type === "kakao" ? "봇 ID" : "파트너ID"}: <span className="font-mono text-gray-700">{ch.account_id}</span></span>
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
                        <p className="text-[10px] font-medium text-gray-500 mb-0.5">
                          {ch.channel_type === "kakao" ? "스킬 서버 URL (오픈빌더에 등록)" : "웹훅 URL (파트너센터에 등록)"}
                        </p>
                        <p className="text-xs font-mono text-gray-700 break-all">{ch.webhook_url}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(ch.webhook_url || "");
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
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="bg-emerald-50 rounded-xl border border-emerald-200/50 p-5">
              <h3 className="text-sm font-bold text-emerald-700 mb-3">네이버톡톡 연동</h3>
              <ol className="space-y-2 text-xs text-gray-600">
                <li><span className="font-bold text-emerald-700">1.</span> 위에서 계정 추가 (파트너 ID + Auth 키)</li>
                <li><span className="font-bold text-emerald-700">2.</span> 생성된 웹훅 URL → 파트너센터에 등록</li>
                <li><span className="font-bold text-emerald-700">3.</span> 파트너센터에서 send 이벤트 활성화</li>
                <li><span className="font-bold text-emerald-700">4.</span> 고객 메시지 자동 수신 → 답변 자동 발송</li>
              </ol>
            </div>
            <div className="bg-yellow-50 rounded-xl border border-yellow-200/50 p-5">
              <h3 className="text-sm font-bold text-yellow-700 mb-3">카카오톡 연동</h3>
              <ol className="space-y-2 text-xs text-gray-600">
                <li><span className="font-bold text-yellow-700">1.</span> 위에서 계정 추가 (봇 ID + REST API 키)</li>
                <li><span className="font-bold text-yellow-700">2.</span> 생성된 스킬 URL → 오픈빌더 스킬에 등록</li>
                <li><span className="font-bold text-yellow-700">3.</span> 시나리오 블록에서 스킬 연결</li>
                <li><span className="font-bold text-yellow-700">4.</span> 고객 메시지 자동 수신 → 접수 안내 자동 응답</li>
              </ol>
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
        <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${selectedTicket ? "hidden lg:block lg:w-1/2" : "w-full"}`}>
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
          <div className="w-full lg:w-1/2 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            {/* Detail Header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedTicket(null)} className="lg:hidden p-1 hover:bg-gray-100 rounded text-gray-400 cursor-pointer">←</button>
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
                    : selectedTicket.channel === "kakao"
                    ? "카카오톡 콜백으로 발송 시도됩니다"
                    : selectedTicket.channel === "channel_talk"
                    ? "채널톡으로 실시간 발송됩니다"
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
