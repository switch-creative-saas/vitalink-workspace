// Attached files on a support message; each opens through a short-lived signed link.
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { attachmentLink, type Attachment } from '@/lib/supabase/support';

export function AttachmentChips({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  const open = async (path: string) => {
    // Open the tab during the click (browsers block popups opened after an await).
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await attachmentLink(path);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : 'Could not open the file');
    }
  };
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((file) => (
        <button key={file.path} type="button" onClick={() => void open(file.path)}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <Paperclip className="h-3 w-3" />{file.name}<span className="text-slate-400">{Math.max(1, Math.round(file.size / 1024))} KB</span>
        </button>
      ))}
    </div>
  );
}
