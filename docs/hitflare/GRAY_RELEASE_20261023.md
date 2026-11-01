# HitFlare 灰度包 20261023

状态：`gray-20261023-serviceization` 已上线，待灰度验收。页面仍显示 v0.18.3，不是新的正式版本；包内 OPS.md 保留打包时的候选说明。

实际目录为 `/opt/hitflare-release-gray-20261023`，drop-in 为 `60-release-gray-20261023.conf`，权威数据路径不变。原包及内部 79 个文件哈希、服务器依赖安装、停服全量备份、隔离迁移演练和正式迁移已通过；账号凭据及原有 Agent/反推记录保留。公网资源、登录、本人配置/资产/画布 API、管理日志核验通过；API 创建画布保存后重新登录回读一致，不代替浏览器刷新验收。

启动前完整备份位于 `/opt/hitflare-backup-before-gray-20261023/data.tar.gz`，SHA-256 为 `c646e1500bb0c5b08d75b2fd536b4e756f0364216fa5810c2e272fd014c8f283`。钥匙位于 `/etc/hitflare/keyring.env`，root 所有、权限 600，未进入发布包或数据目录。服务器部署/恢复脚本及日志目录为 `/opt/hitflare-gray-20261023-ops/`；回滚必须恢复完整启动前数据并恢复旧代码。

真实模型请求为 0：按用户安排，上线后由用户在页面保存渠道，再执行一次真实生图或按指引自测。本人配置/资产跨账号隔离、画布浏览器刷新和真实生图期间刷新仍待人工验收；P1、P5、P2/P3/P4/P6 的结论按下文保持区分。

## 1. 本次撤下的运行版本

只读核对时间：2026-10-23。生产 `hitflare.service` 为 active。

| 项 | 值 |
| --- | --- |
| 正在运行的版本 | `v0.18.3` |
| 代码目录 | `/opt/hitflare-release-ac81bdf` |
| 启动命令 | `/opt/node-v24.14.1-linux-x64/bin/node /opt/hitflare-release-ac81bdf/server/index.mjs` |
| 当前 drop-in | `/etc/systemd/system/hitflare.service.d/50-release-ac81bdf.conf` |
| 监听 | `127.0.0.1:3200` |
| 权威数据目录 | `/opt/hitflare-release-52a959d/data` |
| 现有环境文件 | `/opt/hitflare-release-52a959d/.env` |
| 公网入口 | `https://hitflare.152.32.172.162.sslip.io/` |

本次要撤出运行位的是 `v0.18.3` 这份代码，不是数据目录。灰度期间不要删除 `/opt/hitflare-release-ac81bdf`，也不要删除更早的 `/opt/hitflare-release-*`。那些目录是回滚代码。数据目录 `/opt/hitflare-release-52a959d/data` 继续使用，不要复制运行中的 SQLite 或 WAL 去当新数据根。

第一次启动新代码会迁移账号库、Agent 库和反推库，并新建工作区、生成和画布库。迁移前会在数据目录的 `schema-backups/` 留一份。即便如此，运维仍要在停服务后、启动新代码前，对整个数据目录做一份独立备份。启动成功后，只把 systemd 指回 `ac81bdf` 不能保证登录恢复，因为账号表结构已经变了。要回到 v0.18.3，必须同时恢复这次启动前的数据库备份。

## 2. 包内容与安装

包内是未打 Git tag 的工作区代码，基线提交 `ac81bdf`，加上尚未提交的服务化改动。包标识：`gray-20261023-serviceization`。不要把它记成 `v0.18.4`。

建议安装目录：`/opt/hitflare-release-gray-20261023`。

目录必须保持：

```text
/opt/hitflare-release-gray-20261023/server/index.mjs
/opt/hitflare-release-gray-20261023/web/dist/
/opt/hitflare-release-gray-20261023/shared/
```

服务器是 Node 24。不要把 macOS 的 `node_modules` 带上去。在服务器的 `server/` 目录执行 `npm ci --omit=dev`。

新增环境变量 `HITFLARE_KEYRING`。当前生产进程没有这个变量，不设置则新代码拒绝启动。由运维在服务器生成一次，保存到数据目录和发布目录之外，权限 600。丢失后已加密的 API Key 无法解密，不能重新生成同一把钥匙。

```bash
install -d -m 700 /etc/hitflare
node -e 'const c=require("crypto"); const k=c.randomBytes(32).toString("base64"); require("fs").writeFileSync("/etc/hitflare/keyring.env","HITFLARE_KEYRING="+JSON.stringify({active:"gray-20261023",keys:{"gray-20261023":k}})+"\n",{mode:0o600})'
```

