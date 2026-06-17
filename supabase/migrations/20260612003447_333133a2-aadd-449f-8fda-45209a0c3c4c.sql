
CREATE POLICY "owner reads expert-sources" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expert-sources' AND public.is_owner());
CREATE POLICY "owner uploads expert-sources" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expert-sources' AND public.is_owner());
CREATE POLICY "owner updates expert-sources" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'expert-sources' AND public.is_owner())
  WITH CHECK (bucket_id = 'expert-sources' AND public.is_owner());
CREATE POLICY "owner deletes expert-sources" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expert-sources' AND public.is_owner());
