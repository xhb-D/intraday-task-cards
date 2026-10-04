# Exit Research V0｜Step 5A 最小研究工作台

## 0. 开发隔离

当前正式 main：

4deac7d3e70bb32f4f50a0f8438ca090554877ee

从当前最新 main 创建独立分支：

codex/exit-research-v0-step5a-ui

禁止直接修改 main。
禁止 merge / push main / deploy Pages。
完成后等待人工验收。

--------------------------------------------------
一、先整合已经冻结的 Research Engine
--------------------------------------------------

当前正式 main 只包含生产 Data Capture / Holding Reference，
还没有 Step2–4B 的纯研究模块。

请按顺序把以下冻结研究 commits cherry-pick 到 Step5A 分支：

Step2：
ec24ff0f733166a7654b45fd24a28014c882c820
3a9f27e85265867cc37afecd8358462044b9f0e3

Step3：
7fb6017b9a6f47874435d9dd8426fbd91fc964f7
037841a3c2c17dc4eed3ba4e23dc0d07bf5da797

Step4A：
33ca4cf7e886001e6af63e6c14bccd981cc71798

Step4B：
ee3931cd3e1920b25ecc0e836c29808c9be61576

这些 commits 理论上主要新增：
src/exit-research/
tests
QA scripts
docs

不要让 cherry-pick 回退或覆盖当前 main 已上线的：
Holding Reference
统一状态卡布局
Initial Stop
BOF→PB
Risk Manager
Chime

如果发生生产文件冲突：
立即停止并报告，不强行解决。

整合后先运行全部测试。

--------------------------------------------------
二、本轮产品目标
--------------------------------------------------

新增独立页面：

#/exit-research

名称：

Exit Research
持仓管理研究

用途：

盘后 / 周复盘。

绝不把复杂研究信息放回首页 Task Card。

首页继续保持现在已经上线的低认知负荷版本。

--------------------------------------------------
三、导航
--------------------------------------------------

当前主导航：

日内交易状态卡
Trading Risk Manager
自然周期报时

增加：

Exit Research

建议：

日内交易状态卡
Trading Risk Manager
Exit Research
自然周期报时

或根据现有空间选择最自然的位置。

更新 router：

#/exit-research

浏览器 title：

Exit Research · 统一交易控制中心

未知 route 逻辑保持不变。

--------------------------------------------------
四、Step5A 只做“研究工作台”
--------------------------------------------------

第一版页面只需要四块：

A. 数据准备
B. Research Trades
C. 单笔交易详情
D. Policy Replay

不要做大型统计 Dashboard。
不要做参数矩阵。
不要做 Train / Validation。
不要做自动优化。

--------------------------------------------------
五、数据准备区
--------------------------------------------------

页面顶部显示：

数据准备

### Task Card 数据

默认读取当前浏览器正在使用的 V5 Intraday records。

显示：

Task Card Records：N
实际已入场：N
Initial Stop完整：N

不要复制这些数据到新的 Truth。

只读当前 canonical state。

### Tradovate

提供三个本地文件选择：

Fills.csv
Orders.csv
Position History.csv

文件只在浏览器内存解析。

不得上传网络。
不得写入 canonical Task Card localStorage。

导入后显示：

Fills：N
Orders：N
Position History：N

Logical Trades：
Closed：N
Open：N

### Window Start

因为 Frozen Step2 要求明确确认起点 Flat：

提供 checkbox：

[ ] 我确认本次 Tradovate 导出窗口开始时相关账户/合约均为 Flat

没有确认：
不得重建正式 Logical Trades。

UI 显示：

WINDOW_START_FLAT_UNCONFIRMED

不要默认勾选。

--------------------------------------------------
六、Market Data Bundle
--------------------------------------------------

增加：

Market Data Bundle JSON

[选择文件]

使用 Step4A frozen validator。

显示：

Series 数量
Execution Primary
Detail
Context
Coverage
Source Mode

