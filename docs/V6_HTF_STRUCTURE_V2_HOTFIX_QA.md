# V6 HTF Structure V2 — 本地候选与兼容验证

## 基线与范围

- 分支：`codex/v6-htf-structure-v2-hotfix`
- Base / 开始时 HEAD / fetch 后 origin/main：`05927058a4cc1b889add45d280acf563b95c8948`。
- 开始时工作区 clean。相关已验收标题/Setup 修改已在该 main；没有引入旧研究开发分支。
- 本轮只创建独立本地候选，不 push、merge 或 deploy；没有使用子代理。

## 新分类与界面

顺序保持：HTF结构 → 当前偏见 → 交易方向。

| 新稳定 key | 新分类按钮 | 新建 mtf_pb / mtf_bof |
|---|---|---|
| trend_pullback_stronger | 趋势（回调变强） | 两者均允许，仍须有做多/做空方向 |
| trend_pullback_weaker | 趋势（回调变弱） | 两者均允许，仍须有做多/做空方向 |
| htf_range_v2 | 震荡 | 两者均允许，仍须有做多/做空方向 |

HTF 标题：`HTF结构（HTF波段动能& 新的未测试优质缺口）`。
偏见标题：`当前偏见（价格对HVN拒绝or接受）`。
方向标题：`交易方向 偏见方向>HTF方向>MTF方向`。

新分类与冻结的 `STRUCTURES_3M` 分开定义为 `HTF_STRUCTURES_V2`。偏见、方向按钮与颜色规则不改；所有新结构按钮统一 neutral，选中态使用既有 text-secondary 中性色。

## 兼容与事实保护

这是 **V6 可读结构枚举扩展和新登记确认门槛**，不是对旧值改显示名称。Intraday 仍为 V6，Unified 仍为 V2，卡片和记录字段结构不变；无新增字段、无迁移脚本、无用户数据批处理。

- `unjudged / bullish / range / bearish` 继续可读、校验、导出和 JSON round-trip；V5 validator 和 V5→V6 migration 源码规则不改。
- 旧卡片保留原值；旧 bullish/range/bearish 显示 `旧分类：<原名称>；请重新确认 HTF结构后登记新机会（不影响已有交易）`。
- 旧分类不选中新按钮，不能登记任何新的 Opportunity。用户主动选择新分类后才启用现有两个 Setup；选择只修改 card.structure3m，不回写历史快照，不关闭已有 pending 或 Trade。
- 新机会 snapshot 原样保存所选新 key；记录 ID、时间、已登记旧 snapshot、Manual Events 不改。
- 旧 htf_bof/htf_pb 历史兼容与生命周期保留，仍不可新建；新建集合仍为 mtf_pb/mtf_bof。
- 新分类不根据方向或 Setup 自动推断；三个新值均允许 PB 和 BOF，未增加策略限制。

既有 V6 生命周期/事件层使用 detached V5 validation view。新 snapshot 的合法性先由 V6 白名单确认，然后仅在 detached view 中使用 `range` 作为冻结校验器所需的中性占位值。该占位不是市场判断或新旧分类映射：不会写回 canonical record，也不会导出或进入研究结果。事件 writer 仍仅复制 researchCapture；所有实际 record 保持原新 key。研究读取边界采用同样只读适配，冻结 V5 validator 自身仍拒绝新 key。

`src/capture-persistence.js` 的变动仅为 Markdown 新结构标签 lookup；序列化、读写、恢复、CAS、备份字段不改。研究模块的唯一修改在校验适配边界，没有改变 Matching、Actual Metrics、PB/BOF Replay 或 Lookahead QA 算法及策略数值。含新 key 的备份面向此候选及后续兼容版本，不声称旧程序能够读取新分类。

## 自动化验证

- `npm test`：986/986 PASS，0 failed，0 skipped；原956项保留并通过，新增30项。
- 新文件 `test/v6-htf-structure-v2.test.js`：29项，覆盖精确标题/顺序，3结构×2Setup×2方向，快照冻结，JSON/Markdown，旧分类拒绝登记且原子不变，V5兼容/active recovery，旧生命周期，冻结 V5 严格拒绝新key，未知key拒绝，3种新分类的完整研究结果与旧输入对比。
- `test/multi-trade-v6-capture.test.js` 新增1项：真实 production bundle 的结构点击保存、新记录快照、旧 pending 不改、Unified V2 和 Risk/Chime 隔离。
- 现有 V6 创建 fixture 改为显式选择新分类。迁移后新登记测试先验证旧分类被拒绝、state不变，再明确选择新分类；保留原多笔/ID/事件/快照断言。冻结 V5 fixture、历史 Golden Ground Truth 和 frozen-m1 文件未改。
- `npm run build`、`node --check dist/app.bundle.js`、`git diff --check`：PASS。
- Bundle SHA-256：`d01c2c036d502f6dac16301b1e43b7f75f2cddfcb43823d01dee42a0ab7c9080`。
- 9个静态资源统一 cache version：`v6-htf-structure-v2-hotfix-20261008`。

