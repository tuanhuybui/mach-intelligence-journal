/** MẠCH. server API. Supabase publishable key only; RLS enforces moderation. */
const crypto = require('node:crypto');
const BASE = process.env.SUPABASE_URL || 'https://njkpjhocifgbqyxzkeob.supabase.co';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_xda658Yjb7Zsd60HormYPA_hGD6tgLn';
const CATS = ['AI','AI Agent','Công nghệ','Khoa học','Robotics','Tương lai'];
const send=(res,code,body,cacheSeconds=0)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control',cacheSeconds&&code===200?`public, s-maxage=${cacheSeconds}, stale-while-revalidate=90`:'no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));};
const clean=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
const idOK=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/i.test(s);
const eq=(x,y)=>{if(typeof x!=='string'||!y||y.length<24)return false;const a=Buffer.from(x),b=Buffer.from(y);return a.length===b.length&&crypto.timingSafeEqual(a,b);};
const apiURL=(table,query='')=>`${BASE}/rest/v1/${table}${query?'?'+query:''}`;
async function supa(method,url,body,token,prefer){const headers={'apikey':KEY,'Content-Type':'application/json','Accept':'application/json'};if(token)headers.Authorization=`Bearer ${token}`;if(prefer)headers.Prefer=prefer;const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(14000)});const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data={error:raw.slice(0,300)};}if(!r.ok){const error=new Error(data?.msg||data?.message||data?.error_description||data?.error||'Yêu cầu đến Supabase thất bại.');error.status=r.status;throw error;}return data;}
function article(b){if(!b||typeof b!=='object')throw Object.assign(new Error('Thiếu dữ liệu bài viết.'),{status:400});const v={title:clean(b.title,180),excerpt:clean(b.excerpt,420),category:clean(b.category,40),author:clean(b.author,100),author_email:clean(b.author_email,254)||null,image:clean(b.image,1200),body:clean(b.body,50000),source_urls:Array.isArray(b.source_urls)?b.source_urls.slice(0,12).filter(x=>typeof x==='string'&&/^https?:\/\//.test(x)).map(x=>x.slice(0,1000)):[]};if(v.title.length<10||v.excerpt.length<20||v.author.length<2||v.body.length<80||!CATS.includes(v.category))throw Object.assign(new Error('Bài viết thiếu tiêu đề, chuyên mục, tác giả hoặc nội dung (tối thiểu 80 ký tự).'),{status:400});if(v.image && !/^(https?:\/\/|data:image\/svg\+xml;base64,)/.test(v.image))throw Object.assign(new Error('Ảnh bìa không hợp lệ.'),{status:400});return v;}
const authToken=req=>{const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):'';};
async function ensureAdmin(req){const jwt=authToken(req);if(!jwt)throw Object.assign(new Error('Bạn cần đăng nhập Admin.'),{status:401});const user=await supa('GET',`${BASE}/auth/v1/user`,undefined,jwt);const gate=await supa('GET',apiURL('mach_admin_gate','select=id&limit=1'),undefined,jwt);if(!gate?.length)throw Object.assign(new Error('Tài khoản này không có quyền Admin.'),{status:403});return {jwt,user};}
const mapPost=r=>({id:r.id,title:r.title,excerpt:r.excerpt,category:r.category,author:r.author,image:r.image||'',body:r.body,date:String(r.published_at||r.created_at||'').slice(0,10),status:r.status,source_type:r.source_type,author_email:r.author_email,source_urls:r.source_urls,agent_name:r.agent_name,review_note:r.review_note,created_at:r.created_at,published_at:r.published_at});
// Anonymous, non-identifying analytics cookie. One view per visitor / article / half-hour.
const METRICS_SECRET = process.env.MACH_METRICS_SECRET || '';
const VISITOR_COOKIE = 'mach_visit';
function metricVisitor(req,res,create=false){
 const raw=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(VISITOR_COOKIE+'='));
 let token=raw?.slice(VISITOR_COOKIE.length+1)||'';
 if(!/^[0-9a-f]{32}$/.test(token)){
   if(!create)return null;
   token=crypto.randomBytes(16).toString('hex');
   res.setHeader('Set-Cookie',`${VISITOR_COOKIE}=${token}; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`);
 }
 return crypto.createHmac('sha256',METRICS_SECRET).update(token).digest('hex');
}
const isAutomated=req=>/bot|crawler|spider|preview|headless|pingdom|uptime|lighthouse|curl|postman|python-requests/i.test(String(req.headers['user-agent']||'')) ||
   String(req.headers['sec-purpose']||req.headers.purpose||'').includes('prefetch');
async function metricCounts(keys,visitor){
 const obj=await supa('POST',apiURL('rpc/mach_metrics_public'),{p_keys:keys,p_visitor:visitor||null});
 return obj||{articles:{},site:{pageviews:0,visitors_today:0}};
}

/* MẠCH. benchmark gateway. Fixed upstream URLs, cache and explicit provenance. */
let benchCache=null,benchCacheUntil=0;
const BENCH_OPEN='https://huggingface.co/datasets/OpenEvals/leaderboard-data/resolve/main/leaderboard.json';
const BENCH_SWE='https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/leaderboard';
async function fetchBenchmarkJSON(url,key=''){
 const headers={'Accept':'application/json','User-Agent':'MACH-Journal-Benchmark/1.0'};
 if(key)headers['x-api-key']=key;
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(9000)});
 if(!r.ok)throw Error('Upstream '+new URL(url).hostname+' HTTP '+r.status);
 const body=await r.text();if(body.length>2_000_000)throw Error('Upstream payload too large');
 return JSON.parse(body);
}
function finiteScore(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100?n:null;}
async function benchmarkPayload(){
 if(benchCache&&Date.now()<benchCacheUntil)return benchCache;
 const key=process.env.ARTIFICIAL_ANALYSIS_API_KEY||'';
 const [swe,open,aa]=await Promise.allSettled([
   fetchBenchmarkJSON(BENCH_SWE),
   fetchBenchmarkJSON(BENCH_OPEN),
   key?fetchBenchmarkJSON('https://artificialanalysis.ai/api/v2/language/models/free?page=1',key):Promise.resolve(null)
 ]);
 const sources={
  swe:{name:'SWE-bench Verified / Hugging Face',url:'https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified',updated:'Không công bố',models:[]},
  open:{name:'OpenEvals / Hugging Face (lịch sử)',url:'https://huggingface.co/datasets/OpenEvals/leaderboard-data',updated:'Không công bố',models:[]},
  aa:{name:'Artificial Analysis',url:'https://artificialanalysis.ai/data-api/docs',updated:'Theo API',models:[]}
 };
 if(swe.status==='fulfilled'&&Array.isArray(swe.value)){
  sources.swe.models=swe.value.slice(0,600).map(v=>({
   id:String(v.modelId||''),name:String(v.modelId||''),
   provider:String(v.author?.name||v.author?.fullname||v.modelId?.split('/')[0]||''),
   verified:v.verified===true,
   url:typeof v.source?.url==='string'&&v.source.url.startsWith('https://')?v.source.url:null,
   scores:{sweVerified:finiteScore(v.value)}
  })).filter(x=>x.name&&x.scores.sweVerified!=null);
 }else sources.swe.error=swe.status==='rejected'?String(swe.reason?.message||swe.reason):'Không có bảng xếp hạng hợp lệ';
 if(open.status==='fulfilled'&&Array.isArray(open.value?.models)){
  sources.open.updated=String(open.value.metadata?.lastUpdated||'Không công bố');
  sources.open.models=open.value.models.slice(0,600).map(v=>{
   const scores={},parts=Object.entries(v.benchmarks||{});let resultDate='';
   for(const [metric,info] of parts){
    const score=finiteScore(info?.score);if(score!=null)scores[metric]=score;
    if(info?.date&&(!resultDate||info.date>resultDate))resultDate=info.date;
   }
   return {id:String(v.id||''),name:String(v.name||''),provider:String(v.provider||''),coverage:parts.length,resultDate,scores};
  }).filter(x=>x.name&&Object.keys(x.scores).length);
 }else sources.open.error=open.status==='rejected'?String(open.reason?.message||open.reason):'Dữ liệu lịch sử không hợp lệ';
 if(!key){
  sources.aa.status='not_configured';
  sources.aa.error='Chưa có ARTIFICIAL_ANALYSIS_API_KEY trên Vercel. Đây không phải kết quả xếp hạng.';
 }else if(aa.status==='fulfilled'&&Array.isArray(aa.value?.data)){
  sources.aa.indexVersion=aa.value.intelligence_index_version;
  sources.aa.updated='Phiên bản Index v'+String(aa.value.intelligence_index_version??'—');
  sources.aa.models=aa.value.data.slice(0,250).map(v=>({
   id:String(v.id||''),name:String(v.name||''),provider:String(v.model_creator?.name||''),
   scores:{
    intelligence:finiteScore(v.evaluations?.artificial_analysis_intelligence_index),
    coding:finiteScore(v.evaluations?.artificial_analysis_coding_index),
    agentic:finiteScore(v.evaluations?.artificial_analysis_agentic_index)
   },
   ttft:typeof v.performance?.median_time_to_first_token_seconds==='number'?v.performance.median_time_to_first_token_seconds:null,
   tps:typeof v.performance?.median_output_tokens_per_second==='number'?v.performance.median_output_tokens_per_second:null,
   priceIn:typeof v.pricing?.price_1m_input_tokens==='number'?v.pricing.price_1m_input_tokens:null,
   priceOut:typeof v.pricing?.price_1m_output_tokens==='number'?v.pricing.price_1m_output_tokens:null
  }));
  if(aa.value.pagination?.has_more)sources.aa.warning='Chỉ hiển thị trang 1 theo quota API, không phải toàn bộ thị trường.';
 }else sources.aa.error=aa.status==='rejected'?String(aa.reason?.message||aa.reason):'Không nhận được dữ liệu Artificial Analysis';
 const payload={fetched_at:new Date().toISOString(),sources};
 benchCache=payload;benchCacheUntil=Date.now()+(sources.swe.models.length||sources.open.models.length||sources.aa.models.length?1800000:60000);
 return payload;
}

