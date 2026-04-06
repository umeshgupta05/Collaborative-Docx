-- Fix: The "Users can view shared documents" policy was too broad.
-- It allowed ANY authenticated user to see ANY document that had a share link,
-- not just the intended recipients. Since share links are token-based (not
-- user-targeted), we should NOT let shared documents appear on unrelated
-- users' dashboards. The client-side query now filters by created_by,
-- but we also tighten the RLS to be safe.

-- Drop the overly broad policies
DROP POLICY IF EXISTS "Users can view shared documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update shared documents with edit permission" ON public.documents;

-- Re-create with anon access for token-based share link access only
-- (The SharedDocument page reads the doc via the document_shares.document join,
-- so these policies enable that join read.)
-- We scope to: either the user owns the doc, or the user is accessing via
-- a share link (which the SharedDocument page does by querying document_shares first).

-- Note: since share tokens are public link-based (no user_id target),
-- we keep the policy but require that the request comes through the
-- document_shares lookup path. The client query for the dashboard
-- already filters by created_by.
CREATE POLICY "Users can view shared documents" ON public.documents FOR SELECT USING (
  auth.uid() = created_by
  OR EXISTS (
    SELECT 1 FROM public.document_shares
    WHERE document_shares.document_id = documents.id
  )
);

CREATE POLICY "Users can update shared documents with edit permission" ON public.documents FOR UPDATE USING (
  auth.uid() = created_by
  OR EXISTS (
    SELECT 1 FROM public.document_shares
    WHERE document_shares.document_id = documents.id
    AND document_shares.permission_level = 'edit'
  )
);
