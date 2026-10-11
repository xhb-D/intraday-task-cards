# V6 预期与人工管理转换｜完整备份、恢复与代码回退说明

适用：本轮支持 `BOF_MANAGEMENT_SWITCH_RECORDED` 的新候选及明确保持该能力的后续版本。Intraday schemaVersion=6 / Unified version=2；**新版读旧，旧版不一定读新**。本说明不授权发布或实际生产恢复。

## 发布前：保全两份独立存档

1. 停止编辑，确认页面没有“尚未保存”、冲突或回读失败提示。导出前核对当前持仓与真实交易平台；本工具的 HTML 确认不等于券商成交。
2. 在当前正常页面点击顶部“导出 / 备份”→“完整备份 JSON”。保存为带日期的新文件，保留旧文件。它包含全部 `records[]`（包括结束、取消、失效记录）、风险管理、报时与外观。
3. 进入 Exit Research，点击“导出研究设置”。下载的 `Exit_Research_Store_V1.json` 包含独立 `exit-research:v1` Store 的 `manualDecisions`、研究筛选/选择和 `tradeOverrides`。**统一 JSON 不包含这份 Store**。
4. 单独保留研究原始 Fills / Orders / Position History CSV 和 Market Bundle。它们是研究工作台的内存输入，研究设置 JSON 不包含这些源文件。
5. 记录当前代码 SHA，以及本轮新候选的精确 SHA（见交付消息）。原候选 `eb80e9a…` 不支持新管理转换事件，不能作为含该事件数据的工作恢复版本。
6. 关闭同一存储环境中所有旧标签页、旧窗口和旧代码页面。随后只保留 **一个可写标签页**。storage 事件/expectedRaw/readback 会拒绝已可见的过期写入，不能保证所有并发调度都无丢失。

## 检查备份有效

在包含本轮新代码的本地目录执行只读检查；路径替换为实际下载文件：

```sh
node scripts/verify-v6-recovery.mjs '/完整路径/Unified.json' '/完整路径/Exit_Research_Store_V1.json'
```

脚本不写任何文件或浏览器存储。PASS 表示两份文件通过当前严格 validator，并输出 SHA-256、records/已结束记录/人工事件数量、研究决定/覆盖设置数量及筛选值。它不核验券商真实性，也不代替实际恢复演练。失败时保留原文件，不手动删字段以求通过。

在隔离浏览器 profile 中打开**支持新事件的版本**，执行下一节的恢复演练。生产存储保持原状，演练 profile 不作为第二个生产可写工作区。比对恢复后完整 records 与下载 JSON，抽查原始 ID、首次预期、更正、管理转换、持仓观察、止损、结束和取消/失效事实。

## 在支持新数据的版本恢复

1. 确认代码能识别四种新增人工事件，尤其 `BOF_MANAGEMENT_SWITCH_RECORDED`；不能只根据版本号“V6”判断能力相同。
2. 确认只有一个生产可写标签，且两个备份文件已验证、已另存。
3. 顶部“导出 / 备份”→“导入 JSON 备份”，选择完整 Unified 文件，检查预览后确认。导入前保存原统一存档快照 `trading-control-center:v1:pre-import`，并执行现有 CAS/readback。
4. 如果导入会移除现有已结束记录、改变已结束事实或缩短/改写既有人工事件前缀，页面会拒绝恢复。**不要清理存储来绕过保留检查**。保全两份原始备份，在隔离环境核对差异；需要合并或纠错时另行取得明确授权，本轮不自动合并。
5. 进入“历史档案”，用品种、Setup、ID 或人工文字查询，核对原始 Setup、当前人工管理和完整时间线。已结束记录默认只读；普通持仓观察与管理转换已关闭。复盘补写/更正仍按独立语义追加并标记。
6. 进入 Exit Research，在“导入研究设置”选择独立 Research Store 文件，检查预览后确认恢复。再导出研究设置，逐字段比对 manualDecisions、preferences 和 settings；统一存档恢复不会代替这一步。
7. 重新加载必要的成交 CSV / Market Bundle，重新核查既有质量门槛。新 Setup 的正式策略比较仍阻断；M3 重叠归属不能靠恢复或人工管理转换绕过。
8. 最后重新导出两份备份，运行只读检查，并与真实平台核对当前实际持仓。确认完整后才恢复日常编辑。

本轮实际演练在明暗两主题均通过：7 条 records、其中 5 条已结束、14 条人工事件；独立 Research Store 含 1 条人工匹配拒绝决定、1 项 tradeOverride 和 `SETUP_BOF` 筛选。两份存档在空白隔离 profile 中分别恢复，并与原下载内容逐项相等。该证据是合成数据，不是生产恢复。

## 旧网页代码回退后的处理

- Base `ef54f29e…` 不认识新 Setup/预期事件；原候选 `eb80e9a…` 不认识新增管理转换。真实测试均进入 `recovery-required`，原始 raw 保持不变。旧 Research UI 也可能拒绝新筛选值。
- 关闭旧页，不在旧页中开始空白工作区或继续编辑，不删除新事件、不改原始 Setup、不剥离研究决定。
- 优先恢复**仍支持新格式的代码版本**到同一 origin，并保留原浏览器存储。待另行批准代码发布后，重新打开兼容版本；有效现有 raw 可以直接读取，无须数据降级。
- 若存储损坏或丢失，使用经过验证且完整保全现有历史的最新 Unified + Research Store 两份文件，在支持新数据的版本恢复。只有旧的、不完整的备份时，停止写入并保全所有原件；不能把丢弃新历史包装成兼容恢复。
- 本轮新候选或支持同一事件集的前向修复版本才是恢复锚点。恢复旧网页代码与恢复旧数据是两件事；旧代码不能因为有新备份就继续编辑新格式。

## 页面完全无法打开时的原始保全

由操作者在**正确 origin 的浏览器控制台**执行以下只读下载。它不调用 setItem/removeItem/clear，不改原存储，也不输出数据内容；保存后用支持新数据的版本检查。某个键不存在时跳过，不伪造空 Store。

```js
for (const [key, name] of [
  ['trading-control-center:v1', 'Unified_raw_preserved.json'],
  ['exit-research:v1', 'Exit_Research_raw_preserved.json']
]) {
  const raw = localStorage.getItem(key);
  if (raw === null) continue;
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
```

原始文件若不能通过 validator，继续保留原件，交由受控修复处理。pre-import 快照和浏览器本地存储不能替代离线文件备份。
