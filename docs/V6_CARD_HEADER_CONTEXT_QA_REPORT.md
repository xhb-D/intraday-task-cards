# V6 商品卡片头部顺序与上下文文案 QA

日期：2026-10-08

- Base：2c6e6d8ba8b86f055021520a85f07315aafdfc8d（开始时 fetch 后本地 main / origin/main 一致）
- 分支：codex/v6-card-header-context-hotfix
- 顺序：HTF结构 → 当前偏见 → 交易方向
- 标题精确为：
  - HTF结构（HTF波段动能& 新的未测试优质缺口）
  - 当前偏见（TPO字母轨迹&尾部）
  - 交易方向 HTF方向>缺口方向>MTF方向
- Renderer 只移动原有两段 section 并修改标题；按钮参数、ARIA group、direction 逻辑不变。
- refinement.css 只允许卡片 classifier 标题自然换行，不修改颜色、按钮或其他页面。
- 9 个现有资源版本统一更新为 v6-card-header-context-hotfix-20261008；无额外资源。

## 自动化

npm test：928/928 PASS，0 skipped（当前 main 原有 923 项；新增 5 项）。
更新 GC/CL/ES × none/wait/signal/position 的 12 项顺序及精确文案测试、bundle 文案和资源版本测试。
新增 long/short × wait/position 的 4 项锁定 tone、两个 Setup、多笔 Research Capture 和 renderer 无 mutation 检查；新增 collapsed card 标题与隐藏容器兼容检查。
既有 V6 model/migration/persistence、Risk/Chime、Exit Research、Initial Stop、BOF→PB 测试全部通过。

npm run build、node --check dist/app.bundle.js、git diff --check 全部 PASS。

## 隔离浏览器 QA

仅使用 synthetic 数据和独立 loopback origin 127.0.0.1:4291；未读取用户真实浏览器数据，未访问正式数据。
fixture：GC wait/long、CL signal/short、ES 两笔独立持仓与不同 Initial Stop；另用 holding fixture 验证 GC long / CL short 跟随持仓。
对同一 fixture 的候选与 base 资源进行实际 getComputedStyle / DOM 几何对照。

| 配置 | 结果 | GC/CL/ES 卡片高度 | 相比 base 高度变化 |
| --- | --- | --- | --- |
| desktop 1280×1000 light | PASS | 703.5 / 703.5 / 774.5px | 全部 0px |
| desktop 1280×1000 dark | PASS | 703.5 / 703.5 / 774.5px | 全部 0px |
| mobile 390×844 light | PASS | 703.5 / 703.5 / 942.5px | 全部 0px |
| mobile 390×844 dark | PASS | 703.5 / 703.5 / 942.5px | 全部 0px |

四种配置均：标题正确且完整、顺序正确、无横向溢出、按钮同排无错位；三个标题各为单行。
HTF结构选中背景保持中性色。偏见、按钮 selected/unselected/disabled 和 wait/signal 强调均与 base 相同。
实际 computed color：light long rgb(24,122,65) / short rgb(197,52,69)；dark long rgb(108,239,166) / short rgb(255,104,121)。锁定和跟随持仓均保留语义色。
两笔 ES Initial Stop 分别为 5000.0 / 5002.0；两个 Setup 按钮及下方持仓/机会区域正常。
候选浏览器 console error/warn：0。

截图与机器读数：/Users/hongchujun/Documents/日内交易/V6-Card-Header-Context-QA-20261008/
- desktop-light.jpg / desktop-dark.jpg（完整页面，三张卡片均可见）
- mobile-light.jpg / mobile-dark.jpg（390×844 viewport）
- layout-evidence.json（四种候选与 base 对照）
- holding-colors.json（跟随持仓颜色）

## 范围与交付

未修改 schema、records、migration、persistence、store、revision/CAS、multi-trade、Setup 创建规则、Initial Stop、BOF→PB、导出结构或 Exit Research / Risk / Chime 业务逻辑。
只提交本地候选；未 push、未 merge、未 deploy。等待人工验收。
