#!/bin/bash
# 공급사 품절/재입고/판매종료 메일 자동 수집 (TubePing)
cd /home/dev/shinsananalytics-hub/tuping-admin/tubeping_admin
exec /usr/bin/python3 scripts/collect_stock_alerts.py --days 7 >> /home/dev/shinsananalytics-hub/tuping-admin/tubeping_admin/scripts/stock_alerts.log 2>&1