如果没有 Bundle：

允许完成：
Task Card ↔ Tradovate reconciliation

但 Market Metrics / Replay 显示：

等待行情数据

不要伪造数据。

--------------------------------------------------
七、Market Data Request Plan
--------------------------------------------------

这是 Step5A 很重要的功能。

如果 Research Trade 已经匹配，
但还没有 Market Bundle：

提供按钮：

导出行情请求

根据 Frozen：

planMarketDataRequests(...)
planReplayMarketDataRequests(...)

生成 JSON 文件。

内容包括：

researchTradeId
executionProduct
executionContract
Actual Entry
Actual Exit
Replay Hard End（如尚未配置则标 pending）
5M需求
30M context需求
Detail按需需求

这个 JSON 将来可以交给 ChatGPT / TradingView 数据生产流程。

不要让网页自己联网 TradingView。

--------------------------------------------------
八、Replay Hard End 暂时人工配置
--------------------------------------------------

因为我们还没冻结 GC / ES / CL 的统一 Hard End 时间，

Step5A 对 Replay 必须让用户明确配置。

可以在研究设置区提供：

GC Replay Hard End
CL Replay Hard End
ES Replay Hard End

V0 可先支持：
“本次交易指定 Hard End 时间”

不要给一个悄悄的默认时间。

没有配置 Hard End：
Actual Metrics 可以算，
Policy Replay 不运行。

显示：

REPLAY_HARD_END_REQUIRED

--------------------------------------------------
九、Research Trades 列表
--------------------------------------------------

中间左侧/上方：

Research Trades

每行至少显示：

日期
GC / ES / CL
LONG / SHORT
Setup
BOF→PB（如有）
Task Entry Time
Actual Entry Time
Initial Stop
Matching Status
Quality Status

状态视觉：

READY
REVIEW
BLOCKED

但不要用“胜负”颜色夸张表达。

--------------------------------------------------
十、过滤
--------------------------------------------------

第一版只需要：

全部
PB
BOF
BOF→PB

以及：

GC
CL
ES

和：

READY
REVIEW
BLOCKED

不要做复杂搜索系统。

--------------------------------------------------
十一、匹配状态
--------------------------------------------------

调用 Frozen Step3：

reconcileOpportunities
buildResearchTrades
assessExecutionQa

显示：

MATCHED
REVIEW_REQUIRED
MATCH_AMBIGUOUS
NO_MATCH
DATA_CONFLICT

如果 MATCH_AMBIGUOUS：

页面应能显示候选 Logical Trades。

允许人工：

确认这笔
拒绝这笔

调用 Frozen：
applyManualMatch
applyManualReject

--------------------------------------------------
十二、人工 Match Store
--------------------------------------------------

这里要特别注意：

不要写进 Task Card V5 Truth。

Manual Match 是 Research Data。

Step5A 可以新建独立：

Exit Research Store V1

仅保存：

manual match decisions
研究 UI preferences
必要 research settings

优先使用独立 localStorage key，例如：

exit-research:v1

不要改 Unified V2。

不要改 Intraday V5。

必须提供：

导出 Research Store JSON
导入 Research Store JSON

这样研究人工确认可以备份。

--------------------------------------------------
十三、单笔详情
--------------------------------------------------

选中 Research Trade 后显示：

### 交易事实

品种
方向
原始 Setup
BOF→PB 时间（如有）

HTML：
registeredAt
taskEntryConfirmedAt
taskExitConfirmedAt

Tradovate：
具体合约
Actual Entry
Actual Entry Price
Actual Exit
Actual Exit Price
Qty

Initial Stop
1R

### Matching

Entry 时间差
Exit 时间差
Matching reasons

### Execution QA

Orders：
PASS / WARNING / CONFLICT / INSUFFICIENT

Position History：
同上

--------------------------------------------------
十四、Actual Metrics
--------------------------------------------------

有 Market Bundle 时显示：

Actual Holding：

Realized R
MFE
MAE

