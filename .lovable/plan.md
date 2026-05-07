# MindSpark AI — Subscription, Payments & Multi-Model System

This is a large change. Before I build, I want to align on a few important decisions because some parts of the spec conflict with how Lovable projects work.

## Important constraints (must read)

1. **No Node `/api/*` backend.** Lovable runs a Vite/React frontend + Supabase edge functions. So the endpoints will be Supabase edge functions (`create-payment`, `verify-payment`, `activate-pro`, `payment-webhook`), called via `supabase.functions.invoke`. Same behavior, different transport.

2. **Real UPI payments need a gateway.** A raw `upi://pay?pa=...` QR cannot be auto-verified — UPI has no public "did this txn succeed" API for individuals. To actually verify payment server-side you need **Razorpay / Cashfree / Paddle**. For now I'll build it with a **mock gateway** (polling returns success after ~5s in dev) and a clean integration point so we can plug Razorpay later. Lovable also has built-in Paddle support if you'd prefer real payments now — say the word and I'll wire that instead.

3. **API keys you pasted are now public.** You shared `VITE_GEMINI_API_KEY` and `VITE_GROQ_API_KEY` in chat. Anything prefixed `VITE_` is shipped to the browser and visible to every visitor. **Please rotate both keys immediately.** I will NOT put third-party keys in `VITE_` vars. Instead, all model calls go through a Supabase edge function that reads `GEMINI_API_KEY` / `GROQ_API_KEY` / `MISTRAL_API_KEY` as server secrets. I'll prompt you to add them via the secrets tool.

4. **JWT for Pro plan.** I'll store a signed JWT issued by the `activate-pro` edge function (signed with `JWT_SECRET` server secret) in localStorage, and re-verify it server-side on every Pro-gated call. Client also decodes it for UI gating.

5. **Lovable AI Gateway already covers Gemini.** I'll keep the existing `chat` edge function (Gemini via Lovable AI) as the Free path, and add Groq + Mistral routing in the same function for Pro models. This avoids extra SDKs in the browser.

## What I'll build

### A. Database (Supabase migration)
- `payment_requests` table: `id (uuid)`, `user_id`, `txn_id`, `amount`, `currency`, `status (pending/success/failed)`, `created_at`, `expires_at`. RLS: user can read own rows; only service role writes status.
- `subscriptions` table: `user_id`, `plan ('free'|'pro')`, `activated_at`, `expires_at`, `txn_id`. RLS: user can read own.

### B. Edge functions
- `create-payment` — creates a `payment_requests` row, returns `{ txnId, qrPayload, expiresAt }`. Rate-limited 3/hour/user.
- `verify-payment` — returns current status. In dev: marks `success` after 5s.
- `activate-pro` — verifies row is `success`, issues JWT (`{userId, plan:'pro', iat, exp:+30d, txnId}`) using `JWT_SECRET`, upserts `subscriptions`.
- `payment-webhook` — signature-verified endpoint to receive real gateway callbacks (stub now, ready for Razorpay).
- `chat` (existing) — extended to accept `model` param. Server enforces: if user not Pro → force `gemini-1.5-flash`. Routes Gemini via Lovable AI Gateway, Groq via Groq SDK (server-side), Mistral via Mistral API (server-side).

### C. Frontend
- **Sidebar**: add new **Upgrade** item between History and Settings. Sidebar drives a `view` state in `ChatInterface` (`chat | upgrade | settings`).
- **Upgrade page** (`src/components/UpgradePage.tsx`): hero, two plan cards (Free disabled, Pro highlighted), "Upgrade to Pro →" button → opens QR modal.
- **QR modal** (`src/components/PaymentQRModal.tsx`): generates QR client-side from server `qrPayload` using `qrcode` npm package, 10-min countdown, "I've completed the payment" → starts polling `verify-payment` every 5s, on success calls `activate-pro`, stores JWT, success animation, refreshes plan.
- **Settings page** (refactor): remove payment UI. Show current plan status + Free vs Pro comparison table + Models table (9 rows with lock state) + "Upgrade to Pro" CTA that switches view to Upgrade.
- **Daily limit banner** (`src/components/UsageBanner.tsx`): top of chat. 75% yellow, 90% orange, 100% red full-block with live countdown and Upgrade CTA. Uses `useTokenUsage` (already exists, will extend to use new plan source).
- **Plan hook** (`src/hooks/usePlan.ts`): reads JWT from localStorage, decodes with `jwt-decode`, exposes `{ isPro, expiresAt, plan }`. Auto-clears expired JWT.
- **Model selector** (in `ChatInterface` input bar): grouped dropdown (Google / Meta-Groq / Mistral). Free users see all 9 with lock icons + Pro badge on locked ones; only Gemini 1.5 Flash selectable. Pro users get full access. Selection persisted in localStorage `mindspark_selected_model`. Uses shadcn `Select` styled with dark `#0d1117` / `#e6edf3` per spec.
- **Dropdown dark theme**: update shadcn `select.tsx` `SelectContent` / `SelectItem` defaults (or add a wrapper) so every dropdown across the app uses the dark palette.

### D. Limit enforcement
- `useTokenUsage` already tracks tokens/images/docs in localStorage with 24h reset. I'll wire it to:
  - Block sending messages when `tokensExceeded` (Free only).
  - Block image gen when `imagesExceeded`.
  - Block doc upload when `docsExceeded`.
  - Banner driven by `usage.tokens / tokenBudget` ratio.
- Pro users (JWT valid) bypass all checks.

### E. Packages to install
- `qrcode` + `@types/qrcode` (client QR rendering)
- `jwt-decode` (client JWT parsing)
- Server-side: `groq-sdk`, `@mistralai/mistralai` imported in the edge function via esm.sh.

## What I will NOT do (and why)
- I will **not** add `VITE_GEMINI_API_KEY` / `VITE_GROQ_API_KEY` / `VITE_MISTRAL_API_KEY` to the client. Browser-exposed third-party keys are an immediate abuse/cost risk. All calls go through edge functions using server secrets.
- I will **not** call `groq-sdk` or `@mistralai/mistralai` from the browser, even with `dangerouslyAllowBrowser`.
- I will **not** hardcode any UPI ID — it'll come from server config / a `MERCHANT_UPI_ID` server secret you set.

## Secrets I'll need you to add (after you approve the plan)
- `JWT_SECRET` (random string, ≥32 chars)
- `GEMINI_API_KEY` (server) — optional; Lovable AI Gateway already provides Gemini for free, so this is only needed if you want direct Google billing
- `GROQ_API_KEY` (server)
- `MISTRAL_API_KEY` (server)
- `MERCHANT_UPI_ID` (your real UPI handle for the QR payload)

## Build order
1. DB migration (payment_requests, subscriptions) → wait for your approval.
2. Edge functions (create/verify/activate/webhook + extend chat for multi-model).
3. Sidebar "Upgrade" nav item + view routing.
4. Upgrade page + QR modal + polling + JWT storage.
5. usePlan hook + integrate with useTokenUsage gating.
6. Usage banner with live countdown.
7. Model selector dropdown (grouped, locked states).
8. Dark dropdown styling pass.
9. Settings refactor (comparison table + models table + CTA only).

## Please confirm
1. Use **mock payment gateway** (auto-success in 5s for dev), with Razorpay integration hooks ready — OR enable **Lovable Paddle** for real payments now?
2. You acknowledge the leaked Gemini & Groq keys above must be rotated by you in their consoles?
3. OK to proceed with all 9 build steps in one go after migration approval?