## 真实浏览器 QA

隔离 Codex In-app Browser，本机新 origin `http://127.0.0.1:4297`；仅固定 synthetic。使用完整候选 app 和资源，无替代 renderer；不读取用户正常 Safari/Chrome 数据或真实备份。

| 尺寸与主题 | 三按钮宽度(px) | 按钮高度(px) | 结构文字行数 | 文本边界/页面溢出 |
|---|---|---|---|---|
| 1280×1000 light | 120 / 120 / 66 | 26 | 各1行 | 全在按钮内/无 |
| 1280×1000 dark | 120 / 120 / 66 | 26 | 各1行 | 全在按钮内/无 |
| 1440×1000 light | 120 / 120 / 66 | 26 | 各1行 | 全在按钮内/无 |
| 1440×1000 dark | 120 / 120 / 66 | 26 | 各1行 | 全在按钮内/无 |
| 390×844 light | 128.625 / 128.625 / 70.75 | 26 | 各1行 | 全在按钮内/无 |
| 390×844 dark | 128.625 / 128.625 / 70.75 | 26 | 各1行 | 全在按钮内/无 |

GC/CL/ES 都实测：DOM顺序、标题内容、Range文本边界、scrollWidth/clientWidth、按钮同Y/同高，Setup仍同排25%/75%且文案单行。三个新分类同时选中于三张卡，computed background 均为 light `rgb(110,110,115)`、dark `rgb(147,161,184)`，无结构红绿语义。锁定/跟随方向的绿色和红色保持既有主题色。未增加新分类卡片的标题或按钮行数，原卡片下方的等待/找信号、两个独立持仓和 Initial Stop 均正常显示。

旧分类 synthetic：GC旧 active+stop正常，CL/ES旧 pending正常；新建按钮禁用。GC主动改为回调变弱后旧持仓、stop仍正常，两种新建按钮启用；CL未选新分类仍可从wait→signal→入场，旧分类提示仍保留。重载后两项状态均恢复。Risk、Exit Research、Chime页面正常，console error/warn为空。没有重新安装或验收 macOS Helper。

截图和实测JSON（本地外部QA目录，不含用户真实交易）：
`/Users/hongchujun/Documents/日内交易/V6-HTF-Structure-V2-QA-20261008/`

- desktop-light.jpg
- desktop-dark.jpg
- mobile-light.jpg
- mobile-dark.jpg
- legacy-confirmation.jpg
- layout-measurements.json
- route-smoke.json

## 边界与结论

schemaVersion / 字段结构 / migration / persistence写入 / CAS / 多笔生命周期 / Initial Stop / BOF→PB / Risk / Chime Helper / Tradovate / Research Store / 研究数学均未修改。明确变更的是结构分类可读枚举、新机会结构确认条件及界面文案布局。

没有发现须新增人工架构裁决的问题。只提交本地候选，等待人工视觉与语义验收；尚未发布。

## 修改文件完整清单

- `dist/app.bundle.js`
- `docs/V6_HTF_STRUCTURE_V2_HOTFIX_QA.md`
- `index.html`
- `refinement.css`
- `src/app.js`
- `src/capture-persistence.js`
- `src/capture-ui.js`
- `src/exit-research/research-common.js`
- `src/intraday-v6/model.js`
- `src/intraday-v6/validation.js`
- `src/model.js`
- `test/bundle.test.js`
- `test/fixtures/intraday-v6.js`
- `test/multi-trade-v6-capture.test.js`
- `test/multi-trade-v6-migration.test.js`
- `test/multi-trade-v6-model.test.js`
- `test/v6-card-header-order.test.js`
- `test/v6-htf-structure-v2.test.js`
- `test/v6-locked-direction-color.test.js`
- `test/v6-mtf-bof-setup.test.js`
- `test/v6-setup-simplification.test.js`
- `test/v6-ui-selection.test.js`
- `test/v6-ui-structure-neutral.test.js`
