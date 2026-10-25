"""路线规划与现场调整（确定性规则，LLM 只负责一句话解释）。

规划只读取 Django 已发布路线目录，不生成未经审的景点内容。
时间估算按路线自身的 total_minutes 折算：站点时长占 60%，步行占 40%。
"""
import json
import logging
import re

from . import llm
from .route_catalog import RouteCatalogError, get_catalog

logger = logging.getLogger(__name__)

# 规划参数
SHORT_ROUTE_CODE = 'axis-3'
MAIN_ROUTE_CODE = 'meihu-8'
SHORT_MINUTES = 25
LONG_MINUTES = 40
TIME_TOLERANCE_MINUTES = 4
MIN_STOPS = 2
STOP_WEIGHT = 0.6
WALK_WEIGHT = 0.4

# 现场避雨点（MVP 配置；后续可迁入 Django Route 内容字段）
SHELTERS = {
    'meihu-8': {'spot_id': 77, 'name': '眉湖小屋'},
    'axis-3': {'spot_id': 18, 'name': '图书馆'},
}

NATURE_TOKENS = {
    'nature', 'natural', 'civilization', '自然', '山水', '水', '湖', '文明',
}
AXIS_TOKENS = {
    'architecture', 'history', '建筑', '校史', '历史', '中轴', '入门',
}

EXPLAIN_SYSTEM_PROMPT = (
    '你是郑州大学校园路线规划助手。根据已确定的规划结果，'
    '用一句不超过 50 字、口语化的中文解释这样安排的原因。'
    '不得新增或修改景点、站数、分钟数；'
    '不要写任何数字或数量词（如“七站”“三十分钟”）；'
    '不要使用列表、编号或换行。'
)


class RouteNotFound(LookupError):
    """请求的路线不在已发布目录中。"""


class InvalidRouteOrder(ValueError):
    """当前站序不在路线中。"""


def _route_by_code(catalog, code):
    return next((route for route in catalog if route['code'] == code), None)


def _time_route_code(minutes):
    return SHORT_ROUTE_CODE if minutes < SHORT_MINUTES else MAIN_ROUTE_CODE


def _interest_route_code(interests):
    tokens = {
        str(item).strip().lower()
        for item in interests
        if str(item).strip()
    }
    wants_nature = bool(tokens & NATURE_TOKENS)
    wants_axis = bool(tokens & AXIS_TOKENS)
    if wants_nature and not wants_axis:
        return MAIN_ROUTE_CODE
    if wants_axis and not wants_nature:
        return SHORT_ROUTE_CODE
    return None


def _find_start(catalog, start_spot_id):
    if not start_spot_id:
        return None, 1
    for route in catalog:
        for stop in route['stops']:
            if stop['spot_id'] == start_spot_id:
                return route['code'], stop['order']
    return None, 1


def _select_stops(route, start_order, include_optional):
    selected = [
        stop for stop in route['stops']
        if stop['order'] >= start_order
        and (include_optional or not stop['optional'] or stop['order'] == start_order)
    ]
    if not selected:
        raise InvalidRouteOrder(f'站序 {start_order} 不在路线 {route["code"]} 中')
    return selected


def _walk_fraction(route, selected):
    if len(selected) <= 1 or len(route['stops']) <= 1:
        return 0.0
    return (len(selected) - 1) / (len(route['stops']) - 1)


def estimate_minutes(route, selected):
    """按路线总时长折算子路线时长；站点 60%、步行 40%。"""
    if not selected:
        return 0
    total_seconds = sum(stop['duration_seconds'] for stop in route['stops'])
    selected_seconds = sum(stop['duration_seconds'] for stop in selected)
    stop_fraction = selected_seconds / total_seconds if total_seconds else 0.0
    weighted = STOP_WEIGHT * stop_fraction + WALK_WEIGHT * _walk_fraction(
        route, selected,
    )
    return max(1, round(route['total_minutes'] * weighted))


def _trim_to_budget(route, selected, minutes):
    """超出用户时间较多时从队尾裁剪，至少保留 MIN_STOPS 站。"""
    selected = list(selected)
    while (
        len(selected) > MIN_STOPS
        and estimate_minutes(route, selected) > minutes + TIME_TOLERANCE_MINUTES
    ):
        selected.pop()
    return selected


