import { Upload } from 'lucide-react';

export function CalendarUpload({
  onUpload,
  uploadedCount,
}: {
  onUpload: (file: File) => Promise<void>;
  uploadedCount: number;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm backdrop-blur-sm hover:border-purple-200/80 hover:bg-white hover:shadow-md">
      <Upload className="h-3.5 w-3.5 shrink-0 text-purple-600" aria-hidden />
      ICS{uploadedCount > 0 ? ` · ${uploadedCount}` : ''}
      <input
        className="hidden"
        type="file"
        accept=".ics,text/calendar"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file);
        }}
      />
    </label>
  );
}

