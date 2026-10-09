# V6 首页紧凑布局与模块内导航 QA

## 候选与范围

- 分支：`codex/v6-chime-compact-module-nav-hotfix`
- 开发 Base：`358e06e83ba31cc01d66c39455f90ec367c9f966`
- 生产 main / origin/main：`7a0a534e202dd2cd03fcf5af98a198c2e0849eec`
- 仅本地候选；未 push、merge 或 deploy。
- 资源版本：`v6-chime-compact-module-nav-20261009`
- Bundle SHA-256：`a8c90a7531207355486babe292735d3b6ac79e974107a6a31a1f515da318263f`

本轮修改首页 HTML、展示 CSS、Chime view 的 DOM wrapper、对应测试和构建产物。业务源码差异仅为 `src/natural-chime/view.js` 的节点分组；没有改动原有回调、周期调度或运行状态判断。未修改 schema、migration、persistence/CAS、交易模型、Setup、Initial Stop、BOF→PB、Risk 业务、Exit Research 或 macOS Helper。

上一候选的周期底部区、隐藏商品下移、交易方向“小偏见方向>大偏见方向”和底部账户区均保留。

## 页面入口

| 页面 | 入口 | 返回 |
| --- | --- | --- |
| Home | 顶部“统一交易控制中心”，可访问名称“返回日内交易状态卡” | `#/home` |
| Risk | 原账户区“进入 Trading Risk Manager →” | 原有返回首页链接 |
| Exit Research | 今日机会记录右侧独立链接；手机紧邻记录标题上方 | 动态工作台外的返回首页链接 |
| Chime | 原报时操作区“报时设置 →” | 动态设置区外的返回首页链接 |

四个路由地址不变，未知路由保留返回首页。顶部四项集中导航已移除，没有新增集中菜单或重复模块。研究入口位于 `<summary>` 外；历史展开、收起和记录数量展示独立于导航。

## 紧凑布局与高度实测

使用同一份隔离 synthetic 数据和四个暂停周期进行前后对照。Base 页面与最终候选通过独立本地 QA 副本渲染；未访问用户正常浏览器或真实存档。

Desktop：报时模式行、时钟/运行状态行、播放选项行、操作行及底部周期区。Mobile：模式与选择器尽量同行，完整警告自然换行，声音选择器独占合理宽度，操作按钮可换行。原周期列表内部安全滚动保留；320px 下最后一个周期操作可横向滚动访问，不产生页面级溢出。

下表为 CSS 像素；浅色与深色对应尺寸一致。高度取两位小数显示。

| 宽度 | Header 前→后 | 减少 | Chime 前→后 | 减少 |
| --- | --- | --- | --- | --- |
| 1280 | 72→51 | 21 | 483.28→271.09 | 212.19 |
| 1440 | 72→51 | 21 | 483.28→271.09 | 212.19 |
| 390 | 101→66 | 35 | 473.38→348.78 | 124.59 |
| 375 | 104.50→66 | 38.50 | 472.88→348.28 | 124.59 |
| 320 | 174→90 | 84 | 472.38→387.78 | 84.59 |

1280/1440/390/375/320 × Light/Dark 共十种组合均检查页面宽度、控件遮挡和截图，页面 scrollWidth 等于 viewport width，没有页面横向溢出。标题、保存状态、备份入口和研究入口未截断。320px 标题鼠标命中区域曾覆盖换行空白，已通过 block anchor 最小修正；鼠标点击与键盘 Enter 均可返回首页，focus outline 清楚。

## 实际交互与回归证据

- Risk、Exit Research、Chime 均实际进入并通过明确返回链接回首页；顶部标题也可返回首页。
- 历史关闭及打开两种状态下，研究入口只导航，不改变 disclosure 状态；summary 中没有链接。
- 周期单独恢复、刷新后保留、再次暂停成功；0/1/4/5 个周期数量和空态正确，3/5/15/30 与自定义 17 分钟正常。
- 语音开关使声音选择器启用/禁用；未启动实际报时音频或系统通知。
- 隐藏商品展开、收起和恢复 CL 成功；仅一份隐藏列表。
- Synthetic ES 两笔独立持仓与 5000/5002 Initial Stop 保留；第二笔 BOF→PB 及撤销仅影响该笔。
- 独立 Native view fixture 验证断连、配置不一致和证书提示全文可见，操作禁用保护保留。该 fixture 直接使用候选 view 与 CSS；没有连接、安装、修改或专项验收真实 Helper。
- 实际浏览器 console 捕获：0 新增 error/warn。
- 生产 Bundle VM 路由循环测试逐次核对 Unified 原始字符串、独立 Research Store 字符串完全不变，并保留两笔持仓和 pending。此项为自动化隔离证明，不声称对用户浏览器存档做过读取或导出比对。
- 既有 Risk 账户增改删、余额/CAS、Exit Research、Multi-Trade、Chime 回归随完整测试全部通过。

## 测试与构建

`npm test`：**1056/1056 PASS，0 skipped**；Base 1046 项全部保留，新增 10 项。

新增测试：

1. `Module navigation: header title is home entry; centralized nav is absent; header tools retained`
2. `Module navigation: research entry is outside summary, visible with closed history; original Risk/Chime entries reused`
3. `Module navigation: risk has an explicit hash return outside dynamic host`
4. `Module navigation: exit-research has an explicit hash return outside dynamic host`
5. `Module navigation: chime has an explicit hash return outside dynamic host`
6. `Module navigation: error has an explicit hash return outside dynamic host`
7. `Compact Chime: desktop groups and mobile wrapping retain complete warnings and safe controls`
8. `Compact Chime browser: original controls grouped once, help and actions remain operable`
9. `Compact Chime native: original controls grouped once, help and actions remain operable`
10. `Module navigation production: hash routes and returns preserve Unified, Research settings and current view state`

原先依赖静态顶部导航的测试改为核对实际模块入口与路由可达性，没有删除路由覆盖。资源版本和 history wrapper 断言同步更新。

- `npm run build`：PASS，重建后无额外非预期差异。
- `node --check dist/app.bundle.js`：PASS。
- `git diff --check`：PASS。
- 浏览器 QA 目录中的 index 和九项 versioned CSS/JS 与最终仓库逐字节一致：10/10。

## 截图与测量文件

实际浏览器输出目录：

`/Users/hongchujun/Documents/日内交易/V6-Chime-Compact-Module-Nav-QA-20261009/`

- `desktop-1280-light.jpg` / `desktop-1280-dark.jpg`
- `desktop-1440-light.jpg` / `desktop-1440-dark.jpg`
- `mobile-390-light.jpg` / `mobile-390-dark.jpg`
- `mobile-375-light.jpg` / `mobile-375-dark.jpg`
- `mobile-320-light.jpg` / `mobile-320-dark.jpg`
- `mobile-320-zero-periods.jpg`
- `route-risk.jpg` / `route-exit-research.jpg` / `route-chime.jpg`
- `native-warning-desktop-light.jpg` / `native-warning-mobile-320-dark.jpg`
- `keyboard-home-focus.jpg`
- `height-and-layout-measurements.json`

没有需要新增人工业务裁决的问题。本地候选等待人工视觉验收；不代表已正式发布。
