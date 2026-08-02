import { Button } from '@/components/ui/button';

interface ForgotPasswordPanelProps {
  onBack: () => void;
}

/**
 * CB8 is a self-hosted, username-first server with no outbound email, so there
 * is no self-service email reset (the old flow silently "succeeded" and told
 * users to check an inbox that never receives anything). Accounts are managed by
 * an administrator, who can reset a password from User Management — so this panel
 * just points the user there instead of pretending to send a link.
 */
export default function ForgotPasswordPanel({ onBack }: ForgotPasswordPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-left">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Reset password</h2>
        <p className="text-sm text-muted-foreground">
          This server doesn't send password-reset emails. Ask an administrator to
          reset your password from User Management. If you're the administrator and
          have lost access, reset the admin password from the server console.
        </p>
      </div>

      <div className="flex justify-end pt-2 border-t border-border">
        <Button
          type="button"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          onClick={onBack}
        >
          Back to sign in
        </Button>
      </div>
    </div>
  );
}
