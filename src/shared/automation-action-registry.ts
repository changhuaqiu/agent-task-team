export const AUTOMATION_PRODUCT_COMMAND_REGISTRY = [
  {
    name: 'work.create',
    label: '创建正式工作',
    description: '在当前 Project 中创建一条可追踪的 Work。',
  },
] as const;

export type AutomationProductCommandName = (typeof AUTOMATION_PRODUCT_COMMAND_REGISTRY)[number]['name'];

export function isAutomationProductCommandName(value: string): value is AutomationProductCommandName {
  return AUTOMATION_PRODUCT_COMMAND_REGISTRY.some((entry) => entry.name === value);
}
