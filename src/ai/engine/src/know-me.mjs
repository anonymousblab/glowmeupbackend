import { ensure, copy, userId } from './errors.mjs';
import { validate, validateProfile, profileSchema, quizSchema, visionSchema, PROFILE_PATHS } from './contracts.mjs';
import { TAXONOMY as T, CONTRACT_VERSION } from './taxonomy.mjs';

export function scoreStyleQuiz(choices=[]) {
  validate(quizSchema,{choices});
  const scores=Object.fromEntries(T.style.map(s=>[s,0]));
  for(const choice of choices) for(const tag of choice.tags) scores[tag]+=choice.weight??1;
  const ranked=T.style.filter(s=>scores[s]>0).sort((a,b)=>scores[b]-scores[a] || T.style.indexOf(a)-T.style.indexOf(b));
  return {primary:ranked[0]??null,secondary:ranked[1]??null,scores,source:'quiz',confirmed:false};
}
export function emptyProfile() {
  return {contract_version:CONTRACT_VERSION,profile_version:1,
    style_profile:{primary:null,secondary:null,scores:{},source:'unknown',confirmed:false},
    color_profile:{skin_depth:null,undertone:'unknown',liked_color_families:[],avoided_color_families:[],photo_estimate_confirmed:false},
    body_profile:{apparent_shape:null,preferred_silhouettes:[],preferred_fit:null,measurements:null},
    lifestyle:{occasions:[],styling_goals:[]},preferences:{coverage_requirements:[],liked_patterns:[],avoided_patterns:[],disliked_styles:[]},provenance:{}};
}
export function getPath(profile,path) {return path.split('.').reduce((value,k)=>value?.[k],profile);}
const nonempty=value=>value!==null && value!=='unknown' && (!Array.isArray(value)||value.length>0);
export function mergeUserConfirmedValues(base,changes={}) {
  ensure(changes&&typeof changes==='object'&&!Array.isArray(changes)&&Object.keys(changes).every(p=>PROFILE_PATHS.includes(p)));
  const draft=copy(base);
  for(const [path,value]of Object.entries(changes)){const [section,key]=path.split('.');draft[section][key]=copy(value);draft.provenance[path]='user_confirmed';}
  validateProfile(draft);return draft;
}
export function confirmedContext(profile) {
  if(!profile) return null;
  validateProfile(profile);
  const subset=emptyProfile(); subset.profile_version=profile.profile_version;
  for(const path of PROFILE_PATHS) {
    if(!['user_confirmed','user_provided'].includes(profile.provenance[path])) continue;
    if(path.startsWith('style_profile.')&&!profile.style_profile.confirmed) continue;
    // Keep biometric/physical estimates out of the chat/recommendation minimum.
    if(['color_profile.skin_depth','color_profile.undertone','body_profile.apparent_shape','body_profile.measurements'].includes(path)) continue;
    const [section,field]=path.split('.');subset[section][field]=copy(getPath(profile,path));subset.provenance[path]=profile.provenance[path];
  }
  subset.style_profile.confirmed=profile.style_profile.confirmed;
  subset.style_profile.source=profile.style_profile.source;
  return subset;
}
export class ProfileWorkspace {
  // Memory fixture repository only; replace with Caca's actual session/repository adapters.
  #saved=new Map(); #drafts=new Map(); #events=new Map();
  get(principal) {return copy(this.#saved.get(userId(principal))??null);}
  getDraft(principal) {return copy(this.#drafts.get(userId(principal))??null);}
  begin(principal,choices=[],answers={}) {
    const id=userId(principal);const draft=this.get(principal)??emptyProfile();
    const allowed=['color_profile','body_profile','lifestyle','preferences'];
    ensure(answers && typeof answers==='object'&&!Array.isArray(answers)&&Object.keys(answers).every(k=>allowed.includes(k)));
    for(const [section,fields] of Object.entries(answers)) {
      validate({...profileSchema.properties[section],required:[]},fields);
      Object.assign(draft[section],copy(fields));
      for(const field of Object.keys(fields))if(PROFILE_PATHS.includes(`${section}.${field}`))draft.provenance[`${section}.${field}`]='user_provided';
    }
    draft.style_profile=scoreStyleQuiz(choices);
    draft.provenance['style_profile.primary']='quiz_inferred';draft.provenance['style_profile.secondary']='quiz_inferred';
    validateProfile(draft); this.#drafts.set(id,copy(draft));return copy(draft);
  }
  confirm(principal,changes={},expectedVersion=0,{forceRevision=false}={}) {
    ensure(typeof forceRevision==='boolean');
    const id=userId(principal),saved=this.get(principal);
    ensure((saved?.profile_version??0)===expectedVersion,'VERSION_CONFLICT','Profil telah berubah; muat ulang.',409);
    const pending=this.#drafts.get(id)??saved;
    ensure(pending,'PROFILE_NOT_FOUND','Isi quiz terlebih dahulu.',404);
    const draft=mergeUserConfirmedValues(pending,changes);
    draft.style_profile.confirmed=true; draft.style_profile.source='user_confirmed';
    for(const path of PROFILE_PATHS) if(nonempty(getPath(draft,path))) draft.provenance[path]='user_confirmed';
    if(draft.color_profile.skin_depth!==null || draft.color_profile.undertone!=='unknown') draft.color_profile.photo_estimate_confirmed=true;
    validateProfile(draft);
    const comparable=p=>{const v=copy(p);delete v.profile_version;return JSON.stringify(v);};
    draft.profile_version=saved && !forceRevision && comparable(saved)===comparable(draft)?saved.profile_version:(saved?.profile_version??0)+1;
    this.#saved.set(id,copy(draft));this.#drafts.delete(id);
    if(draft.profile_version!==(saved?.profile_version??0))this.#events.set(id,[...(this.#events.get(id)??[]),{type:'KNOWME_PROFILE_UPDATED',profile_version:draft.profile_version}]);
    return copy(draft);
  }
  drainEvents(principal) {const id=userId(principal);const events=this.#events.get(id)??[];this.#events.delete(id);return copy(events);}
  delete(principal) {const id=userId(principal);this.#saved.delete(id);this.#drafts.delete(id);this.#events.delete(id);}
}
export function validateVision(result,captureType) {
  validate(visionSchema,result);ensure(result.capture_type===captureType,'INVALID_AI_RESPONSE','Tipe foto tidak sesuai.');
  const attrs=result.observed_attributes;
  ensure(captureType!=='face'||attrs.body_silhouette_apparent===null,'INVALID_AI_RESPONSE','Foto wajah tidak boleh menghasilkan bentuk tubuh.');
  ensure(captureType!=='body'||attrs.skin_depth_apparent===null,'INVALID_AI_RESPONSE','Foto tubuh tidak digunakan untuk analisis warna wajah.');
  if(result.analysis_status==='insufficient_evidence') ensure(attrs.skin_depth_apparent===null&&attrs.body_silhouette_apparent===null&&attrs.photo_clothing_coverage.length===0,'INVALID_AI_RESPONSE','Bukti tidak cukup harus menghasilkan nilai kosong.');
  return copy(result);
}
export function visionReviewPatch(result,acceptedFields=[]) {
  validateVision(result,result.capture_type);
  ensure(Array.isArray(acceptedFields)&&acceptedFields.every(p=>['color_profile.skin_depth','body_profile.apparent_shape'].includes(p)));
  ensure(result.analysis_status==='ok'||acceptedFields.length===0,'INSUFFICIENT_EVIDENCE','Tidak ada atribut yang dapat dikonfirmasi.');
  const mapping={'color_profile.skin_depth':result.observed_attributes.skin_depth_apparent,'body_profile.apparent_shape':result.observed_attributes.body_silhouette_apparent};
  ensure(acceptedFields.every(p=>mapping[p]!==null),'INVALID_INPUT','Tidak bisa menerima atribut kosong.');
  // Explicit user review is required; this patch never writes a profile on its own.
  return Object.fromEntries(acceptedFields.map(p=>[p,mapping[p]]));
}
