import { ensure } from './errors.mjs';
import { TAXONOMY as T, CONTRACT_VERSION } from './taxonomy.mjs';

const text = (maxLength=500) => ({type:'string',minLength:1,maxLength});
const en = values => ({type:'string',enum:values});
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const list = (items,maxItems=30) => ({type:'array',items,maxItems,uniqueItems:true});
const obj = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const sources=['user_confirmed','user_provided','quiz_inferred','ai_estimated','unknown'];
export const PROFILE_PATHS = [
  'style_profile.primary','style_profile.secondary','color_profile.skin_depth','color_profile.undertone',
  'color_profile.liked_color_families','color_profile.avoided_color_families','body_profile.apparent_shape',
  'body_profile.preferred_silhouettes','body_profile.preferred_fit','body_profile.measurements',
  'lifestyle.occasions','lifestyle.styling_goals','preferences.coverage_requirements',
  'preferences.liked_patterns','preferences.avoided_patterns','preferences.disliked_styles',
];
const provenance = obj(Object.fromEntries(PROFILE_PATHS.map(p=>[p,en(sources)])),[]);
const measurements = obj(Object.fromEntries(['height_cm','bust_cm','waist_cm','hip_cm'].map(k=>[k,{type:'number',minimum:1,maximum:400}])),[]);
export const profileSchema = obj({
  contract_version:{const:CONTRACT_VERSION}, profile_version:{type:'integer',minimum:1},
  style_profile:obj({primary:nullable(en(T.style)),secondary:nullable(en(T.style)),scores:obj(Object.fromEntries(T.style.map(s=>[s,{type:'number',minimum:0,maximum:10000}])),[]),source:en(['quiz','user_confirmed','user_provided','ai_estimated','unknown']),confirmed:{type:'boolean'}}),
  color_profile:obj({skin_depth:nullable(text(60)),undertone:nullable(en(['unknown','warm','cool','neutral','olive'])),liked_color_families:list(en(T.color)),avoided_color_families:list(en(T.color)),photo_estimate_confirmed:{type:'boolean'}}),
  body_profile:obj({apparent_shape:nullable(text(80)),preferred_silhouettes:list(en(T.silhouette)),preferred_fit:nullable(text(40)),measurements:nullable(measurements)}),
  lifestyle:obj({occasions:list(en(T.occasion)),styling_goals:list(text(120),10)}),
  preferences:obj({coverage_requirements:list(en(T.requiredCoverage)),liked_patterns:list(en(T.pattern)),avoided_patterns:list(en(T.pattern)),disliked_styles:list(en(T.style))}),
  provenance,
});
export const quizSchema = obj({choices:{type:'array',maxItems:12,items:obj({tags:list(en(T.style),3),weight:{type:'number',minimum:0,maximum:3}},['tags'])}});
export const visionSchema = obj({
  analysis_status:en(['ok','insufficient_evidence']),capture_type:en(['face','body']),
  observed_attributes:obj({skin_depth_apparent:nullable(text(60)),undertone:{const:'unknown'},body_silhouette_apparent:nullable(text(80)),photo_clothing_coverage:list(en(T.coverage))}),
  quality_warnings:list(text(),10),reasons:list(text(),10),confidence_note:text(),requires_user_confirmation:{const:true},
});
export const glowyOutputSchema = obj({reply:text(4000),mode:en(['general','profile_styling','catalog_grounded','photo_analysis','post_discussion']),referenced_product_ids:list(text(20),5),uncertainties:list(text(),10),follow_up_question:nullable(text())});
export const glowyRequestSchema = obj({message:text(2000),product_id:nullable(text(20)),post_id:nullable(text(100)),uploaded_image_token:nullable(text(100))},['message']);
export const postInputSchema = obj({media_key:text(100),caption:text(2000),visibility:en(['public','private']),publication_consent:{type:'boolean'}});
export const feedbackSchema = obj({product_id:text(20),action:en(['save','not_my_style'])});

// Validates ONLY the documented schema subset emitted here; unknown keywords fail closed.
const keywords = new Set(['type','const','enum','anyOf','properties','required','additionalProperties','items','maxItems','uniqueItems','minLength','maxLength','minimum','maximum']);
export function validate(schema,value,path='$') {
  ensure(Object.keys(schema).every(k=>keywords.has(k)), 'SCHEMA_UNSUPPORTED','Schema keyword belum didukung.');
  if (schema.anyOf) {
    ensure(schema.anyOf.some(s=>{try{validate(s,value,path);return true;}catch{return false;}}),'INVALID_INPUT',`Nilai tidak valid pada ${path}.`); return value;
  }
  if ('const' in schema) ensure(value===schema.const,'INVALID_INPUT',`Konstanta tidak valid pada ${path}.`);
  if (schema.enum) ensure(schema.enum.includes(value),'INVALID_INPUT',`Enum tidak valid pada ${path}.`);
  const type=schema.type;
  if(type==='object') {
    ensure(value!==null && typeof value==='object' && !Array.isArray(value),'INVALID_INPUT',`Object diperlukan pada ${path}.`);
    ensure((schema.required??[]).every(k=>Object.hasOwn(value,k)),'INVALID_INPUT',`Field wajib hilang pada ${path}.`);
    ensure(schema.additionalProperties!==false || Object.keys(value).every(k=>Object.hasOwn(schema.properties??{},k)),'INVALID_INPUT',`Field tidak dikenal pada ${path}.`);
    for(const [k,v] of Object.entries(value)) if(Object.hasOwn(schema.properties??{},k)) validate(schema.properties[k],v,`${path}.${k}`);
  } else if(type==='array') {
    ensure(Array.isArray(value),'INVALID_INPUT',`Array diperlukan pada ${path}.`);
    ensure(value.length<=(schema.maxItems??Infinity),'INVALID_INPUT',`Terlalu banyak item pada ${path}.`);
    ensure(!schema.uniqueItems || new Set(value.map(v=>JSON.stringify(v))).size===value.length,'INVALID_INPUT',`Duplikasi pada ${path}.`);
    value.forEach((v,i)=>validate(schema.items,v,`${path}[${i}]`));
  } else if(type==='string') ensure(typeof value==='string' && value.trim().length>=(schema.minLength??0) && value.length<=(schema.maxLength??Infinity),'INVALID_INPUT',`String tidak valid pada ${path}.`);
  else if(type==='integer'||type==='number') ensure(typeof value==='number' && Number.isFinite(value) && (type!=='integer'||Number.isInteger(value)) && value>=(schema.minimum??-Infinity) && value<=(schema.maximum??Infinity),'INVALID_INPUT',`Angka tidak valid pada ${path}.`);
  else if(type==='boolean') ensure(typeof value==='boolean','INVALID_INPUT',`Boolean diperlukan pada ${path}.`);
  else if(type==='null') ensure(value===null,'INVALID_INPUT',`Null diperlukan pada ${path}.`);
  return value;
}
export function validateProfile(profile) {
  validate(profileSchema,profile);
  ensure(profile.style_profile.primary!==profile.style_profile.secondary || profile.style_profile.primary===null,'INVALID_INPUT','Gaya utama dan sekunder harus berbeda.');
  return profile;
}
