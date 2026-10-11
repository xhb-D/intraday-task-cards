# V6 Setup V2 + Expectations V1｜F01–F04 有界修复交付

日期：2026-10-11。状态：**LOCAL_CANDIDATE / READY_FOR_INDEPENDENT_REVIEW**。本轮按用户最新裁决修复原 BLOCK 候选，不标记 FROZEN，不推送、合并或部署。

本报告中的业务裁决替代原候选审计契约中“新 Setup 不开放任何人工转换”的局部规定；原报告、原审计文件和原提交保留作对照。正式研究分类仍未获裁决。

## 1. 原 Candidate SHA

`eb80e9ace0784a40beacef2e870e6e821b026f58`，原分支 `codex/v6-setup-expectations-v1` 保持该提交。生产比较 Base：`ef54f29e48d1de7e2f7a87840a6f0aa3cd2df72e`。

已读取两份原交付文件及独立审计 `V6-Setup-Expectations-Independent-Audit-20261011/V6_SETUP_EXPECTATIONS_INDEPENDENT_AUDIT.md`。修复前已跟踪文件均与原候选一致；两个原有未跟踪 `.DS_Store` 文件保留原状。

## 2. 新 Candidate SHA

分支：`codex/v6-setup-expectations-remediation`。精确新 SHA 见本轮交付消息；本报告、代码和证据在同一新本地提交中，父提交为上述原候选。本轮不改变原候选分支，不声称重新审计了线上部署。

## 3. 修改文件清单

完整清单：[changed-files.txt](qa/v6-remediation/changed-files.txt)。主要文件：

| 范围 | 修改 |
| --- | --- |
| 历史保留与查询 | `src/intraday-v6/model.js`（禁止删除）、`queries.js`、新增 `src/history-archive.js` |
| 新管理事件、严格验证与派生状态 | `src/intraday-v6/expectations.js`、`model.js`、`index.js`；现有 `validation.js` 调用严格混合链校验，文件本身未改 |
| 首页/档案路由接入 | `src/app.js`、`src/capture-ui.js`、`src/router.js`、`index.html`、`refinement.css` |
| 面板必要显示改动 | `src/expectation-panel.js` 仅 historyHtml：新事件文字及确定性排序；该函数之外逐字节不变 |
| Research 有界适配 | `src/exit-research/ui/capture-adapter.js`、`view-model.js`、`render.js` |
| 构建 | `scripts/build.mjs`、生成的 `dist/app.bundle.js`；全部资源更新同一缓存版本 |
| 新回归/验证工具 | `test/v6-remediation.test.js`、`scripts/qa-v6-remediation.mjs`、`scripts/verify-v6-recovery.mjs` |
| 既有测试必要适配 | 模型删除测试改为拒绝；Capture 历史断言改为独立档案/当前卡片；导航、资源版本及旧删除入口断言更新，其他断言保留 |
| 原浏览器脚本 | `scripts/qa-v6-expectations.mjs` 仅将结束历史入口改为档案路由并返回首页，原 26 组功能检查继续执行 |
| 文档/证据 | 本报告、恢复说明、`docs/qa/v6-remediation/` 的日志、原始结果、截图、合成下载文件和哈希 |

## 4. F01–F04 修复详情

