from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('config', '0001_initial')]
    operations = [
        migrations.CreateModel(
            name='DevicePing',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('device_id', models.CharField(max_length=64, verbose_name='设备标识')),
                ('app_version', models.CharField(default='1.0.0', max_length=20, verbose_name='App 版本')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='记录时间')),
            ],
            options={
                'verbose_name': '设备访问记录', 'verbose_name_plural': '设备访问记录',
                'db_table': 'device_pings',
            },
        ),
        migrations.AddIndex(
            model_name='deviceping', index=models.Index(fields=['device_id'], name='dp_dev_idx'),
        ),
        migrations.AddIndex(
            model_name='deviceping', index=models.Index(fields=['created_at'], name='dp_ts_idx'),
        ),
    ]
