import React from 'react';

/**
 * A shared empty-state block for the library. Used by the grid for three
 * distinct situations — an empty library (with onboarding CTAs for admins), a
 * search/filter with no matches (with a "clear" action), and an empty
 * collection — so failed searches never reuse the genuinely-empty illustration.
 */
export default function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6 select-none">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      )}
      {actions && <div className="flex flex-wrap items-center justify-center gap-2 mt-1">{actions}</div>}
    </div>
  );
}