| 问题 | 实现 | 证据 |
| --- | --- | --- |
| F01 历史硬删除 | 首页只保留当前卡片和档案/研究入口；结束记录不在首页列表。新增 `#/history` 查询同一 `records[]`；删除按钮及 handler 移除，V6 deleteRecord 对结束记录抛 `V6_RECORD_DELETE_FORBIDDEN`，活动记录继续拒绝删除。取消/失效机会同样保留 | 结束/取消/失效、导出、刷新、旧删除伪造点击、独立档案和恢复保护回归；真实浏览器查询 |
| F02 新 BOF 人工转换 | 原始 `bof` 保持，追加一次 BOF→SPB 或 BOF→CPB；当前管理由事件确定，SPB/CPB 默认同名管理。没有反向、横向转换或新撤销按钮 | 严格联合负向测试、混合事件、A/B 隔离；Desktop/Mobile 两种转换实际操作 |
| F03 CSV 公式前缀 | 危险文本用 `csv-text:` + JSON 字符串编码，CSV 再正常双引号转义；可逆解码，canonical 不变 | `= + - @`、控制字符、Unicode 格式字符/空白、保留前缀、引号/换行和错误编码测试；实际 CSV 下载 |
| F04 同刻排序 | 只读时间线按 recordedAt、HTML 快照阶段、原人工顺序确定；入场前→HTML 入场→持仓期间→HTML 结束→复盘 | 全部同毫秒单元测试及原候选/新候选真实 UI 对照；canonical 字节相等 |

额外检查了批量清理和恢复入口：新建/切 Setup、单笔退出和全部平仓只结束记录；V6 不再有 records.splice。旧 V5 兼容模块仍保留冻结旧函数，但生产交互只走 V6 facade，没有旧删除 UI 入口。风险账户删除不涉及交易 records，本轮不修改风险算法。

恢复预览及确认前检查现有已结束档案：缺记录、结束事实变化、已有人工事件前缀被缩短/改写时拒绝；空白工作区路径也受此检查。没有重构 Unified persistence，没有自动合并。完整当前备份、保留前缀的明确复盘追加、只恢复风险的备份仍可通过。不能用恢复旧备份静默删除新历史。

## 5. 新 BOF→SPB/CPB 事件结构

```js
{
  id: `${record.id}:manual-N`, // 同一 record 全部人工事件连续序号
  type: 'BOF_MANAGEMENT_SWITCH_RECORDED',
  recordedAt: actualSaveTime,
  effectiveAt: actualSaveTime,
  source: 'manual_intraday',
  payload: {
    recordId,
    submissionId,
    timing: 'after_html_entry',
    htmlEnteredAtAtRecording: record.enteredAt,
    htmlEndedAtAtRecording: null,
    from: 'BOF',
    to: 'SPB' // 或 'CPB'
  }
}
```

普通 UI 在保存动作采样本地浏览器时钟，无时间编辑入口。只允许原始 bof、HTML 已入场且未结束、从未转换的记录。字段集合、来源、from/to、身份、时间/快照、事件序号及 submissionId 都严格校验；同 token 同内容重试 no-op，冲突重用拒绝。普通第二次转换拒绝；已结束时只有原幂等重试可返回既有事件，不追加。

原始 Setup 始终来自 canonical `record.type`，没有新增可写 currentManagement 字段。`currentManagement` 是纯派生查询及只读导出字段。新事件不改变 Initial Stop、入场预期、持仓判断或退出事实。

## 6. 新旧转换兼容矩阵

| 原始 Setup / 状态 | 当前人工管理 | 允许操作 |
| --- | --- | --- |
| spb | SPB | 无转换；预期、止损、观察、退出继续 |
| cpb | CPB | 无转换；预期、止损、观察、退出继续 |
| bof 未转换且持仓中 | BOF | 一次转为 SPB 或 CPB |
| bof 已转 SPB / CPB | 所选管理方式 | 不反向、不横向、不撤销 |
| bof pending / ended | 原事件派生值 | 不允许普通管理转换 |
| mtf_bof / htf_bof / htf_pb | 原正式 BOF/PB 派生状态 | 原 BOF_TO_PB_RECORDED / REVERTED 保持 |
| 其他历史类型 | 原正式规则 | 没有新增转换权限 |

新旧转换事件不会互相改名或复用。detached V5 投影过滤新增管理事件，继续映射旧撤销引用；canonical ID、内容、顺序不压缩。旧研究回归继续通过。

## 7. 历史档案 UI 与数据保留证明

