import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
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

function thisMonthStartKstISO(): string {
  // KST(UTC+9) 기준 이번 달 1일 00:00을 UTC로 변환
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, -9, 0, 0));
  return start.toISOString();
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
  const monthStart = thisMonthStartKstISO();

  const [productsRes, posRes, settlementRes, ordersRes, tasksRes] = await Promise.all([
    sb.from("products").select("id", { count: "exact", head: true }),
    sb
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .gte("order_date", monthStart.slice(0, 10)),
    sb
      .from("settlements")
      .select("influencer_actual, status")
      .neq("status", "paid"),
    sb
      .from("orders")
      .select(
        "id, cafe24_order_id, product_name, quantity, shipping_status, order_date, store:stores(name)"
      )
      .order("order_date", { ascending: false })
      .limit(5),
    sb
      .from("team_tasks")
      .select("id, title, due_date, priority, status, member:team_members(name)")
      .in("status", ["doing", "wait"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5),
  ]);

  const productCount = productsRes.count ?? 0;
  const monthPoCount = posRes.count ?? 0;

  const unsettledAmount = (settlementRes.data || []).reduce(
    (sum, r: { influencer_actual?: number | null }) => sum + (r.influencer_actual || 0),
    0
  );

  const blogPostCount = readBlogPostCount();

  const recentOrders = (ordersRes.data || []).map(
    (o: {
      id: string;
      cafe24_order_id: string | null;
      product_name: string;
      quantity: number;
      shipping_status: string;
      order_date: string;
      store: { name: string | null } | { name: string | null }[] | null;
    }) => {
      const store = Array.isArray(o.store) ? o.store[0] : o.store;
      return {
        id: o.cafe24_order_id || o.id.slice(0, 8),
        product: o.product_name,
        channel: store?.name || "-",
        qty: o.quantity,
        status: STATUS_LABEL[o.shipping_status] || o.shipping_status,
        date: o.order_date ? o.order_date.slice(0, 10) : "",
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
    },
    recentOrders,
    activeTasks,
  });
}
