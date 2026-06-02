CREATE TABLE IF NOT EXISTS public.conversation_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  extracted_text text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_documents TO authenticated;
GRANT ALL ON public.conversation_documents TO service_role;

ALTER TABLE public.conversation_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own conversation documents" ON public.conversation_documents;
DROP POLICY IF EXISTS "Users can insert own conversation documents" ON public.conversation_documents;
DROP POLICY IF EXISTS "Users can update own conversation documents" ON public.conversation_documents;
DROP POLICY IF EXISTS "Users can delete own conversation documents" ON public.conversation_documents;

CREATE POLICY "Users can view own conversation documents"
ON public.conversation_documents
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_documents.conversation_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own conversation documents"
ON public.conversation_documents
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_documents.conversation_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update own conversation documents"
ON public.conversation_documents
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_documents.conversation_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_documents.conversation_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete own conversation documents"
ON public.conversation_documents
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_documents.conversation_id
      AND c.user_id = auth.uid()
  )
);

CREATE TRIGGER update_conversation_documents_updated_at
BEFORE UPDATE ON public.conversation_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();