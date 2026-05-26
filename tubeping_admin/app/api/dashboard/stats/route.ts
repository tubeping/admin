import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PO_STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  sent: "발주서 이메일 발송",
  viewed: "발주서 열람",
  completed: "송장등록완료",
  cancelled: "취소",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  ordered: "발주완료",
  shipping: "배송중",
  delivered: "배송완료",
  cancelled: "취소",
};

const TASK_PRIORITY_LABEL: Record<string, string> = {
  high: "높음",
  normal: "중간",
  low: "낮음",
};

function thisMonthStartDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function readBlogPostCount(): number {
  const candidates = [
    path.resolve(process.cwd(), "..", "blog", "publish_log.json"),
    path.resolve(process.cwd(), "public", "publish_log.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        const log = JSON.parse(raw);
        return Array.isArray(log.posts) ? log.posts.length : 0;
      }
    } catch {
      // continue
    }
  }
  return 0;
}

export async function GET() {
  const sb = getServiceClient();
  const monthStart = thisMonthStartDate();

  const [productsRes, allPosRes, monthPosRes, settlementRes, recentPosRes, ordersForPosRes, tasksRes] = await Promise.all([
    sb.from("products").select("id", { count: "exact", head: true }),
    // 전체 발주서 상태별 카운트
    sb.from("purchase_orders").select("status"),
    // 이번 달 발주서 수
    sb.from("purchase_orders").select("id", { count: "exact", head: true }).gte("order_date", monthStart),
    sb.from("settlements").select("influencer_actual, status").neq("status", "paid"),
    // 최근 발주서 10건
    sb.from("purchase_orders")
      .select("id, po_number, order_date, status, sent_at, viewed_at, access_expires_at, source, supplier_id, suppliers:supplier_id(name, email)")
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10),
    // 최근 발주서 관련 주문 집계용
    sb.from("orders")
      .select("purchase_order_id, tracking_number")
      .not("purchase_order_id", "is", null),
    sb.from("team_tasks")
      .select("id, title, due_date, priority, status, member:team_members(name)")
      .in("status", ["doing", "wait"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5),
  ]);

  const productCount = productsRes.count ?? 0;
  const monthPoCount = monthPosRes.count ?? 0;

  // 발주서 상태별 집계
  const poStatusCounts = { sent: 0, viewed: 0, completed: 0 };
  for (const po of allPosRes.data || []) {
    if (po.status === "sent") poStatusCounts.sent++;
    else if (po.status === "viewed") poStatusCounts.viewed++;
    else if (po.status === "completed") poStatusCounts.completed++;
  }

  const unsettledAmount = (settlementRes.data || []).reduce(
    (sum, r: { influencer_actual?: number | null }) => sum + (r.influencer_actual || 0),
    0
  );

  const blogPostCount = readBlogPostCount();

  // 발주서별 주문/송장 집계
  const poOrderStats: Record<string, { total: number; tracked: number }> = {};
  for (const o of ordersForPosRes.data || []) {
    if (!o.purchase_order_id) continue;
    if (!poOrderStats[o.purchase_order_id]) poOrderStats[o.purchase_order_id] = { total: 0, tracked: 0 };
    poOrderStats[o.purchase_order_id].total++;
    if (o.tracking_number && String(o.tracking_number).trim()) poOrderStats[o.purchase_order_id].tracked++;
  }

  const recentPOs = (recentPosRes.data || []).map(
    (po: {
      id: string;
      po_number: string;
      order_date: string;
      status: string;
      sent_at: string | null;
      viewed_at: string | null;
      access_expires_at: string | null;
      source: string;
      suppliers: { name: string; email: string } | null;
    }) => {
      const stats = poOrderStats[po.id] || { total: 0, tracked: 0 };
      return {
        id: po.id,
        po_number: po.po_number,
        order_date: po.order_date,
        supplier_name: po.suppliers?.name || "-",
        order_count: stats.total,
        tracked_count: stats.tracked,
        status: po.status,
        status_label: PO_STATUS_LABEL[po.status] || po.status,
        sent_at: po.sent_at,
        viewed_at: po.viewed_at,
        source: po.source,
      };
    }
  );

  const activeTasks = (tasksRes.data || []).map(
    (t: {
      id: string;
      title: string;
      due_date: string | null;
      priority: string | null;
      member: { name: string | null } | { name: string | null }[] | null;
    }) => {
      const member = Array.isArray(t.member) ? t.member[0] : t.member;
      const due = t.due_date ? `${t.due_date.slice(5, 7)}/${t.due_date.slice(8, 10)}` : "-";
      return {
        title: t.title,
        assignee: member?.name || "-",
        due,
        priority: TASK_PRIORITY_LABEL[t.priority || "normal"] || "중간",
      };
    }
  );

  return NextResponse.json({
    stats: {
      productCount,
      monthPoCount,
      unsettledAmount,
      blogPostCount,
      poStatusCounts,
    },
    recentPOs,
    activeTasks,
  });
}
