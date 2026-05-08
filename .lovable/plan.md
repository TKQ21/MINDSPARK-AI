## MindSpark Pro — QR Payment + Admin Panel Implementation

### 1. Database (migration)
- Create `admin_settings` table (id=1 singleton: qr_code_url, upi_id, pro_price, admin_password_hash, updated_at). Seed row id=1.
- Recreate `payment_requests` to match new shape (email, txn_id unique, status, submitted_at, reviewed_at). Drop old payment_requests since we're changing schema significantly.
- Create `user_plans` table (user_id unique, email, plan, tokens_used, image_gen_count, doc_upload_count, usage_reset_at, pro_activated_at, pro_expires_at). Trigger on new user → insert default free row.
- RLS:
  - `admin_settings`: SELECT public to authenticated/anon (for QR URL on upgrade page). No UPDATE via RLS — admin updates via edge function with service role.
  - `payment_requests`: user can SELECT/INSERT own rows. No UPDATE for users.
  - `user_plans`: user can SELECT own row. No UPDATE for users.
- Storage bucket `qr-codes` (public). RLS allow public read.

### 2. Edge Functions (admin operations using service role)
- `admin-auth`: verify password (returns success), or set initial password if none. Uses SHA-256 client-side too, but server validates against stored hash.
- `admin-update-settings`: update upi_id / pro_price / qr_code_url / admin_password_hash. Requires password in body.
- `admin-list-requests`: list all payment_requests (requires password).
- `admin-review-request`: approve/reject payment request, on approve update user_plans to pro for 30 days. Requires password.
- `submit-payment`: user submits txn_id; inserts into payment_requests for their auth.uid().

(All admin endpoints accept `password` in body, hash + compare to admin_settings.admin_password_hash. Simple but matches the "no real auth" approach.)

### 3. Frontend routes
- Add `/admin` route (`src/pages/Admin.tsx`):
  - Password gate (sessionStorage `admin_authed`).
  - First-time setup flow if no hash stored.
  - 3 tabs: Payment Requests, QR & Settings, Change Password.
- Update `UpgradePage.tsx`:
  - Show Free vs Pro comparison cards (limits: 10 questions/day, 5 images/day, 3 docs).
  - "Pay ₹200 via UPI" → modal showing QR image (from admin_settings.qr_code_url) + UPI ID + txn_id input → calls `submit-payment`.
  - Remove the demo "Try Pro" button.
- Sidebar (`ChatSidebar.tsx`): show badge — Pro / Pro Pending / Free — based on user_plans + latest payment_request.

### 4. Limits & model gating
- Update `useTokenUsage` (or new `usePlan` hook) to read plan from `user_plans` table (with localStorage fallback). New free limits:
  - questions: 10/day (replace token budget gating with question count)
  - images: 5/day
  - docs: 3/day
- All 7 models locked for free users (only `gemini-1.5-flash` allowed). Pro = unlimited + all models. ModelSelector shows lock icons; selecting locked model triggers upgrade prompt.
- Daily reset at `usage_reset_at` (24h rolling). Reset on next request via edge function or client check.

### 5. Dropdown styling fix
- Find language dropdown (likely native `<select>` in InsightsPanel / settings) — apply dark bg `#0d1117` text `#e6edf3` styles, or replace with shadcn `<Select>` already themed.

### 6. Test flow
- Visit `/admin` → set password → upload QR → set UPI ID.
- Free user → click Upgrade → scan QR → enter txn_id → submit.
- Admin → approve → user becomes Pro → all models unlock.

### Technical notes
- Password hashing: SHA-256 via `crypto.subtle.digest` on client, hex string sent to server, server compares to stored hash. Admin endpoints rely on this shared secret (same as if admin password was sent directly — acceptable for this demo system; document as such).
- Storage upload from client uses anon key with public bucket + permissive insert policy (since admin auth is custom). To keep it safer: do the upload via edge function with service role, accepting base64 from admin client.
- Drop existing `payment_requests` and `subscriptions` tables (subscriptions replaced by user_plans).

### Files to create/modify
- New: `supabase/functions/admin-auth/index.ts`, `admin-settings/index.ts`, `admin-requests/index.ts`, `submit-payment/index.ts`
- New: `src/pages/Admin.tsx` + small components inline
- New: `src/hooks/useUserPlan.ts`
- Modify: `src/App.tsx` (route), `src/components/UpgradePage.tsx`, `src/components/ChatSidebar.tsx`, `src/components/ModelSelector.tsx`, `src/components/InsightsPanel.tsx` (dropdown fix), `src/components/ChatInterface.tsx` (use new limits), `supabase/functions/chat/index.ts` (enforce pro from DB).
