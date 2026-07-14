"""
郑大五十步 — 根 URL 路由
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # Admin 后台（路径非默认值，安全加固）
    path(f'{settings.ADMIN_URL}', admin.site.urls),

    # API v1
    path('api/v1/spots/', include('apps.spots.urls')),
    path('api/v1/config/', include('apps.config.urls')),
    path('api/v1/auth/', include('apps.accounts.urls')),
]

# 开发环境：Django 直接 serve media 文件
# 生产环境由 Nginx 代理，此配置在 DEBUG=False 时不生效
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
