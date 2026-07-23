from django.db import migrations, models


def seed_default_categories(apps, schema_editor):
    Category = apps.get_model('config', 'Category')
    defaults = [
        ('college', '🏫 学院', '#8B1A2B', 1),
        ('nature', '🌿 自然景观', '#2E7D32', 2),
        ('architecture', '🏛 特色建筑', '#6D4C41', 3),
        ('teaching', '📚 教学区', '#00838F', 4),
        ('service', '🍽 生活服务', '#7B1FA2', 5),
        ('humanity', '📖 人文景观', '#F9A825', 6),
    ]
    for key, label, color, order in defaults:
        Category.objects.get_or_create(key=key, defaults={'label': label, 'color': color, 'sort_order': order})


class Migration(migrations.Migration):
    dependencies = [('config', '0003_add_constraint')]
    operations = [
        migrations.CreateModel(
            name='Category',
            fields=[
                ('key', models.CharField(max_length=20, primary_key=True, serialize=False, verbose_name='分类标识')),
                ('label', models.CharField(max_length=20, verbose_name='显示名称')),
                ('color', models.CharField(default='#6D4C41', max_length=7, verbose_name='分类颜色')),
                ('sort_order', models.IntegerField(default=0, verbose_name='排序')),
            ],
            options={
                'verbose_name': '景点分类', 'verbose_name_plural': '景点分类',
                'db_table': 'categories', 'ordering': ['sort_order'],
            },
        ),
        migrations.RunPython(seed_default_categories, migrations.RunPython.noop),
    ]
