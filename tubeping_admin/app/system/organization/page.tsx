"use client";

import { useState } from "react";

/* ══════════════════════════════════════════
   타입 & 데이터
   ══════════════════════════════════════════ */

const TABS = ["에이전트 관리", "사업 기획", "디자인 가이드"] as const;
type Tab = (typeof TABS)[number];

/* ── 에이전트 ── */
type Agent = {
  name: string;
  nameEn: string;
  icon: string;
  role: string;
  desc: string;
  file: string;
  status: "활성" | "개발중" | "예정";
  skills: string[];
  permission: "RW" | "RO";
};

/* 팀 정의 */
type Team = {
  name: string;
  color: string;
  members: Agent[];
};

const TEAMS: Team[] = [
  {
    name: "기획팀",
    color: "bg-purple-100 border-purple-300",
    members: [
      { name: "전략이", nameEn: "Strategist", icon: "🧠", role: "기획팀", desc: "사업 기획서/제안서 작성, 시장 분석", file: "", status: "예정", skills: ["사업 기획", "시장 분석", "제안서 작성"], permission: "RW" },
      { name: "벤치마커", nameEn: "Benchmarker", icon: "🔍", role: "기획팀", desc: "경쟁사 분석, 벤치마킹 리서치", file: "", status: "예정", skills: ["경쟁 분석", "벤치마킹", "트렌드 리서치"], permission: "RO" },
      { name: "플래너", nameEn: "Planner", icon: "📋", role: "기획팀", desc: "프로젝트 일정 관리, 마일스톤 추적", file: "", status: "예정", skills: ["일정 관리", "마일스톤", "로드맵"], permission: "RW" },
    ],
  },
  {
    name: "소싱팀",
    color: "bg-blue-100 border-blue-300",
    members: [
      { name: "트렌디", nameEn: "Trendy", icon: "📈", role: "소싱팀", desc: "네이버 DataLab 트렌드 키워드 수집", file: "", status: "개발중", skills: ["DataLab API", "트렌드 분석", "키워드 수집"], permission: "RO" },
      { name: "셀러", nameEn: "Seller", icon: "🛒", role: "소싱팀", desc: "셀러라이프 상품 데이터 수집", file: "", status: "개발중", skills: ["셀러라이프", "상품 수집", "가격 분석"], permission: "RO" },
      { name: "스코어러", nameEn: "Scorer", icon: "🎯", role: "소싱팀", desc: "4가지 점수 계산 (트렌드/마진/시즌/채널적합)", file: "", status: "개발중", skills: ["점수 계산", "가중치 분석", "채널 매칭"], permission: "RO" },
      { name: "리포터", nameEn: "Reporter", icon: "📊", role: "소싱팀", desc: "채널별 Excel 리포트 생성 + 추천", file: "", status: "개발중", skills: ["Excel 리포트", "채널별 추천", "데이터 시각화"], permission: "RW" },
    ],
  },
  {
    name: "콘텐츠팀",
    color: "bg-green-100 border-green-300",
    members: [
      { name: "블로거", nameEn: "Blogger", icon: "✍️", role: "콘텐츠팀", desc: "SEO 최적화 블로그 콘텐츠 기획·작성·발행", file: ".claude/agents/tubeping-blogger.md", status: "활성", skills: ["키워드 리서치", "SEO 최적화", "콘텐츠 작성", "E-E-A-T"], permission: "RW" },
      { name: "리뷰양이", nameEn: "Review Owl", icon: "🦉", role: "콘텐츠팀", desc: "노써치 스타일 상품 리뷰·추천 사이트 구축", file: ".claude/agents/reviewyangi.md", status: "활성", skills: ["상품 리뷰", "점수 시스템", "구매가이드", "랭킹"], permission: "RW" },
      { name: "키워디", nameEn: "Keywordy", icon: "🔑", role: "콘텐츠팀", desc: "키워드 리서치 + 경쟁 분석", file: "", status: "예정", skills: ["키워드 분석", "검색량 조회", "경쟁도 분석"], permission: "RO" },
      { name: "머시니", nameEn: "Machiny", icon: "⚙️", role: "콘텐츠팀", desc: "콘텐츠 머신 대기열 자동 처리", file: "", status: "예정", skills: ["자동 발행", "대기열 관리", "스케줄링"], permission: "RW" },
      { name: "썸네일러", nameEn: "Thumbnailer", icon: "🎨", role: "콘텐츠팀", desc: "상품 이미지/배너 자동 생성", file: "", status: "예정", skills: ["이미지 생성", "배너 디자인", "썸네일"], permission: "RW" },
    ],
  },
  {
    name: "영업팀",
    color: "bg-yellow-100 border-yellow-300",
    members: [
      { name: "세일즈", nameEn: "Sales YouTuber", icon: "🎬", role: "영업팀", desc: "유튜브 쇼핑 채널 운영 + 영상 커머스 전략", file: "", status: "예정", skills: ["유튜브 쇼핑", "채널 운영", "영상 기획"], permission: "RW" },
      { name: "아웃리처", nameEn: "Outreacher", icon: "📧", role: "영업팀", desc: "유튜버 이메일 수집 + 아웃리치 메일 발송", file: "", status: "예정", skills: ["이메일 수집", "아웃리치", "템플릿 관리"], permission: "RW" },
      { name: "시알엠", nameEn: "CRM Agent", icon: "🤝", role: "영업팀", desc: "유튜버 CRM 관리 + 팔로업 자동화", file: "", status: "예정", skills: ["CRM 관리", "팔로업", "파이프라인"], permission: "RW" },
    ],
  },
  {
    name: "커머스팀",
    color: "bg-orange-100 border-orange-300",
    members: [
      { name: "프로덕터", nameEn: "Producter", icon: "📦", role: "커머스팀", desc: "상품 등록/수정/재고 관리", file: "", status: "예정", skills: ["상품 등록", "재고 관리", "카테고리"], permission: "RW" },
      { name: "오더러", nameEn: "Orderer", icon: "🚚", role: "커머스팀", desc: "발주 자동화 + 배송 추적", file: "", status: "예정", skills: ["발주 관리", "배송 추적", "자동 발주"], permission: "RW" },
      { name: "정산이", nameEn: "Settler", icon: "💰", role: "커머스팀", desc: "수수료 계산 + 정산서 생성", file: "", status: "예정", skills: ["수수료 계산", "정산서", "매출 집계"], permission: "RO" },
    ],
  },
  {
    name: "분석팀",
    color: "bg-pink-100 border-pink-300",
    members: [
      { name: "대시보더", nameEn: "Dashboarder", icon: "📉", role: "분석팀", desc: "KPI 대시보드 데이터 집계", file: "", status: "예정", skills: ["KPI 집계", "대시보드", "지표 관리"], permission: "RO" },
      { name: "인사이터", nameEn: "Insighter", icon: "💡", role: "분석팀", desc: "일간/주간 성장 인사이트 생성", file: "", status: "예정", skills: ["성장 분석", "인사이트", "리포트"], permission: "RO" },
      { name: "모니터", nameEn: "Monitor", icon: "🔔", role: "분석팀", desc: "재고 부족/미정산/이상 징후 알림", file: "", status: "예정", skills: ["알림", "모니터링", "이상 탐지"], permission: "RO" },
    ],
  },
  {
    name: "개발팀",
    color: "bg-cyan-100 border-cyan-300",
    members: [
      { name: "빌더", nameEn: "Builder", icon: "💻", role: "개발팀", desc: "프론트/백엔드 코드 구현", file: "", status: "예정", skills: ["Next.js", "TypeScript", "Tailwind", "API"], permission: "RW" },
      { name: "테스터", nameEn: "Tester", icon: "🧪", role: "개발팀", desc: "빌드 검증 + E2E 테스트", file: "", status: "예정", skills: ["tsc 검증", "E2E 테스트", "빌드 체크"], permission: "RO" },
      { name: "리뷰어", nameEn: "Reviewer", icon: "🔎", role: "개발팀", desc: "코드 리뷰 + 보안 점검", file: "", status: "예정", skills: ["코드 리뷰", "보안 점검", "품질 관리"], permission: "RO" },
      { name: "디플로이", nameEn: "Deployer", icon: "🚀", role: "개발팀", desc: "Vercel 배포 + 모니터링", file: "", status: "예정", skills: ["배포", "Vercel", "CI/CD"], permission: "RW" },
    ],
  },
];

