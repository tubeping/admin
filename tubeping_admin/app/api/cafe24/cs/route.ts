/**
 * 카페24 CS 문의 수집 API
 * GET  /api/cafe24/cs — 전 몰 게시판 문의글 수집 → cs_tickets에 저장
 * POST /api/cafe24/cs — 특정 스토어만 수집 (body: { store_id })
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getActiveStores, cafe24Fetch, type StoreInfo } from "@/lib/cafe24";

// 카페24 게시판 유형별 ticket_type 매핑
const BOARD_TYPE_MAP: Record<string, string> = {
  "4": "inquiry",     // 상품문의
  "5": "inquiry",     // 1:1 문의
  "6": "return",      // 반품/교환
};

interface Cafe24Article {
  no: number;
  subject: string;
  content: string;
  writer: string;
  member_id?: string;
  email?: string;
  phone?: string;
  created_date: string;
  reply_date?: string;
  replied?: string; // T/F
  product_no?: number;
  order_id?: string;
  attach_file_urls?: string[];
  nick_name?: string;
}

interface Cafe24Board {
  board_no: number;
  board_name: string;
  board_type: string;
}

async function syncStoreCS(store: StoreInfo) {
  const sb = getServiceClient();
  let totalSynced = 0;
  let totalSkipped = 0;

  // 1. 게시판 목록 조회
  const boardsRes = await cafe24Fetch(store, "/boards?limit=100");
  if (!boardsRes.ok) {
    return { store: store.name, error: `게시판 조회 실패: ${boardsRes.status}`, synced: 0 };
  }

  const boardsData = await boardsRes.json();
  const boards: Cafe24Board[] = boardsData.boards || [];

  // CS 관련 게시판만 필터 (상품문의, 1:1문의, 반품교환 등)
  // 카페24 board_type: 4=상품문의, 5=1:1문의, 6=게시판 등
  // 실제로는 모든 게시판에서 수집 (이름으로 필터)
  const csBoards = boards.filter(
    (b) =>
      b.board_name.includes("문의") ||
      b.board_name.includes("Q&A") ||
      b.board_name.includes("qna") ||
      b.board_name.includes("1:1") ||
      b.board_name.includes("반품") ||
      b.board_name.includes("교환") ||
      b.board_name.includes("클레임") ||
      b.board_name.includes("CS") ||
      ["4", "5"].includes(b.board_type)
  );

  // 2. 각 게시판에서 최근 글 수집
  for (const board of csBoards) {
    const articlesRes = await cafe24Fetch(
      store,
      `/boards/${board.board_no}/articles?limit=100&sort=created_date&order=desc`
    );
    if (!articlesRes.ok) continue;

    const articlesData = await articlesRes.json();
    const articles: Cafe24Article[] = articlesData.articles || [];

    for (const article of articles) {
      const ticketType = BOARD_TYPE_MAP[board.board_type] || "inquiry";
      const channelTicketId = String(article.no);

      // 이미 수집된 건 스킵 (upsert)
      const { error } = await sb.from("cs_tickets").upsert(
        {
          store_id: store.id,
          channel: "cafe24",
          channel_ticket_id: channelTicketId,
          channel_board_no: board.board_no,
          ticket_type: ticketType,
          category: board.board_name,
          customer_name: article.writer || article.nick_name,
          customer_email: article.email,
          customer_phone: article.phone,
          customer_id: article.member_id,
          order_id: article.order_id,
          product_name: article.product_no ? `상품번호: ${article.product_no}` : null,
          subject: article.subject,
          content: article.content,
          attachments: article.attach_file_urls || [],
          status: article.replied === "T" ? "replied" : "open",
          replied_at: article.reply_date || null,
          raw_data: article,
          created_at: article.created_date,
        },
        {
          onConflict: "channel,channel_ticket_id,store_id",
        }
      );

      if (error) {
        totalSkipped++;
      } else {
        totalSynced++;
      }
    }
  }

  return {
    store: store.name,
    boards: csBoards.map((b) => b.board_name),
    synced: totalSynced,
    skipped: totalSkipped,
  };
}

export async function GET() {
  try {
    const stores = await getActiveStores();
    const results = [];

    for (const store of stores) {
      const result = await syncStoreCS(store);
      results.push(result);
    }

    const totalSynced = results.reduce((s, r) => s + (r.synced || 0), 0);
    return NextResponse.json({ results, total_synced: totalSynced });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "수집 실패" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { store_id } = await req.json();
    const stores = await getActiveStores();
    const store = stores.find((s) => s.id === store_id);

    if (!store) {
      return NextResponse.json({ error: "스토어를 찾을 수 없습니다" }, { status: 404 });
    }

    const result = await syncStoreCS(store);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "수집 실패" },
      { status: 500 }
    );
  }
}