首页“历史档案 →”进入 `#/history`，复用原路由/返回入口、主题和表格布局；窄屏按字段纵向排列，查看按钮在可视宽度内。查询支持品种、原始 Setup 显示名、ID 和人工内容；只选择 `endedAt !== null` 的记录，包括 canceled/invalid。它没有独立存储键或写入副本。

打开“预期与完整历史”默认无编辑表单、无持仓更新。已获允许的“入场预期”分区和“更正”仍是明确的复盘操作，保存后带 post_close_review 标记。记录查询和时间线展示不写 canonical。

JSON / Unified、全部 Markdown、CSV、weeklyDecisionReview 保留全部 records。今日 Markdown 继续原有范围过滤，不改写数据；全量归档应使用“全部 Markdown”或完整备份。实际恢复证明见两主题的 `*-recovery-verification.json`：7 records、5 ended、14 manualEvents，下载/空白环境恢复前后逐项相等。

## 8. CSV 安全验证与恢复身份

导出列保持原前 9 列，追加 `current_management` 和 `text_encoding=csv-text-prefix-v1`。所有文本单元格经过统一编码器：以 `= + - @`、apostrophe、空白/控制/格式字符起始，包含控制/格式字符，或本身以保留前缀 `csv-text:` 起始时，编码为 ASCII 前缀加 JSON 字符串。保留前缀也编码，避免解码歧义。

机器读取时先正常解析 CSV，再对单元格执行 **一次** `decodeDecisionCsvText`，需要历史对象时再 JSON.parse。错误编码或非字符串身份拒绝。示例：

```js
const parsed = parseCsv(csvText);
const identity = decodeDecisionCsvText(parsed.rows[0].values[0]);
const events = JSON.parse(decodeDecisionCsvText(parsed.rows[0].values[7]));
```

没有修改原始 record ID、JSON 备份或事件 payload；也没有新建 CSV→canonical 的写入入口。实际 CSV 下载中 `\t=1+1` 被安全编码且恢复为同一原始身份。没有在 Excel/其他表格软件中执行公式，不把文件级防护测试称作所有表格客户端行为验收。

## 9. 同毫秒顺序验证

`manualDecisionTimeline` 返回 detached 列表；按 recordedAt 先排序。同刻阶段顺序为：0 入场前快照 → 1 HTML 入场事实 → 2 持仓期间人工事件（旧事件亦归此阶段）→ 3 HTML 结束事实 → 4 复盘事件。阶段内保留 canonical manualEvents 顺序。

实际 UI 验证六行：首次预期 → HTML 入场确认 → 更正 → 持仓判断 → HTML 退出/结束确认 → 复盘更正。没有更改 recordedAt、effectiveAt、event ID、payload 或引用。原候选对照截图仍显示旧错序，见画廊。

## 10. Exit Research 阻断验证

spb/cpb/bof，包括已经人工转 SPB/CPB 的 bof，仍为 `researchSetupClass=null`、`PENDING_HUMAN_REVIEW`、`strategyComparisonEligible=false`、`SETUP_CLASSIFICATION_PENDING`、`replays=[]`。完整 fills / bundle / hardEnd 也不能赋予策略资格；原 Setup 与 HTML 人工管理分别显示。

Research Trade / Manual Decision Truth 保留新增事件；只读 Replay 入参副本过滤四种已知新增人工事件。未知事件仍拒绝。旧 BOF 转换/撤销、原预期混合链和旧 Replay 结果回归通过。M3 重叠记录即使人工确认匹配，仍保持 NO_MATCH / BLOCKED / `V6_OVERLAP_EXECUTION_UNSUPPORTED`。

48 个保护文件与 Base、原候选均逐字节相同；包括 Tradovate、Logical Trade、R、MFE/MAE、Market Bundle、Replay、Lookahead QA、Risk、Chime、migration 和 Unified persistence。`src/model.js` 完整文件未改。详见 [冻结边界](qa/v6-remediation/frozen-boundaries.json)。

## 11. 自动化测试

