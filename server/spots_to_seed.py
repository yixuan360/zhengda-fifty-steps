"""从 Django DB 导出全部景点 → app/constants/seedSpots.ts"""
import os, sys, django, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.spots.models import Spot
from datetime import datetime

spots = list(Spot.objects.all().order_by('id').values())
for s in spots:
    for k in list(s.keys()):
        if isinstance(s[k], datetime):
            s[k] = int(s[k].timestamp() * 1000)
        if k in ('created_at', 'image', 'audio'):
            del s[k]

def ts_str(v):
    """转义为合法 TS 字符串字面量（带双引号）。

    用 json.dumps 而非手写 replace：
    - 生产 DB 文本可能含 CRLF（\\r\\n），裸 \\r 是 ECMAScript 行终止符，
      手写 esc 只转义 \\n 会把 \\r 原样写入导致 "Unterminated string constant"。
    - json.dumps 统一处理 \\n、\\r、\\r\\n、引号、反斜杠，输出与 TS 双引号字符串兼容。
    """
    return json.dumps(str(v), ensure_ascii=False)

lines = []
lines.append('/**')
lines.append(f' * 内置种子景点 — 离线兜底数据（V{len(spots)}，郑大主校区景点）')
lines.append(' *')
lines.append(' * 数据源：server 数据库，与 Admin 后台录入数据保持一致。')
lines.append(' * 用途：首次启动灌入 SQLite；同步成功后被服务器数据覆盖。')
lines.append(' * 坐标：全部 GCJ-02；trigger 为 v4.1 触发几何（缺省即圆）。')
lines.append(' *')
lines.append(' * 自动生成命令：cd server && python spots_to_seed.py')
lines.append(' */')
lines.append('')
lines.append("import type { Spot, Trigger } from '../types';")
lines.append('')
lines.append('const s = (')
lines.append('  id: number, name: string, lat: number, lng: number,')
lines.append('  triggerRadius: number, summary: string, description: string,')
lines.append('  category: string = "architecture", trigger?: Trigger,')
lines.append('): Spot => ({')
lines.append('  id, name, lat, lng, triggerRadius, summary, description,')
lines.append('  imageUrl: "", audioUrl: "", isActive: true, category, trigger, updatedAt: 0,')
lines.append('});')
lines.append('')
lines.append('export const SEED_SPOTS: Spot[] = [')

for sp in spots:
    cat = sp.get('category') or 'architecture'
    trig = sp.get('trigger')
    trig_arg = ''
    if trig:
        trig_json = json.dumps(trig, ensure_ascii=False)
        trig_arg = f',\n    {trig_json}'
    lines.append(f'  s({sp["id"]}, {ts_str(sp["name"])}, {sp["lat"]}, {sp["lng"]}, {sp["trigger_radius"]},')
    lines.append(f'    {ts_str(sp["summary"])},')
    lines.append(f'    {ts_str(sp["description"])},')
    lines.append(f'    {ts_str(cat)}{trig_arg}),')

lines.append('];')
lines.append('')

out_path = os.path.join(os.path.dirname(__file__), '..', 'app', 'constants', 'seedSpots.ts')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f'[OK] 生成 seedSpots.ts：{len(spots)} 个景点 → {out_path}')
