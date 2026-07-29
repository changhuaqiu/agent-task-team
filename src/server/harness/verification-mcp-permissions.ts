import type { DispatchSource } from '../repositories/control-plane-types';

const PLAYWRIGHT_VERIFICATION_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_hover',
  'browser_press_key',
  'browser_wait_for',
  'browser_take_screenshot',
  'browser_tabs',
  'browser_close',
  'browser_console_messages',
  'browser_network_requests',
  'browser_evaluate',
] as const;

export function verificationAutoApprovedMcpToolNames(
  source: DispatchSource | undefined,
): string[] {
  if (source !== 'test_gate' && source !== 'review_gate') return [];
  return PLAYWRIGHT_VERIFICATION_TOOLS.flatMap((toolName) => [
    `mcp.playwright.${toolName}`,
    `mcp__playwright__${toolName}`,
  ]);
}
