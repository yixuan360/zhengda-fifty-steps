"""
文脉叙事引擎 T1 — 数据模型 + 人审 Admin 测试
覆盖：卡片创建默认值 / 状态流转 / 批量采纳与驳回 / ReviewTask 落库 / 索引生效。
"""
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client, RequestFactory, TestCase

from apps.narrative.admin import KnowledgeItemAdmin
from apps.narrative.models import KnowledgeItem, ReviewTask
from apps.spots.models import Spot

User = get_user_model()

KNOWLEDGE_URL = '/manage/narrative/knowledgeitem/'


class NarrativeModelTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='钟楼', lat=34.8166, lng=113.5345,
            description='郑州大学主校区钟楼，标志性建筑。',
        )

    def _make_item(self, **overrides):
        data = {
            'spot': self.spot,
            'dimension': 'architecture',
            'depth': 1,
            'fact_text': '钟楼是郑州大学主校区的标志性建筑。',
            'source_refs': [{'title': '郑州大学官网', 'url': 'https://www.zzu.edu.cn/'}],
        }
        data.update(overrides)
        return KnowledgeItem.objects.create(**data)

    # ── 创建 ──────────────────────────────────────────────

    def test_item_defaults_pending_and_single_source(self):
        """新建卡片默认 pending / single / version=1 / created_by=ai。"""
        item = self._make_item()
        self.assertEqual(item.status, 'pending')
        self.assertEqual(item.confidence, 'single')
        self.assertEqual(item.version, 1)
        self.assertEqual(item.created_by, 'ai')
        self.assertEqual(item.source_refs[0]['title'], '郑州大学官网')

    def test_source_refs_defaults_to_empty_list(self):
        """source_refs 未提供时为空列表而非 None。"""
        item = self._make_item(source_refs=[])
        self.assertEqual(item.source_refs, [])

    # ── 索引 ──────────────────────────────────────────────

    def test_composite_index_declared(self):
        """模型声明 (spot, dimension, depth, status) 复合索引。"""
        indexes = KnowledgeItem._meta.indexes
        self.assertEqual(len(indexes), 1)
        self.assertEqual(
            indexes[0].fields, ['spot', 'dimension', 'depth', 'status'],
        )

    def test_composite_index_exists_in_database(self):
        """迁移后数据库中确实存在该复合索引。"""
        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(
                cursor, KnowledgeItem._meta.db_table,
            )
        indexed_columns = [
            tuple(info['columns']) for info in constraints.values()
            if info.get('index')
        ]
        self.assertIn(
            ('spot_id', 'dimension', 'depth', 'status'), indexed_columns,
        )


class KnowledgeItemAdminTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.spot = Spot.objects.create(
            name='眉湖', lat=34.8150, lng=113.5330,
            description='郑州大学主校区眉湖。',
        )
        cls.admin_user = User.objects.create_superuser(
            username='narrative_admin',
            email='narrative@zhengda.com',
            password='narrative_pass_123',
        )
        cls.admin_client = Client()
        cls.admin_client.login(
            username='narrative_admin', password='narrative_pass_123',
        )

    def _make_item(self, fact_text='眉湖是主校区的人工湖。', **overrides):
        data = {
            'spot': self.spot,
            'dimension': 'nature',
            'depth': 2,
            'fact_text': fact_text,
        }
        data.update(overrides)
        return KnowledgeItem.objects.create(**data)

    def _run_action(self, action, items):
        return self.admin_client.post(KNOWLEDGE_URL, {
            'action': action,
            '_selected_action': [str(item.id) for item in items],
            'index': '0',
        })

    # ── 列表页与过滤 ──────────────────────────────────────

    def test_admin_list_page_reachable_with_filters(self):
        """列表页可访问，且 status/dimension/depth/spot 过滤可用。"""
        for query in ('?status=pending', '?dimension=nature', '?depth=2',
                      f'?spot__id__exact={self.spot.id}'):
            response = self.admin_client.get(KNOWLEDGE_URL + query)
            self.assertEqual(response.status_code, 200, msg=query)

    # ── 禁止物理删除 ──────────────────────────────────────

    def test_admin_delete_is_forbidden(self):
        """删除权限关闭：下架只能改状态，不能物理删除卡片。"""
        item = self._make_item()
        request = RequestFactory().get(KNOWLEDGE_URL)
        request.user = self.admin_user
        admin_instance = KnowledgeItemAdmin(KnowledgeItem, admin.site)
        self.assertFalse(admin_instance.has_delete_permission(request, item))

        self.admin_client.post(KNOWLEDGE_URL, {
            'action': 'delete_selected',
            '_selected_action': [str(item.id)],
            'index': '0',
            'post': 'yes',
        })
        self.assertTrue(KnowledgeItem.objects.filter(id=item.id).exists())

    # ── 批量采纳 ──────────────────────────────────────────

    def test_approve_selected_moves_pending_to_approved(self):
        """批量采纳：pending → approved，并写一条 approve 的 ReviewTask。"""
        items = [
            self._make_item(fact_text='卡片甲'),
            self._make_item(fact_text='卡片乙'),
        ]
        response = self._run_action('approve_selected', items)
        self.assertEqual(response.status_code, 302)

        for item in items:
            item.refresh_from_db()
            self.assertEqual(item.status, 'approved')
            task = item.review_tasks.get()
            self.assertEqual(task.decision, 'approve')
            self.assertIsNotNone(task.created_at)

    # ── 批量驳回 ──────────────────────────────────────────

    def test_reject_selected_moves_pending_to_rejected(self):
        """批量驳回：pending → rejected，并写一条 reject 的 ReviewTask。"""
        item = self._make_item()
        response = self._run_action('reject_selected', [item])
        self.assertEqual(response.status_code, 302)

        item.refresh_from_db()
        self.assertEqual(item.status, 'rejected')
        self.assertEqual(item.review_tasks.get().decision, 'reject')

    # ── 只处理 pending ────────────────────────────────────

    def test_action_skips_non_pending_items(self):
        """已发布的卡片再次被勾选时不改变状态、不重复写 ReviewTask。"""
        approved = self._make_item(fact_text='已发布卡片', status='approved')
        pending = self._make_item(fact_text='待审卡片')

        self._run_action('approve_selected', [approved, pending])

        approved.refresh_from_db()
        pending.refresh_from_db()
        self.assertEqual(approved.status, 'approved')
        self.assertEqual(pending.status, 'approved')
        self.assertEqual(ReviewTask.objects.filter(item=approved).count(), 0)
        self.assertEqual(ReviewTask.objects.filter(item=pending).count(), 1)

    def test_review_task_cascade_delete(self):
        """删除卡片时 ReviewTask 级联删除。"""
        item = self._make_item()
        ReviewTask.objects.create(item=item, decision='approve')
        item.delete()
        self.assertEqual(ReviewTask.objects.count(), 0)
