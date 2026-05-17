export function buildBehaviorLayer(): string {
  return '完成回复后思考：如果只是更新状态，写 TASKS.md/任务工具即可；如果只是知会，写群聊说明即可；只有需要其他角色执行新动作时，才用「@agent 请/需要 + 动作 + 具体交付物」发起 A2A。是否需要请求用户确认？如都不需要，正常结束即可。';
}
