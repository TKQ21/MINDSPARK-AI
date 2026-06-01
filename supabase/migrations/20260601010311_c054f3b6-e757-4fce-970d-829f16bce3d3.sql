-- Ensure required columns/defaults exist for per-user plans
ALTER TABLE public.user_plans
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN plan SET DEFAULT 'free',
  ALTER COLUMN question_count SET DEFAULT 0,
  ALTER COLUMN image_gen_count SET DEFAULT 0,
  ALTER COLUMN doc_upload_count SET DEFAULT 0,
  ALTER COLUMN tokens_used SET DEFAULT 0,
  ALTER COLUMN usage_reset_at SET DEFAULT (now() + interval '24 hours');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_plans_user_id_unique'
      AND conrelid = 'public.user_plans'::regclass
  ) THEN
    ALTER TABLE public.user_plans
      ADD CONSTRAINT user_plans_user_id_unique UNIQUE (user_id);
  END IF;
END;
$$;

-- Keep table reachable via the API for authenticated users while RLS protects rows
GRANT SELECT, INSERT, UPDATE ON public.user_plans TO authenticated;
GRANT ALL ON public.user_plans TO service_role;

-- RLS: each account can only work with its own plan row
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own plan" ON public.user_plans;
DROP POLICY IF EXISTS "Users can view own plan" ON public.user_plans;
DROP POLICY IF EXISTS "Users can update own plan" ON public.user_plans;
DROP POLICY IF EXISTS "Users can insert own plan" ON public.user_plans;

CREATE POLICY "Users can view own plan"
  ON public.user_plans
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own plan"
  ON public.user_plans
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own plan"
  ON public.user_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Auto-create/repair user_plans rows whenever a user is created
CREATE OR REPLACE FUNCTION public.handle_new_user_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_plans (
    user_id,
    email,
    plan,
    tokens_used,
    question_count,
    image_gen_count,
    doc_upload_count,
    usage_reset_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'free',
    0,
    0,
    0,
    0,
    now() + interval '24 hours'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.user_plans.email),
        usage_reset_at = COALESCE(public.user_plans.usage_reset_at, now() + interval '24 hours');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_plan ON auth.users;
CREATE TRIGGER on_auth_user_created_plan
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_plan();

-- Backfill/repair existing accounts
INSERT INTO public.user_plans (
  user_id,
  email,
  plan,
  tokens_used,
  question_count,
  image_gen_count,
  doc_upload_count,
  usage_reset_at
)
SELECT
  id,
  email,
  'free',
  0,
  0,
  0,
  0,
  now() + interval '24 hours'
FROM auth.users
ON CONFLICT (user_id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, public.user_plans.email),
      usage_reset_at = COALESCE(public.user_plans.usage_reset_at, now() + interval '24 hours');