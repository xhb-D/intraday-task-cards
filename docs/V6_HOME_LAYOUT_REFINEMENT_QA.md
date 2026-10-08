# V6 首页布局优化 QA

日期：2026-10-08。状态：本地候选，等待人工视觉验收；未 push / merge / deploy。

## 基线与范围

- Production main：`05927058a4cc1b889add45d280acf563b95c8948`；开始前 fetch 后一致。
- 本轮 Base：`47a962b19b66a0ce4a676d078b357030398c00cb`，完整保留 HTF结构 V2 候选。
- 分支：`codex/v6-home-layout-refinement`。
- 本轮产品改动：`src/capture-ui.js` 的展示标题/ARIA/旧分类提示、`index.html` 的同一个 Risk 挂载节点位置、主页父容器及标题 CSS、构建 Bundle。
- 未修改 domain、schemaVersion、records、migration、persistence、CAS、Risk 计算/controller、Chime JavaScript/Helper/Backend、Setup 或研究算法。
- 统一静态资源 version：`v6-home-layout-refinement-20261008`，9 个资源引用同步更新；未改动其他资源内容。

## 标题与 DOM

顺序：大偏见 → 小偏见 → 交易方向。

| 主标题 | 单独第二行说明 |
| --- | --- |
| 大偏见 | HTF波段动能&新的未测试优质缺口 |
| 小偏见 | 价格拒绝（尾部/单打印）&价格接受（弱端点/震荡） |

两组使用相同 `.context-heading`、`.context-title`、`.context-note`；主标题 13px / 650，说明 11px / 400、次级文字颜色，正常换行，无隐藏/省略。

交易方向保持：`交易方向 偏见方向>HTF方向>MTF方向`。所有选项、按钮大小、颜色、动作和旧记录语义保持 Base 版本。

首页 DOM：`#home-top-region > #chime-summary-host` → 商品看板 → 三张商品卡 → `#history` → 唯一 `#risk-dashboard-host`。Risk 挂载仍在 home 路由内部，原控制器按同一 ID 初始化；独立 `#/risk` 容器未移动。

移除旧父容器将 Risk/Chime 拼成双列的 grid-area / display:contents 样式。Chime 顶部变为单列全宽；下方 Risk 使用未修改的 `risk-dashboard.css` 原有独立摘要+横向账户卡布局。手机继续使用原有账户选择器和两列操作按钮，不另造移动端账户系统。

## 自动化验证

- `npm test`：**1002/1002 PASS，0 skipped，0 fail**；Base 原有 986 项均保留，新增 16 项。
- `npm run build`：PASS。
- `node --check dist/app.bundle.js`：PASS。
- `git diff --check`：PASS。
- Bundle SHA-256：`cae2a3b7ff7d544794f297bfa72fb20551c4e59500c79dbe689db2a217a931b5`。
- 浏览器 QA 目录中 index、bundle 和全部 8 个其他加载资源，与最终构建文件逐字节相同。

新增测试：

1. `Home layout {GC|CL|ES}/{none|wait|signal|position}: exact two-level big/small bias headings, direction order, no canonical mutation`（12 项）：精确双层标题、顺序、3 个结构/偏见按钮、2 个 Setup、渲染不修改 canonical state。
2. `Home layout DOM: unique Risk mount follows history inside home; Chime alone retains the top mount`：唯一挂载、完整首页 DOM 顺序和独立 Risk 路由保留。
3. `Home layout CSS: shared title hierarchy and natural wrapping; standalone Chime and original Risk grid retained`：标题层级、自然换行、原 Risk 桌面/手机 CSS 与横向滚动保留。
4. `Home layout relocated Risk mount: account creation/editing, balance events, selection, rail and reload use only the same Unified Risk section`：真实 Risk controller 初始化，新增两账户、余额事件更新/撤销、编辑不改 ID、选择、左右滚动、同一个 Unified key/section 写回、其他 sections 不变与 reload。
5. `Home layout production: hide/collapse and per-trade management leave synthetic accounts, balances and chime settings unchanged after reload`：运行完整 production bundle；商品隐藏/折叠、独立 BOF→PB 不改变 Risk/Chime，reload 保留 sections。

