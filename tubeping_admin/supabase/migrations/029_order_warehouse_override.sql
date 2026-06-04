-- 029_order_warehouse_override.sql
-- 주문 단위 출고지(fulfillment) override.
-- 기존: 출고지는 상품 마스터(products.fulfillment_warehouse_supplier_id)에서만 결정됨.
--       → 같은 상품이라도 특정 주문만 다른 곳에서 출고하거나, 상품기본 출고창고를
--         무시하고 공급사 직배송으로 보내고 싶을 때 방법이 없었음.
-- 변경: orders에 override 컬럼 추가. NULL이면 상품 마스터 기본값을 그대로 사용하고,
--       값이 있으면 그 supplier를 출고지로 사용(주문수집/조회·발주 라우팅 모두 우선).
--       공급사(=supplier_id)와 동일하게 지정하면 "공급사 직배송" 의미가 됨.

alter table orders
  add column if not exists fulfillment_warehouse_supplier_id uuid references suppliers(id);

comment on column orders.fulfillment_warehouse_supplier_id is
  '주문 단위 출고지 override. NULL=상품 마스터(products.fulfillment_warehouse_supplier_id) 기본값 사용. 값 지정 시 해당 공급사를 출고지로 사용(발주 라우팅 포함).';
