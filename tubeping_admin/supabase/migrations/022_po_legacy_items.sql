-- 발주모아 등 레거시 발주서의 주문 상세 아이템
-- purchase_orders 테이블의 PO에 연결되는 주문 행

CREATE TABLE IF NOT EXISTS po_legacy_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

  -- 발주모아 원본 필드
  product_code TEXT,                    -- 상품코드 (SOSH...)
  order_item_no TEXT,                   -- 주문상품고유번호
  order_number TEXT,                    -- 주문번호 (WSH...)
  order_date TEXT,                      -- 주문일
  product_name TEXT,                    -- 판매사상품명
  option_name TEXT,                     -- 판매사옵션명
  quantity INTEGER NOT NULL DEFAULT 1,  -- 주문수량
  buyer_name TEXT,                      -- 주문자명
  buyer_phone TEXT,                     -- 주문자연락처
  receiver_name TEXT,                   -- 수령인명
  receiver_phone TEXT,                  -- 수령인연락처
  receiver_zipcode TEXT,                -- 우편번호
  receiver_address TEXT,                -- 주소
  delivery_memo TEXT,                   -- 배송시 요청사항
  shipping_company TEXT,                -- 택배사
  tracking_number TEXT,                 -- 배송번호

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- purchase_orders에 source 컬럼 추가 (tubeping / legacy 구분)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'tubeping';

CREATE INDEX IF NOT EXISTS idx_po_legacy_items_po_id ON po_legacy_items(purchase_order_id);
