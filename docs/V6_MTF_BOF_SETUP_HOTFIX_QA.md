# V6 MTF BOF Setup Hotfix — 本地候选 QA

## 基线与授权

- 分支：`codex/v6-mtf-bof-setup-hotfix`
- Base：`ba9b28c7168f8204e1a24082a5b056715cd4ec03`（已验收、未发布的交易方向标题候选）。
- 开始时 fetch 确认 production origin/main：`d18b2b8c1660214ed289089f746ef9cadf93b3cc`。
- Base 直接基于上述 main；工作区开始时 clean。本轮只提交本地候选，不 push / merge / deploy。
- 用户明确确认保持顺序：HTF结构 → 当前偏见 → 交易方向；上一候选的 `偏见方向>HTF方向>MTF方向` 保留。

## Setup 身份与兼容边界

| type | 可新建 V6 | 显示名称 | 研究类别 |
|---|---|---|---|
| mtf_pb | 是 | MTF PB | PB |
| mtf_bof | 是 | MTF BOF（做多等收敛 做空等扫高） | BOF |
| htf_bof | 否 | HTF BOF（恐慌或走弱 1次） | BOF |
| htf_pb | 否 | MTF BOF（趋势走弱 1次） | BOF |

新类型在 canonical records 中始终保存为 `mtf_bof`。未对用户记录执行批量改名、改 type、改 ID 或重新编号。旧 htf_bof / htf_pb 的 wait、signal、position、closed 均保留读取、生命周期、事件和导出能力；旧 Exit Research 标签维持既有版本（htf_pb 在其旧 UI 标签中原有的空格格式也未改动）。

Intraday schemaVersion 仍为 6，Unified 仍为 2，字段结构和 records 单一事实源不变。本轮是 **V6 type 可读枚举的加法扩展及创建集合调整**，不是单纯全局换名称。冻结 V5 SETUPS / validator / 迁移规则不扩展：V5 数据中的 mtf_bof 仍被拒绝。

V6 复用 V5 生命周期/Manual Event 校验和事件 writer 时，只在 detached validation view 中投影 mtf_bof → htf_bof。写回只复制 researchCapture，原 record.type 不改。研究入口使用同样的 detached type-only 验证适配，匹配和研究输出仍接收原 mtf_bof 身份。没有改变匹配算法、PB/BOF 参数、回放引擎或指标数学。

旧版本程序不认识新枚举，不能把含 mtf_bof 的新备份当作旧版本输入；本轮保证旧数据向当前候选可读，并未实现向旧程序降级。

## 实际浏览器 QA

- 隔离 Codex In-app Browser，本机临时 origin `http://127.0.0.1:4293`；只使用固定 synthetic 数据。
- 未读取正常 Safari / Chrome 的真实存储，未访问或导入真实用户备份。
- 页面使用本次构建的完整 app bundle 和原生产资源，未制作替代产品 renderer。
- CSS 仅商品卡片 `.setup-segment` 改为 1fr / 3fr；字体仍为既有 11px，按钮高度 36px。

| Viewport / theme | PB / BOF 宽度 | BOF 文字宽度 | 文本行数 | 页面横向溢出 |
|---|---|---|---|---|
| 1280×1000 light | 77.25 / 231.75px | 约184.95px | 1 | 无 |
| 1280×1000 dark | 77.25 / 231.75px | 约184.95px | 1 | 无 |
| 1440×1000 light | 77.25 / 231.75px | 约184.95px | 1 | 无 |
| 1440×1000 dark | 77.25 / 231.75px | 约184.95px | 1 | 无 |
| 390×844 light | 82.75 / 248.25px | 约184.95px | 1 | 无 |
| 390×844 dark | 82.75 / 248.25px | 约184.95px | 1 | 无 |

以上均检查 GC/CL/ES：两个按钮同 Y、同高度；Range.getClientRects() = 1，文字边界在按钮内，scrollWidth ≤ clientWidth，white-space: nowrap，overflow: visible，无 ellipsis。左右宽度约25% / 75%（不含按钮间隙）。

浅/深色锁定与跟随持仓：long 分别为 rgb(24,122,65) / rgb(108,239,166)，short 分别为 rgb(197,52,69) / rgb(255,104,121)。结构按钮 data-tone=neutral；原偏见色不改。等待/找信号选中项保留最强强调。Setup 选中/未选中保持既有样式；不可用时两主题均 disabled、中性、opacity=0.64。

