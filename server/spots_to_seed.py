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

def esc(v):
    return v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

lines = []
lines.append('/**')
lines.append(' * 内置种子景点 — 离线兜底数据（V5.3，42 个郑大主校区景点）')
lines.append(' *')
lines.append(' * 数据源：server 数据库，与 Admin 后台录入数据保持一致。')
lines.append(' * 用途：首次启动灌入 SQLite；同步成功后被服务器数据覆盖。')
lines.append(' * 坐标：全部 GCJ-02。')
lines.append(' *')
lines.append(' * 自动生成命令：cd server && python spots_to_seed.py')
lines.append(' */')
lines.append('')
lines.append("import type { Spot } from '../types';")
lines.append('')
lines.append('const s = (')
lines.append('  id: number, name: string, lat: number, lng: number,')
lines.append('  triggerRadius: number, summary: string, description: string,')
lines.append('  category: string = "architecture",')
lines.append('): Spot => ({')
lines.append('  id, name, lat, lng, triggerRadius, summary, description,')
lines.append('  imageUrl: "", audioUrl: "", isActive: true, category, updatedAt: 0,')
lines.append('});')
lines.append('')
lines.append('export const SEED_SPOTS: Spot[] = [')

for sp in spots:
    cat = sp.get('category') or 'architecture'
    lines.append(f'  s({sp["id"]}, "{esc(sp["name"])}", {sp["lat"]}, {sp["lng"]}, {sp["trigger_radius"]},')
    lines.append(f'    "{esc(sp["summary"])}",')
    lines.append(f'    "{esc(sp["description"])}",')
    lines.append(f'    "{esc(cat)}"),')

lines.append('];')
lines.append('')

out_path = os.path.join(os.path.dirname(__file__), '..', 'app', 'constants', 'seedSpots.ts')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f'✅ 生成 seedSpots.ts：{len(spots)} 个景点 → {out_path}')
