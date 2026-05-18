import { MarkdownContent } from '../MarkdownContent';

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

  return <MarkdownContent content={content} />;
}
