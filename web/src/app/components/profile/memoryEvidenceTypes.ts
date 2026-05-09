export type MemoryEvidenceItem = {
  id: string;
  type: 'profile' | 'chat_history' | 'decision_report' | 'memory' | 'calendar' | 'unknown' | string;
  label: string;
  shortText: string;
  fullText?: string;
  sourceId?: string;
  confidence?: number | null;
};
