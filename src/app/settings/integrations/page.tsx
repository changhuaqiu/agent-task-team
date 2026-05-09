import type { Metadata } from 'next';
import { IntegrationSettingsPage } from '@/components/settings/IntegrationSettingsPage';

export const metadata: Metadata = {
  title: '集成配置中心 · 智能体任务中心',
  description: '查看模型账号、角色素材、技能、团队套件与执行环境状态',
};

export default function SettingsIntegrationsRoute() {
  return <IntegrationSettingsPage />;
}
