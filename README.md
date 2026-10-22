# 郑大五十步

> 五十步一景，到达即播 —— 面向郑州大学学生与访客的校园语音导览应用。

打开 App 即是校园地图；当你走进某个景点的触发范围，讲解语音会自动响起。内容涵盖校内的**自然山水、建筑肌理、学院学科与人文历史**，以"五十步一景"的空间顺序讲述郑大、郑州与中原的故事。

## 功能特性

- **地图导览首页**：高德 3D 地图，自定义去 POI 底图，GPS 实时定位与精度提示
- **自动触发讲解**：进入景点触发范围（圆形 / 走廊 / 多边形三种几何）自动播放语音，离开即重置，支持多点就近排队播报
- **105 个景点**：16 个多边形区域、4 条走廊（商业街 / 道路 / 桥）、85 个点位，分类涵盖建筑、人文、自然、教学
- **景点列表与详情**：图文 + 语音讲解，分类浏览
- **后台播放**：锁屏控制、悬浮播放条
- **离线可用**：内置种子数据 + SQLite 缓存 + 媒体文件缓存，联网后全量同步
- **内容管理后台**：Django Admin 可视化编辑触发区域（含走廊半宽）、批量操作、edge-tts 语音合成

## 技术栈

| 端 | 技术 |
|---|---|
| 客户端 | Expo SDK 57 / React Native 0.86 · Expo Router · Zustand · TypeScript |
| 地图定位 | react-native-amap3d（高德 3D SDK）· react-native-amap-geolocation（GCJ-02） |
| 音频 | react-native-track-player（后台播放 + 锁屏控制） |
| 本地存储 | expo-sqlite · expo-file-system |
| 后端 | Django 4.2 · DRF · SimpleJWT · MySQL 8.0 |
| 语音合成 | edge-tts |
| 发布 | EAS Build · EAS Update 热更新 |

## 目录结构

```
├── app/                  # 客户端（Expo React Native）
│   ├── app/              # 路由页面：地图 / 列表 / 景点详情
│   ├── hooks/            # 导览触发引擎 useTour、定位
│   ├── constants/        # seedSpots.ts 离线种子数据（由 DB 生成，禁止手改）
│   ├── services/ stores/ # 同步、SQLite、播放状态
│   └── scripts/          # verify-trigger.js 触发引擎对拍测试
├── server/               # 后端（Django）
│   ├── apps/spots/       # 景点模型、只读 API、写 API（X-Editor-Key 鉴权）
│   ├── apps/accounts/    # 微信登录（JWT，真实对接留 TODO）
│   └── apps/config/      # 全局配置、分类、设备活跃统计
├── deploy/               # 生产部署：gunicorn.service、nginx 配置、环境变量模板
└── docs/                 # 文档（入口：docs/项目现状说明.md）
```

## 快速开始

**客户端：**

```bash
cd app
npm install
npx expo start
```

**后端：**

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # 填入数据库等配置
python manage.py migrate && python manage.py runserver
```

**生产部署**（阿里云 ECS + Gunicorn + Nginx + post-receive 自动部署）见 [`docs/部署说明.md`](docs/部署说明.md) 与 [`deploy/README.md`](deploy/README.md)。

## 文档索引

现行事实的唯一入口是 **[docs/项目现状说明.md](docs/项目现状说明.md)**，包含技术栈、数据现状（105 景点）、触发引擎语义、部署方式、开发时间线与全部文档索引。历史版本文档归档于 `docs/archive/`。

## 合规与安全说明

- 仓库内所有环境文件（`deploy/server.env.production`、各 `.env.example`）仅含占位符，**真实密钥只存在于服务器与本机，未进入版本库**
- 高德 Key 随 App 分发（编译进 APK），属客户端可公开值；签名密钥（jks）已 gitignore
- 用户数据遵循最小化采集：仅设备活跃统计（device_id 按日去重），无个人信息
- 代码基于 MIT 协议开源，第三方组件（高德 SDK、edge-tts、Expo 等）遵循其各自许可

## License

[MIT](LICENSE)