const ALL_AGENTS = TEAMS.flatMap((t) => t.members);

const AGENT_STATUS_STYLE: Record<string, string> = {
  "활성": "bg-green-100 text-green-700",
  "개발중": "bg-blue-100 text-blue-700",
  "예정": "bg-gray-100 text-text-tertiary",
};

/* ── 사업 기획 ── */
type Project = {
  title: string;
  status: "진행중" | "완료" | "기획" | "예정";
  progress: number;
  desc: string;
  due: string;
  milestones: { name: string; done: boolean }[];
};

const PROJECTS: Project[] = [
  {
    title: "TubePing 어드민 허브",
    status: "진행중",
    progress: 70,
    desc: "AI 에이전트 + 자동화 인프라를 관리하는 통합 어드민 시스템",
    due: "2026-04",
    milestones: [
      { name: "사이드바 + 대시보드", done: true },
      { name: "마케팅 메뉴 (블로그/콘텐츠머신)", done: true },
      { name: "종합몰 관리 (상품/발주/정산)", done: true },
      { name: "조직&전략 허브", done: true },
      { name: "디자인 시스템 가이드", done: true },
      { name: "실제 데이터 연동", done: false },
      { name: "인증/권한 시스템", done: false },
    ],
  },
  {
    title: "리뷰양이 (Review Owl) 사이트",
    status: "진행중",
    progress: 30,
    desc: "노써치 스타일 상품 리뷰·추천 사이트. 구매가이드/랭킹/비교 제공",
    due: "2026-05",
    milestones: [
      { name: "에이전트 설계 (.md 작성)", done: true },
      { name: "사이트 구조 설계", done: true },
      { name: "점수 시스템 설계", done: true },
      { name: "프론트엔드 구축", done: false },
      { name: "카페24 상품 데이터 연동", done: false },
      { name: "리뷰 콘텐츠 자동 생성", done: false },
    ],
  },
  {
    title: "소싱 자동화 파이프라인",
    status: "완료",
    progress: 100,
    desc: "네이버 DataLab + 셀러라이프 → 점수 계산 → Excel 리포트 자동 생성",
    due: "2026-03",
    milestones: [
      { name: "DataLab 수집 모듈", done: true },
      { name: "셀러라이프 수집 모듈", done: true },
      { name: "4가지 점수 계산 엔진", done: true },
      { name: "채널별 Excel 리포트", done: true },
    ],
  },
  {
    title: "세일즈 유튜버 에이전트",
    status: "예정",
    progress: 0,
    desc: "유튜브 쇼핑 채널 운영 + 영상 커머스 전략 자동화 에이전트",
    due: "2026-06",
    milestones: [
      { name: "에이전트 설계", done: false },
      { name: "유튜브 쇼핑 분석", done: false },
      { name: "영상 기획 자동화", done: false },
    ],
  },
];

