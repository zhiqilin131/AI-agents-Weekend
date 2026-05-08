import { Plus, Trash2 } from 'lucide-react';
import type { ShadowThread } from './types';

export function ChatSidebar({
  threads,
  activeThreadId,
  onNewChat,
  onSelectThread,
  onDeleteThread,
}: {
  threads: ShadowThread[];
  activeThreadId: string | null;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
}) {
  return (
    <aside className="rounded-3xl border border-white/90 bg-white/60 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-md">
      <button
        type="button"
        onClick={onNewChat}
        className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white"
      >
        <Plus className="h-4 w-4" />
        New Chat
      </button>
      <div className="space-y-2">
        {threads.map((t) => {
          const active = t.thread_id === activeThreadId;
          return (
            <div
              key={t.thread_id}
              className={`group flex items-center gap-2 rounded-xl border px-3 py-2 ${
                active ? 'border-indigo-300 bg-indigo-50/85' : 'border-gray-200 bg-white/80'
              }`}
            >
              <button type="button" className="flex-1 truncate text-left text-sm text-gray-800" onClick={() => onSelectThread(t.thread_id)}>
                {t.title || 'New chat'}
              </button>
              <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onDeleteThread(t.thread_id)}>
                <Trash2 className="h-3.5 w-3.5 text-gray-500" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

