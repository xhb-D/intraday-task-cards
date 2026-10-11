# Setup V2 / 交易预期 V1 有界架构审计与实施契约

日期：2026-10-11。Level 1 局部扩展；依据本轮用户明确的兼容实现授权，不启动新系统或替换既有引擎。实际 `git fetch origin` 成功；HEAD / origin/main 均为 `ef54f29e48d1de7e2f7a87840a6f0aa3cd2df72e`，开始时工作区干净。基线自动化 1057/1057。

## 审计结论

- FACT：V6 `records[]` 是唯一交易事实源，cards 无交易副本；commands 经 candidate preflight 原子修改；Unified V2 的 expectedRaw / revision 检查和 readback 是现有保存边界。
- FACT：V6 当前使用 detached V5 view 验证生命周期及止损/转换事件；V5 事件只允许入场后、退出前，且仅接受五种既有事件。不能直接把 pending 预期塞入原校验器。
- FACT：Replay 的事件白名单不认识预期事件。完整事件送入 Replay 会被阻断；不能改冻结引擎来接受新含义。
- FACT：结构 V2 和旧 Setup 已有独立的可读/可创建边界。新分类不能重命名旧 key；htf_range_v2 仍表示原来的震荡，可继续复用。
- 兼容扩展：保留 Intraday schemaVersion=6、Unified=2、所有 record 字段和现有存储键；只扩展明确枚举和 manualEvents 的严格判别联合，不改变旧事件字段、ID、顺序或内容，不运行 V6→新版本迁移。旧程序遇到新增枚举/事件会 fail closed，不能用旧版本导入新增数据；回退需先导出新完整备份。此为兼容限制，不伪称双向兼容。
- Reuse Assessment：复用现有事务、事件序号、CAS/readback、持久化/迁移链、主题和只读适配。项目为 private、无显式 LICENSE；仅在用户自己的仓库内修改，不引入外部代码/新依赖。维护基线为本次 fetch 的 main，集成成本集中于校验投影、混合事件写回与 Replay 输入边界；技术债是两个小型 bundle linker 和既有同步 localStorage CAS（不能声称跨进程原子锁）。
- 未决：SPB/CPB/BOF 的正式研究分类全部待人工裁决；不提供 PB/BOF 转换或策略参数继承。保留匹配事实、原始 Setup 和人工历史，但正式策略比较显式阻断；M3 重叠持仓阻断保持。

## Business / Architecture contract

- 新大偏见按序：`breakout_strong_pullback_weak` / `breakout_weak_pullback_strong` / `htf_range_v2`。旧 trend_pullback_* 继续读取及导出原义；卡片未重新选择时仅阻断新登记，既有记录继续生命周期。
- 新建仅 `spb` / `cpb` / `bof`，三列等宽、完整自然换行（390/375/320 均优先并排）。旧 mtf_pb/mtf_bof/htf_pb/htf_bof 及既有 legacy types 可读。
- 事件仍为 `{id,type,recordedAt,effectiveAt,source,payload}`，ID=`record.id:manual-N`，N 为同记录所有事件的总序号。新 payload 明确 recordId 和 submissionId；recordedAt=effectiveAt 是保存时实际时间，无普通时间输入。
- `ENTRY_EXPECTATION_RECORDED` 首次不可覆盖，content={path,keyLevels,focus} 各上限 200 Unicode 字符，至少一项非空。
- `ENTRY_EXPECTATION_CORRECTED` 追加 originalEventId/previousEventId/originalRecordedAt/originalContent/previousContent/content 及当次时间标记，严格检查引用和内容一致。
- `HOLDING_EXPECTATION_UPDATED` 追加 status（observing/met/exceeded/underperformed）及可空 reason（200 字符），仅 entered 且未 ended；默认无事件，同状态可多次保存。
- 所有预期/更正记录 timing、htmlEnteredAtAtRecording、htmlEndedAtAtRecording。`before_html_entry` / `after_html_entry` / `post_close_review` 均只依据 HTML 确认时序；不解释为券商成交时序。结束后首次补写或更正显式为复盘补写，普通跟踪拒绝。
- 严格验证混合链全局 ID/归属/序号/时间/重复提交；仅在 detached V5 view 内压缩旧事件序号、映射旧转换引用、去除新预期事件，完成冻结生命周期/旧事件验证。canonical 永不改写。旧 writer 只取回新增的一项并恢复 canonical 序号和引用，避免覆盖混合历史。新 Setup 的验证占位仅用于 lifecycle，不能变成研究分类；显式禁止新 Setup BOF→PB。
- 新研究数据经只读适配保存完整人工历史。Replay 调用前仅复制并筛选批准的旧事件，canonical 和 Research Trade 全量事件不删除；数学内核、成交解析/归属、市场路径不修改。
- 面板为独立 DOM host，避免商品卡片/Chime 重绘销毁表单；单实例、非模态、无蒙层、背景可操作。Desktop pointer capture 拖动，独立版本 UI 偏好键记位置，resize/visualViewport 重夹紧；Mobile 固定底部抽屉，visualViewport 应对键盘，独立滚动，不锁 body。
- 切换记录/模式/关闭含草稿的面板须显式保留或放弃，不静默丢失；保存基于当前 Trade 生命周期重新校验，CAS/readback 失败保留草稿并显示失败，不显示成功。重复 submissionId 不追加。

## 开发前测试矩阵

| 分组 | 自动化与实际浏览器验收 |
| --- | --- |
| 结构/Setup | 新标签顺序与快照；旧 key 原义与旧生命周期；仅三种新建；同向多笔独立登记；新 Setup 无研究分类继承 |
| 入场预期 | pending 可空可写；补录时序；原始不可覆盖；多次更正引用；退出后复盘标记；200 字符/XSS；JSON round-trip |
| 跟踪 | 四状态；默认无事件；同状态多次；可空原因；A/B 隔离；退出后拒绝；逆时序/错误引用/重复 submission 拒绝 |
| 安全 | 全链严格 validator；append-only；旧事件夹杂新事件后 stop/correction/BOF/revert 不丢历史；CAS/双标签/readback/quota 失败不成功；V5/V6 启动/导入/完整导出恢复 |
| 浮动面板 | 首页无导航；非模态背景操作；拖动/关闭重开/刷新/换 Trade；缩小窗口/缩放/重置；草稿提示；Chime 与卡片重绘；桌面明暗截图 |
| Mobile | 390×844、375、320 明暗截图；底部抽屉/长内容/无横向溢出；关闭滚动位置；键盘若无真实设备只能标未验证 |
| 研究/回归 | 原始 Setup/完整人工事件/CSV；新分类待确认阻断；旧交易匹配/metrics/Replay 结果不变；重叠阻断；Risk、Chime Web、Initial Stop、BOF→PB、单笔/全部退出、路由 |
| 工程 | 全量 tests、build、bundle syntax、diff check、冻结引擎文件逐字节不变；实际浏览器 console error/warn |

本文件为实现前审计与可测试契约；最终结果另见交付报告。未宣称 FROZEN、未授权 push/merge/deploy。
