# Supabase Auth email templates

Supabase → Authentication → Emails → Templates. For each template, set the subject and paste the HTML file as the body.
Regenerate with `node supabase/email/build-auth-templates.ts` after changing the layout.

| Template | Subject | Body file |
|---|---|---|
| Confirm signup | `Your VitaLink verification code: {{ .Token }}` | confirm-signup.html |
| Reset password | `Reset your VitaLink password` | reset-password.html |
| Magic link | `Your VitaLink sign-in code: {{ .Token }}` | magic-link.html |
| Change email address | `Confirm your new VitaLink email address` | change-email.html |
| Reauthentication | `Your VitaLink confirmation code: {{ .Token }}` | reauthentication.html |
| Invite user | `You've been invited to VitaLink` | invite-user.html |
