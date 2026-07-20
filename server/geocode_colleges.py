"""高德 Web 服务 Key 批量 POI 搜索学院坐标 → geocode_results.json"""
import urllib.request, urllib.parse, json, time, io
KEY = 'ba769eb3d2b5454cd3ad33e1a8e8e151'

COLLEGES = [
    '郑州大学化学学院', '郑州大学化工学院', '郑州大学力学与安全工程学院',
    '郑州大学土木工程学院', '郑州大学机械与动力工程学院', '郑州大学材料科学与工程学院',
    '郑州大学电气与信息工程学院', '郑州大学水利与交通学院', '郑州大学建筑学院',
    '郑州大学数学与统计学院', '郑州大学物理学院', '郑州大学计算机与人工智能学院',
    '郑州大学地球科学与技术学院',
    '郑州大学文学院', '郑州大学历史学院', '郑州大学哲学学院', '郑州大学新闻与传播学院',
    '郑州大学教育学院', '郑州大学外国语与国际关系学院', '郑州大学马克思主义学院',
    '郑州大学医学院', '郑州大学基础医学院', '郑州大学护理与健康学院',
    '郑州大学口腔医学院', '郑州大学公共卫生学院', '郑州大学药学院',
    '郑州大学商学院', '郑州大学法学院', '郑州大学管理学院', '郑州大学政治与公共管理学院',
    '郑州大学信息管理学院', '郑州大学生命科学学院', '郑州大学生态与环境学院',
    '郑州大学书法学院', '郑州大学河南音乐学院', '郑州大学美术学院', '郑州大学体育学院',
    '郑州大学考古与文化遗产学院', '郑州大学网络空间安全学院',
]

LABS = [
    '郑州大学中原之光实验室', '郑州大学橡塑模具国家工程研究中心',
    '郑州大学抗病毒性传染病创新药物全国重点实验室',
    '郑州大学棉花生物育种与综合利用全国重点实验室',
    '郑州大学代谢紊乱与食管癌防治全国重点实验室',
    '郑州大学关键金属选冶与高纯制程全国重点实验室',
    '郑州大学材料物理教育部重点实验室', '郑州大学中华源考古实验室',
    '郑州大学智能集群系统教育部工程研究中心',
    '郑州大学互联网医疗与健康服务河南省协同创新中心',
]

results = {}
for name in COLLEGES + LABS:
    try:
        q = urllib.parse.quote(name.encode('utf-8'))
        url = f'https://restapi.amap.com/v3/place/text?keywords={q}&city=410100&key={KEY}'
        with urllib.request.urlopen(url, timeout=10) as resp:
            raw = resp.read()
        r = json.loads(raw.decode('utf-8'))
        if r['status'] == '1' and r.get('pois'):
            p = r['pois'][0]
            lng, lat = p['location'].split(',')
            results[name] = {'lat': float(lat), 'lng': float(lng), 'poi_name': p['name']}
        else:
            results[name] = None
    except Exception as e:
        results[name] = {'error': str(e)}
    time.sleep(0.15)

out = io.open('geocode_results.json', 'w', encoding='utf-8')
json.dump(results, out, ensure_ascii=False, indent=1)
out.close()

found = sum(1 for v in results.values() if v and 'lat' in v)
print(f'done: {found}/{len(results)} found')
for k, v in results.items():
    if v and 'lat' in v:
        print(f'  OK: {k} -> {v["lat"]}, {v["lng"]}')
    else:
        print(f'  --: {k}')
