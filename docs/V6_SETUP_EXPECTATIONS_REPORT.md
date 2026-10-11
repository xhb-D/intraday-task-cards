# V6 Setup V2 + 交易预期记录与跟踪 V1｜本地候选交付

日期：2026-10-11。状态：**LOCAL_CANDIDATE / READY_FOR_CHAT_HUMAN_REVIEW**。本轮未 push、merge、deploy；不标记 FROZEN。

大偏见 V3、独立 SPB/CPB/BOF、每笔入场预期与持仓判断、首页单实例浮动面板已实现。自动化 **1114/1114**，实际 Chrome 的 26 组检查完成，保留 30 张明暗截图。真实手机输入法与物理多显示器切换尚未验收；研究分类仍待人工裁决。

## 1. 分支与 Base SHA

- 分支：`codex/v6-setup-expectations-v1`。
- Base：`ef54f29e48d1de7e2f7a87840a6f0aa3cd2df72e`。
- 开始时工作区干净；实际执行 `git fetch origin`，并在交付前再次 fetch。已取得的 `origin/main` 仍为上述 Base，没有强行采用过期基线。
- 使用当前独立分支；没有创建额外 worktree，也没有修改 main。

## 2. 新 Commit SHA

本报告与实现、测试及证据一同提交。**精确候选 SHA 见本轮交付消息**；该 SHA 对应包含本报告的本地提交，可用 `git rev-parse codex/v6-setup-expectations-v1` 核对。提交不包含自身 SHA，避免自引用。

## 3. 修改文件清单

| 范围 | 文件 |
| --- | --- |
| Capture 模型与严格验证 | `src/model.js`、`src/intraday-v6/model.js`、`src/intraday-v6/validation.js`、`src/intraday-v6/index.js`、新增 `src/intraday-v6/expectations.js` |
| 首页与面板 | `src/app.js`、`src/capture-ui.js`、新增 `src/expectation-panel.js`、`index.html`、`refinement.css` |
| 导出 | `src/capture-persistence.js` |
| Research 只读适配与展示 | `src/exit-research/ui/capture-adapter.js`、`controller.js`、`labels.js`、`render.js`、`store.js`、`view-model.js` |
| 构建 | `scripts/build.mjs`、`scripts/research-bundle.mjs`、生成的 `dist/app.bundle.js` |
| 新增验证 | `test/v6-expectations.test.js`、`scripts/qa-v6-expectations.mjs` |
| 现有测试适配 | `test/bundle.test.js`、`test/fixtures/intraday-v6.js`、`test/multi-trade-v6-capture.test.js`、`test/multi-trade-v6-migration.test.js`、`test/multi-trade-v6-model.test.js`、`test/v6-card-header-order.test.js`、`test/v6-home-layout.test.js`、`test/v6-htf-structure-v2.test.js`、`test/v6-locked-direction-color.test.js`、`test/v6-mtf-bof-setup.test.js`、`test/v6-setup-label.test.js`、`test/v6-setup-simplification.test.js`、`test/v6-ui-selection.test.js`、`test/v6-ui-structure-neutral.test.js` |
| 审计与交付证据 | `docs/V6_SETUP_EXPECTATIONS_AUDIT.md`、本报告、`docs/qa/v6-setup-expectations/` 内截图索引、30 张 PNG、2 份合成备份、浏览器结果、冻结边界哈希、测试日志与验证清单 |

现有测试按新的可创建枚举更新；历史生命周期仍以明确的历史 fixture 验证，没有删除历史兼容覆盖。

## 4. 数据结构审计结论

[实现前审计与测试矩阵](V6_SETUP_EXPECTATIONS_AUDIT.md)采用 Level 1 有界扩展；复用 `records[]`、事务、事件序号、Unified 存储与研究适配，不建立第二份可写交易事实源，不引入新依赖。

新事件沿用严格判别联合。完整混合链先验证所有字段、record 归属、序号、时间、重复提交及更正引用，再构造 detached V5 view 执行既有生命周期/止损规则。该临时视图只压缩旧事件 ID 并同步转换引用，canonical 的 ID、内容和顺序均不改写。旧 writer 只把本次新增事件取回，不用投影视图覆盖完整历史。

