interface FooterLinksProps {
  primaryText?: string;
  actionText?: string;
  onAction?: () => void;
}

export function FooterLinks({ primaryText, actionText, onAction }: FooterLinksProps) {
  return (
    <div className="mt-[16px] flex flex-col items-center gap-6 animate-[fade-in_250ms_ease-out_forwards]">
      {primaryText && actionText && onAction && (
        <p className="text-[14px] text-[var(--auth-text-secondary)]">
          {primaryText}{' '}
          <button 
            className="text-[var(--auth-text-primary)] hover:underline font-medium hover:text-[var(--auth-accent)] transition-colors" 
            onClick={onAction}
          >
            {actionText}
          </button>
        </p>
      )}
    </div>
  );
}
