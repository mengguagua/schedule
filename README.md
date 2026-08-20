# 医院护士排班系统

面向长白班护士组的轻量月度排班系统。前端、API、自动任务和 SQLite 数据库由一个 Node.js 服务提供，适合部署在单台 VPS。

完整业务规则见 [docs/requirements.md](./docs/requirements.md)，统一术语见 [CONTEXT.md](./CONTEXT.md)。

## 技术结构

- React + Vite
- Express 5
- Node.js 24 内置 SQLite
- 单文件数据库与本地轮换备份
- Excel `.xlsx` 导出

生产环境只运行一个 Node.js 进程，不需要 MySQL、Redis、Spring Boot 等额外服务。

## 本地运行

需要 Node.js 24 或更高版本。

```bash
./scripts/start-local.sh
```

脚本会在首次运行时安装依赖并创建本地配置。打开 `http://localhost:3000`，使用账号 `admin`、初始本地密码 `admin123456` 登录。按 `Ctrl+C` 停止服务，以后仍执行同一条命令启动。

`.env` 创建后不会被脚本覆盖；SQLite 数据保存在 `./data`，备份保存在 `./backups`。

常用环境变量：

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `ADMIN_PASSWORD` | 无 | 首次启动必填；只用于创建初始 `admin` |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3000` | 服务端口 |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `BACKUP_DIR` | `./backups` | 自动备份目录 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |

数据库创建完成后，修改 `ADMIN_PASSWORD` 不会覆盖超级用户现有密码。

## 构建与启动

```bash
npm run build
ADMIN_PASSWORD='请替换为初始密码' NODE_ENV=production npm start
```

## VPS 裸机部署

生产环境不使用 Docker，采用 Node.js + systemd + Nginx。应用以低权限系统账户运行，SQLite 数据与程序版本分开存放。完整步骤和目录规划见 [VPS 裸机部署计划](./docs/vps-deployment-plan.md)。

## 自动任务

- 每月 1 日 00:05（`Asia/Shanghai`）自动生成当月排班。
- 服务错过执行时间时，启动后自动补生成缺少的当月排班。
- 每 2 天凌晨 02:00 生成 SQLite 一致性备份。
- 自动删除 14 天以前的备份文件。

## 验证

```bash
npm test
npm run build
```

`tests/integration-live.mjs` 是针对已启动测试服务的完整 API 验收脚本：

```bash
TEST_BASE_URL=http://127.0.0.1:3000 node tests/integration-live.mjs
```

该脚本会创建测试护士组、账户和排班，请只对专用测试数据库运行。
