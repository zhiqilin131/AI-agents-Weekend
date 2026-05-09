/** Diary API shapes (mirror backend). */

export type DiaryTone = 'reflective' | 'focused' | 'uncertain' | 'excited' | 'stressed' | 'neutral' | 'mixed';

export type DiaryMonthDay = {
  date: string;
  id?: string | null;
  has_entry: boolean;
  title?: string;
  tone?: DiaryTone | null;
  summary_preview?: string;
};

export type DiarySourceCounts = {
  chat_messages: number;
  voice_turns: number;
  reports: number;
  calendar_items: number;
  memory_refs: number;
  imported_items: number;
};

export type DiaryEntryDto = {
  id: string;
  user_id: string;
  date: string;
  timezone?: string;
  title: string;
  summary: string;
  highlights: string[];
  themes: string[];
  tone?: DiaryTone | null;
  action_items: { title: string; source: string; source_id?: string; completed?: boolean }[];
  linked_thread_ids: string[];
  linked_message_ids?: string[];
  linked_decision_ids: string[];
  linked_calendar_event_ids: string[];
  linked_memory_ids?: string[];
  linked_import_ids?: string[];
  source_counts: DiarySourceCounts;
  generated_by: string;
  user_edited: boolean;
  visibility?: string;
  memory_status: string;
  memory_indexed: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DiaryJumpPhase = 'idle' | 'preparing_jump' | 'jumping' | 'landing';
