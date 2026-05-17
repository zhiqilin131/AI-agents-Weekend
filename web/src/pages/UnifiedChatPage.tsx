import { useSearchParams } from 'react-router';
import { ShadowChatShell } from '../app/components/shadow/ShadowChatShell';
import { normalizeSlimeType } from '../features/slime/slimeIdentity';

export default function UnifiedChatPage() {
  const [params] = useSearchParams();
  const initialSlimeType = normalizeSlimeType(params.get('slime')) ?? 'generalized';
  return (
    <ShadowChatShell
      initialThreadId={params.get('thread')}
      initialOpenReportId={params.get('openReport')}
      initialSlimeType={initialSlimeType}
    />
  );
}

