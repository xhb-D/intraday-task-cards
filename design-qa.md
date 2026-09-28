# 日内交易状态卡 UI Design QA

- Date: 2026-09-28
- Scope: 仅将商品卡片标题 `市场结构（比较20均线和波段高低点）` 改为 `市场结构（MTF chanlun）`；布局、主题、控件、业务规则和数据格式不变。
- Source visual truth path: `/Users/hongchujun/.codex/generated_images/01a079d6-c844-7fe0-b65f-ab3aedeebe71/exec-8f97f269-9ee9-4e80-aa06-d485a6f81aaa.png`。
- Implementation screenshot path: Codex in-app browser inline capture；可复现页面 `http://127.0.0.1:4184/?preview=mtf-chanlun#/home`。
- Viewport: 1280 x 720 CSS px，dark theme，1x density。
- Source pixels: 1234 x 1275；implementation pixels: 1280 x 720。源图是单卡近景，实施截图是三卡完整页面，因此只比较授权范围内的标题文案、单行显示、对齐和相邻控件布局，不对两者整体比例作伪精确比较。

## Full-view comparison evidence

- GC、CL、ES 三张卡片均显示 `市场结构（MTF chanlun）`。
- 三卡字段顺序仍为当前偏见 → 市场结构 → 交易方向 → 当前机会 → 当前状态。
- 新标题未改变商品卡片宽度、市场结构按钮尺寸、下方交易方向间距或三列布局。
- 深色主题的字体、边框、表面色和选中态均沿用既有 token，没有新增视觉资产或样式。

## Focused region comparison evidence

- 重点检查每张卡片“当前偏见”与市场结构按钮之间的标题区域；新标题保持单行，左边缘与其他字段标题一致。
- `MTF chanlun` 的大小写、空格和全角括号与冻结文案完全一致。
- 相邻的 `多头 / 震荡（观察拍卖完成） / 空头` 按钮未发生挤压、换行或错位。

## Required fidelity surfaces

- Fonts and typography: 沿用现有字体、字号、字重、行高和抗锯齿；无可见漂移。
- Spacing and layout rhythm: 标题上下间距与其他字段一致；三列卡片无溢出。
- Colors and visual tokens: 未修改颜色、透明度、边框、圆角或状态色。
- Image quality and asset fidelity: 本次没有图片、图标或其他视觉资产变更。
- Copy and content: 页面、README、业务规范、测试和生产 bundle 均统一为 `市场结构（MTF chanlun）`；旧标题已无残留。

## Findings

- 未发现 P0、P1 或 P2 问题。
- P3：源效果图是单卡近景，实际页面为三卡密集布局；实际产品字号更小，但这是既有响应式布局，不属于本次文案修改造成的偏差。

## Comparison history

1. 首次自动测试在生产 bundle 尚未重建时发现旧标题仍存在；先重新构建生产 bundle，再复测。
2. 最终页面截图确认三张卡片均使用新标题，且没有布局回归。

## Verification

- `npm run build` passed。
- `npm test`: 219/219 passed。
- `node --check dist/app.bundle.js` passed。
- `git diff --check` passed。

final result: passed