module.exports=async function handler(req,res){
 const url=new URL(req.url,'https://mach.example'),action=url.searchParams.get('action')||'health';
 if(req.method==='OPTIONS')return send(res,405,{error:'Unsupported method'});
 try {
  if(action==='benchmarks'&&req.method==='GET')return send(res,200,await benchmarkPayload(),1800);
  if(action==='health'&&req.method==='GET')return send(res,200,{mach:true,database:'connected',moderation:true,auth:'supabase',version:7});
  if(action==='metrics'&&req.method==='GET'){
   const ids=String(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,120);
   if(!METRICS_SECRET)return send(res,503,{error:'Analytics chưa được cấu hình.'});
   const visitor=metricVisitor(req,res,false);
   return send(res,200,await metricCounts(ids,visitor));
  }
  if(action==='track'&&req.method==='POST'){
   if(!METRICS_SECRET)return send(res,503,{error:'Analytics chưa được cấu hình.'});
   if(isAutomated(req))return send(res,200,{ok:true,skipped:true});
   const b=req.body||{};
   const evt=clean(b.event,20),articleId=clean(b.article_id,110),pageKey=clean(b.page,130);
   const channel=clean(b.channel,20);
   if(!['page','view','like','save','share'].includes(evt))return send(res,400,{error:'Loại sự kiện không hợp lệ.'});
   if(evt==='page'&&!/^\/[a-z0-9/_-]{0,129}$/.test(pageKey))return send(res,400,{error:'Đường dẫn không hợp lệ.'});
   if(evt!=='page'&&!/^[a-z0-9-]{3,110}$/.test(articleId))return send(res,400,{error:'ID bài viết không hợp lệ.'});
   if(evt==='share'&&!['copy','facebook','linkedin','native'].includes(channel))return send(res,400,{error:'Loại chia sẻ không hợp lệ.'});
   const visitor=metricVisitor(req,res,true);
   const result=await supa('POST',apiURL('rpc/mach_metrics_track'),{
     p_secret:METRICS_SECRET,p_visitor:visitor,p_event:evt,
     p_article:evt==='page'?null:articleId,p_page:evt==='page'?pageKey:null,p_channel:evt==='share'?channel:null
   });
   return send(res,200,result||{ok:true});
  }
  if(action==='analytics'&&req.method==='GET'){
   const {jwt}=await ensureAdmin(req);
   const result=await supa('POST',apiURL('rpc/mach_metrics_admin'),{},jwt);
   return send(res,200,result||{totals:{},daily:[],top_articles:[]});
  }
  // Lightweight public feed: no full article bodies; cache briefly at Vercel's edge.
  if(action==='feed'&&req.method==='GET'){
   const rows=await supa('GET',apiURL('mach_articles','select=id,title,excerpt,category,author,image,source_type,agent_name,created_at,published_at,status&status=eq.published&order=published_at.desc&limit=100'));
   return send(res,200,{posts:rows.map(mapPost)},15);
  }
  // Fetch a single article's complete body only when a reader opens it.
  if(action==='article'&&req.method==='GET'){
   const id=clean(url.searchParams.get('id'),110);
   if(!idOK(id))return send(res,400,{error:'ID bài viết không hợp lệ.'});
   const rows=await supa('GET',apiURL('mach_articles',`select=id,title,excerpt,category,author,image,body,source_urls,source_type,agent_name,created_at,published_at,status&id=eq.${id}&status=eq.published&limit=1`));
   if(!rows?.length)return send(res,404,{error:'Không tìm thấy bài viết.'});
   return send(res,200,{article:mapPost(rows[0])},30);
  }
  if(action==='posts'&&req.method==='GET'){const rows=await supa('GET',apiURL('mach_articles','select=id,title,excerpt,category,author,image,body,source_urls,source_type,agent_name,created_at,published_at,status&status=eq.published&order=published_at.desc&limit=100'));return send(res,200,{posts:rows.map(mapPost)});}
  if(action==='register'&&req.method==='POST'){
   const email=clean(req.body?.email,254).toLowerCase(),password=req.body?.password;
   if(email!=='tuanhuy1993@gmail.com')return send(res,403,{error:'Chỉ email được cấp quyền mới có thể khởi tạo Admin.'});
   if(typeof password!=='string'||password.length<12)return send(res,400,{error:'Mật khẩu cần tối thiểu 12 ký tự.'});
   await supa('POST',`${BASE}/auth/v1/signup`,{email,password});
   return send(res,200,{ok:true,message:'Đã gửi yêu cầu đăng ký. Hãy xác minh email nếu Supabase yêu cầu, sau đó đăng nhập.'});
  }
  if(action==='login'&&req.method==='POST'){
   const email=clean(req.body?.email,254),password=req.body?.password;
   if(!email||typeof password!=='string')return send(res,400,{error:'Thiếu email hoặc mật khẩu.'});
   const t=await supa('POST',`${BASE}/auth/v1/token?grant_type=password`,{email,password});
   const gate=await supa('GET',apiURL('mach_admin_gate','select=id&limit=1'),undefined,t.access_token);
   if(!gate?.length)return send(res,403,{error:'Tài khoản không được cấp quyền Admin hoặc email chưa được xác nhận.'});
   return send(res,200,{access_token:t.access_token,refresh_token:t.refresh_token,expires_at:Math.floor(Date.now()/1000)+t.expires_in,email:t.user?.email});
  }
  if(action==='refresh'&&req.method==='POST'){
   const token=clean(req.body?.refresh_token,4096);
   if(!token)return send(res,400,{error:'Thiếu refresh token.'});
   const t=await supa('POST',`${BASE}/auth/v1/token?grant_type=refresh_token`,{refresh_token:token});
   const gate=await supa('GET',apiURL('mach_admin_gate','select=id&limit=1'),undefined,t.access_token);
   if(!gate?.length)return send(res,403,{error:'Không có quyền Admin.'});
   return send(res,200,{access_token:t.access_token,refresh_token:t.refresh_token,expires_at:Math.floor(Date.now()/1000)+t.expires_in,email:t.user?.email});
  }
  if(action==='submit'&&req.method==='POST'||action==='agent-submit'&&req.method==='POST'){
   const isAgent=action==='agent-submit';
   if(isAgent&&!eq(req.headers['x-agent-key'],process.env.MACH_AGENT_KEY))return send(res,401,{error:'Agent API key không hợp lệ.'});
   const b=req.body||{};if(b.website)return send(res,202,{ok:true,status:'pending'});
   const v=article(b),hash=crypto.createHash('sha256').update((req.headers['x-forwarded-for']||req.socket?.remoteAddress||'')+'|'+(process.env.MACH_IP_SALT||'mach')).digest('hex');
   const generatedId=crypto.randomUUID();const payload={...v,id:generatedId,source_type:isAgent?'agent':'human',agent_name:isAgent?clean(b.agent_name||'AI Agent',100):null,ip_hash:hash,status:'pending'};
   await supa('POST',apiURL('mach_articles'),payload,undefined,'return=minimal');
   return send(res,202,{ok:true,status:'pending',id:generatedId,message:'Bài đã được gửi Admin duyệt, chưa xuất bản.'});
  }
  if(action==='queue'&&req.method==='GET'){
   const {jwt}=await ensureAdmin(req);
   const rows=await supa('GET',apiURL('mach_articles','select=*&order=created_at.desc&limit=200'),undefined,jwt);
   const comments=await supa('GET',apiURL('mach_comments','select=*&status=eq.pending&order=created_at.asc&limit=100'),undefined,jwt);
   return send(res,200,{articles:rows.map(mapPost),comments});
  }
  if(action==='moderate'&&req.method==='POST'){
   const {jwt,user}=await ensureAdmin(req);const {id,decision}=req.body||{};
   if(!idOK(id)||!['approve','reject'].includes(decision))return send(res,400,{error:'ID hoặc quyết định không hợp lệ.'});
   const now=new Date().toISOString(),status=decision==='approve'?'published':'rejected';
   const payload={status,reviewed_at:now,reviewed_by:user.id,review_note:clean(req.body.note,1200)||null,updated_at:now};if(status==='published')payload.published_at=now;
   const rows=await supa('PATCH',apiURL('mach_articles',`id=eq.${id}&status=eq.pending&select=id,status`),payload,jwt,'return=representation');
   if(!rows?.length)return send(res,409,{error:'Bài không còn ở trạng thái chờ duyệt.'});
   return send(res,200,{ok:true,id,status});
  }
  if(action==='edit'&&req.method==='POST'){
   const {jwt}=await ensureAdmin(req);const id=req.body?.id;if(!idOK(id))return send(res,400,{error:'ID không hợp lệ.'});
   const v=article(req.body);const rows=await supa('PATCH',apiURL('mach_articles',`id=eq.${id}&select=id,title`),{...v,updated_at:new Date().toISOString()},jwt,'return=representation');
   return send(res,rows?.length?200:404,rows?.length?{ok:true,id}:{error:'Không tìm thấy bài.'});
  }
  if(action==='comments'&&req.method==='GET'){
   const id=clean(url.searchParams.get('id'),110);if(!/^[\w-]{3,110}$/.test(id))return send(res,400,{error:'ID bài viết không hợp lệ.'});
   const rows=await supa('GET',apiURL('mach_comments',`select=name,text,created_at&article_id=eq.${encodeURIComponent(id)}&status=eq.approved&order=created_at.asc&limit=100`));
   return send(res,200,{comments:rows.map(x=>({name:x.name,text:x.text,date:x.created_at.slice(0,10)}))});
  }
  if(action==='comments'&&req.method==='POST'){
   const id=clean(req.body?.article_id,110),name=clean(req.body?.name,70),text=clean(req.body?.text,1600);
   if(!/^[\w-]{3,110}$/.test(id)||name.length<2||text.length<2)return send(res,400,{error:'Bình luận không hợp lệ.'});
   await supa('POST',apiURL('mach_comments'),{article_id:id,name,text,status:'pending'});
   return send(res,202,{ok:true,status:'pending',message:'Bình luận đã gửi, đang chờ Admin duyệt.'});
  }
  if(action==='moderate-comment'&&req.method==='POST'){
   const {jwt}=await ensureAdmin(req);const {id,decision}=req.body||{};
   if(!idOK(id)||!['approve','reject'].includes(decision))return send(res,400,{error:'Thông tin không hợp lệ.'});
   const status=decision==='approve'?'approved':'rejected';const rows=await supa('PATCH',apiURL('mach_comments',`id=eq.${id}&status=eq.pending&select=id,status`),{status,reviewed_at:new Date().toISOString()},jwt,'return=representation');
   return send(res,rows?.length?200:409,rows?.length?{ok:true,id,status}:{error:'Bình luận không còn chờ duyệt.'});
  }
  if(action==='subscribe'&&req.method==='POST'){
   const email=clean(req.body?.email,254).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))return send(res,400,{error:'Email không hợp lệ.'});
   await supa('POST',apiURL('mach_subscribers'),{email},undefined,'return=minimal,resolution=ignore-duplicates');
   return send(res,200,{ok:true});
  }
  return send(res,404,{error:'Không tìm thấy API.'});
 }catch(e){console.error('[MACH]',action,e.status||500,String(e.message).slice(0,160));return send(res,e.status>=400&&e.status<500?e.status:502,{error:e.status===401?'Thông tin xác thực không hợp lệ.':(e.status===403?'Không đủ quyền thực hiện thao tác.':'Yêu cầu chưa thành công. Vui lòng thử lại.')});}
};