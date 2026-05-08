export function CalendarUpload({
  onUpload,
  uploadedCount,
}: {
  onUpload: (file: File) => Promise<void>;
  uploadedCount: number;
}) {
  return (
    <label className="text-xs px-3 py-2 rounded-full border border-indigo-200 cursor-pointer bg-indigo-50 text-indigo-800 hover:bg-indigo-100">
      Upload .ics calendar
      <input
        className="hidden"
        type="file"
        accept=".ics,text/calendar"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file);
        }}
      />
      <span className="ml-2 text-gray-500">({uploadedCount})</span>
    </label>
  );
}

