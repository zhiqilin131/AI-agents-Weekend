type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-md'
                : 'bg-white/90 border border-gray-200 text-gray-900 rounded-bl-md'
            }`}
          >
            {m.content}
          </div>
        </div>
      ))}
    </div>
  );
}

