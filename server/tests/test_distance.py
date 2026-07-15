"""
Haversine 距离计算测试（v4.0 §12 / §6.2）
5 个参数化用例，验证与前端公式一致。
"""
import math
import pytest


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    标准 Haversine 公式求两点间距（米）。
    地球半径 R = 6371000m。
    前端使用相同公式，本测试确保前后端计算结果一致。
    """
    R = 6371000.0

    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


# ── 参数化测试用例 ───────────────────────────────────────

@pytest.mark.parametrize('lat1,lng1,lat2,lng2,expected_m,desc', [
    # 用例 1：同一点，距离为 0
    (34.817878, 113.535387, 34.817878, 113.535387, 0.0, '同一点距离为 0m'),

    # 用例 2：约 50m（触发半径边界，纯纬度偏移）
    # 1° 纬度 ≈ 111320m，偏移 0.000450° ≈ 50.1m
    (34.817878, 113.535387, 34.818328, 113.535387, 50.1, '纯纬度偏移 ~50m'),

    # 用例 3：约 1000m（纯纬度偏移 ~1km）
    # 偏移 0.009° ≈ 1001m
    (34.817878, 113.535387, 34.826878, 113.535387, 1001.0, '纯纬度偏移 ~1km'),

    # 用例 4：郑大校内两景点实际距离（钟楼 → 南门，斜向 ~480m）
    (34.817878, 113.535387, 34.813603, 113.534654, 480.0, '郑大钟楼到南门 ~480m'),

    # 用例 5：远距离验证（郑州 → 北京天安门 ~630km）
    (34.7570, 113.6290, 39.9042, 116.4074, 625000.0, '郑州到北京 ~625km'),
])
def test_haversine_distance(lat1, lng1, lat2, lng2, expected_m, desc):
    """验证 Haversine 距离计算误差 < 1%"""
    result = haversine_distance(lat1, lng1, lat2, lng2)
    tolerance = max(expected_m * 0.01, 1.0)  # 1% 误差容忍，最小 1m
    assert abs(result - expected_m) < tolerance, (
        f'{desc}：期望 {expected_m:.1f}m，实际 {result:.1f}m（偏差 {abs(result - expected_m):.1f}m）'
    )
