from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('config', '0002_device_pings')]
    operations = [
        migrations.AddConstraint(
            model_name='deviceping',
            constraint=models.UniqueConstraint(
                fields=['device_id', 'created_at'],
                name='dp_dev_date_uq',
            ),
        ),
    ]