实际交互：已有新 MTF BOF 持仓后新增 MTF PB，确认入场后两笔持仓仍独立；继续可登记 MTF BOF pending。ES 两笔 MTF BOF 分别显示 Initial Stop 5000/5002，只转换第一笔 BOF→PB，第二笔仍 BOF；撤销后第一笔恢复 BOF。自动化测试另验证单笔退出、全部平仓保留 pending、reload 和非法操作原子性。

Risk、Exit Research、Chime 页面可正常打开，浏览器 console 无 error/warn。macOS Chime Helper / native backend / 安装 / 调度未改动；未重新进行 Helper POC。

截图与原始 computed-style/布局证据（repo 外）：

- `/Users/hongchujun/Documents/日内交易/V6-MTF-BOF-Setup-QA-20261008/desktop-light.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-MTF-BOF-Setup-QA-20261008/desktop-dark.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-MTF-BOF-Setup-QA-20261008/mobile-light.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-MTF-BOF-Setup-QA-20261008/mobile-dark.jpg`
- `/Users/hongchujun/Documents/日内交易/V6-MTF-BOF-Setup-QA-20261008/computed-layout.json`

## 测试与检查

- 原928项保留；既有 V6 创建测试按授权更新为 mtf_bof，历史 V5 fixtures / frozen artifacts 未改写。无删除、跳过、弱化旧校验。
- 新增28项：`test/v6-mtf-bof-setup.test.js` 26项 + production bundle 测试2项。
- 核心新增测试：
  - `MTF BOF identity`：新建集合、精确名称及原历史标签。
  - `MTF BOF creation gate`：旧两类型在 empty / pending / holding 均原子拒绝。
  - `MTF BOF legacy compatibility`：旧两类型四生命周期的 migration/reload/export 保留及继续操作。
  - `MTF BOF frozen V5 boundary`：V5 validator、creation、context gate 仍拒绝新类型。
  - `MTF BOF validation projection` / `strict V6 validation`：不改 canonical type，未知type、zone、timeline、无效事件仍拒绝。
  - `MTF BOF lifecycle` / `coexist`：独立止损、转换/撤销、同Setup多笔、退出/flatten/pending以及新旧共存。
  - `MTF BOF Exit Research`：保持原Setup身份，实际指标与完整 BOF replay 输出和相同旧类型输入 deepEqual。
  - `MTF BOF UI semantics` / `protects accepted header order`：选中、未选中、禁用 class/tone，三卡头部顺序与上一候选标题。
  - 两项 production bundle 测试：实际 app wiring 创建/入场/history，旧类型禁止新建与旧活跃记录继续原生命周期。
- `npm test`：956/956 PASS，fail=0，skipped=0，cancelled=0。
- `npm run build`：PASS。
- `node --check dist/app.bundle.js`：PASS。
- `git diff --check`：PASS。
- Bundle SHA-256：`06f874e26e6e363ea92a6ab60129632c3b67b8119aba0586927f4dfd7ac02f60`。
- 统一静态资源版本：`v6-mtf-bof-setup-hotfix-20261008`。

## 修改文件清单（相对 Base）

- src/model.js
- src/intraday-v6/model.js
- src/intraday-v6/validation.js
- src/intraday-v6/index.js
- src/capture-ui.js
- src/exit-research/research-common.js
- src/exit-research/ui/labels.js
- refinement.css
- index.html
- dist/app.bundle.js
- test/bundle.test.js
- test/fixtures/intraday-v6.js
- test/multi-trade-v6-capture.test.js
- test/multi-trade-v6-model.test.js
- test/v6-card-header-order.test.js
- test/v6-setup-simplification.test.js
- test/v6-mtf-bof-setup.test.js
- docs/V6_MTF_BOF_SETUP_HOTFIX_QA.md

Migration / persistence / CAS、store、Risk、Chime、Tradovate reconstruction、matching、PB/BOF replay 数学文件没有修改。schemaVersion 和字段结构不变，V6 validator 仅增加新Setup身份的兼容校验。未发现需要另行人工裁决的不兼容结构或迁移问题。

LOCAL CANDIDATE ONLY — WAITING FOR HUMAN REVIEW
