import OpenAI from 'openai';
import { DomainError,ensure } from '../src/errors.mjs';
import { validate } from '../src/contracts.mjs';
import { openaiConfigured } from './config.mjs';

// Conservative uncached estimate; documentation checked 2026-11-12. No model fallback.
export function modelRates(model){return /^gpt-4\.1-mini(?:-2025-04-14)?$/.test(model)?{input:0.40,output:1.60}:null;}
export function structuredSchema(schema){
  if(Array.isArray(schema))return schema.map(structuredSchema);
  if(!schema||typeof schema!=='object')return schema;
  const result={};
  for(const [key,value]of Object.entries(schema))if(key!=='uniqueItems')result[key]=structuredSchema(value);
  if('const'in result){const value=result.const;delete result.const;result.enum=[value];result.type=typeof value;}
  if(result.type==='object')ensure(result.additionalProperties===false&&Object.keys(result.properties??{}).every(key=>result.required?.includes(key)),'OPENAI_SCHEMA_UNSUPPORTED','Semua field output OpenAI harus required.');
  return result;
}
export function sanitizedOpenAIError(error){
  if(error instanceof DomainError)return error;
  if(['AbortError','APIConnectionTimeoutError','TimeoutError'].includes(error?.name))return new DomainError('AI_TIMEOUT','OpenAI terlalu lama merespons.',504,true);
  const status=Number(error?.status);
  if(status===400)return new DomainError('AI_REQUEST_REJECTED','OpenAI menolak request/model/schema. Periksa konfigurasi backend.',502);
  if(status===401)return new DomainError('AI_AUTH_FAILED','Kredensial OpenAI tidak valid.',503);
  if(status===403)return new DomainError('AI_PERMISSION_DENIED','Project tidak diizinkan menggunakan model OpenAI ini.',503);
  if(status===404)return new DomainError('AI_MODEL_UNAVAILABLE','Model OpenAI tidak tersedia pada project ini. Tidak ada pergantian model otomatis.',503);
  if(status===429)return new DomainError(error?.code==='insufficient_quota'?'AI_QUOTA_EXHAUSTED':'AI_RATE_LIMITED',error?.code==='insufficient_quota'?'Kuota/kredit OpenAI tidak tersedia.':'Rate limit OpenAI tercapai.',429,error?.code!=='insufficient_quota');
  return new DomainError('AI_UNAVAILABLE','Layanan OpenAI tidak tersedia. Profil manual dan Suits Me tetap dapat dipakai.',503,true);
}
export class OpenAIProvider{
  kind='openai';#config;#client;#calls=0;#inputTokens=0;#outputTokens=0;#reserved=0;#estimated=0;#active=false;#verified=new Set();#last=null;
  constructor(config,client=null){this.#config=config;this.#client=client;}
  diagnostics(){const c=this.#config;return {mode:openaiConfigured(c)?(this.#verified.size?'openai_live_verified':'openai_configured_unverified'):'offline',selected_provider:'openai',model:c.chatModel,chat_model:c.chatModel,vision_model:c.visionModel,model_access_verified:this.#verified.size>0,live_tested:this.#verified.size>0,calls_this_run:this.#calls,call_cap:c.maxCalls,input_tokens:this.#inputTokens,output_tokens:this.#outputTokens,estimated_cost_usd:this.#estimated,reserved_cost_usd:this.#reserved,budget_usd:c.budgetUsd,verified_models:[...this.#verified]};}
  lastEvidence(){return this.#last?structuredClone(this.#last):null;}
  async generate({instructions,context,schema,image=null,task='chat',signal=null}){
    const c=this.#config;
    ensure(openaiConfigured(c),'AI_NOT_CONFIGURED','OpenAI belum aktif atau key baru belum dikonfirmasi. Gunakan profil manual dan Suits Me.',503);
    ensure(!signal?.aborted,'AI_CANCELLED','Request dibatalkan sebelum dikirim.',499);
    ensure(!this.#active,'AI_BUSY','Tunggu request AI sebelumnya selesai.',429);
    ensure(this.#calls<c.maxCalls,'AI_CALL_CAP','Batas panggilan OpenAI proses ini tercapai.',429);
    const model=(task==='vision'||image)?c.visionModel:c.chatModel,rates=modelRates(model);
    ensure(rates,'AI_PRICING_UNVERIFIED','Tarif model ini belum diaudit untuk batas US$0.50. Jangan mengganti model tanpa review.',503);
    const contextText=JSON.stringify(context);ensure(Buffer.byteLength(contextText)<=40000,'CONTEXT_TOO_LARGE','Konteks terlalu panjang.');
    const format=structuredSchema(schema);
    // UTF-8 bytes overestimate text tokens. Image reserve exceeds the configured 1024px input budget.
    const inputReserve=Buffer.byteLength(JSON.stringify({instructions,context,schema:format}))+4096+(image?16000:0);
    const reservation=(inputReserve*rates.input+c.maxOutputTokens*rates.output)/1000000;
    ensure(this.#reserved+reservation<=c.budgetUsd,'AI_BUDGET_CAP','Batas estimasi budget OpenAI proses ini tercapai.',429);
    this.#client??=new OpenAI({apiKey:c.key,baseURL:'https://api.openai.com/v1',logLevel:'off',maxRetries:0,timeout:c.timeoutMs});
    this.#active=true;this.#calls++;this.#reserved+=reservation;
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    let timer;this.#last={provider:'openai',model,http_status:null,status:'FAILED',input_tokens:0,output_tokens:0,estimated_cost_usd:null};
    try{
      const content=[{type:'input_text',text:contextText}];
      if(image)content.push({type:'input_image',image_url:`data:${image.mimeType};base64,${image.data}`,detail:'low'});
      const pending=this.#client.responses.create({model,instructions,input:[{role:'user',content}],text:{format:{type:'json_schema',name:task==='vision'?'know_me_vision':'glowy_response',strict:true,schema:format}},store:false,max_output_tokens:c.maxOutputTokens},{maxRetries:0,timeout:c.timeoutMs,signal:controller.signal}).withResponse();
      const {data,response,request_id}=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DomainError('AI_TIMEOUT','OpenAI terlalu lama merespons.',504,true));},c.timeoutMs);})]);
      const input=Number(data.usage?.input_tokens)||0,output=Number(data.usage?.output_tokens)||0,estimate=(input*rates.input+output*rates.output)/1000000;
      this.#inputTokens+=input;this.#outputTokens+=output;this.#estimated+=estimate;
      this.#last={provider:'openai',model:data.model??model,http_status:response.status,request_id:request_id??null,status:'FAILED',input_tokens:input,output_tokens:output,estimated_cost_usd:estimate};
      ensure(data.status==='completed','AI_INCOMPLETE','OpenAI tidak menghasilkan jawaban lengkap.',502);
      ensure(!(data.output??[]).some(item=>(item.content??[]).some(part=>part.type==='refusal')),'AI_REFUSED','OpenAI tidak dapat memenuhi permintaan ini.',422);
      const text=data.output_text??(data.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==='output_text').map(part=>part.text).join('');
      ensure(typeof text==='string'&&text.trim().length>0&&text.length<=20000,'INVALID_AI_RESPONSE','Jawaban OpenAI kosong atau terlalu panjang.',502);
      let result;try{result=JSON.parse(text);validate(schema,result);}catch{throw new DomainError('INVALID_AI_RESPONSE','Jawaban OpenAI tidak sesuai kontrak JSON.',502);}
      this.#verified.add(model);this.#last.status='PASS';return result;
    }catch(error){const safe=sanitizedOpenAIError(error),networkCode=error?.cause?.code;this.#last={...this.#last,status:'FAILED',error_code:safe.code,http_status:this.#last.http_status??(Number(error?.status)||null),network_failure_code:['EACCES','ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(networkCode)?networkCode:null};throw safe;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#active=false;}
  }
}
