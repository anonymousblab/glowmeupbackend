import { ensure,copy,DomainError } from './errors.mjs';
import { validate,glowyOutputSchema } from './contracts.mjs';
import { confirmedContext } from './know-me.mjs';

export class DisabledProvider {
  kind='disabled';
  async complete() {throw new DomainError('AI_NOT_CONFIGURED','Provider AI belum diaktifkan.',503);}
}
export async function completeOffline(provider,request) {
  ensure(['mock','disabled'].includes(provider?.kind),'PAID_API_DISABLED','Hanya provider offline yang diizinkan.');
  try {return await provider.complete(request);}
  catch(error) {
    // Do not return raw transport errors, request text, credentials or upstream bodies.
    if(error instanceof DomainError)throw error;
    throw new DomainError('AI_UNAVAILABLE','Provider sedang tidak tersedia. Coba lagi nanti.',503,true);
  }
}
export class MockProvider {
  kind='mock'; calls=[];
  constructor(responder=null) {this.responder=responder;}
  async complete(request) {
    this.calls.push(copy(request));
    if(this.responder)return this.responder(copy(request));
    if(request.task==='know_me_vision') return {
      analysis_status:'insufficient_evidence',capture_type:request.capture_type,
      observed_attributes:{skin_depth_apparent:null,undertone:'unknown',body_silhouette_apparent:null,photo_clothing_coverage:[]},
      quality_warnings:['Fixture offline; tidak ada analisis pixel.'],reasons:['Provider mock tidak melakukan inference.'],confidence_note:'Mock only; konfirmasi pengguna diperlukan.',requires_user_confirmation:true};
    const c=request.context;
    return {reply:c.catalog_candidates.length?'[MOCK] Berikut kandidat dari katalog; alasan pencocokan disiapkan engine offline.':'[MOCK] Aku bisa membantu ide styling umum; belum ada kandidat katalog.',
      mode:c.authorized_post?'post_discussion':c.image_attachment?'photo_analysis':c.catalog_candidates.length?'catalog_grounded':c.glow_profile?'profile_styling':'general',
      referenced_product_ids:c.allowed_product_ids.slice(0,2),uncertainties:['Respons fixture offline, bukan inference GPT.'],follow_up_question:null};
  }
}
export function buildGlowyContext({profile=null,candidates=[],catalog,message='',requestedProductId=null,authorizedPost=null,imageAttachment=null,maxProducts=5,occasion=null}) {
  ensure(Number.isInteger(maxProducts)&&maxProducts>=1&&maxProducts<=5,'INVALID_LIMIT','Konteks dibatasi 1–5 produk.');
  ensure(typeof message==='string'&&message.trim().length>0&&message.length<=2000);
  ensure(Array.isArray(candidates)&&Array.isArray(catalog));
  const known=new Map(catalog.map(i=>[i.product_id,i]));
  ensure(candidates.every(p=>known.has(p.product_id)),'UNKNOWN_PRODUCT','Kandidat di luar katalog.',404);
  ensure(new Set(candidates.map(p=>p.product_id)).size===candidates.length,'INVALID_CATALOG','Duplikasi kandidat.');
  if(requestedProductId)ensure(known.has(requestedProductId)&&candidates.some(p=>p.product_id===requestedProductId),'UNKNOWN_PRODUCT','Produk tidak ditemukan atau dikecualikan oleh batasan aktif.',404);
  const bounded=requestedProductId?[...candidates.filter(p=>p.product_id===requestedProductId),...candidates.filter(p=>p.product_id!==requestedProductId)].slice(0,maxProducts):candidates.slice(0,maxProducts);
  const context={
    glow_profile:confirmedContext(profile),allowed_product_ids:bounded.map(p=>p.product_id),
    catalog_candidates:bounded.map(p=>{const row=known.get(p.product_id);return {
      product_id:row.product_id,group:row.group,subcategory:row.subcategory,style_tags:copy(row.style_tags),occasion_tags:copy(row.occasion_tags),
      color_family:row.color_family,pattern_tags:copy(row.pattern_tags),apparent_silhouette:row.apparent_silhouette,coverage_tags:copy(row.coverage_tags),
      matched_tags:validatedMatches(p.matched_tags??[],row),review_status:row.review_status,source_rights_status:row.source_rights_status,
    };}),
    requested_product_id:requestedProductId,authorized_post:authorizedPost?{post_id:authorizedPost.post_id,caption:authorizedPost.caption,media_reference:{media_key:authorizedPost.media_key,data_kind:'mock_metadata_only'}}:null,
    image_attachment:imageAttachment?{media_key:imageAttachment.media_key,purpose:imageAttachment.purpose,data_kind:'mock_metadata_only'}:null,
    current_user_message:message,current_occasion:occasion,data_status:'OFFLINE_DEMO_ONLY',
  };
  ensure(JSON.stringify(context).length<=24000,'CONTEXT_TOO_LARGE','Konteks melewati batas lokal.');
  return context;
}
function validatedMatches(matches,item) {
  const facts={style:item.style_tags,occasion:item.occasion_tags,color:[item.color_family],silhouette:[item.apparent_silhouette],pattern:item.pattern_tags};
  ensure(Array.isArray(matches)&&matches.length<=20&&matches.every(m=>m&&Object.keys(m).every(k=>['signal','value'].includes(k))&&facts[m.signal]?.includes(m.value)),'INVALID_CATALOG','Alasan tidak sesuai fakta katalog.');
  return copy(matches);
}
export function validateGlowyOutput(output,allowedIds) {
  try{validate(glowyOutputSchema,output);}catch{throw new DomainError('INVALID_AI_RESPONSE','Respons tidak sesuai skema.',502);}
  ensure(output.referenced_product_ids.every(id=>allowedIds.includes(id)),'INVALID_AI_RESPONSE','Produk di luar shortlist.',502);
  ensure(output.mode!=='catalog_grounded'||output.referenced_product_ids.length>0,'INVALID_AI_RESPONSE','Mode katalog memerlukan referensi produk.',502);
  const allText=[output.reply,...output.uncertainties,output.follow_up_question??''].join('\n');
  ensure(!/https?:\/\/|www\.|<[^>]+>|\]\(|sk-[a-z0-9_-]{12,}/i.test(allText),'INVALID_AI_RESPONSE','Respons mengandung link/markup/secret tidak diizinkan.',502);
  // Stop obvious unsupported price/percentage claims; semantic safety still needs live evaluation.
  ensure(!/(?:\brp\.?\s*\d|\bidr\s*\d|\$\s*\d|\d\s*%)/i.test(allText),'INVALID_AI_RESPONSE','Harga atau persentase kecocokan tidak didukung.',502);
  return copy(output);
}
