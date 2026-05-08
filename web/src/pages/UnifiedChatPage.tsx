import { useSearchParams } from 'react-router';
import { ShadowChatShell } from '../app/components/shadow/ShadowChatShell';

export default function UnifiedChatPage() {
  const [params] = useSearchParams();
  return (
    <ShadowChatShell initialThreadId={params.get('thread')} initialOpenReportId={params.get('openReport')} />
  );
}

