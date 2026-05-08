import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

export default function AppErrorPage() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : 'Something went wrong';
  const detail =
    isRouteErrorResponse(error) && typeof error.data === 'string'
      ? error.data
      : error instanceof Error
        ? error.message
        : 'Please refresh or return to home.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff5fb] via-[#f5f3ff] to-[#f0f9ff] px-6 py-12">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/90 bg-white/75 p-6 shadow-[0_16px_48px_rgba(99,102,241,0.12)] backdrop-blur-md">
        <h1 className="text-2xl text-gray-900" style={{ fontWeight: 700 }}>
          {title}
        </h1>
        <p className="mt-2 text-sm text-gray-600">{detail}</p>
        <div className="mt-5 flex items-center gap-2">
          <Link to="/" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Back home
          </Link>
          <Link to="/chat" className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 hover:bg-gray-50">
            Go to chat
          </Link>
        </div>
      </div>
    </div>
  );
}