def _excluded_stops(route, selected, start_order):
    selected_orders = {stop['order'] for stop in selected}
    excluded = []
    for stop in route['stops']:
        if stop['order'] in selected_orders:
            continue
        if stop['order'] < start_order:
            reason = '从当前景点开始'
        elif stop['optional']:
            reason = '时间不足，留到下次'
        else:
            reason = '时间不足'
        excluded.append({'order': stop['order'], 'reason': reason})
    return excluded


def _weather_note(route, context):
    if (context or {}).get('weather') != 'rain':
        return ''
    shelter = SHELTERS.get(route['code'])
    if shelter:
        return f' 今天有雨，{shelter["name"]}可以避雨。'
    return ' 今天有雨，记得带伞。'


def _template_explanation(route, selected, excluded, minutes, start_order,
                          context=None):
    total = estimate_minutes(route, selected)
    count = len(selected)
    total_stops = len(route['stops'])
    weather_note = _weather_note(route, context)

    if start_order > 1:
        remaining = max(0, count - 1)
        if remaining == 0:
            text = (
                f'你已经在这条线的第 {start_order} 站；'
                '可以听当前景点，或往回到前面的站。'
            )
        else:
            text = (
                f'你从第 {start_order} 站出发，沿这条线再走 {remaining} 站，'
                f'约 {total} 分钟；前面的景点留到下次。'
            )
        return text + weather_note
    if route['code'] == SHORT_ROUTE_CODE:
        first = _stop_label(selected[0])
        last = _stop_label(selected[-1])
        if count == 1:
            text = (
                f'{route["name"]}今天只走{first}一站，约 {total} 分钟；'
                '先看懂校园中轴。'
            )
        else:
            text = (
                f'{route["name"]}共 {count} 站，约 {total} 分钟；'
                f'从{first}走到{last}，先看懂校园中轴。'
            )
        return text + weather_note
    if not excluded:
        first = _stop_label(selected[0])
        last = _stop_label(selected[-1])
        return (
            f'{route["name"]}共 {count} 站，约 {total} 分钟；'
            f'今天时间够，从{first}一路走到{last}。'
        ) + weather_note
    optional_orders = {stop['order'] for stop in route['stops'] if stop['optional']}
    only_optional = all(item['order'] in optional_orders for item in excluded)
    if only_optional:
        deferred_orders = {item['order'] for item in excluded}
        deferred = '、'.join(
            _stop_label(stop) for stop in route['stops']
            if stop['order'] in deferred_orders
        )
        return (
            f'完整线有 {total_stops} 站；你今天 {minutes} 分钟，走前 {count} 站，'
            f'{deferred}留到下次。'
        ) + weather_note
    return (
        f'完整线有 {total_stops} 站；你今天 {minutes} 分钟，走前 {count} 站，'
        '后面的站留到下次。'
    ) + weather_note


def _explanation_payload(route, selected, excluded, minutes, start_order,
                         context):
    return {
        'route_name': route['name'],
        'user_minutes': minutes,
        'total_minutes': estimate_minutes(route, selected),
        'stop_count': len(selected),
        'start_order': start_order,
        'excluded': excluded,
        'weather': (context or {}).get('weather', ''),
    }


def _clean_explanation(text):
    cleaned = re.sub(r'\s+', ' ', text or '').strip()
    if not 8 <= len(cleaned) <= 120:
        return ''
    if not any(token in cleaned for token in ('分钟', '站', '走', '路线', '景点')):
        return ''
    # LLM 解释不写数字，避免与确定性规划的站数/分钟数冲突。
    if re.search(r'\d', cleaned):
        return ''
    # “每一站/第一站”不是数量描述；其余中文数量词回退模板。
    if re.search(r'(?<![每第])[一二三四五六七八九十百千]+(?:站|分钟)', cleaned):
        return ''
    return cleaned


