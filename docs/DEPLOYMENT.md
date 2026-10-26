# 部署、维护与回退

此改动只交付本地代码，不创建云资源、不上传密钥、不自动发布。前端保持 GitHub Pages，后端独立部署。

## 上线前准备

1. 现有 GitHub 仓库及 Pages 管理权限；继续使用同一 Pages 站点与 `/weather-layer/` 路径。
2. 一个 Cloudflare 账号、Workers 和 D1 权限，以及满足预计调用量的额度。每分钟 Cron 不是精确秒级定时，浏览器到达时间也无保证。当前每次最多推进 50 个计划、发送 20 个到期任务，适合小规模第一版；超出容量前扩展队列和并发，不承诺无限设备。
3. Node 24 与 pnpm。`pnpm install --frozen-lockfile` 安装后端／测试依赖。前端访客不需要 Node。
4. 一对长期保留的 VAPID 密钥、有效的联系邮箱或 HTTPS 联系页。不需要 Firebase 管理密钥或 Apple 开发者账号。
5. 支持推送的真实设备。iOS / iPadOS 16.4+ 从主屏幕运行；Android Chrome、桌面 Chrome / Edge / Firefox / Safari 各自独立验收，系统通知权限必须允许。

## 配置和部署（由维护者明确执行）

下面的 `--remote` 和 `deploy` 是真正的云端写入操作，本次没有执行。

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create weather-layer-reminders
```

把返回的 database ID 写入 `backend/wrangler.toml`，并核对：

| 配置 | 用途 |
| --- | --- |
| `DB` | D1 binding，迁移目录为 `backend/migrations` |
| `ALLOWED_ORIGIN` | 仅允许精确前端 origin，例如 `https://kierraclifford805-dev.github.io`，无路径，无尾斜杠 |
| `FRONTEND_URL` | 完整目录 URL，例如 `https://kierraclifford805-dev.github.io/weather-layer/`，必须以 `/` 结束 |
| `PAUSE_DELIVERY` | `true` 暂停 Cron 发送与测试，仍允许关闭、查询和删除 |
| `crons` | `* * * * *`，UTC 每分钟唤醒；任务自身用城市 IANA 时区计算 |

配置日期锁定 `2026-07-30`，使用 Web Crypto 与 Fetch，无需 Node API 兼容旗标。测试工具使用匹配的稳定版，升级后必须重跑运行时测试。

```sh
pnpm exec wrangler d1 migrations apply weather-layer-reminders --remote --config backend/wrangler.toml
pnpm run keys
# 输出包含私钥，只在本机查看，勿复制到聊天、截图、仓库或日志。
pnpm exec wrangler secret put VAPID_PUBLIC_KEY --config backend/wrangler.toml
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config backend/wrangler.toml
pnpm exec wrangler secret put VAPID_SUBJECT --config backend/wrangler.toml
# SUBJECT 示例：mailto:你的联系邮箱
pnpm run check:backend
pnpm exec wrangler deploy --config backend/wrangler.toml
```

`VAPID_PUBLIC_KEY` 会经 `/v1/config` 公开给浏览器，这是协议所需；私钥只在 Workers Secrets。`backend/.dev.vars.example` 仅为模板，本地 `.dev.vars` 已被忽略。勿把 Cloudflare API token 放前端或仓库。

部署后将 `reminder-config.js` 的 `API_BASE` 改为该 Worker 的 HTTPS origin，例如 `https://weather-layer-reminders.你的子域.workers.dev`。前端不含私钥。

提交前端所需的 `index.html`、`app.js`、`reminders.js`、`reminders.css`、`reminder-config.js`、`shared/`、`sw.js`、manifest 和 icons 后，按原有 main 根目录 Pages 流程发布。仅上传 `index.html` 已不够。不要上传 `.dev.vars`、`.wrangler`、`node_modules` 或本地数据库。

验证 `/v1/config` 从精确 origin 返回 `ready:true`，再在网页上主动开启、发送测试，完成 [真实设备验收](ACCEPTANCE.md)。`ready:true` 只是必要配置存在；密钥是否匹配、供应商和设备是否可达须由推送测试确认。

## 本机开发

```sh
cp backend/.dev.vars.example backend/.dev.vars
# 填入仅本机测试用的密钥，不要提交。
cp backend/wrangler.toml backend/wrangler.local.toml
# 把 local 配置中的 origin / FRONTEND_URL 改为 localhost:8765 及 /weather-layer/
pnpm exec wrangler d1 migrations apply weather-layer-reminders --local --config backend/wrangler.local.toml
pnpm exec wrangler dev --test-scheduled --config backend/wrangler.local.toml
```

前端 API 地址临时指向本地 Wrangler 地址。手工请求本地 `/__scheduled?cron=*+*+*+*+*` 可触发 Cron（此端点仅由 Wrangler 本地开发提供，生产 Worker 无人工 Cron 入口）。提交前恢复 `reminder-config.js`；运行时自动化测试无需任何真实密钥或网络推送目标。

## 任务语义

