# 日内交易实时状态卡 V1

本地、无网络的桌面浏览器工具，用于保持 GC、CL、ES 的 3M 日内交易任务状态。它不读取行情、不连接 TradingView 或券商，也不发送订单。

## 打开

方式 1（适合日常使用）：直接双击 `index.html`。页面加载仓库内已生成的 `dist/app.bundle.js`，不依赖 ES Module、CDN、网络或运行时服务器。

方式 2（需要更稳定持久化时推荐）：在本目录运行 `npx serve .`，再打开显示的 `http://localhost:xxxx` 地址。

Safari 的 `file://` 本地文件模式是否允许 localStorage 由浏览器策略决定：即使不可用，三张卡和内存状态仍可正常使用，页面会显示“尚未保存”降级提示，Markdown / JSON 导出仍可用。长期保存请使用 localhost 模式或定期导出 JSON。迁移或清理浏览器数据前请导出 JSON。

开发者修改 `src/` 后运行 `npm run build` 更新已提交的 `dist/app.bundle.js`；最终用户不需要运行构建命令。

## 结构

- `src/model.js`：纯业务状态机、机会/记录 identity 和不变量。
- `src/persistence.js`：V1 envelope、结构校验、localStorage 序列化和 Markdown 导出。
- `src/startup.js`：存储故障隔离；保证先创建内存工作区，再尝试恢复。
- `src/app.js`：DOM 渲染、确认对话框和浏览器 I/O。
- `dist/app.bundle.js`：供直接双击 `index.html` 使用的 classic-script 生产 bundle。
- `styles.css`：固定 GC / CL / ES 三卡桌面优先界面。
- `test/model.test.js`：验收场景与随机不变量测试。

## 数据与保存

每张卡保存方向、当前机会和空闲状态起点。机会保存稳定 `id`、已确认位置 `zone`、未确认草稿 `zoneDraft`、登记/入场/结束时间、注意力阶段及阶段片段。历史记录是机会的无草稿快照；删除记录不会触碰当前机会，也不会自动复活。

localStorage key 为 `intraday-task-cards:v1:state`，schemaVersion 为 `1`。完整 JSON 备份包含 `app`、`schemaVersion`、`savedAt`、`timezone` 和整个工作区；导入先校验再二次确认。

## 验证

```sh
npm test
```

测试覆盖三品种隔离、方向/机会切换、位置确认、注意力阶段、未登记结束、入场/平仓语义、删除不复活、恢复/导出，以及 1,000 次随机状态转换不变量检查。

## 已知限制

- localStorage 受浏览器策略和容量限制；保存失败时页面会提示“尚未保存”，保留内存数据并允许导出 JSON。
- 损坏或 schema 不兼容的本地存档不会被空白状态覆盖。三张卡仍会显示；可导出原始存档、恢复有效备份，或经确认后开始空白工作区。
- 页面显示最后一次手动任务状态；恢复不重新核验行情或真实持仓。
