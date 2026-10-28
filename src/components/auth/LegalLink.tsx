// "Terms of Service" / "Privacy Policy" links on the sign-in and sign-up pages. They open the
// documents from www.vitalink.africa in a dialog, so people can read them without leaving sign-up.
import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LEGAL_DOCUMENTS } from '@/content/legal';

export function LegalLink({ doc, children, className }: { doc: 'terms' | 'privacy'; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const document = LEGAL_DOCUMENTS[doc];

  return (
    <>
      <a
        href={document.url}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}
        className={className}
      >
        {children}
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl bg-white p-0 dark:bg-slate-900">
          <DialogHeader className="border-b border-slate-100 px-6 py-4 text-left dark:border-slate-800">
            <DialogTitle className="text-lg text-slate-900 dark:text-slate-50">{document.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>Last updated {document.lastUpdated}</span>
              <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#1E4ED8] hover:underline">
                Open on vitalink.africa <ExternalLink className="h-3 w-3" />
              </a>
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {document.blocks.map((block, index) => {
              if (block.type === 'heading') return <h3 key={index} className="mb-2 mt-6 text-base font-semibold text-slate-900 first:mt-0 dark:text-slate-50">{block.text}</h3>;
              if (block.type === 'subheading') return <h4 key={index} className="mb-1.5 mt-4 font-semibold text-slate-800 dark:text-slate-100">{block.text}</h4>;
              if (block.type === 'list') return <ul key={index} className="mb-3 list-disc space-y-1 pl-5">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
              return <p key={index} className="mb-3">{block.text}</p>;
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
