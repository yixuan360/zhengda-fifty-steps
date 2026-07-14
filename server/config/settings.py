"""
Django settings for 郑大五十步 project.

V1 极简配置：单文件，不做多环境拆分。
"""
import os
from pathlib import Path
from decouple import config as env_config

# ── 路径 ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

# ── 安全 ──────────────────────────────────────────────
SECRET_KEY = env_config('SECRET_KEY', default='dev-secret-key-change-in-production')
DEBUG = env_config('DEBUG', default=True, cast=bool)

ALLOWED_HOSTS = env_config(
    'ALLOWED_HOSTS',
    default='localhost,127.0.0.1,10.0.2.2',
    cast=lambda v: [s.strip() for s in v.split(',')],
)

# ── 应用注册 ──────────────────────────────────────────
INSTALLED_APPS = [
    # Django 内置
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # 第三方
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    # 项目应用（V1 三个 app，无 Service 层）
    'apps.spots',
    'apps.accounts',
    'apps.config',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',         # CORS 必须放最前面
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# ── 数据库（MySQL 8.0，utf8mb4）──────────────────────
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': env_config('DB_NAME', default='zhengda'),
        'USER': env_config('DB_USER', default='root'),
        'PASSWORD': env_config('DB_PASSWORD', default=''),
        'HOST': env_config('DB_HOST', default='localhost'),
        'PORT': env_config('DB_PORT', default='3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
        },
    }
}

# ── 用户模型 ─────────────────────────────────────────
AUTH_USER_MODEL = 'accounts.User'

# ── 密码验证 ─────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = []

# ── 国际化 ───────────────────────────────────────────
LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = 'Asia/Shanghai'
USE_I18N = True
USE_TZ = True

# ── 静态资源 ─────────────────────────────────────────
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# ── 媒体文件（Django Admin 上传的图片/音频）───────────
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── 默认主键 ─────────────────────────────────────────
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── CORS（开发阶段宽松，生产收紧）────────────────────
CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = env_config(
    'CORS_ALLOWED_ORIGINS',
    default='',
    cast=lambda v: [s.strip() for s in v.split(',') if s.strip()],
)

# ── DRF 配置 ─────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.AllowAny',         # V1 默认开放，需要鉴权的 View 单独设置
    ),
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
    ),
    'EXCEPTION_HANDLER': 'config.exceptions.custom_exception_handler',
}

# ── SimpleJWT 配置 ───────────────────────────────────
from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=7),        # 7 天，对齐 v4.0 §9.2
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),      # 30 天
    'ROTATE_REFRESH_TOKENS': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# ── 文件上传 ─────────────────────────────────────────
FILE_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024         # 50MB（音频文件可能较大）
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# ── Admin 安全 ───────────────────────────────────────
# 修改 Admin 路径（v4.0 §4.3），非默认值
ADMIN_URL = env_config('ADMIN_URL', default='manage/')
