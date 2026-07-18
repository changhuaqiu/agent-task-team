export function buildBehaviorLayer(): string {
  return '完成回复前检查：本轮承诺的动作是否已有可核验结果或明确阻塞；是否涉及需要用户确认的高风险操作。没有后续动作时正常结束，不虚构执行状态。';
}
