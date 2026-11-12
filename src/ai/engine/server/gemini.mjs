import { GoogleGenAI } from '@google/genai';
import { DomainError,ensure } from '../src/errors.mjs';
import { providerConfigured } from './config.mjs';

export function sanitizedProviderError(error) {
  if(error instanceof DomainError)return error;
  if(error?.name==='AbortError'||error?.name==='TimeoutError')return new DomainError('AI_TIMEOUT','Gemini terlalu lama merespons.',504,true);
  const code=Number(error?.status??error?.code);
  if(code===400)return new DomainError('AI_REQUEST_REJECTED','Provider menolak konfigurasi request. Periksa model dan schema server.',502);
  if(code===401)return new DomainError('AI_AUTH_FAILED','Kredensial provider tidak valid.',503);
  if(code===403)return new DomainError('AI_PERMISSION_DENIED','Project tidak diizinkan memakai layanan/model ini.',503);
  if(code===404)return new DomainError('AI_MODEL_UNAVAILABLE','Model tidak tersedia pada project ini.',503);
  if(code===429)return new DomainError('AI_RATE_LIMITED','Kuota atau rate limit Gemini tercapai.',429,true);
  return new DomainError('AI_UNAVAILABLE','Layanan Gemini belum tersedia. Gunakan alur manual.',503,true);
}
function jsonSchema(schema) {
  if(Array.isArray(schema))return schema.map(jsonSchema);
  if(!schema||typeof schema!=='object')return schema;
  const out={};for(const [k,v] of Object.entries(schema))if(k!=='uniqueItems')out[k]=jsonSchema(v);
  if('const' in out){const value=out.const;delete out.const;out.type=typeof value;out.enum=[value];}
  return out;
}
export class GeminiProvider {
  kind='gemini';
  #config;#client;#calls=0;#callWindowStartedAt=Date.now();#inputTokens=0;#outputTokens=0;#active=false;
  constructor(config,client=null){this.#config=config;this.#client=client;}
  #refreshCallWindow(){const now=Date.now();if(now-this.#callWindowStartedAt>=this.#config.callWindowMs){this.#calls=0;this.#callWindowStartedAt=now;}}
  diagnostics(){return {mode:providerConfigured(this.#config)?'gemini_configured_unverified':'offline',model:this.#config.model||null,model_access_verified:false,live_tested:false,calls_this_run:this.#calls,calls_in_window:this.#calls,call_cap:this.#config.maxCalls,call_window_ms:this.#config.callWindowMs,input_tokens:this.#inputTokens,output_tokens:this.#outputTokens};}
  async generate({instructions,context,schema,image=null,signal=null}) {
    ensure(providerConfigured(this.#config),'AI_NOT_CONFIGURED','Gemini belum diaktifkan. Gunakan Know Me manual dan Suits Me offline.',503);
    ensure(!signal?.aborted,'AI_CANCELLED','Request dibatalkan sebelum dikirim.',499);
    ensure(!this.#active,'AI_BUSY','Tunggu request sebelumnya selesai.',429);
    this.#refreshCallWindow();
    ensure(this.#calls<this.#config.maxCalls,'AI_CALL_CAP','Batas panggilan Gemini pada jendela waktu ini tercapai.',429,true);
    const text=JSON.stringify(context);ensure(Buffer.byteLength(text)<40000,'CONTEXT_TOO_LARGE','Konteks terlalu panjang.');
    this.#client??=new GoogleGenAI({apiKey:this.#config.key,httpOptions:{timeout:this.#config.timeoutMs,retryOptions:{attempts:1}}});
    this.#active=true;this.#calls++;
    const controller=new AbortController();
    const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    let timeout;
    try {
      const parts=[{text}];if(image)parts.push({inlineData:{mimeType:image.mimeType,data:image.data}});
      const operation=this.#client.models.generateContent({model:this.#config.model,contents:[{role:'user',parts}],config:{systemInstruction:instructions,responseMimeType:'application/json',responseJsonSchema:jsonSchema(schema),maxOutputTokens:2048,automaticContinuation:false,abortSignal:controller.signal,httpOptions:{timeout:this.#config.timeoutMs,retryOptions:{attempts:1}}}});
      const result=await Promise.race([operation,new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new DomainError('AI_TIMEOUT','Gemini terlalu lama merespons.',504,true));},this.#config.timeoutMs);})]);
      this.#inputTokens+=Number(result.usageMetadata?.promptTokenCount)||0;this.#outputTokens+=Number(result.usageMetadata?.candidatesTokenCount)||0;
      if(result.promptFeedback?.blockReason)throw new DomainError('AI_REFUSED','Provider tidak dapat memproses permintaan ini.',422);
      const finish=result.candidates?.[0]?.finishReason;
      if(finish&&finish!=='STOP')throw new DomainError(finish==='MAX_TOKENS'?'AI_INCOMPLETE':'AI_REFUSED','Provider tidak menghasilkan jawaban lengkap yang dapat digunakan.',502,finish==='MAX_TOKENS');
      ensure(typeof result.text==='string'&&result.text.length<=20000,'INVALID_AI_RESPONSE','Respons provider tidak valid.',502);
      try{return JSON.parse(result.text);}catch{throw new DomainError('INVALID_AI_RESPONSE','Respons Gemini bukan JSON yang valid.',502);}
    }catch(error){throw sanitizedProviderError(error);}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);this.#active=false;}
  }
}
