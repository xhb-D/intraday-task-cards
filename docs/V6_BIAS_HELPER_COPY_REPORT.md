# V6 大偏见、小偏见辅助文案：本地 Candidate 验证报告

状态：`LOCAL_CANDIDATE / WAITING_CHAT_HUMAN_REVIEW`。仅本地修改、验证和提交；未 Push、未 Merge、未 Deploy。

## 基线与修改

- 已刷新远端引用，开始修改前 `main`、`origin/main`、`HEAD` 均为用户指定已发布冻结基线 `00aa5971a9f51c941b06c5b883e3966113fa2072`。
- 独立分支：`codex/v6-bias-helper-copy`。
- Candidate SHA 以交付消息及本分支提交记录为准。
- GC、CL、ES 统一使用以下辅助说明：
  - 大偏见：`确定持仓预期（关注波段动能&未测试优质缺口）`
  - 小偏见：`结合价格走势和VP分析TPO 确认价格拒绝和接受（尾部&单打印&弱端点）`
- 保留大偏见、小偏见标题、全部选项、内部 key、选中状态、颜色、交易方向判断及事件逻辑。

## 文件清单

| 文件 | 修改内容 |
| --- | --- |
| `src/capture-ui.js` | 只替换两处说明文本；HTML 中 `&` 按原方式转义 |
| `dist/app.bundle.js` | 重建 bundle；与基线相比仅同样两处文本替换 |
| `test/v6-card-header-order.test.js` | 更新已有文案断言 |
| `test/v6-home-layout.test.js` | 更新已有文案断言 |
| `test/v6-htf-structure-v2.test.js` | 更新已有文案断言 |
| `test/v6-mtf-bof-setup.test.js` | 更新已有文案断言 |
| `scripts/qa-v6-bias-helper-copy.mjs` | 本地浏览器验证与基线对照脚本 |
| 本报告、`docs/qa/v6-bias-helper-copy/` | 截图、测试记录、文件清单与验证证据 |

精确逐文件清单见 [changed-files.txt](qa/v6-bias-helper-copy/changed-files.txt)。原有两份未跟踪 `.DS_Store` 文件保留且排除在提交之外。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全部现有自动化测试 `npm test` | 1175/1175 通过；失败、跳过均为 0 |
| Build `npm run build` | 通过 |
| Bundle Syntax `node --check dist/app.bundle.js` | 通过 |
| QA 脚本语法检查 | 通过 |
| Diff Check | 通过 |
| 真实 Chrome 浏览器 | 154.0.8037.99；20 组全部通过；14 张实际页面截图 |
| 尺寸 | 1440、1024、390、375、320px，均覆盖 Light / Dark |
| 卡片及旧分类 | 每组均检查 GC、CL、ES；每种尺寸和主题均检查正常分类与旧分类提示 |
| 浏览器异常 | 控制台错误、警告、页面错误均为 0 |

所有尺寸和主题下，大偏见说明完整显示为一行，小偏见说明自然换为两行。计算样式保持 `11px / 16px`、字重 `400`，颜色与基线一致；说明下方与按钮之间均为原有 `6px` 间距。无文字截断、省略号、横向溢出或按钮遮挡；按钮尺寸、选中状态、颜色及禁用状态与基线相同。现有 CSS 已满足要求，本轮没有修改 CSS，也没有重新设计商品卡片。

已目视复核 1440px 和 320px 的明暗主题截图，以及 320px 深色旧分类截图。完整截图可在 [浏览器截图画廊](qa/v6-bias-helper-copy/index.html) 查看；其他尺寸的文字边界和按钮间距亦经过实际浏览器几何测量。

## 冻结边界核验

1. 源码和 bundle 分别与基线逐字节对照，均只包含指定两处字符串替换。四份测试文件也只更新同一文案的既有断言。
2. 基线 354 个跟踪文件中，其余 348 个文件与基线逐字节相同，包含全部 CSS、页面入口、依赖配置和其余产品代码。
3. 既有冻结清单中的 48 个受保护文件哈希均未改变，详见 [frozen-boundaries.json](qa/v6-bias-helper-copy/frozen-boundaries.json)。
4. 浏览器对照中，将两处说明还原后，三张卡片完整 DOM 与基线一致。每个场景载入前后的 Unified 原始序列化数据保持相同。
5. 验证仅使用本地 HTTP 页面、临时 Chrome 上下文和合成数据。未读取或修改实际生产交易数据。

确认未修改任何交易事实或冻结逻辑，包含 SPB / CPB / BOF、入场与持仓预期、BOF 转换、records、manualEvents、历史档案、Exit Research、Risk Manager、Chime、V6 schemaVersion 和 Unified 数据结构。

## 证据与复核

- [验证摘要](qa/v6-bias-helper-copy/verification.json)
- [完整自动化测试记录](qa/v6-bias-helper-copy/automated-tests.log)
- [Build 记录](qa/v6-bias-helper-copy/build.log)
- [实际浏览器结果与测量](qa/v6-bias-helper-copy/browser-results.json)
- [文件 SHA-256 清单](qa/v6-bias-helper-copy/sha256-manifest.json)

本 Candidate 等待 Chat/Human Review；现有已发布冻结基线保持不变。
