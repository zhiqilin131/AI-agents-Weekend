import { cn } from './ui/utils';
import { renderChatMarkdown } from '../../utils/chatMarkdown';

const BASE =
  'chat-message-markdown space-y-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul:first-child]:mt-0 [&_ul:last-child]:mb-0';

type Props = {
  content: string;
  className?: string;
};

/** Renders LLM prose with lightweight markdown (bold, italic, lists, blockquotes). */
export function MarkdownContent({ content, className }: Props) {
  return <div className={cn(BASE, className)}>{renderChatMarkdown(content)}</div>;
}