- 原候选：1114 项。
- 开发前 F01–F04 初始回归 17 项 FAIL（保留 RED 日志）。
- 新专用回归：60 项 PASS；新增 history 路由返回测试 1 项。
- 最终全部：**1175/1175 PASS，0 fail、0 skipped**。
- Build、Bundle Syntax、两份 QA 脚本及恢复校验脚本 Syntax、Diff Check 通过（CSV 下载原件的 CRLF 按 cr-at-eol 识别，未改写下载内容）。
- [完整测试日志](qa/v6-remediation/automated-tests.log)、[构建日志](qa/v6-remediation/build.log)、[验证清单](qa/v6-remediation/verification.json)。日志仅规范化行尾空白，完整输出内容保留。

## 12. 浏览器 QA

实际系统 Chrome 154.0.8037.99、headless、临时 localhost、新 profile、合成记录；没有读取或写入生产浏览器交易存储。

- 原 26 组回归全部通过，30 张新截图，覆盖拖动/记忆/重置/草稿/Chime 重绘/双标签/失败保护/恢复及 Mobile 390/375/320 明暗抽屉。
- 新 20 组定向检查全部通过，30 张截图，含原候选对照、档案、转换、同刻显示、CSV 下载、两份存档恢复和 Mobile 390/320 的转换与档案。
- 总计 **46 组、60 张截图**，正常场景新增 console error/warn=0。原回归故意注入 quota/readback 的 4 条预期错误诊断独立保留。
- [截图画廊](qa/v6-remediation/index.html) / [逐图索引](qa/v6-remediation/README.md) / [原回归结果](qa/v6-remediation/regression/results.json) / [定向结果](qa/v6-remediation/targeted/results.json)。

面板拖动、位置存储、几何处理、草稿流程和表单布局未重做；historyHtml 外代码逐字节相同，原 refinement.css 内容也完整保留，仅追加档案 CSS。

## 13. 备份与恢复方案

[可执行恢复说明](V6_EXPECTATIONS_RECOVERY.md)提供：发布前两份完整备份、只读有效性检查、隔离恢复演练、单可写标签、旧代码 fail-closed、独立 Research Store 保全、缺历史备份拒绝规则、前向代码恢复及页面失效时的只读原始下载。

实际两主题 UI 下载并恢复 Unified 与独立 Research Store，包含非空人工决定、设置和新筛选。旧 Base 与原候选不支持对应新事件时实际保持原始 raw 并进入 recovery-required。禁止剥离事件或改 Setup 降级。

## 14. schemaVersion / migration

Intraday=6、Unified=2 保持，没有新 migration，没有生产数据迁移，没有放宽旧 validator 或任意字段。新增事件在原严格六字段结构内作为明确判别分支；更旧程序能力不足时 fail closed。只承诺新版读旧的单向兼容。

## 15. 残留风险与人工事项

1. SPB/CPB/BOF 正式研究分类与策略继承仍未裁决，相关比较持续阻断。HTML 转换权限本轮已裁决，不再与研究分类耦合。
2. 真实 iOS/Android 输入法、触摸/系统安全区、物理显示器变化及浏览器工具栏原生缩放未验收；现有证据为实际 Chrome 视口/CSS zoom 模拟。
3. 既有 localStorage CAS 非跨上下文原子锁；保持一个可写标签约束，不声称修复极限并发窗口。记录时间来自本地浏览器时钟，不是外部可信授时。
4. 管理误操作的可追溯更正事件未获本轮授权，未新增撤销或反向转换；需要时另行裁决。
5. 结构校验/正常 UI 的永久保留不等于密码学防篡改或浏览器磁盘故障恢复。独立离线备份仍必要。
6. 两个原有 `.DS_Store` 未跟踪文件未改、未纳入提交。已跟踪改动与本轮证据均提交在新候选。

本轮到此停止，等待新 Candidate 独立复审。**NO PUSH / NO MERGE / NO DEPLOY。**