`singleRecordV5View` 中新 Setup 的临时占位仅用于生命周期验证，不形成研究策略映射。未知事件、额外 payload、非法引用、错误时间或伪造快照均拒绝。

## 5. 新大偏见 key

| 顺序 | 内部 key | 显示 |
| --- | --- | --- |
| 1 | `breakout_strong_pullback_weak` | 突破强&回调弱 |
| 2 | `breakout_weak_pullback_strong` | 突破弱&回调强 |
| 3 | `htf_range_v2` | 震荡 |

震荡复用原 key，含义保持原样。旧 `trend_pullback_stronger` / `trend_pullback_weaker` 继续保留原义；没有重命名旧记录。仍使用旧分类的卡片需要主动选择新大偏见后登记新机会，已有 pending/active Trade 可以继续操作。标题、辅助说明、小偏见和方向保留；大偏见使用中性色。

## 6. 新 SPB / CPB / BOF key

| key | 完整显示文案 |
| --- | --- |
| `spb` | SPB（观察结构背离、rsi、PD array） |
| `cpb` | CPB（做多等收敛 做空等扫高） |
| `bof` | BOF（行为是真突破 预期会失败） |

新建只允许三者，Desktop/Mobile 三列等宽；390/375/320 实测均可以并排自然换行，无省略、隐藏或按钮内容溢出。每次登记生成独立 record；同 Setup、同方向可以多笔持仓。

## 7. 旧数据兼容结果

V5/V6 旧备份继续走原恢复/迁移链。历史 `mtf_pb`、`mtf_bof`、`htf_bof`、`htf_pb` 及原正式 legacy 类型继续可读；原始 ID、type、时间、结构快照、Initial Stop、BOF→PB 和撤销事件保留。旧 pending、active、closed 生命周期及混合事件写入回归通过，不自动生成预期或“待观察”。

兼容方向明确：**本候选可以读旧数据；旧程序无法识别新增枚举/事件，会 fail closed**。有新增记录后，旧版本回退不能直接读取新备份。回退前应保存本候选完整备份；没有执行降级转换或破坏性迁移。

验证使用仓库测试 fixture 和隔离浏览器的合成备份；本轮没有读取、清理或改写生产 origin 的真实 localStorage。

## 8. 入场预期事件结构

事件公共结构保持六个字段：

```js
{
  id: `${record.id}:manual-N`, // N 为该 record 全部人工事件的总序号
  type: 'ENTRY_EXPECTATION_RECORDED', // 或 ENTRY_EXPECTATION_CORRECTED
  recordedAt: actualSaveTime,
  effectiveAt: actualSaveTime,
  source: 'manual_intraday',
  payload: {
    recordId, submissionId, timing,
    htmlEnteredAtAtRecording, htmlEndedAtAtRecording,
    content: { path, keyLevels, focus }
  }
}
```

三个字段 trim 后各最多 200 Unicode 字符，可独立为空，但至少一项有效。空预期不阻断登记、入场或退出。首次保存只有一个 `ENTRY_EXPECTATION_RECORDED`。

更正事件在上述 payload 中追加 `originalEventId`、`previousEventId`、`originalRecordedAt`、`originalContent`、`previousContent`。新事件 ID 和 `recordedAt` 表示本次更正，不覆盖首次内容；当前版本由事件链确定。

## 9. 持仓跟踪事件结构

公共事件结构相同，type 为 `HOLDING_EXPECTATION_UPDATED`，payload 为：

```js
{
  recordId, submissionId, timing,
  htmlEnteredAtAtRecording, htmlEndedAtAtRecording,
  status, // observing / met / exceeded / underperformed
  reason  // 可为空，trim 后最多 200 Unicode 字符
}
```

状态仅为待观察、符合预期、超出预期、不及预期。默认无事件；相同状态允许不同次观察重复保存。每次新增事件，绑定独立 record ID。已结束 Trade 拒绝普通持仓更新。判断不会改变交易、止损或管理状态，也不生成因果推断。

