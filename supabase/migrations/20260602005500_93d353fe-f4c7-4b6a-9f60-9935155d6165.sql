CREATE OR REPLACE FUNCTION public.ensure_current_user_plan()
RETURNS public.user_plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result public.user_plans;
  current_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  current_email := auth.jwt() ->> 'email';

  INSERT INTO public.user_plans (user_id, email, plan, tokens_used, question_count, image_gen_count, doc_upload_count, usage_reset_at)
  VALUES (auth.uid(), current_email, 'free', 0, 0, 0, 0, now() + interval '24 hours')
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.user_plans.email),
        usage_reset_at = COALESCE(public.user_plans.usage_reset_at, now() + interval '24 hours'),
        updated_at = now();

  UPDATE public.user_plans
  SET plan = CASE
        WHEN plan = 'pro' AND pro_expires_at IS NOT NULL AND pro_expires_at > now() THEN 'pro'
        ELSE 'free'
      END,
      tokens_used = CASE WHEN usage_reset_at <= now() THEN 0 ELSE tokens_used END,
      question_count = CASE WHEN usage_reset_at <= now() THEN 0 ELSE question_count END,
      image_gen_count = CASE WHEN usage_reset_at <= now() THEN 0 ELSE image_gen_count END,
      doc_upload_count = CASE WHEN usage_reset_at <= now() THEN 0 ELSE doc_upload_count END,
      usage_reset_at = CASE WHEN usage_reset_at <= now() THEN now() + interval '24 hours' ELSE usage_reset_at END,
      updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_current_user_usage(
  usage_kind text,
  token_delta integer DEFAULT 0
)
RETURNS public.user_plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result public.user_plans;
BEGIN
  result := public.ensure_current_user_plan();

  IF result.plan = 'pro' AND result.pro_expires_at IS NOT NULL AND result.pro_expires_at > now() THEN
    RETURN result;
  END IF;

  UPDATE public.user_plans
  SET question_count = question_count + CASE WHEN usage_kind = 'question' THEN 1 ELSE 0 END,
      tokens_used = tokens_used + GREATEST(COALESCE(token_delta, 0), 0),
      image_gen_count = image_gen_count + CASE WHEN usage_kind = 'image' THEN 1 ELSE 0 END,
      doc_upload_count = doc_upload_count + CASE WHEN usage_kind = 'doc' THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_current_user_plan() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_current_user_usage(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_current_user_plan() FROM anon;
REVOKE ALL ON FUNCTION public.increment_current_user_usage(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_current_user_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_plan() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_current_user_usage(text, integer) TO service_role;