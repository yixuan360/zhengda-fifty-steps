"""
从 JSON 文件导出景点 → app/constants/seedSpots.ts
用法：python spots_to_seed_from_json.py [json文件路径]
默认读取 production_spots_full.json
"""
import os, sys, json

# 确定 JSON 文件路径
if len(sys.argv) > 1:
    json_path = sys.argv[1]
else:
    json_path = os.path.join(os.path.dirname(__file__), 'production_spots_full.json')

print(f'读取 JSON 文件: {json_path}')

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# 解析景点数据
spots_data = data.get('data', {}).get('spots', [])
if not spots_data:
    print('错误: JSON 文件中没有找到景点数据')
    sys.exit(1)

print(f'读取到 {len(spots_data)} 个景点')


def ts_str(v):
    """转义为合法 TS 字符串字面量（带双引号）。"""
    return json.dumps(str(v), ensure_ascii=False)


lines = []
lines.append('/**')
lines.append(f' * 内置种子景点 — 离线兜底数据（V{len(spots_data)}，郑大主校区景点）')
lines.append(' *')
lines.append(' * 数据源：生产服务器数据库，与 Admin 后台录入数据保持一致。')
lines.append(' * 用途：首次启动灌入 SQLite；同步成功后被服务器数据覆盖。')
lines.append(' * 坐标：全部 GCJ-02；trigger 为 v4.1 触发几何（缺省即圆）。')
lines.append(' *')
lines.append(' * 自动生成命令：cd server && python spots_to_seed_from_json.py')
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

for sp in spots_data:
    cat = sp.get('category') or 'architecture'
    trig = sp.get('trigger')
    trig_arg = ''
    if trig:
        trig_json = json.dumps(trig, ensure_ascii=False)
        trig_arg = f',\n    {trig_json}'
    lines.append(f'  s({sp["id"]}, {ts_str(sp["name"])}, {sp["lat"]}, {sp["lng"]}, {sp["triggerRadius"]},')
    lines.append(f'    {ts_str(sp.get("summary", ""))},')
    lines.append(f'    {ts_str(sp.get("description", ""))},')
    lines.append(f'    {ts_str(cat)}{trig_arg}),')

lines.append('];')
lines.append('')

out_path = os.path.join(os.path.dirname(__file__), '..', 'app', 'constants', 'seedSpots.ts')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f'[OK] 生成 seedSpots.ts：{len(spots_data)} 个景点 → {out_path}')
