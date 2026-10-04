# Exit Research V0 / Step 1 — 授权范围补充

日期：2026-10-04。基线：e25ba69a1b264b311e51101eb3d282ca59b632a0。
状态：用户已授权 Step 1 实现和独立开发分支本地 commit；等待人工验收，未 FROZEN。
本补充仅在该开发分支替代原统一规范中的日内版本及对应迁移说明。原机会分类、方向、偏见、结构、生命周期、风险和报时规则继续适用。

## 业务边界

- 只增加 Initial Stop、人工 BOF → PB 和 append-only Manual Event Log。
- 只在持仓显示录入 UI；未填写 Stop 不影响入场或全部平仓。
- Stop 只接受大于 0 的有限数值，不与 Entry 或 tick size 校验。
- 首次 Stop 使用当前时间；修正追加 oldValue/newValue，不覆盖旧事件。
- mtf_pb 为 PB，htf_pb/htf_bof 为 BOF；内部 key 和原始机会类型不变。
- BOF 持仓可以单击 BOF → PB；有效转换存在时隐藏转换按钮，提供轻量撤销。
- 撤销追加事件并引用原转换事件 ID；撤销后允许重新记录。只支持原始 BOF、人工转换及误触撤销，不引入自动判断或复杂管理状态网络。
- 完整事件进入历史及统一 JSON；Markdown 仅提供当前 Stop 和有效管理变化的摘要。
- 不开发任何导入成交、行情、R、回放、研究页面或 Step 2 能力；不新增依赖。

## 技术边界

日内 envelope 和 state 均为 V5；统一 envelope 继续 V2；风险 schema 2、chime schema 1 不变。
每笔 opportunity 和 record 新增：

```json
{
  "researchCapture": {
    "eventSequence": 0,
    "manualEvents": []
  }
}
```

事件字段：

```json
{
  "id": "op-1-example:manual-1",
  "type": "INITIAL_STOP_RECORDED",
  "recordedAt": 1790000000000,
  "effectiveAt": 1790000000000,
  "source": "manual_intraday",
  "payload": { "stopPrice": 3974 }
}
```

- 五种类型：INITIAL_STOP_RECORDED、INITIAL_STOP_CORRECTED、INITIAL_STOP_LATE_RECORDED、BOF_TO_PB_RECORDED、BOF_TO_PB_REVERTED。
- 初次/补记 payload：stopPrice；修正：oldValue/newValue；转换：from BOF/to PB；撤销：from PB/to BOF/revertedEventId。
- eventSequence 等于事件数量；ID 由 opportunity ID 和单笔递增序号生成，混合类型共享序号。
- recordedAt/effectiveAt 使用现有毫秒时间戳；source 表示盘中人工录入/人工判断。正常 UI 两个时间均为当前时间。
- recordInitialStop 的可选 effectiveAt 明确早于 recordedAt 时产生 LATE 事件；禁止早于入场或晚于记录。V0 不新增回填时间 UI，不自动把首次填写倒填为入场时间。
- Initial Stop、有效转换和当前管理分别由 effectiveInitialStop、effectiveBofToPbEvent、derivedManagementState 推导，不保存第二份永久 truth。
- 业务动作在 model 中先校验候选事件，再追加、syncRecord、touch revision 和 assertState；UI 只维护不持久化的编辑草稿。
- 校验事件结构、序号/ID、时间、source、价格、修正旧值、转换/撤销关系以及活动记录一致性。

## 迁移路径

1. assertLegacyState 校验 V3；migrateV3Workspace 执行既有 V3 → V4 分类升级及旧活动机会收尾，assertV4State 校验结果。
2. migrateV4Workspace 复制完整 V4，只给机会/记录添加空 Research Capture，state/envelope 改为 V5，assertState 校验。
3. 已是 V5 时严格校验后跳过迁移，不新增事件或重复审计。
4. V3 → V4 audit 的 toSchemaVersion 仍为 4，不伪装成 3 → 5。
5. Unified V1 继续使用原顶层迁移路径；Unified V2 也编排内嵌 V3/V4 → V5。
6. 本地迁移复用已有 pre-upgrade 原始快照、raw guard、一次 canonical 写入、revision +1、精确回读与失败回滚。V2 迁移不读取旧 chime 键。
7. 风险、报时、preferences 和非版本相关交易事实不重写。V3 已结束历史的原字段保持原值；V3 活动机会依原 V3 → V4 升级规则结束。V4 → V5 的所有交易事实完全不变。

## 验证与交付边界

保留全部既有测试；新增迁移保持性、事件链、往返、摘要和生产 bundle 点击测试。
实际运行 npm test、npm run build、bundle 语法、构建符号完整性及 diff 检查，进行桌面/窄屏 UI 和冲突保护验证。
仅提交 codex/exit-research-v0-step1 本地 commit；禁止 push、merge、Pages 配置/工作流变更及正式部署。完成后停止，等待人工验收。
