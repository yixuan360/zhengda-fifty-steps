"""
trigger 结构校验 — views（写 API）与 admin（地图编辑器表单）共用，
避免两份规则漂移。规则与 App 端 parseTrigger 保持一致。
"""
import math

# 非圆形 trigger 的最小顶点数（与 App 端 parseTrigger 保持一致）
MIN_POINTS = {'corridor': 2, 'polygon': 3}


def validate_trigger(t):
    """服务端 trigger 结构校验，与 App 端 parseTrigger 同规则。
    返回 True 表示结构合法（None=圆形，合法）。
    corridor 至少 2 点、polygon 至少 3 点；坐标拒绝非有限数（NaN/Infinity）。"""
    if t is None:
        return True
    if not isinstance(t, dict):
        return False
    typ = t.get('type')
    if typ not in ('circle', 'corridor', 'polygon'):
        return False
    if typ != 'circle':
        points = t.get('points')
        min_points = MIN_POINTS[typ]
        if not isinstance(points, list) or len(points) < min_points:
            return False
        for p in points:
            if (
                not isinstance(p, dict)
                or not isinstance(p.get('lat'), (int, float))
                or not isinstance(p.get('lng'), (int, float))
                or not (math.isfinite(p['lat']) and math.isfinite(p['lng']))
            ):
                return False
    if 'halfWidth' in t and (
        not isinstance(t['halfWidth'], (int, float))
        or not math.isfinite(t['halfWidth'])
        or t['halfWidth'] <= 0
    ):
        return False
    return True