## 10. 原始预期不可覆盖验证

重复首次写入拒绝；多次更正严格核对 original/previous 引用与内容；错误引用、篡改原始内容、重复 submission 和额外字段均有负向测试。A/B 同品种交易分别保存的字节隔离测试与实际浏览器检查通过。旧止损/BOF 事件与新预期交错后继续更正、转换及撤销，既有事件不丢失。

这里的不可覆盖指应用命令与严格事件链约束；不声称客户端存储具有密码学防篡改能力。

## 11. 补录时间识别结果

- `before_html_entry`：HTML 入场确认前。
- `after_html_entry`：入场后补录，依据 HTML 确认。
- `post_close_review`：结束后复盘补写。

首次和每次更正分别保存当时的 enteredAt/endedAt 快照，后续入场/退出不重写原标记；同毫秒前后操作有专门测试。用户表单没有倒填时间入口，使用实际保存时钟。持仓观察显示为“持仓期间记录（依据 HTML 确认）”。上述均为 Manual Decision Truth，不等同 Tradovate 真实成交时序。

## 12. Desktop 拖动与位置记忆

首页独立 DOM host，单实例、非模态、无蒙层、无 body 滚动锁；背景登记、入场、旧 BOF→PB/撤销及商品操作保持可用。卡片和 Chime 重绘不会销毁草稿。

标题栏采用 pointer capture；松开后将 `{version:1,x,y}` 保存至纯 UI 键 `intraday-task-cards:expectation-panel-ui:v1`。不进入 manualEvents 或 Unified 交易事实。实际 Chrome 验证关闭重开、刷新、换 Trade 共用位置；窗口缩小、CSS 125% 缩放、越界夹紧和重置通过。位置保存失败会提示，表单仍可操作。

窗口/visualViewport 改变触发重新夹紧；物理外接显示器拔除及跨显示器移动未实测。缩放验证使用 CSS zoom 模拟，没有宣称覆盖全部 OS/浏览器缩放组合。

## 13. Mobile 底部抽屉

明暗主题下 390×844、375×844、320×844 均实测：抽屉位于当前首页，内容独立滚动、保存/取消可达、关闭后背景滚动位置恢复、无根页面横向溢出。未保存草稿在关闭/换 Trade/模式时提供保留或放弃提示。

使用 visualViewport resize/scroll 更新抽屉高度并滚动焦点。390×430 的缩小视口模拟检查通过，截图明确标为 simulation。**真实 iOS/Android 输入法弹出、焦点及保存按钮行为仍为 NOT VERIFIED**，不能据此宣称真机键盘验收通过。

## 14. 导出、恢复与 CAS

JSON、Unified V2 全备份、启动读取、Markdown 和新增“导出交易预期 CSV”保留每笔原始 Setup、全部入场版本、全部持仓判断、HTML 确认时间及原有人工事件。Markdown 包含完整 Manual Decision Truth JSON；CSV 中历史字段为可恢复 JSON。`weeklyDecisionReview` 返回 detached 只读数据，无第二份可写事实。

自动化覆盖 JSON/Unified round-trip 与 Markdown/CSV 内容恢复。实际 Chrome 在明暗两主题均完成 UI 下载完整备份并重新导入，全部 records 相等；2 份下载文件保存在证据目录。

复用 expectedRaw/revision 比较及写后 readback。自动化和真实双标签检查均证明冲突不能追加事件；注入 quota/readback 故障后无成功提示，原始 canonical 与草稿保留。相同 submissionId 的相同提交不追加，冲突复用拒绝。此为现有同步 localStorage 边界，不宣称跨进程原子锁或覆盖所有同时写入调度。

## 15. Exit Research 兼容与分类未决

原始 Setup 与完整人工历史在 Research Trade / Matching UI / filters / CSV 保留；新增独立 SPB、CPB、BOF 筛选，不归入旧 PB 或旧 BOF。

