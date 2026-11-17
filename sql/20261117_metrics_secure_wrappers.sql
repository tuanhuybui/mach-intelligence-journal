-- Keep privileged functions in non-exposed schema and expose invoker-only wrappers.
ALTER FUNCTION public.mach_metrics_track(text,text,text,text,text,text) SET SCHEMA private;
ALTER FUNCTION public.mach_metrics_public(text[],text) SET SCHEMA private;
ALTER FUNCTION public.mach_metrics_admin() SET SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon,authenticated;
REVOKE ALL ON FUNCTION private.mach_metrics_track(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.mach_metrics_public(text[],text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.mach_metrics_admin() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mach_metrics_track(text,text,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION private.mach_metrics_public(text[],text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mach_metrics_admin() TO authenticated;
CREATE FUNCTION public.mach_metrics_track(p_secret text,p_visitor text,p_event text,p_article text DEFAULT NULL,p_page text DEFAULT NULL,p_channel text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.mach_metrics_track(p_secret,p_visitor,p_event,p_article,p_page,p_channel);
$$;
CREATE FUNCTION public.mach_metrics_public(p_keys text[],p_visitor text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.mach_metrics_public(p_keys,p_visitor);
$$;
CREATE FUNCTION public.mach_metrics_admin() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.mach_metrics_admin();
$$;
REVOKE ALL ON FUNCTION public.mach_metrics_track(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mach_metrics_public(text[],text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mach_metrics_admin() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mach_metrics_track(text,text,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.mach_metrics_public(text[],text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mach_metrics_admin() TO authenticated;