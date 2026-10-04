// Presentation only. Frozen engine enums and serialized values remain unchanged.
export const DIRECTION_LABELS = Object.freeze({ LONG: '做多', SHORT: '做空' });
export const MATCH_STATUS_LABELS = Object.freeze({ MATCHED: '已匹配', REVIEW_REQUIRED: '需要人工确认', MATCH_AMBIGUOUS: '存在多个可能成交', NO_MATCH: '未找到对应成交', DATA_CONFLICT: '成交数据有冲突' });
export const QUALITY_LABELS = Object.freeze({ READY: '可正式比较', REVIEW_REQUIRED: '可查看，但建议复核', BLOCKED: '暂不能形成研究结论' });
export const QA_STATUS_LABELS = Object.freeze({ PASS: '通过', FAIL: '未通过', WARNING: '有提示', CONFLICT: '有冲突', INSUFFICIENT_DATA: '数据不足' });
export const POLICY_LABELS = Object.freeze({ PB_BASELINE_V1: 'PB 基准管理 V1', BOF_BASELINE_V1: 'BOF 基准管理 V1', PB_TIGHT_GIVEBACK_V1: 'PB 紧保护 V1', BOF_TIGHT_GIVEBACK_V1: 'BOF 紧保护 V1', PB_HARD_CEILING_V1: 'PB 固定上限 V1', BOF_HARD_CEILING_V1: 'BOF 固定上限 V1' });
export const EXIT_REASON_LABELS = Object.freeze({ STOP_TRIGGERED: '保护位触发', STOP_GAP_THROUGH: '价格跳过保护位后退出', INITIAL_STOP: '初始止损触发', HARD_CEILING: '达到固定上限后退出', HARD_CEILING_EXIT: '达到固定上限后退出', REPLAY_HARD_END: '到达研究截止时间', SOFT_CEILING: '进入高盈利保护阶段' });
export const TRACE_EVENT_LABELS = Object.freeze({ ENTRY: '真实入场', INITIAL_STOP_ACTIVE: '初始止损生效', BAR_STARTED: '开始下一根 5M，使用此前已知保护位', ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION: '入场边界不确定区间未用于策略激活', MFE_UPDATED: '更新最大已确认 MFE', MILESTONE_REACHED: '达到 {milestone}R', STAGE_CONFIRMED: '确认进入保护阶段', STAGE_EFFECTIVE: '管理阶段正式生效', PROTECTION_CALCULATED: '计算新的保护位', PROTECTION_EFFECTIVE: '新保护位生效', STOP_TRIGGERED: '保护位触发退出', BOF_TO_PB_MANUAL_RECORDED: '人工判断 BOF → PB', BOF_TO_PB_MANUAL_REVERTED: '撤销 BOF → PB，恢复 BOF 管理', POLICY_SWITCH_EFFECTIVE: '{setup} 管理正式生效', HARD_CEILING_CONFIRMED: '确认达到固定上限', HARD_CEILING_EXIT: '达到固定上限后退出', REPLAY_HARD_END_EXIT: '到研究截止时间退出', REPLAY_BLOCKED: '关键数据或边界条件不足，暂不能回放' });
export const MILESTONE_STATUS_LABELS = Object.freeze({ CONFIRMED_REACHED: '已确认达到', POSSIBLE_BOUNDARY_REACHED: '可能达到', NOT_REACHED: '未达到', DATA_INCOMPLETE: '数据不足' });
export const SETUP_LABELS = Object.freeze({ mtf_pb: 'MTF PB', htf_pb: 'MTF BOF（趋势走弱1次）', htf_bof: 'HTF BOF' });
export const SETUP_SOURCE_LABELS = Object.freeze({ MANUAL_ACTUAL: '按实际人工管理', FIXED_INITIAL_SETUP: '始终按原始 Setup 管理', RESEARCH_TRANSITION_RULE: '研究转换规则：暂未启用' });
export const STAGE_LABELS = Object.freeze({ INITIAL: '初始保护', RUNNER: '持有观察', PROTECT: '盈利保护', TARGET_REVIEW: '目标复核', EXTREME: '高盈利保护', SOFT_CEILING: '高盈利保护阶段', HARD_CEILING: '固定上限' });
export const COVERAGE_LABELS = Object.freeze({ COMPLETE: '完整', INCOMPLETE: '不完整' });
export const PRICE_SOURCE_LABELS = Object.freeze({ EXACT_EXECUTION_CONTRACT: '实际执行合约', SAME_EXPIRY_LARGE_CONTRACT_PROXY: '同到期大合约代理行情', CONTINUOUS_CONTRACT_PROXY: '连续合约代理行情', CONTEXT_MARKET: '背景市场行情' });
export const MARKET_ROLE_LABELS = Object.freeze({ EXECUTION_PRIMARY: '执行合约主行情', EXECUTION_DETAIL: '执行合约细节行情', CONTEXT: '背景市场行情' });
export const BOUNDARY_LABELS = Object.freeze({ WINDOW_START_FLAT_UNCONFIRMED: '尚未确认导出窗口起点为空仓，暂不重建正式成交', FLAT_CONFIRMED: '已人工确认导出窗口起点为空仓' });
export const QUALITY_EXPLANATIONS = Object.freeze({ READY: '数据完整，可用于策略对比。', REVIEW_REQUIRED: '结果可以参考，但存在边界、代理行情或辅助数据问题。', BLOCKED: '关键数据缺失或存在冲突。' });
export function displayLabel(labels, code) { return code == null ? '—' : labels[code] || '待核对'; }