新的 drop-in 使用下一序号 `60-release-gray-20261023.conf`。保留原有 `HOST=127.0.0.1`、`PORT=3200`、`HITFLARE_DATA_DIR=/opt/hitflare-release-52a959d/data` 和管理员变量。追加 `EnvironmentFile=/etc/hitflare/keyring.env`。不要把钥匙写进发布目录或数据目录。

切换顺序：停服务，备份数据目录，校验包哈希，解压到新目录，`npm ci --omit=dev`，写 drop-in，`daemon-reload`，启动，检查 `http://127.0.0.1:3200/api/health` 为 200。启动失败就停在新代码，用启动前备份恢复数据，再把 drop-in 指回 `50-release-ac81bdf.conf`。

## 3. 已验、未验和缺口

P1 已由用户人工通过。P5 已由用户确认以自动化结果验收，不再另行点验。P2、P3、P4、P6 只有 AI 本地测试通过，没有人工签字，也没有生产验收。

| 范围 | 当前结论 | 灰度里要看的 |
| --- | --- | --- |
| P1 登录、session、禁用、改密、改角色 | 人工通过 | 抽验本人能登录；不要在生产禁用真实账号 |
| P5 管理日志、灵感来源、只读扫描、备份恢复 | 以自动化验收 | 只看日志页是否打开且不含提示词和 Key；不要在生产执行恢复 |
| P2 配置、媒体、资产、413、WebDAV 停用 | AI 通过，人未验收 | 本人配置和资产是否只属于自己；旧 WebDAV 菜单不可用 |
| P3 生成历史、调用和错误码 | AI 通过，人未验收 | 真实渠道只发一张图，刷新后历史仍是「生成中」 |
| P4 画布保存和引用 | AI 通过，人未验收 | 新建画布，保存后刷新仍在 |
| P6 切账号和 ZIP 边界 | AI 通过，人未验收 | 灰度不做破坏性切换测试 |
| 图片创作服务器持有上游连接 | 假上游测试通过，人未复验 | 上面这一张真实图即是复验 |

已知缺口，灰度不修，也不能用这些入口证明「刷新不中断」：

- 画布里的生图、Gemini、自定义调用脚本和视频仍由浏览器直连，刷新会中断。
- 旧浏览器 IndexedDB 数据不会自动导入，也不会被清空。用户换浏览器后看不到旧本地素材和画布。
- 旧 WebDAV 同步已停用。加密 WebDAV 恢复、日志保留周期、存储物理清理和多实例队列都没有做。
- 修复前留下的「进行中」或 `unknown` 记录保持原样，不回写。
- 图片任务只存在于当前这一个 Node 进程。进程退出后，未完成的服务器调用记为状态不确定，不会自动续跑。

灰度验收通过前，不要删除 `v0.18.3` 代码目录，不要把本包记成正式版本。

## 4. 灰度实测反馈

2026-10-23 灰度使用中补充，不改变上一节的验收结论，也不在本记录里修代码。

- 图片创作：生成后刷新页面，页面上的生成耗时计时会回到 0。服务器上的图片请求没有被刷新取消；已完成调用的耗时仍写在服务端 `durationMs`。进行中记录在完成前没有可续计的页面计时，重新打开进行中记录时，可见计时从当前时刻重计，不从任务开始时间续计。反推提示词的进行中计时使用服务端开始时间，不按这个现象处理。
- 反推提示词：刷新后会恢复浏览器里保存的上一张参考图，但没有进行中任务时不会进入该历史任务的工作态，结果区也不恢复。页面因此停在既非干净草稿、也非历史任务的状态。「开始反推」在模型无法对上当前账号渠道时保持禁用；删图并重新上传只更换草稿，不重新校验或改选模型，按钮仍会是灰的。
- 配置里的 WebDAV 和本地存储入口仍在。WebDAV 页只显示停用说明，同步函数会拒绝执行，不会连接或恢复远端文件。本地存储页读取的是当前浏览器 IndexedDB，不是服务器磁盘。实测该浏览器仍有旧数据：站点约 749.3 MB，HitFlare `infinite-canvas` v7 约 744.5 MB，其中 `image_files` 209 条约 740.2 MB。这是封存的旧浏览器数据，本次部署不导入也不清空。

## 5. 前端修复包，已上线待灰度验收

