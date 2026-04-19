import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';

export function PageBackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/')}
      className="inline-flex items-center gap-2 mb-8 px-4 py-2.5 rounded-full text-sm bg-white/80 backdrop-blur-sm border border-white/90 text-gray-800 shadow-sm hover:bg-white hover:shadow-md hover:border-purple-200/80 transition-all focus:outline-none focus:ring-2 focus:ring-purple-400/40"
      style={{ fontWeight: 600 }}
    >
      <ArrowLeft className="w-4 h-4 text-purple-600 shrink-0" aria-hidden />
      Back to home
    </button>
  );
}