原有标题/cache/UI 测试同步调整展示预期；原业务、迁移、持久化、研究、Risk、Chime 回归未删除或跳过。

## 实际浏览器 QA

仅使用 Codex In-app Browser 和新 localhost `127.0.0.1:4298` 的 synthetic 工作区；未读取用户正常 Safari、真实账户、真实存档或生产 localStorage。测试账户名称明确标注 SYNTHETIC。未连接/安装/重新验收 Native Helper。

| 尺寸 / 模式 | 页面横向溢出 | 标题/Setup 溢出 | Risk 在 history 后 | 唯一挂载 |
| --- | --- | --- | --- | --- |
| 1280×1000 light | 无 | 无 | 是 | 1 |
| 1280×1000 dark | 无 | 无 | 是 | 1 |
| 1440×1000 light | 无 | 无 | 是 | 1 |
| 1440×1000 dark | 无 | 无 | 是 | 1 |
| 390×844 light | 无 | 无 | 是 | 1 |
| 390×844 dark | 无 | 无 | 是 | 1 |

浏览器实际测量：desktop 三卡宽 344px；GC/CL 卡高 749.5px、含两笔持仓的 ES 高 870.5px。Light/Dark 高度完全一致。手机 GC/CL 高 749.5px、ES 高 1038.5px（沿用持仓参考上下堆叠）；Risk 宽 366px，无自身横向溢出，账户操作按钮各 165.5px。长说明使用正常换行，不截断。

颜色 computed style：light 锁定做多 `rgb(24,122,65)`、做空 `rgb(197,52,69)`；dark 做多 `rgb(108,239,166)`、做空 `rgb(255,104,121)`。结构选中仍为 neutral；偏见既有颜色不变。等待/找信号选中强调、两个 Setup 和独立持仓/止损显示正常。

实际账户操作：新增 synthetic 第三账户成功；A 余额 50100→50150，撤销后 50100；编辑名称成功；切换 B 后 reload 保留选择和账户。桌面向右查看更多账户将 rail.scrollLeft 从 1 改为 254；手机仍使用原选择器切换 A/B。自动化验证同时证明账户操作只写相同 Unified Risk section、账户 ID 不变。

实际商品操作：ES 第一笔 BOF→PB 后第二笔仍 BOF，撤销恢复 BOF；两笔 Initial Stop 5000/5002 独立显示。GC 折叠、CL 隐藏及 reload 后 Risk 余额/账户选择不变，随后用 UI 恢复商品显示。完整 bundle 测试补充 deepEqual sections 证据。

`#/risk` 正常显示完整风险页；`#/exit-research` 正常显示 synthetic 交易及缺成交数据提示；`#/chime` 正常显示原五周期设置。首页浏览器报时开始→暂停按钮状态正常；语音/通知关闭以免影响用户。Web/Native 模式选项保留，Native backend/Helper 不在本轮现场重新测试。控制台 error/warn：0。

## 发现的原有问题（不属于本次布局改动）

在“编辑账户”弹窗点“删除账户”后，删除确认弹窗不打开：`riskDialog()` 的 `activeRiskDialog` 防重复守卫阻止 `deleteConfirm()` 再打开第二个弹窗。实际浏览器与额外测试均复现。

`src/risk-manager-view.js` 在 Production main、Base 与本轮工作区内容一致；Production main 与 Base Git blob 均为 `f080c2eea0399d4e3ce78a802d4732e867085654`。本轮没有修改该文件或 Risk 业务逻辑。

因此，不能宣称“账户删除 UI 通过”。新增、编辑、余额更新/撤销、选择与 reload 已通过。删除问题保留并返回人工审核，须另行授权修复；没有为通过测试修改 Risk 代码或弱化任何原有测试。

## 截图与测量文件

均由实际候选浏览器渲染生成，存放仓库外，未提交 synthetic 存档。

- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/desktop-light.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/desktop-dark.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/mobile-light.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/mobile-dark.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/desktop-risk-accounts.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/mobile-risk-controls.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-Home-Layout-QA-20261008/layout-measurements.json`

本次布局验证通过；本地候选等待人工验收，附带上述原有 Risk 删除弹窗问题。NO PUSH / NO MERGE / NO DEPLOY。
