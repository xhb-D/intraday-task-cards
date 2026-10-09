# Mobile 今日机会记录研究入口微调

- 分支：`codex/v6-chime-compact-module-nav-hotfix`
- Base：`e2eca16e7fd7a8fce2fc2e8f338d50b2706b8a22`
- 仅本地候选；不 push、merge 或 deploy。
- 资源版本：`v6-mobile-history-research-20261010`

## 修改

仅首页研究入口 HTML 和局部展示 CSS：在 max-width:620px 时，由 history-module 提供统一主题边框、背景和阴影，内层 details 去除重复边框。链接与记录标题处于同一视觉卡片内，链接仍为 details 的兄弟节点，未放入 summary。

手机端显示“研究 →”，链接完整可访问名称为 `进入 Exit Research`。桌面继续显示“进入 Exit Research →”，原右侧位置、字号、尺寸保持不变。两个响应式标签属于同一个链接，没有复制入口或绑定新的监听器。

未修改任何 src 文件、Chime、商品看板、Risk、交易或研究算法。未修改 schema、migration、persistence 或数据。资源统一版本更新后已构建，Bundle 与 Base 逐字节一致：

`a8c90a7531207355486babe292735d3b6ac79e974107a6a31a1f515da318263f`

## 实际浏览器 QA

仅使用 Codex 隔离浏览器、本机 4307 端口及 synthetic 数据；未读取私人浏览器或真实 localStorage。

| 宽度 | 浅色/深色 | 页面 scrollWidth | 共同边框 | 收起卡片高度 | 研究入口 |
| --- | --- | --- | --- | --- | --- |
| 320 | PASS / PASS | 320 | 1px | 42px | 研究 → |
| 375 | PASS / PASS | 375 | 1px | 42px | 研究 → |
| 390 | PASS / PASS | 390 | 1px | 42px | 研究 → |

六组检查中，链接均在共同边框内；研究链接宽度 40px，与记录条数间隔 12px，没有重叠或截断。浅色背景实测 `rgb(255,255,255)`，深色背景 `rgb(26,34,51)`，内层 details 边框为 0px。

每组分别执行记录收起/展开 → 点击研究入口 → 研究页可见 → 明确返回首页，共十二次往返。展开状态保持原值，记录条数始终为 `4 条 · 今日及未结束`。summary 点击可正常展开/收起。320px 展开记录时页面 scrollWidth 仍为 320，原有表格内部滚动保持。

1280px Light/Dark 与 Base 实际页面对照：桌面研究链接文字不变，宽度均为 120.890625px，右侧位置和相对卡片顶部偏移均相同。共同 wrapper 在桌面无新增边框；原 details 边框保持 1px。

Console：0 error/warn。不存在需要新增人工裁决的问题。

截图及实测 JSON：

`/Users/hongchujun/Documents/日内交易/V6-Mobile-History-Research-QA-20261010/`

- mobile-320-light.jpg / mobile-320-dark.jpg
- mobile-375-light.jpg / mobile-375-dark.jpg
- mobile-390-light.jpg / mobile-390-dark.jpg
- mobile-320-dark-expanded.jpg
- desktop-1280-light.jpg / desktop-1280-dark.jpg
- measurements-and-interactions.json

## 自动化验证

新增 `Mobile history research: shared themed border contains independent short entry; desktop label and placement retained`，验证手机共享主题边框、内层 details 无重复边框、长短文案响应式切换、desktop 原样式以及唯一完整 aria-label。

更新原研究入口测试，继续验证链接在 summary 外、唯一入口及明确返回路径；未删除原测试。统一资源版本测试同步更新。

- npm test：**1057/1057 PASS，0 skipped**，原 1056 项保留，新增 1 项。
- npm run build：PASS。
- node --check dist/app.bundle.js：PASS。
- git diff --check：PASS。
- Bundle 与 Base 逐字节一致。

等待人工最终确认；未正式发布。