三种新类型统一标记 `PENDING_HUMAN_REVIEW`，`researchSetupClass=null`，`strategyComparisonEligible=false`，Replay 状态 `SETUP_CLASSIFICATION_PENDING`，结果列表为空，不继承策略参数，不开放 BOF→PB。匹配事实与分类裁决分开显示。新类型即使成交质量完整，也不显示为正式可比较。

仅在只读适配内，为冻结匹配准备 detached 生命周期视图，并在 Replay 入参副本中去除三个已知的预期事件。canonical / Research Trade 完整事件仍保留。旧 Trade 在加入预期事件前后，market metrics 与 Replay 结果完全一致的回归通过。

**M3 重叠成交归属阻断保持**；没有改 Tradovate parser、归属算法、R、MFE/MAE、Market Bundle、Lookahead QA 或 Policy Replay。48 个保护文件与 Base 逐字节相同，`src/model.js` 从 STAGES 起的冻结函数也逐字节相同，详见 [冻结边界哈希](qa/v6-setup-expectations/frozen-boundaries.json)。

## 16. 全部自动化结果

- Base：1057/1057。
- 候选：**1114/1114 PASS，0 fail，0 skipped**。
- 新专用文件 53 项，另外既有枚举矩阵扩展增加 4 项。
- 覆盖严格混合链、旧备份/生命周期、多笔交易、Initial Stop、BOF→PB/撤销、导出恢复、故障保护、研究分类与旧 Replay 结果，以及 Risk / Chime / macOS Helper 既有 Web 测试。
- [完整测试日志](qa/v6-setup-expectations/automated-tests.log)。未重新开发或运行原生 macOS Helper；本次只验证既有 Web 侧回归。

## 17. Build / Bundle Syntax / Diff Check

`npm run build`、`node --check dist/app.bundle.js`、`node --check scripts/qa-v6-expectations.mjs`、`git diff --check` 均通过。构建产物与源码一起提交；[验证清单](qa/v6-setup-expectations/verification.json)记录 bundle 和证据 SHA-256。

## 18. Desktop / Mobile Light / Dark 实际截图

[截图画廊](qa/v6-setup-expectations/index.html) / [逐图索引](qa/v6-setup-expectations/README.md) / [浏览器检查原始结果](qa/v6-setup-expectations/results.json)。实际系统 Chrome 154.0.8037.99，headless、隔离 profile、临时 loopback origin，只有合成记录。

Desktop 每主题 10 张：pending 未写、入场预期面板、pending 已写、active 未写、active 已写及跟踪、更新面板、完整历史、拖动位置、重开位置、研究分类待确认。

Mobile 每主题 5 张：390/375/320 抽屉、390 关闭后滚动恢复、缩小视口键盘模拟。共 30 张，真实浏览器捕获，没有绘制效果图代替截图。

26 组浏览器检查全部完成。非故障场景新增 console error/warn 为 0；故意注入的 quota/readback 失败产生 4 条预期诊断，单独列于 `expectedFaultDiagnostics`，没有隐去或计作正常成功。

## 19. schemaVersion / migration

Intraday **schemaVersion=6**、Unified **version=2** 保持；record 外层结构和现有存储键保持；只扩展新枚举及严格事件类型。`src/intraday-v6/migration.js` 和 `src/capture-unified.js` 与 Base 逐字节相同。没有新增版本迁移，没有自动改写旧生产记录，也没有放宽未知事件或任意 payload 的接受条件。

## 20. 人工裁决与停止点

1. SPB / CPB / BOF 的正式研究分类、策略继承与转换规则仍需人工裁决；当前统一阻断正式策略比较。
2. 真机 iOS/Android 键盘、物理显示器变化及实际浏览器缩放仍需人工设备验收；当前有视口/CSS 缩放模拟证据。
3. 含新枚举/事件备份的旧程序回退限制需要 Review 时确认；本轮没有降级或破坏性迁移。

本地候选与证据交付后停止，等待 Chat/Human Review。**NO PUSH / NO MERGE / NO DEPLOY。**