Milestones：

2R
4R
6R
8R
10R

状态明确显示：

Confirmed
Possible
Not Reached
Incomplete

如果 MFE/MAE 有区间：

不要只显示一个假精确数字。

例如：

MFE：
Confirmed ≥ 8.4R
Possible ≤ 8.5R

或等价易懂中文。

--------------------------------------------------
十五、Policy Replay 区
--------------------------------------------------

有完整 Replay data + Hard End 才运行。

第一版固定只显示六套 Frozen Policy：

PB_BASELINE_V1
BOF_BASELINE_V1

PB_TIGHT_GIVEBACK_V1
BOF_TIGHT_GIVEBACK_V1

PB_HARD_CEILING_V1
BOF_HARD_CEILING_V1

但只运行适用于当前 Setup / pairing 的策略。

--------------------------------------------------
十六、BOF 交易的 Replay
--------------------------------------------------

如果初始 Setup = BOF：

至少提供两个模式：

A. 按真实人工管理
MANUAL_ACTUAL

B. 始终按 BOF
FIXED_INITIAL_SETUP

如果存在 BOF→PB：

把两者并排比较。

例如：

实际退出
+4.2R

Baseline / Manual BOF→PB
+6.3R

Baseline / 始终 BOF
+4.8R

不要实现自动 Research Transition Rule。

--------------------------------------------------
十七、PB 交易
--------------------------------------------------

PB 交易只需要：

MANUAL_ACTUAL / 原始 PB

比较：

Actual
Baseline
Tight
Hard Ceiling

--------------------------------------------------
十八、Policy 卡片
--------------------------------------------------

每个结果卡至少：

Policy Name
Setup Source
Simulated Exit R
Exit Reason
Max Known MFE
Quality
Lookahead QA

提供：

查看回放轨迹

点击后展开 Replay Trace。

--------------------------------------------------
十九、Replay Trace
--------------------------------------------------

以时间线形式显示：

Entry
Milestone
Stage
Protection
BOF→PB
Stop Trigger
Hard Ceiling
Hard End

不要一次全部展开。

默认折叠。

每项用中文解释，
但保留内部稳定 reason code 可查看。

--------------------------------------------------
二十、不要把 REVIEW 当成错误
--------------------------------------------------

UI明确区分：

READY：
可正式比较

REVIEW_REQUIRED：
数据可看，但存在代理/边界/辅助QA问题

BLOCKED：
不能形成正式研究结论

不要让用户误以为 REVIEW 就是程序故障。

--------------------------------------------------
二十一、Realized R
--------------------------------------------------

如果 Research Trade：

Actual Entry
Actual Exit
Initial Stop

都有效，

计算：

LONG:
(ActualExit - ActualEntry) / 1R

SHORT:
(ActualEntry - ActualExit) / 1R

建议复用 r-math。

不要使用 broker P/L 美元金额反推 R。

--------------------------------------------------
二十二、Post-Exit 暂缓
--------------------------------------------------

Step5A 暂时不要开发：

15m
30m
60m
Post Exit Extension
Post Exit Adverse

虽然架构已经设计过，
留到 Step5B。

先把最核心工作流跑通。

--------------------------------------------------
二十三、参数编辑暂缓
--------------------------------------------------

页面不得让用户编辑：

6R
8R
10R
30%
25%
20%

第一版只展示冻结 experimental policies。

参数研究 UI 留 Step6。

--------------------------------------------------
二十四、研究免责声明文案
--------------------------------------------------

页面顶部用非常轻的一行：

“以下结果为历史路径研究，不是实时交易指令。”

不要做巨大警告框。

--------------------------------------------------
二十五、数据隐私
--------------------------------------------------

所有 CSV / JSON：

只在本地浏览器处理。

禁止：
fetch 外部服务器
上传
analytics
remote storage

不得把：
账户ID
Fill ID
Order ID

默认显示在 UI 主表。

详情调试可用缩略/隐藏形式。

