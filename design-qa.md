# 日内交易状态卡 UI Design QA

- Date: 2026-10-01
- Scope: 将当前机会中的 `HTF PB` 改为 `MTF BOF（趋势走弱 1次）`；保持原字号，文字在按钮内换成两行。
- Approved visual reference: conversation visualization `opportunity-mtf-bof-once.html`，用户确认后实施。
- Implementation preview: `http://127.0.0.1:4186/?preview=mtf-bof-weak-once#/home`。
- Viewport: 1280 x 720 CSS px，浅色外观，三列卡片布局。

## Full-view comparison evidence

- GC、CL、ES 三张卡片的当前机会均显示 `MTF PB / MTF BOF（趋势走弱 1次） / HTF BOF`。
- 中间按钮在现有卡片宽度内自然换为两行，没有缩小字号。
- 三个按钮高度随最长文案统一拉齐，没有上下错位。
- 下方入场信号和当前状态区域随内容自适应下移，没有重叠或遮挡。

## Focused region comparison evidence

- 三个按钮实测字号均为 12 px、行高均为 15 px、高度均为 38 px。
- 中间按钮只换行，不裁切、不溢出，完整显示 `MTF BOF（趋势走弱 1次）`。
- 按钮保留既有选中态、禁用态、边框、圆角和主题颜色。

## Required fidelity surfaces

- Fonts and typography: 新文案与相邻按钮使用相同字号和字重。
- Spacing and layout rhythm: 按钮组保持三等分；最长文案决定整行统一高度。
- Colors and visual tokens: 沿用既有机会按钮样式，不引入新配色。
- Copy and content: 页面、历史空状态、README、业务规范、架构规范、测试和生产 bundle 已同步更新。

## Findings

- 未发现 P0、P1、P2 或 P3 问题。

## Verification

- `npm run build` passed。
- `npm test`: 219/219 passed。
- `node --check dist/app.bundle.js` passed。
- `git diff --check` passed。
- 1280 x 720 三列页面人工检查 passed。

final result: passed
