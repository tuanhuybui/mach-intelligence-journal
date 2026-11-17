-- MẠCH. anonymous aggregate analytics; data begins at deployment, not historical.
-- All underlying event tables are inaccessible from Supabase Data API.
CREATE TABLE IF NOT EXISTS private.mach_metrics_config (
 id smallint PRIMARY KEY CHECK(id=1),
 secret_sha256 text NOT NULL CHECK(length(secret_sha256)=64)
);
REVOKE ALL ON TABLE private.mach_metrics_config FROM PUBLIC,anon,authenticated;
INSERT INTO private.mach_metrics_config(id,secret_sha256)
 VALUES (1,'f63e6aefbbaf2067ec4ad3b716811c14f30acdd5fb73cc9f5934fde4b99eb72f')
 ON CONFLICT(id) DO UPDATE SET secret_sha256=excluded.secret_sha256;

CREATE TABLE IF NOT EXISTS public.mach_page_hits(
 page_key text NOT NULL CHECK(length(page_key) BETWEEN 1 AND 130),
 visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
 hit_day date NOT NULL,
 half_hour smallint NOT NULL CHECK(half_hour BETWEEN 0 AND 47),
 first_seen timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(page_key,visitor_hash,hit_day,half_hour)
);
CREATE INDEX IF NOT EXISTS mach_page_hits_date_idx ON public.mach_page_hits(hit_day DESC);
CREATE TABLE IF NOT EXISTS public.mach_article_hits(
 article_key text NOT NULL CHECK(length(article_key) BETWEEN 3 AND 110),
 visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
 hit_day date NOT NULL,
 half_hour smallint NOT NULL CHECK(half_hour BETWEEN 0 AND 47),
 first_seen timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(article_key,visitor_hash,hit_day,half_hour)
);
CREATE INDEX IF NOT EXISTS mach_article_hits_article_idx ON public.mach_article_hits(article_key);
CREATE TABLE IF NOT EXISTS public.mach_reactions(
 article_key text NOT NULL CHECK(length(article_key) BETWEEN 3 AND 110),
 visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
 liked boolean NOT NULL DEFAULT false,
 saved boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(article_key,visitor_hash)
);
CREATE INDEX IF NOT EXISTS mach_reactions_article_idx ON public.mach_reactions(article_key);
CREATE TABLE IF NOT EXISTS public.mach_share_clicks(
 article_key text NOT NULL CHECK(length(article_key) BETWEEN 3 AND 110),
 visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
 share_day date NOT NULL,
 channel text NOT NULL CHECK(channel IN ('copy','facebook','linkedin','native')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(article_key,visitor_hash,share_day,channel)
);
CREATE INDEX IF NOT EXISTS mach_share_clicks_article_idx ON public.mach_share_clicks(article_key);

ALTER TABLE public.mach_page_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mach_article_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mach_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mach_share_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mach_page_hits,public.mach_article_hits,public.mach_reactions,public.mach_share_clicks FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mach_metrics_track(
 p_secret text,p_visitor text,p_event text,p_article text DEFAULT NULL,
 p_page text DEFAULT NULL,p_channel text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_expected text;
 v_day date:=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
 v_bucket int:=(extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::int*2+
   floor(extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')/30)::int);
 v_liked boolean;
 v_saved boolean;
 v_exists boolean;
BEGIN
 SELECT secret_sha256 INTO v_expected FROM private.mach_metrics_config WHERE id=1;
 IF p_secret IS NULL OR length(p_secret)<40 OR encode(extensions.digest(p_secret,'sha256'),'hex')<>v_expected
 THEN RAISE EXCEPTION 'Unauthorized metrics event' USING ERRCODE='42501'; END IF;
 IF p_visitor IS NULL OR p_visitor !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid visitor'; END IF;
 IF p_event NOT IN ('page','view','like','save','share') THEN RAISE EXCEPTION 'Invalid event'; END IF;
 IF p_event='page' THEN
   IF p_page IS NULL OR length(p_page)>130 OR p_page !~ '^/[a-z0-9/_-]*$' THEN RAISE EXCEPTION 'Invalid page'; END IF;
   INSERT INTO public.mach_page_hits(page_key,visitor_hash,hit_day,half_hour)
   VALUES(p_page,p_visitor,v_day,v_bucket) ON CONFLICT DO NOTHING;
   RETURN jsonb_build_object('ok',true,'event','page');
 END IF;
 IF p_article IS NULL OR length(p_article)>110 OR p_article !~ '^[a-z0-9-]{3,110}$' THEN RAISE EXCEPTION 'Invalid article'; END IF;
 SELECT (EXISTS (SELECT 1 FROM public.mach_articles WHERE id::text=p_article AND status='published')
   OR p_article=ANY(ARRAY[
    'agent-khong-chi-chat','mo-hinh-ai-tren-thiet-bi','robotics-the-gioi-vat-ly',
    'ai-khoa-hoc-su-song','luong-tu-va-gioi-han','trung-tam-du-lieu-ai',
    'kinh-vien-vong-khong-gian','multimodal-ai','danh-gia-agent',
    'an-toan-ai','tri-nho-va-ngu-canh','khoa-hoc-lien-nganh'
   ])) INTO v_exists;
 IF NOT v_exists THEN RAISE EXCEPTION 'Unknown published article'; END IF;
 IF p_event='view' THEN
   INSERT INTO public.mach_page_hits(page_key,visitor_hash,hit_day,half_hour)
   VALUES('/bai-viet/'||p_article,p_visitor,v_day,v_bucket) ON CONFLICT DO NOTHING;
   INSERT INTO public.mach_article_hits(article_key,visitor_hash,hit_day,half_hour)
   VALUES(p_article,p_visitor,v_day,v_bucket) ON CONFLICT DO NOTHING;
   RETURN jsonb_build_object('ok',true,'event','view');
 END IF;
 IF p_event IN ('like','save') THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_article),hashtext(p_visitor));
   INSERT INTO public.mach_reactions(article_key,visitor_hash,liked,saved)
     VALUES(p_article,p_visitor,false,false) ON CONFLICT DO NOTHING;
   IF p_event='like' THEN
     UPDATE public.mach_reactions SET liked=NOT liked,updated_at=now()
     WHERE article_key=p_article AND visitor_hash=p_visitor
     RETURNING liked,saved INTO v_liked,v_saved;
   ELSE
     UPDATE public.mach_reactions SET saved=NOT saved,updated_at=now()
     WHERE article_key=p_article AND visitor_hash=p_visitor
     RETURNING liked,saved INTO v_liked,v_saved;
   END IF;
   RETURN jsonb_build_object('ok',true,'liked',v_liked,'saved',v_saved);
 END IF;
 IF p_channel NOT IN ('copy','facebook','linkedin','native') THEN RAISE EXCEPTION 'Invalid share channel'; END IF;
 INSERT INTO public.mach_share_clicks(article_key,visitor_hash,share_day,channel)
 VALUES(p_article,p_visitor,v_day,p_channel) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'event','share');
END $fn$;
REVOKE ALL ON FUNCTION public.mach_metrics_track(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mach_metrics_track(text,text,text,text,text,text) TO anon;

CREATE OR REPLACE FUNCTION public.mach_metrics_public(p_keys text[],p_visitor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_items jsonb;v_visits bigint;v_today bigint;
BEGIN
 IF p_keys IS NULL OR cardinality(p_keys)>120 THEN RAISE EXCEPTION 'Too many article keys'; END IF;
 SELECT coalesce(jsonb_object_agg(article_key,stats),'{}'::jsonb) INTO v_items FROM (
   SELECT k.article_key,
     jsonb_build_object(
       'views',(SELECT count(*) FROM public.mach_article_hits h WHERE h.article_key=k.article_key),
       'likes',(SELECT count(*) FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.liked),
       'saves',(SELECT count(*) FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.saved),
       'shares',(SELECT count(*) FROM public.mach_share_clicks s WHERE s.article_key=k.article_key),
       'liked',CASE WHEN p_visitor ~ '^[0-9a-f]{64}$' THEN EXISTS(SELECT 1 FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.visitor_hash=p_visitor AND r.liked) ELSE false END,
       'saved',CASE WHEN p_visitor ~ '^[0-9a-f]{64}$' THEN EXISTS(SELECT 1 FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.visitor_hash=p_visitor AND r.saved) ELSE false END
     ) AS stats
   FROM (SELECT distinct x AS article_key FROM unnest(p_keys) AS x WHERE x ~ '^[a-z0-9-]{3,110}$') k
 ) agg;
 SELECT count(*),count(DISTINCT visitor_hash) FILTER(WHERE hit_day=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
 INTO v_visits,v_today FROM public.mach_page_hits;
 RETURN jsonb_build_object('articles',coalesce(v_items,'{}'::jsonb),'site',jsonb_build_object('pageviews',v_visits,'visitors_today',v_today));
END $fn$;
REVOKE ALL ON FUNCTION public.mach_metrics_public(text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mach_metrics_public(text[],text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.mach_metrics_admin()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE totals jsonb;daily jsonb;top_articles jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.mach_is_admin())
 THEN RAISE EXCEPTION 'Admin only' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
   'pageviews',(SELECT count(*) FROM public.mach_page_hits),
   'unique_visitors',(SELECT count(DISTINCT visitor_hash) FROM public.mach_page_hits),
   'today_visitors',(SELECT count(DISTINCT visitor_hash) FROM public.mach_page_hits WHERE hit_day=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date),
   'article_views',(SELECT count(*) FROM public.mach_article_hits),
   'likes',(SELECT count(*) FROM public.mach_reactions WHERE liked),
   'saves',(SELECT count(*) FROM public.mach_reactions WHERE saved),
   'shares',(SELECT count(*) FROM public.mach_share_clicks)
 ) INTO totals;
 SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.day),'[]'::jsonb) INTO daily FROM (
   SELECT d::date AS day,
     (SELECT count(*) FROM public.mach_page_hits p WHERE p.hit_day=d::date) AS pageviews,
     (SELECT count(DISTINCT visitor_hash) FROM public.mach_page_hits p WHERE p.hit_day=d::date) AS visitors,
     (SELECT count(*) FROM public.mach_article_hits p WHERE p.hit_day=d::date) AS article_views
   FROM generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-13,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,interval '1 day') d
 ) t;
 SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY t.views DESC),'[]'::jsonb) INTO top_articles FROM (
   SELECT k.article_key,
    (SELECT a.title FROM public.mach_articles a WHERE a.id::text=k.article_key AND a.status='published' LIMIT 1) AS title,
    (SELECT count(*) FROM public.mach_article_hits h WHERE h.article_key=k.article_key) AS views,
    (SELECT count(*) FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.liked) AS likes,
    (SELECT count(*) FROM public.mach_reactions r WHERE r.article_key=k.article_key AND r.saved) AS saves,
    (SELECT count(*) FROM public.mach_share_clicks s WHERE s.article_key=k.article_key) AS shares
   FROM (SELECT distinct article_key FROM public.mach_article_hits
         UNION SELECT distinct article_key FROM public.mach_reactions
         UNION SELECT distinct article_key FROM public.mach_share_clicks) k
   ORDER BY views DESC LIMIT 30
 ) t;
 RETURN jsonb_build_object('totals',totals,'daily',daily,'top_articles',top_articles);
END $fn$;
REVOKE ALL ON FUNCTION public.mach_metrics_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mach_metrics_admin() TO authenticated;