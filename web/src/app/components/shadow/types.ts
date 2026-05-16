export type ShadowRole = 'user' | 'assistant' | 'system';

export type ShadowMessage = {
  id: string;
  role: ShadowRole;
  content: string;
  created_at?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export type ThreadPendingAction = {
  id: string;
  type: 'clarification' | 'decision_report' | 'role_mode';
  title: string;
  message: string;
  blocks: string[];
  payload: Record<string, unknown>;
  created_at?: string;
  why?: string;
};

export type ShadowThread = {
  thread_id: string;
  title: string;
  updated_at?: string;
  mode?: string;
  pending_action?: ThreadPendingAction | null;
  messages?: ShadowMessage[];
  memory_events?: Array<{
    kind: string;
    items: string[];
    at: string;
    details?: Array<{
      action?: string;
      id?: string;
      text?: string;
      category?: string;
      confidence?: number;
      importance?: number;
      previous_id?: string;
    }>;
  }>;
  linked_decision_ids?: string[];
  active_report_context?: { decision_id: string; mode: string } | null;
  /** Rolling local summary — not durable profile memory */
  working_summary?: string;
  /** Ephemeral thread notes (jokes, roleplay, etc.) — never promoted without confirmation */
  temporary_context?: Array<Record<string, unknown>>;
};

export type ShadowSuggestion = {
  type: 'role_mode' | 'decision_report' | null;
  title: string;
  message: string;
};

export type AgentStatus =
  | 'idle'
  | 'reading_memory'
  | 'thinking'
  | 'responding'
  | 'updating_profile'
  | 'decision_detected'
  | 'report_generating'
  | 'report_complete'
  | 'scheduling'
  | 'report_open'
  | 'error';