--------------------------------------------------
二十六、移动端
--------------------------------------------------

Exit Research 主要是盘后桌面使用。

但 390px 至少：

不横向溢出
列表可切换到卡片式
详情顺序合理
trace可折叠

不要求移动端拥有桌面同样高的信息密度。

--------------------------------------------------
二十七、Production Data Safety
--------------------------------------------------

研究页面任何错误：

不得造成 Task Card canonical state 损坏。

读取 Task Card：
只读。

Research Store：
独立。

CSV / Bundle：
内存或 Research Store 明确数据。

如果 Research 页面崩溃：
首页状态卡仍必须正常。

--------------------------------------------------
二十八、Router / Navigation 测试
--------------------------------------------------

必须验证：

#/home
#/risk
#/exit-research
#/chime

全部正常。

Unknown route 仍正常。

浏览器后退/前进正常。

--------------------------------------------------
二十九、自动测试
--------------------------------------------------

至少覆盖：

1. route
2. current V5 records read-only
3. CSV import
4. Flat confirmation gate
5. Logical Trade reconstruction
6. reconciliation
7. ambiguous match UI model
8. manual confirmation
9. manual reject
10. Research Store round-trip
11. Market Bundle validation
12. request plan export
13. Actual 1R
14. Actual MFE/MAE
15. milestones
16. Replay Hard End missing
17. PB baseline
18. PB tight
19. PB hard ceiling
20. BOF manual actual
21. BOF fixed setup
22. BOF→PB comparison
23. Replay trace
24. Step3 blocked propagation
25. Market blocked propagation
26. Lookahead fail display
27. page render does not mutate Intraday state
28. Risk/Chime regression
29. desktop no overflow
30. 390px no overflow

以及所有 Step1–4B frozen tests 必须继续通过。

--------------------------------------------------
三十、开发方式
--------------------------------------------------

不要把所有代码塞进 app.js。

建议：

src/exit-research/ui/
  store.js
  controller.js
  view-model.js
  render.js
  export.js

或者等价合理结构。

生产 app.js 只负责 route 初始化 / 容器挂载。

--------------------------------------------------
三十一、第一版视觉
--------------------------------------------------

沿用现有统一交易控制中心设计语言。

不要重新做一套“量化平台”风格。

重点：

清楚
紧凑
可审计
不炫技

桌面建议：

左：
Research Trades

右：
Trade Detail / Metrics / Replay

顶部：
Data Preparation

具体布局可以按真实页面优化。

--------------------------------------------------
三十二、浏览器 QA
--------------------------------------------------

必须制作真实浏览器截图：

Desktop light
Desktop dark
390×844 mobile

至少包含：

A. 无数据
B. CSV导入后
C. 匹配列表
D. READY单笔详情
E. BLOCKED示例
F. Replay结果
G. Trace展开

全部用 synthetic 数据。

不得把用户真实交易数据放进截图或仓库。

--------------------------------------------------
三十三、验证
--------------------------------------------------

运行：

npm test
npm run build
node --check dist/app.bundle.js
git diff --check

并报告全部测试数。

--------------------------------------------------
三十四、完成边界
--------------------------------------------------

本轮不：

merge
push main
deploy

不做：
TradingView网络接入
自动下载行情
Post Exit
参数矩阵
Walk Forward
Skill
AI自动研究结论

完成一个独立 Step5A commit 后停止。

--------------------------------------------------
三十五、最终报告
--------------------------------------------------

返回：

1. branch
2. base main SHA
3. cherry-pick结果
4. Step5A commit SHA
5. 修改文件
6. router变化
7. Research Store schema
8. 数据导入流程
9. Matching UI
10. Market Bundle UI
11. Metrics UI
12. Replay UI
13. Trace UI
14. 数据隔离证明
15. 测试总数
16. build结果
17. desktop light/dark截图
18. mobile截图
19. 已知限制
20. 明确未部署

完成后停止等待人工验收。