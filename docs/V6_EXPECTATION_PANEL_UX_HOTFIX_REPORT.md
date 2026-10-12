# V6 Expectation Panel UX Hotfix — Local Candidate

验证日期：2026-10-12。状态：完成本地实现与验证，等待 Chat/Human Review。

## 分支与基线

- Branch：`codex/v6-expectation-panel-close-guard`
- Base：`00aa5971a9f51c941b06c5b883e3966113fa2072`
- Candidate：包含本报告的本地 Git commit；完整 SHA 随交付回复提供。
- 开始时工作区 clean。本地 main 与 origin/main 引用均为 `975b5095de22686a609a0f2313c0114a1eb81fd3`。
- 按本轮明确要求从 `00aa597` 创建分支，没有合入 `975b509` 的大/小偏见文案补丁。因此截图显示指定旧基线的辅助文案；本候选与当前 main 为分叉关系，不能直接快进发布。main 未被覆盖。
- 本轮未执行 push、merge、deploy，也未重新冻结数据模型。

## 最终交互

面板保持 `aria-modal="false"`，没有新增遮罩、页面滚动锁或焦点陷阱。外部点击直接关闭干净面板；内部输入、按钮、标签、更正入口与历史展开均保持打开。关闭按钮和全局 ESC 使用同一关闭保护。

关闭请求发现草稿修改时显示「存在未保存修改」，提供「保存并关闭 / 继续编辑 / 放弃修改」。保存并关闭复用原保存回调及原校验、提交 ID、版本检查、写入锁，只有 `ok:true` 才关闭。失败、无效内容、存储写入失败和冲突都保留草稿及面板。放弃修改仅清理 UI 草稿，重新打开恢复已保存内容。

切换分区或 Trade 时保留原有「保留当前草稿 / 放弃草稿并继续」流程，不把 A 的草稿带入 B。离开首页且存在草稿时，确认区仍可见，避免导航把未保存表单隐藏。

外部点击判断同时检查 `target` 包含关系、事件原始路径和 pointer 按下起点。这样可兼容标签重绘后的键盘点击、面板内开始的选字/拖动和拖动释放。原拖动、位置存储键、重置与视口调整逻辑保留。外部关闭不抢回主页焦点；按钮/ESC 关闭保留原入口焦点恢复。

确认区仅调整面板内部按钮排列，并正确隐藏切换流程不使用的保存按钮。未调整商品卡片或其他模块样式。

## 修改文件

| 文件 | 修改内容 |
| --- | --- |
| `src/expectation-panel.js` | 关闭请求、未保存确认、复用保存处理、外部点击和全局 ESC |
| `refinement.css` | 仅确认区按钮紧凑排列及 hidden 显示规则 |
| `dist/app.bundle.js` | 从源代码重新生成 |
| `scripts/qa-v6-expectation-close.mjs` | 新增真实 Chrome 交互与失败保护测试 |
| `scripts/qa-v6-expectations.mjs` | 原回归中的外部点击预期改为关闭；保留 BOF 行为回归 |
| 本报告及 `docs/qa/v6-expectation-close/` | 浏览器截图、测试日志、边界校验、截图索引 |

完整路径清单见 [changed-files.txt](qa/v6-expectation-close/changed-files.txt)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全部现有自动化测试 | **1175 / 1175 PASS**，0 fail / skipped |
| 新增 Chrome 检查 | **116 PASS**；1440 Light/Dark、390 Light/Dark |
| 既有预期浏览器回归 | **26 PASS**；包含存档失败、回读失败、双标签冲突、历史、导入导出、位置与路由 |
| Build | PASS |
| Bundle / Source / QA Syntax | PASS |
| Diff Check | PASS |
| 非预期浏览器错误或警告 | 0；注入 quota 故障的诊断单独记录 |
| 冻结边界 | **350 / 350 原有受保护文件字节一致** |
| 浏览器截图 | **38 张**；包括打开、外部/ESC 关闭、未保存确认、放弃、保存、失败、拖动、刷新恢复与手机视口缩小 |

Chrome 版本：`154.0.8037.99`。仅使用随机 localhost origin、独立浏览器 context 和合成数据；未使用 Safari 生产页面或真实生产存档。

