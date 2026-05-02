export type PhaseStatus = 'planned' | 'active' | 'done';

export interface Phase {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  order: number;
  status: PhaseStatus;
  createdAt: string;
  updatedAt: string;
}