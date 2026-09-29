# 日内交易状态卡 UI Design QA

- Date: 2026-09-29
- Scope: 将商品卡片的“入场信号”固定提示改为两行，并统一当前偏见、市场结构、交易方向、当前机会四个字段标题的字号和垂直间距。
- Approved visual reference: conversation visualization `entry-signal-two-lines.html`，用户确认后实施。
- Implementation preview: `http://127.0.0.1:4185/?preview=entry-signal-two-lines#/home`。
- Viewport: 1280 x 720 CSS px；分别检查浅色与深色外观。

## Full-view comparison evidence

- GC、CL、ES 三张卡片均显示相同的两行入场信号。
- 第一行显示 `均线一侧·BB收窄·气泡攻击&吸收·流动性·信号K`。
- 第二行显示 `原方向拒绝+新方向位移（COC）+价格接受（震荡）`。
- 两行使用同一个父级颜色与字体规则，没有次级文字颜色。
- 三列布局、商品卡片宽度、机会按钮和当前状态区域均未发生错位。
- 四个字段标题实测均为 11 px 字号、14 px 行高和 6 px 下间距；相邻字段区之间统一为 8 px。

## Focused region comparison evidence

- 在 1280 px 三列布局及 302 px 窄视口下，两段内容各自保持一行，没有横向溢出或遮挡。
- “入场信号”标签与两行内容形成清晰的左标签、右内容结构。
- 浅色与深色模式均保持两行同色，背景、边框与现有主题一致。
- 302 px 窄视口实测：提示框宽 266 px、内容区宽 211 px；两行 `clientWidth` 与 `scrollWidth` 均为 211 px，没有换行、裁切或横向溢出。
- 卡片字段区改用内容自适应行高，交易方向不再挤占当前机会标题空间。

## Required fidelity surfaces

- Fonts and typography: 两行继承相同字号、字重、行高与颜色。
- Spacing and layout rhythm: 两行之间使用细分隔线和 4px 上内边距；提示区域高度自适应。
- Colors and visual tokens: 沿用既有主题变量及只读区域颜色，不引入新配色。
- Copy and content: 页面、README、业务规范、架构规范、测试和生产 bundle 已统一更新。

## Findings

- 未发现 P0、P1、P2 或 P3 问题。

## Verification

- `npm run build` passed。
- `npm test`: 219/219 passed。
- `node --check dist/app.bundle.js` passed。
- `git diff --check` passed。
- 浅色与深色页面人工检查 passed。

final result: passed