def build_explanation(route, selected, excluded, minutes, start_order,
                      use_llm=True, context=None):
    template = _template_explanation(
        route, selected, excluded, minutes, start_order, context,
    )
    if not use_llm:
        return template

    try:
        raw = llm.generate(
            EXPLAIN_SYSTEM_PROMPT,
            json.dumps(
                _explanation_payload(
                    route, selected, excluded, minutes, start_order, context,
                ),
                ensure_ascii=False,
            ),
            timeout=2.5,
            max_tokens=160,
            attempts=1,
        )
    except Exception as exc:
        logger.info('路线解释 LLM 不可用，使用模板：%s', exc)
        return template

    text = _clean_explanation(raw)
    if not text:
        return template
    weather_note = _weather_note(route, context)
    if weather_note and weather_note not in text:
        text = (text + weather_note)[:160]
    return text


def plan_route(minutes, interests=None, start_spot_id=None, context=None,
               catalog=None, use_llm=True):
    """返回路线规划 dict；不修改传入的 catalog。"""
    catalog = catalog if catalog is not None else get_catalog()
    if not catalog:
        raise RouteCatalogError('没有可用的已发布路线')
    minutes = max(10, min(int(minutes), 180))
    interests = interests or []

    start_code, start_order = _find_start(catalog, start_spot_id)
    chosen_code = (
        start_code
        or _interest_route_code(interests)
        or _time_route_code(minutes)
    )
    route = _route_by_code(catalog, chosen_code)
    if route is None:
        route = _route_by_code(catalog, _time_route_code(minutes)) or catalog[0]
        start_code = None
        start_order = 1
    if start_code and route['code'] != start_code:
        start_order = 1

    # 默认从首站出发时按 40 分钟分段；从中间站出发时先带上可选站，
    # 再由 _trim_to_budget 按剩余时间裁掉，避免浪费可用时间。
    include_optional = minutes > LONG_MINUTES or start_order > 1
    selected = _select_stops(route, start_order, include_optional)
    selected = _trim_to_budget(route, selected, minutes)
    start_order = selected[0]['order']

    excluded = _excluded_stops(route, selected, start_order)
    explanation = build_explanation(
        route, selected, excluded, minutes, start_order,
        use_llm=use_llm, context=context,
    )

    return {
        'route_code': route['code'],
        'route_name': route['name'],
        'stops': [stop['order'] for stop in selected],
        'excluded': excluded,
        'total_minutes': estimate_minutes(route, selected),
        'walking_km': round(
            route['walking_km'] * _walk_fraction(route, selected), 2,
        ),
        'explanation': explanation,
        'fallback': False,
        'start_order': start_order,
    }


def _stop_label(stop):
    """取景点短名：去掉 note 里的编辑备注括号。"""
    label = re.split(r'[（(]', stop['note'] or '')[0].strip()
    return label or f'第 {stop["order"]} 站'


def _selected_by_orders(route, orders):
    order_set = set(orders)
    return [stop for stop in route['stops'] if stop['order'] in order_set]


def _base_orders(route, current_order, current_stops, include_future=False):
    """当前计划里已经选的站序；未提供或与当前站矛盾时退化。

    include_future=True 用于“想多待”：没有 App 传来 current_stops 时，
    保留默认计划（非可选站），而不是把计划截断到当前站。
    """
    valid = {stop['order'] for stop in route['stops']}
    if current_stops:
        cleaned = sorted({
            int(order) for order in current_stops if int(order) in valid
        })
        if cleaned and current_order in cleaned:
            return cleaned
    if include_future:
        required = [
            stop['order'] for stop in route['stops'] if not stop['optional']
        ]
        if required:
            return required
    return [
        stop['order'] for stop in route['stops']
        if stop['order'] <= current_order
    ]


def _extend_through(route, base_orders, target_order):
    """保留已选站，并补齐到 target 之间的连续站序。"""
    base = set(base_orders)
    if not base:
        return [target_order]
    upper = max(base)
    return [
        stop['order'] for stop in route['stops']
        if stop['order'] in base
        or (upper < stop['order'] <= target_order)
    ]


def _time_short(route, current_order, base_orders):
    selected = _selected_by_orders(
        route, [order for order in base_orders if order <= current_order],
    )
    return {
        'selected': selected,
        'end_reason': '时间不够，提前收尾',
        'message': (
            f'时间不够，走到第 {current_order} 站就收尾；'
            '后面的站留到下次。'
        ),
        'shelter': None,
        'deep_dive': None,
    }


