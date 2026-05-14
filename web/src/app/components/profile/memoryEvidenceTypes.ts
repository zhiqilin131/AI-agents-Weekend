export type MemoryEvidenceItem = {
  id: string;
  type: 'profile' | 'chat_history' | 'decision_report' | 'memory' | 'calendar' | 'unknown' | string;
  label: string;
  shortText: string;
  fullText?: string;
  sourceId?: string;
  confidence?: number | null;
  category?: string | null;
  importance?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastReinforcedAt?: string | null;
};
