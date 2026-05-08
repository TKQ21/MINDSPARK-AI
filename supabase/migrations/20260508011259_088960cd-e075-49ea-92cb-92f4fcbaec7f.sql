
-- Drop old tables (will be replaced)
DROP TABLE IF EXISTS public.payment_requests CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;

-- Admin settings (singleton)
CREATE TABLE public.admin_settings (
  id INT PRIMARY KEY DEFAULT 1,
  qr_code_url TEXT,
  upi_id TEXT,
  pro_price INT NOT NULL DEFAULT 200,
  admin_password_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_settings_singleton CHECK (id = 1)
);
INSERT INTO public.admin_settings (id) VALUES (1);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read admin settings"
  ON public.admin_settings FOR SELECT TO authenticated USING (true);

-- Payment requests
CREATE TABLE public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT,
  txn_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_payment_requests_user ON public.payment_requests(user_id);
CREATE INDEX idx_payment_requests_status ON public.payment_requests(status);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own payment requests"
  ON public.payment_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own payment requests"
  ON public.payment_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User plans
CREATE TABLE public.user_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  tokens_used INT NOT NULL DEFAULT 0,
  question_count INT NOT NULL DEFAULT 0,
  image_gen_count INT NOT NULL DEFAULT 0,
  doc_upload_count INT NOT NULL DEFAULT 0,
  usage_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  pro_activated_at TIMESTAMPTZ,
  pro_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_plans_user ON public.user_plans(user_id);

ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plan"
  ON public.user_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_user_plans_updated_at
  BEFORE UPDATE ON public.user_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_admin_settings_updated_at
  BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create user_plan on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_plans (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_plan ON auth.users;
CREATE TRIGGER on_auth_user_created_plan
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_plan();

-- Backfill plans for existing users
INSERT INTO public.user_plans (user_id, email)
SELECT id, email FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Storage bucket for QR codes
INSERT INTO storage.buckets (id, name, public)
VALUES ('qr-codes', 'qr-codes', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "QR codes are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'qr-codes');