- 所有 UTC 时间用毫秒。计划保留当地 `local_time`、IANA `timezone`、`next_run_at`、固定 `next_target_date`；任务保存不可变目标日期和设置快照。
- `shared/dates.js` 进行日历运算；不用 UTC 加 24 小时代替当地下一天。DST 重复时刻选第一次，跳时顺延实际偏移量；跳过整个当地日期时不把前夜任务挪到目标日。
- 保存时同时写入新计划和第一条任务，旧未终结任务取消。D1 `batch` 事务、唯一约束和原子 `UPDATE … RETURNING` 领取防止并发重复执行。
- 每分钟推进下一条计划，已经错过有效期的任务标为过期；不会在第二天把旧目标重新解释为新“明天”。
- 领取租约 90 秒；发送前再次检查租约、版本、开启状态、订阅和有效期。只有尚未进入网络发送的任务能安全回收租约。
- 发送使用通过最终检查的订阅快照。404 / 410 的停用事务再次匹配该订阅、计划版本和仍有效的发送租约，旧请求的迟到响应不会停用新订阅或新计划。
- 最多 3 次尝试；天气全部失败、推送明确 429 / 5xx 可重试，指数退避并尊重 Retry-After。401 / 403 等永久失败不循环重发。404 / 410 停用失效订阅。
- 推送请求超时或发送阶段进程中断可能已被服务接受，记录 `unknown`，不盲目补发。不能对外部 Web Push 服务承诺绝对 exactly-once。
- 通常有效期为计划时间后 2 小时，且不超过目标日零点；测试 5 分钟且不跨目标日。请求 TTL 取剩余秒数，设备再检查绝对过期时间。
- 每条任务使用稳定 Topic 与通知 tag，Service Worker 在 IndexedDB 中去重、过滤旧版本。发送和设备展示之间没有跨系统事务；极端崩溃可造成漏通知，不能声称保证送达。
- 修改／取消后尚未跨越发送门槛的旧任务不会发送。正在进行的外部请求或供应商已经接受的消息无法撤回，设备端进一步过滤。

| 状态 | 含义 |
| --- | --- |
| pending | 已排队，未领取 |
| claimed | 已领取，准备数据 |
| sending | 已进入外部推送请求阶段 |
| retry | 明确可重试，等待下次尝试 |
| push_accepted | 推送服务返回 2xx；**不代表设备送达或已读** |
| failed | 不可重试或达到次数上限 |
| expired | 超过有效期，不补发 |
| cancelled | 用户关闭、修改或订阅失效导致取消 |
| unknown | 请求是否被服务接受不确定，不自动重复发送 |

## 安全、维护与扩展

每个浏览器持有随机 256 位 bearer capability，后端存其哈希作为所有权标识。没有可猜测设备 ID 接口；GET／修改／测试／删除按同一个凭证限定本设备。订阅 endpoint 哈希唯一，不能用新凭证覆盖其他设备订阅。前端不把凭证放进查询参数、通知 URL 或日志。清除存储后无法恢复旧凭证；旧数据依保留策略清理。

API 使用精确 origin CORS、JSON 限制、8 KiB 流式大小上限、字段白名单、D1 原子限流（IP 每分钟 120 请求、每设备每分钟 60、注册每 IP 每小时 20、测试每设备每小时 3）。对于更大规模公开服务可在 Cloudflare 边缘另加 WAF／滥用防护；D1 限流本身也消耗请求额度。

推送目标仅接受 HTTPS 和明确的 FCM、Mozilla、Apple、Windows 推送域；禁止凭证、非标准端口与重定向。新增供应商必须审核域名并补测试，不能简单允许任意 HTTPS 地址。日志只记录任务状态和脱敏结果码，不打印订阅、密钥或供应商响应正文。不要在 Cloudflare Logpush 等外部观测配置里额外采集 Authorization 请求头。

如密钥泄露：暂停发送、轮换 VAPID Secrets、更新前端取得的新公钥、要求设备重新订阅；不要试图用旧订阅保证迁移。D1 的计划与推送订阅数据需要受 Cloudflare 账号权限保护。

缺失推送密钥时，只要 D1 和精确 `ALLOWED_ORIGIN` 仍可用，已鉴权的查询、关闭、删除仍可执行；注册、开启和测试继续拒绝。关闭不存在的计划、删除已删除的账户均幂等，便于处理响应丢失。不能删除 D1 或移除 CORS 后仍声称用户能清理数据。

前端在本地存储关闭／删除意图，先显示“待确认”，独立尝试关闭 Service Worker 通知、浏览器取消订阅和服务端 DELETE。任一步失败都保留凭证和重试入口；页面重新打开、`online` 事件或手动刷新会重试同一意图，删除不能降级为仅关闭。页面关闭期间不会运行前端重试；必须联网后重新打开。待确认状态阻止重新开启与测试，但仍允许天气查询和预览。浏览器禁止存储时会提示本次操作无法跨重载记住。

2026-10-02 的恢复与并发修复没有更改数据库结构，无新增迁移。保留原 `0001_reminders.sql` 和既有数据即可升级代码；回退前先处理待确认关闭／删除，旧前端不会识别新增的本地待处理标记。

扩展点：`shared/briefing.js` 的模块注册表及数据源、`backend/channels/web-push.js` 的发送渠道注册表。实现 rain / airQuality 后再加入后端输入白名单和前端选项；邮件需要单独的地址验证、退订与发送适配，不复用浏览器 capability 作为邮箱验证。

## 回退

1. 紧急停止：在 Workers 配置把 `PAUSE_DELIVERY` 改为 `true` 并部署，或禁用 Cron。停止接收新开启和测试请求，保留关闭／删除入口。
2. 保留当前 `sw.js` 和独立数据删除入口供现有设备退订。仅把 API_BASE 清空或回退前端，不会自动删除后端已有计划，不能当作停发。
3. 代码回退：前端可恢复到原提交 `c679354`；后端用 Cloudflare 部署版本回退到已验证版本。先停 Cron，避免旧代码与新表结构不兼容。
4. 本次迁移只有新增表，不自动 drop。保留数据库回退副本；确认不再需要数据后，由维护者另行删除 D1。不要把包含订阅的数据备份进 Git。
5. 浏览器中已安装的 Service Worker 会继续存在；若彻底下线，先发停用版 SW／指导用户关闭提醒并移除站点权限。对已交给推送服务的消息无法撤回。
