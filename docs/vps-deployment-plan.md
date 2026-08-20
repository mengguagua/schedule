# VPS 裸机部署计划

目标环境为 1 核 2G Linux VPS，不使用 Docker。应用由一个 Node.js 进程提供 API 和静态前端，SQLite 文件保存在服务器本地磁盘。

## 目录规划

- 程序版本：`/opt/nurse-schedule/releases/<版本号>`
- 当前版本：`/opt/nurse-schedule/current`
- SQLite 数据：`/var/lib/nurse-schedule/schedule.sqlite`
- 自动备份：`/var/backups/nurse-schedule/`
- 私密配置：`/etc/nurse-schedule.env`
- systemd 服务：`/etc/systemd/system/nurse-schedule.service`

程序使用独立的 `nurse-schedule` 系统账户运行，不使用 root 身份运行应用。

## 首次部署

1. 检查 VPS 的 Linux 发行版、CPU 架构、磁盘空间、开放端口及现有 Nginx/Node.js。
2. 安装 Node.js 24、Nginx，并创建低权限系统账户和数据目录。
3. 在本地执行测试和生产构建，只上传服务端文件、构建产物与生产依赖清单。
4. 在 VPS 上执行 `npm ci --omit=dev`，不安装 Vite 等开发依赖。
5. 写入 `/etc/nurse-schedule.env`，配置初始管理员密码、数据目录、备份目录及安全 Cookie。
6. 注册并启动 systemd 服务，设置开机启动、异常自动重启和资源限制。
7. 配置 Nginx 仅向 `127.0.0.1:3000` 转发；公网只开放 SSH、HTTP 和 HTTPS。
8. 如有域名，签发 HTTPS 证书并启用 `COOKIE_SECURE=true`。
9. 验证登录、建组、建账户、排班、导出、日志、服务重启和备份目录。

## 更新与回滚

每次更新先备份 SQLite，再上传到新的版本目录。验证通过后切换 `current` 软链接并重启服务；出现问题时将软链接切回上一个版本。数据目录不随程序版本切换或删除。

## 资源策略

- Node.js 进程设置合理的内存上限，避免异常占满 2G 内存。
- SQLite 使用 WAL 模式，适合本系统的小数据量和低并发写入。
- 前端由 Node.js 提供，Nginx 只负责 HTTPS、压缩和反向代理。
- 排班任务每月执行一次，备份任务每两天执行一次，常驻开销很低。
- systemd 日志限制容量，避免日志长期增长占满磁盘。

## 部署前需要的信息

- VPS IP、SSH 端口和 root 登录方式。
- Linux 发行版及版本（也可以登录后自动检查）。
- 准备使用的域名；若暂无域名，需要确认是否先以 HTTP/IP 临时访问。
- 允许访问系统的来源范围，以及 SSH 是否需要保留当前端口。