const PROJECT_STATUS_STYLE: Record<string, string> = {
  "진행중": "bg-blue-100 text-blue-700",
  "완료": "bg-green-100 text-green-700",
  "기획": "bg-yellow-100 text-yellow-700",
  "예정": "bg-gray-100 text-text-tertiary",
};

/* ── 디자인 가이드 ── */
const BRAND_COLORS = [
  { token: "--primary", name: "브랜드 레드", value: "#C41E1E", desc: "CTA 버튼, 활성 메뉴, 로고 Tube" },
  { token: "--primary-hover", name: "브랜드 호버", value: "#A01818", desc: "버튼 호버 상태" },
  { token: "--primary-light", name: "브랜드 라이트", value: "#FFF0F3", desc: "활성 메뉴 배경, 뱃지 배경" },
  { token: "--primary-dim", name: "브랜드 딤", value: "rgba(196,30,30,0.08)", desc: "포커스 링, 미묘한 강조" },
];

const UI_COLORS = [
  { token: "--background", name: "배경", value: "#F7F7F8", desc: "전체 페이지 배경" },
  { token: "--card", name: "카드", value: "#FFFFFF", desc: "카드, 모달, 테이블 배경" },
  { token: "--foreground", name: "텍스트 기본", value: "#111111", desc: "제목, 본문 텍스트" },
  { token: "--text-secondary", name: "텍스트 보조", value: "#666666", desc: "설명, 부제목" },
  { token: "--text-tertiary", name: "텍스트 3차", value: "#999999", desc: "플레이스홀더, 비활성" },
  { token: "--border", name: "테두리", value: "#F0F0F0", desc: "카드 구분선" },
  { token: "--border-strong", name: "테두리 강조", value: "#E0E0E0", desc: "입력 필드 테두리" },
];