def _rain(route, current_order, route_code, base_orders):
    indoor = next(
        (stop for stop in route['stops']
         if stop['indoor'] and stop['order'] >= current_order),
        None,
    )
    if indoor is not None:
        orders = _extend_through(route, base_orders, indoor['order'])
        selected = _selected_by_orders(
            route, [order for order in orders if order <= indoor['order']],
        )
        label = _stop_label(indoor)
        return {
            'selected': selected,
            'end_reason': f'下雨，改到{label}收尾',
            'message': f'下雨了，先到{label}避雨；这条线今天先到这里。',
            'shelter': None,
            'deep_dive': None,
        }

    selected = _selected_by_orders(
        route, [order for order in base_orders if order <= current_order],
    )
    shelter = SHELTERS.get(route_code)
    if shelter is None:
        return {
            'selected': selected,
            'end_reason': '下雨，提前收尾',
            'message': '下雨了，这条线今天先到这里。',
            'shelter': None,
            'deep_dive': None,
        }
    return {
        'selected': selected,
        'end_reason': f'下雨，改到{shelter["name"]}收尾',
        'message': (
            f'下雨了，就近去{shelter["name"]}避雨；'
            '这条线今天先到这里。'
        ),
        'shelter': shelter,
        'deep_dive': None,
    }


def _more(route, current_order, base_orders):
    base = set(base_orders)
    next_optional = next(
        (stop for stop in route['stops']
         if stop['optional'] and stop['order'] > current_order
         and stop['order'] not in base),
        None,
    )
    if next_optional is not None:
        orders = _extend_through(route, base_orders, next_optional['order'])
        selected = _selected_by_orders(route, orders)
        label = _stop_label(next_optional)
        return {
            'selected': selected,
            'end_reason': '已加回可选站',
            'message': (
                f'把{label}加回来，路线延长到第 {next_optional["order"]} 站。'
            ),
            'shelter': None,
            'deep_dive': None,
        }

    current = next(
        stop for stop in route['stops'] if stop['order'] == current_order
    )
    selected = _selected_by_orders(route, base_orders)
    deep_dive = None
    if current['category']:
        deep_dive = {
            'spot_id': current['spot_id'],
            'category': current['category'],
        }
        message = '这条线已经加满了；在当前景点可以再听一篇深度稿。'
    else:
        message = '这条线已经加满了；继续往前走，或者换一条线。'
    return {
        'selected': selected,
        'end_reason': '没有更多可选站',
        'message': message,
        'shelter': None,
        'deep_dive': deep_dive,
    }


def adapt_route(route_code, current_order, action, context=None, catalog=None,
                current_stops=None):
    """现场调整：time_short / rain / more。"""
    catalog = catalog if catalog is not None else get_catalog()
    if not catalog:
        raise RouteCatalogError('没有可用的已发布路线')
    route = _route_by_code(catalog, route_code)
    if route is None:
        raise RouteNotFound(f'路线 {route_code} 不在已发布目录中')

    orders = {stop['order'] for stop in route['stops']}
    if current_order not in orders:
        raise InvalidRouteOrder(
            f'站序 {current_order} 不在路线 {route_code} 中',
        )

    base_orders = _base_orders(
        route, current_order, current_stops,
        include_future=(action == 'more'),
    )
    if action == 'time_short':
        result = _time_short(route, current_order, base_orders)
    elif action == 'rain':
        result = _rain(route, current_order, route_code, base_orders)
    elif action == 'more':
        result = _more(route, current_order, base_orders)
    else:
        raise InvalidRouteOrder(f'未知调整动作：{action}')

    selected = result['selected']
    shelter = result['shelter'] or {}
    return {
        'route_code': route['code'],
        'stops': [stop['order'] for stop in selected],
        'total_minutes': estimate_minutes(route, selected),
        'end_reason': result['end_reason'],
        'message': result['message'],
        'fallback': False,
        'shelter_spot_id': shelter.get('spot_id'),
        'shelter_name': shelter.get('name'),
        'deep_dive': result['deep_dive'],
    }
