import { renderChatMarkdown } from '../../../utils/chatMarkdown';

export function ChatMessageBody({
  content,
  role,
}: {
  content: string;
  role: 'user' | 'assistant' | 'system';
}) {
  if (role === 'user') {
    return <span className="whitespace-pre-wrap">{content || '\u00a0'}</span>;
  }

  return (
    <div className="chat-message-markdown space-y-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
      {renderChatMarkdown(content)}
    </div>
  );
}