`gray-20261023-fix1` 已部署，只修图片生成计时和反推刷新后的工作态。包在 [outputs/release/hitflare-gray-20261023-fix1.tar.gz](../../outputs/release/hitflare-gray-20261023-fix1.tar.gz)，SHA-256 `e022ff55fb55e9378d4732a0ac843b64403574bb97def64c4777a4dd84a1546f`。包内 `OPS.md` 保留打包时的候选状态。第 4 节为修复前观察，不代表本次修复已经人工验收。

本次仅整目录替换 `/opt/hitflare-release-gray-20261023/web/dist`，不改服务端、数据库、钥匙或 drop-in，不执行 npm ci，不重启服务。替换前后 PID 均为 `1511881`，启动时间未变化。包内 46 个文件及上线后 44 个静态文件哈希一致；公网 `/image`、`/reverse-prompt` HTML 和 JS/CSS 文件匹配，新入口为 `/assets/index-BT8Q9_3_.js`，健康检查正常。原静态目录完整保存在 `/opt/hitflare-backup-before-gray-20261023-fix1/web-dist`，部署证据在 `/opt/hitflare-gray-20261023-fix1-ops/result.json`。

本次只回滚静态文件：先将当前 `web/dist` 改名保留，再把该备份目录移回 `web/dist`，核对入口恢复为 `/assets/index-CzHTj1Xa.js`；不恢复数据库。此静态回滚与前述服务化整包迁移回滚不同。

待人工验收：图片生成中刷新后耗时续计、完成耗时回读；没有进行中反推时刷新为干净草稿；有本人文本模型并上传参考图后开始按钮可点，没有文本模型仍禁用；进行中反推刷新后仍恢复任务和停止按钮。本轮真实模型请求为 0，未操作浏览器旧数据。

## 6. fix3 已回滚，不要再部署

`gray-20261025-fix2` 和 `gray-20261025-fix3` 都不要部署。fix3 曾替换 `server/provider-network.mjs` 和 `web/dist`，但整包前端带上了尚未上线的新界面，已按要求撤回。

2026-10-25 已恢复切换前的 `web/dist` 和 `server/provider-network.mjs`。没有恢复数据库，也没有改钥匙或 drop-in。公网入口回到 `/assets/index-BT8Q9_3_.js`，健康检查正常。当前 PID `128349`。被撤下的文件保留在 `/opt/hitflare-gray-20261025-fix3-ops/withdrawn-fix3`。

fix3 包仍在 [outputs/release/hitflare-gray-20261025-fix3.tar.gz](../../outputs/release/hitflare-gray-20261025-fix3.tar.gz)，SHA-256 `db6ca01b3d4775441793e9228083b0b75a9c3a3d60bc4c73513690b03f1506d8`，只作撤回记录，不能再次替换线上。

## 7. fix5 已在线上，fix7 尚未部署

`gray-20261025-fix4` 已上线，入口 `/assets/index-878a99bc.js`。实测右侧生成记录的耗时停在 0 秒，反推开始后刷新会丢失历史并报恢复失败。

`gray-20261025-fix5` 已在线上。2026-10-25 公网入口为 `/assets/index-2f7ed64a.js`。包在 [outputs/release/hitflare-gray-20261025-fix5.tar.gz](../../outputs/release/hitflare-gray-20261025-fix5.tar.gz)，SHA-256 `6e35657249f99bc7eaf6094001e3af6daebfc2e3bf3c62881df731ebb58e0331`。

## 9. fix7 已上线，待灰度验收

`gray-20261025-fix7` 已上线，待灰度验收。只替换了 `web/dist`，服务 PID 仍是 `167819`，未重启，未改数据库和钥匙。公网入口是 `/assets/index-b426f208.js`。包在 [outputs/release/hitflare-gray-20261025-fix7.tar.gz](../../outputs/release/hitflare-gray-20261025-fix7.tar.gz)，SHA-256 `0e88b54526ee310df11348f37e0d94ba0e35e02dddde3bab766c8e8bf13088b2`。切换前静态目录备份在 `/opt/hitflare-backup-before-gray-20261025-fix7/web-dist`。

## 8. fix4 记录

`gray-20261025-fix4` 已上线，见上一节。包在 [outputs/release/hitflare-gray-20261025-fix4.tar.gz](../../outputs/release/hitflare-gray-20261025-fix4.tar.gz)，SHA-256 `a9fb809383423c056e3e07724fab31f56febbc804a04d46b12be9e7701e18fa4`。入口 `/assets/index-878a99bc.js`。不要再把它当成待部署包。