### 用户指定的 20 项覆盖

| # | 场景 | 结果与证据 |
| --- | --- | --- |
| 1 | 关闭按钮 | clean 关闭；dirty 使用三选项确认 |
| 2 | 外部自动关闭 | 页面外部点与桌面商品卡片点击 |
| 3 | 内部点击不关闭 | 标题点击、内部操作均保持打开 |
| 4 | input 不关闭 | textarea 实际点击与编辑 |
| 5 | tab 不关闭 | 鼠标点击及键盘 Enter；重绘后仍打开 |
| 6 | 历史展开不关闭 | 实际 summary 点击 |
| 7 | ESC 无修改关闭 | 四组主题/视口均覆盖 |
| 8 | ESC 有修改确认 | 三项入场预期内容同时修改 |
| 9 | 外部有修改确认 | 鼠标外部点击及手机触摸 |
| 10 | 保存并关闭成功 | 首次记录、更正和持仓更新；事件增量类型正确 |
| 11 | 放弃恢复草稿 | 重开恢复 path/keyLevels/focus 的已保存值；canonical 字节不变 |
| 12 | 继续编辑 | 原草稿及面板保留 |
| 13 | 拖动不关闭 | 实际 pointer 拖动；面板内选字开始、外部释放也不关闭 |
| 14 | 刷新位置记忆 | 实际刷新后 x/y 与拖动后相等；重置可用 |
| 15 | Mobile 外部关闭 | Chrome 触摸模拟实际 tap |
| 16 | Mobile 输入不误关 | 点击/填写 textarea；缩小视口后草稿保留 |
| 17 | 原有事件历史不改变 | 保存前后原事件逐项相等；关闭/放弃/拖动不写 canonical |
| 18 | 保存失败不关闭 | 实际 Unified quota 写入异常；原存档字节及草稿保留 |
| 19 | CAS 失败保留草稿 | 同 context 两个真实标签页；另一页写入后旧页锁定，保存关闭被拒绝，草稿保留 |
| 20 | 多 Trade 切换隔离 | A 草稿可保留，放弃后 B 不继承；其他 Trade 记录逐项不变 |

额外覆盖：持仓原因单独修改触发保护、必填状态校验、面板外焦点的全局 ESC、手机背景滚动、未保存情况下导航到 Risk 的确认可见性。

## 截图与证据

- [截图浏览页](qa/v6-expectation-close/index.html)
- [1440 Light](qa/v6-expectation-close/1440-light-02-esc-unsaved.png) / [1440 Dark](qa/v6-expectation-close/1440-dark-02-esc-unsaved.png)
- [390 Light](qa/v6-expectation-close/390-light-03-outside-unsaved.png) / [390 Dark](qa/v6-expectation-close/390-dark-03-outside-unsaved.png)
- [新增浏览器结果](qa/v6-expectation-close/browser-results.json)
- [既有浏览器回归结果](qa/v6-expectation-close/regression-results.json)
- [自动化测试日志](qa/v6-expectation-close/automated-tests.log)
- [验证汇总](qa/v6-expectation-close/verification.json)
- [冻结文件 SHA-256 对账](qa/v6-expectation-close/frozen-boundaries.json)

手机使用 Chrome 触摸模拟；视口缩小模拟键盘占用。真实 iPhone/iOS Safari、真实软键盘弹出及物理设备拖动未验证。没有将模拟结果声明为真机验收。

## 严格边界确认

**NO SCHEMA CHANGE / NO DATA MODEL CHANGE / NO BUSINESS LOGIC CHANGE / NO MIGRATION CHANGE / NO HELPER CHANGE**。

`src/app.js` 的保存入口、所有 `src/intraday-v6/` 模块、Unified 持久化、manualEvents 定义、SPB/CPB/BOF、研究/Risk/Chime/Helper/Replay/MFE/MAE/Adapter 均保持基线字节一致。重建 bundle 的修改仅来自面板 UI 模块。关闭和放弃操作没有调用业务变更或 canonical 保存。

本地候选已完成；后续发布等待独立 Chat/Human Review 授权。