const SEMANTIC_COLORS = [
  { name: "성공", value: "#22C55E", bg: "#F0FDF4", desc: "완료, 활성" },
  { name: "경고", value: "#F59E0B", bg: "#FFFBEB", desc: "배송중, 중간" },
  { name: "에러", value: "#EF4444", bg: "#FEF2F2", desc: "품절, 높음" },
  { name: "정보", value: "#3B82F6", bg: "#EFF6FF", desc: "진행중, 링크" },
];

const TYPOGRAPHY = [
  { name: "페이지 제목", size: "24px", weight: "700", tailwind: "text-2xl font-bold" },
  { name: "섹션 제목", size: "18px", weight: "700", tailwind: "text-lg font-semibold" },
  { name: "본문", size: "15px", weight: "400", tailwind: "text-sm" },
  { name: "보조 텍스트", size: "13px", weight: "400", tailwind: "text-xs" },
  { name: "라벨/뱃지", size: "11px", weight: "700", tailwind: "text-[11px] font-bold" },
];

/* ══════════════════════════════════════════
   탭 컴포넌트
   ══════════════════════════════════════════ */

/* ── 에이전트 관리 탭 ── */
function AgentTab() {
  const [selected, setSelected] = useState<Agent | null>(null);

  const activeCount = ALL_AGENTS.filter((a) => a.status === "활성").length;
  const devCount = ALL_AGENTS.filter((a) => a.status === "개발중").length;
  const plannedCount = ALL_AGENTS.filter((a) => a.status === "예정").length;

  return (
    <>
      {/* 요약 */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-foreground">{ALL_AGENTS.length}<span className="text-base font-normal text-text-secondary ml-0.5">명</span></p>
          <p className="text-xs text-[#C41E1E] font-medium mt-1">전체 에이전트</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-foreground">{TEAMS.length}<span className="text-base font-normal text-text-secondary ml-0.5">개</span></p>
          <p className="text-xs text-[#C41E1E] font-medium mt-1">팀</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{activeCount}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">활성</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{devCount}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">개발중</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-text-tertiary">{plannedCount}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">예정</p>
        </div>
      </div>

      {/* 조직도 — oh-car 스타일 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-bold text-foreground">
            AI 조직도 <span className="text-xs font-normal text-[#C41E1E] ml-2">{ALL_AGENTS.length}명</span>
          </h3>
        </div>

        {/* CTO */}
        <div className="flex justify-center mb-4">
          <div className="bg-[#C41E1E] text-white rounded-2xl px-8 py-4 text-center shadow-sm">
            <p className="text-2xl mb-1">🏗️</p>
            <p className="text-sm font-bold">Claude Code (CTO)</p>
            <p className="text-[10px] opacity-80">설계 · 기획 · 위임</p>
          </div>
        </div>

        <div className="w-px h-6 bg-gray-300 mx-auto" />
        <div className="w-[90%] h-px bg-gray-300 mx-auto" />

        {/* Team cards — oh-car 스타일 */}
        <div className="grid grid-cols-7 gap-3 mt-0">
          {TEAMS.map((team) => (
            <div key={team.name} className="flex flex-col items-center">
              <div className="w-px h-6 bg-gray-300" />
              <div className={`w-full rounded-xl border-2 ${team.color} p-3 min-h-[200px]`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-foreground">{team.name}</h4>
                  <span className="text-[10px] text-[#C41E1E] font-bold">{team.members.length}명</span>
                </div>
                <div className="space-y-1.5">
                  {team.members.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => setSelected(selected?.name === m.name ? null : m)}
                      className={`w-full flex items-center gap-1.5 p-1.5 rounded-lg text-left transition-all cursor-pointer ${
                        selected?.name === m.name
                          ? "bg-[#FFF0F3] border border-[#C41E1E]/30"
                          : "hover:bg-white/80"
                      }`}
                    >
                      <span className="text-sm">{m.icon}</span>
                      <span className={`text-[11px] ${m.status === "활성" ? "font-bold text-foreground" : m.status === "개발중" ? "font-medium text-blue-700" : "text-text-tertiary"}`}>
                        {m.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 선택된 에이전트 상세 */}
      {selected && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{selected.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-foreground">{selected.name}</h3>
                  <span className="text-xs text-text-tertiary font-mono">({selected.nameEn})</span>
                </div>
                <p className="text-sm text-text-secondary mt-0.5">{selected.desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${AGENT_STATUS_STYLE[selected.status]}`}>
                {selected.status}
              </span>
              <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${
                selected.permission === "RW" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-text-secondary"
              }`}>
                {selected.permission === "RW" ? "읽기/쓰기" : "읽기전용"}
              </span>
            </div>
          </div>

          {/* 스킬 */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-text-secondary mb-2">스킬</p>
            <div className="flex flex-wrap gap-2">
              {selected.skills.map((skill) => (
                <span key={skill} className="text-xs px-3 py-1 rounded-full border border-gray-200 text-text-secondary">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* 파일 */}
          {selected.file ? (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <span className="text-sm">📄</span>
              <code className="text-xs font-mono text-text-secondary">{selected.file}</code>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <span className="text-sm">📝</span>
              <span className="text-xs text-text-tertiary">에이전트 파일 미생성 — .claude/agents/ 에 생성 예정</span>
            </div>
          )}
        </div>
      )}

      {/* 에이전트 목록 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-foreground">에이전트 상세 목록</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[11px] text-text-secondary border-b border-gray-100">
              <th className="text-left px-6 py-3 font-medium">에이전트</th>
              <th className="text-left px-3 py-3 font-medium">역할</th>
              <th className="text-left px-3 py-3 font-medium">팀</th>
              <th className="text-center px-3 py-3 font-medium">권한</th>
              <th className="text-center px-3 py-3 font-medium">상태</th>
              <th className="text-left px-6 py-3 font-medium">파일</th>
            </tr>
          </thead>
          <tbody>
            {ALL_AGENTS.map((agent) => (
              <tr key={agent.name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{agent.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{agent.name}</p>
                      <p className="text-[10px] text-text-tertiary font-mono">{agent.nameEn}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-text-secondary">{agent.desc}</td>
                <td className="px-3 py-3 text-xs text-text-secondary">{agent.role}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    agent.permission === "RW" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-text-secondary"
                  }`}>
                    {agent.permission}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${AGENT_STATUS_STYLE[agent.status]}`}>
                    {agent.status}
                  </span>
                </td>
                <td className="px-6 py-3">
                  {agent.file ? (
                    <code className="text-[11px] text-text-tertiary font-mono">{agent.file}</code>
                  ) : (
                    <span className="text-[11px] text-text-tertiary">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── 사업 기획 탭 ── */
function BusinessTab() {
  const [expanded, setExpanded] = useState<string | null>(PROJECTS[0].title);

  return (
    <>
      {/* 요약 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-foreground">{PROJECTS.length}</p>
          <p className="text-xs text-[#C41E1E] font-medium mt-1">전체 프로젝트</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{PROJECTS.filter((p) => p.status === "진행중").length}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">진행중</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{PROJECTS.filter((p) => p.status === "완료").length}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">완료</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-3xl font-bold text-text-tertiary">{PROJECTS.filter((p) => p.status === "예정").length}</p>
          <p className="text-xs text-text-secondary font-medium mt-1">예정</p>
        </div>
      </div>

      {/* 프로젝트 카드 */}
      <div className="space-y-4">
        {PROJECTS.map((project) => (
          <div key={project.title} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpanded(expanded === project.title ? null : project.title)}
              className="w-full px-6 py-5 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-foreground">{project.title}</h3>
                <span className={`text-[10px] font-medium px-2.5 py-0.5 rounded-full ${PROJECT_STATUS_STYLE[project.status]}`}>
                  {project.status}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-text-tertiary">목표: {project.due}</span>
                <div className="flex items-center gap-2 w-32">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="bg-[#C41E1E] h-full rounded-full" style={{ width: `${project.progress}%` }} />
                  </div>
                  <span className="text-xs font-medium text-text-secondary w-8 text-right">{project.progress}%</span>
                </div>
                <svg
                  className={`w-4 h-4 text-text-tertiary transition-transform ${expanded === project.title ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded content */}
            {expanded === project.title && (
              <div className="px-6 pb-5 border-t border-gray-100 pt-4">
                <p className="text-sm text-text-secondary mb-4">{project.desc}</p>

                {/* Milestones */}
                <h4 className="text-xs font-semibold text-text-secondary mb-3">마일스톤</h4>
                <div className="space-y-2">
                  {project.milestones.map((ms, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        ms.done ? "bg-green-500" : "border-2 border-gray-300"
                      }`}>
                        {ms.done && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-sm ${ms.done ? "text-text-secondary line-through" : "text-foreground"}`}>
                        {ms.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── 디자인 가이드 탭 ── */
function DesignTab() {
  const [activeChip, setActiveChip] = useState("전체");

  return (
    <>
      {/* 로고 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-bold text-foreground mb-4">로고 규칙</h3>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <span className="text-3xl font-extrabold">
              <span className="text-[#C41E1E]">Tube</span>
              <span className="text-foreground">Ping</span>
            </span>
            <p className="text-[10px] text-text-tertiary mt-2">기본 (밝은 배경)</p>
          </div>
          <div className="text-center bg-foreground rounded-lg px-6 py-4">
            <span className="text-3xl font-extrabold">
              <span className="text-[#C41E1E]">Tube</span>
              <span className="text-white">Ping</span>
            </span>
            <p className="text-[10px] text-gray-400 mt-2">다크 배경</p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-[#C41E1E] flex items-center justify-center mx-auto">
              <span className="text-white font-bold">TP</span>
            </div>
            <p className="text-[10px] text-text-tertiary mt-2">아이콘</p>
          </div>
        </div>
        <div className="mt-4 text-xs text-text-secondary space-y-1">
          <p><strong>Tube</strong> = #C41E1E (항상 빨간색) / <strong>Ping</strong> = #111111 (밝은 배경) · #FFFFFF (어두운 배경)</p>
          <p>두 단어 사이 공백 없음. font-extrabold 고정.</p>
        </div>
      </div>

      {/* 색상 토큰 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-bold text-foreground mb-4">색상 토큰</h3>

        {/* 브랜드 */}
        <p className="text-xs font-semibold text-text-secondary mb-3">브랜드</p>
        <div className="grid grid-cols-4 gap-3 mb-6">
          {BRAND_COLORS.map((c) => (
            <div key={c.token} className="text-center">
              <div className="w-full h-16 rounded-lg border border-gray-200 mb-2" style={{ background: c.value }} />
              <p className="text-xs font-semibold text-foreground">{c.name}</p>
              <code className="text-[10px] text-text-tertiary font-mono">{c.value}</code>
              <p className="text-[10px] text-text-tertiary mt-0.5">{c.desc}</p>
            </div>
          ))}
        </div>

        {/* UI */}
        <p className="text-xs font-semibold text-text-secondary mb-3">UI 기본</p>
        <div className="space-y-2 mb-6">
          {UI_COLORS.map((c) => (
            <div key={c.token} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg border border-gray-200 shrink-0" style={{ background: c.value }} />
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs font-medium text-foreground w-24">{c.name}</span>
                <code className="text-[10px] text-text-tertiary font-mono w-20">{c.token}</code>
              </div>
              <code className="text-[10px] text-text-tertiary font-mono">{c.value}</code>
            </div>
          ))}
        </div>

        {/* 시맨틱 */}
        <p className="text-xs font-semibold text-text-secondary mb-3">시맨틱 (상태)</p>
        <div className="grid grid-cols-4 gap-3">
          {SEMANTIC_COLORS.map((c) => (
            <div key={c.name} className="text-center">
              <div className="flex gap-1 justify-center mb-1">
                <div className="w-8 h-8 rounded-lg border border-gray-200" style={{ background: c.value }} />
                <div className="w-8 h-8 rounded-lg border border-gray-200" style={{ background: c.bg }} />
              </div>
              <p className="text-xs font-semibold text-foreground">{c.name}</p>
              <p className="text-[10px] text-text-tertiary">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 타이포그래피 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-bold text-foreground mb-4">타이포그래피</h3>
        <div className="space-y-3">
          {TYPOGRAPHY.map((t) => (
            <div key={t.name} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-4">
                <span className="text-xs text-text-secondary w-20">{t.name}</span>
                <span style={{ fontSize: t.size, fontWeight: Number(t.weight) }} className="text-foreground">
                  TubePing 샘플
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-text-tertiary font-mono">{t.size} / {t.weight}</span>
                <code className="text-[10px] bg-gray-50 px-2 py-0.5 rounded font-mono text-text-tertiary">{t.tailwind}</code>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-3">fontSize 5종(11/13/15/18/24)만 사용. fontWeight 400/700 2단계만.</p>
      </div>

      {/* 필터 칩 + 뱃지 + 버튼 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-bold text-foreground mb-4">컴포넌트</h3>

        {/* 필터 칩 */}
        <p className="text-xs font-semibold text-text-secondary mb-3">필터 칩</p>
        <div className="flex gap-2 mb-5">
          {["전체", "판매중", "품절임박", "품절"].map((chip) => (
            <button
              key={chip}
              onClick={() => setActiveChip(chip)}
              className="cursor-pointer transition-all"
              style={{
                padding: "6px 16px",
                borderRadius: "100px",
                fontSize: "13px",
                border: activeChip === chip ? "1.5px solid #C41E1E" : "1.5px solid #E0E0E0",
                background: activeChip === chip ? "#FFF0F3" : "transparent",
                color: activeChip === chip ? "#C41E1E" : "#555",
                fontWeight: activeChip === chip ? 700 : 400,
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* 상태 뱃지 */}
        <p className="text-xs font-semibold text-text-secondary mb-3">상태 뱃지</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { label: "활성", cls: "bg-green-100 text-green-700" },
            { label: "개발중", cls: "bg-blue-100 text-blue-700" },
            { label: "진행중", cls: "bg-blue-100 text-blue-700" },
            { label: "완료", cls: "bg-green-100 text-green-700" },
            { label: "예정", cls: "bg-gray-100 text-gray-500" },
            { label: "품절", cls: "bg-red-100 text-red-700" },
            { label: "배송중", cls: "bg-yellow-100 text-yellow-700" },
          ].map((b) => (
            <span key={b.label} className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${b.cls}`}>{b.label}</span>
          ))}
        </div>

        {/* 버튼 */}
        <p className="text-xs font-semibold text-text-secondary mb-3">버튼</p>
        <div className="flex gap-3">
          <button className="px-4 py-2.5 bg-[#C41E1E] text-white text-sm font-medium rounded-lg hover:bg-[#A01818] transition-colors cursor-pointer">
            Primary
          </button>
          <button className="px-4 py-2.5 bg-white text-foreground text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer">
            Secondary
          </button>
          <button className="px-4 py-2.5 bg-white text-red-500 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 transition-colors cursor-pointer">
            Danger
          </button>
          <button className="px-4 py-2.5 bg-gray-100 text-text-tertiary text-sm font-medium rounded-lg cursor-not-allowed" disabled>
            Disabled
          </button>
        </div>
      </div>

      {/* 스타일 규칙 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-base font-bold text-foreground mb-4">스타일 규칙</h3>
        <div className="space-y-2">
          {[
            "어드민 페이지: Tailwind className만 사용",
            "색상은 반드시 디자인 토큰(CSS 변수) 사용 — Tailwind 기본 색상(red-500 등) 금지",
            "fontSize 5종(11/13/15/18/24), fontWeight 400/700 2단계만",
            "카드: bg-card rounded-xl border border-border p-5",
            "섹션 구분: border-b border-border (회색 띠 배경 금지)",
            "입력 필드: focus:ring-2 focus:ring-primary-dim focus:border-primary",
          ].map((rule, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[#C41E1E] text-sm mt-0.5">•</span>
              <p className="text-sm text-text-secondary">{rule}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   메인 페이지
   ══════════════════════════════════════════ */

export default function OrganizationPage() {
  const [activeTab, setActiveTab] = useState<Tab>("에이전트 관리");

  const TAB_CONTENT: Record<Tab, React.ReactNode> = {
    "에이전트 관리": <AgentTab />,
    "사업 기획": <BusinessTab />,
    "디자인 가이드": <DesignTab />,
  };

  return (
    <div className="p-8 max-w-[1100px]">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-foreground">TubePing 조직&전략 허브</h1>
          <span className="text-[10px] font-bold text-white bg-foreground px-2.5 py-1 rounded">
            SUPER ADMIN
          </span>
        </div>
        <p className="text-sm text-text-secondary">
          Claude Code로 구축된 AI 에이전트 생태계 + 개발 인프라 전체 현황
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer rounded-t-lg ${
              activeTab === tab
                ? "text-foreground bg-white border border-gray-200 border-b-white -mb-px"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {TAB_CONTENT[activeTab]}
    </div>
  );
}
