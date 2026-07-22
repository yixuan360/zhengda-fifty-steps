"""从 spots_full.json 导入全部 74 个景点到 MySQL"""
import os, sys, json, django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.spots.models import Spot

with open('spots_full.json', 'r') as f:
    spots = json.load(f)

Spot.objects.all().delete()
count = 0
for s in spots:
    Spot.objects.create(
        id=s['id'], name=s['name'], lat=s['lat'], lng=s['lng'],
        trigger_radius=s.get('trigger_radius', 50),
        summary=s.get('summary', ''), description=s.get('description', ''),
        category=s.get('category', 'general'), is_active=s.get('is_active', True),
    )
    count += 1
print(f'导入完成：{count} 个景点')
