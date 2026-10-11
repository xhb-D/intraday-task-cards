# V6 辅助文案浏览器验证

本地 Chrome 154.0.8037.99 实际页面截图；使用临时浏览器上下文及合成数据。五种宽度 × 两种主题 × 正常/旧分类，共 20 组检查全部通过。每组覆盖 GC、CL、ES。

[查看截图画廊](index.html) · [浏览器测量与断言结果](browser-results.json) · [完整验证报告](../../V6_BIAS_HELPER_COPY_REPORT.md)

| 视口宽度 | Light | Dark |
| --- | --- | --- |
| Desktop 1440px | [截图](1440-light.png) | [截图](1440-dark.png) |
| Desktop 1024px | [截图](1024-light.png) | [截图](1024-dark.png) |
| Mobile 390px | [截图](390-light.png) | [截图](390-dark.png) |
| Mobile 375px | [截图](375-light.png) | [截图](375-dark.png) |
| Mobile 320px | [截图](320-light.png) | [截图](320-dark.png) |
| 旧分类 Desktop 1440px | [截图](1440-light-legacy.png) | [截图](1440-dark-legacy.png) |
| 旧分类 Mobile 320px | [截图](320-light-legacy.png) | [截图](320-dark-legacy.png) |

大偏见说明均为一行，小偏见说明均为两行；保持原字号、颜色、字重及说明下方 6px 按钮间距。无文字截断、横向溢出或按钮遮挡。

## 重现浏览器验证

在仓库根目录运行：

```sh
node scripts/qa-v6-bias-helper-copy.mjs /private/tmp/v6-bias-helper-copy-qa
```

脚本复用已有 Playwright。模块不在默认搜索路径时可通过 `PLAYWRIGHT_MODULE` 指定其绝对模块路径；浏览器路径可通过 `CHROME_PATH` 指定。无新增产品依赖。基线通过 `git archive` 读取至临时目录；所有测试页面仅由本地服务器提供。

完整测试记录见 [automated-tests.log](automated-tests.log)，范围与逐字节核验见 [frozen-boundaries.json](frozen-boundaries.json)。
